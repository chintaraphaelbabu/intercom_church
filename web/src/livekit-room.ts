import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  createLocalAudioTrack,
} from "livekit-client";
import type {
  LocalAudioTrack,
  Participant,
  RemoteAudioTrack,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
} from "livekit-client";
import type {
  AudioRouteLabels,
  DirectorMediaToken,
  DirectorRoom,
  DirectorRoomParticipant,
  MediaConnectionState,
} from "./media";

interface TokenResponse {
  url: string;
  token: string;
  error?: string;
}

export interface DirectorTokenRequest {
  identity?: string;
  name?: string;
  role?: "director" | "operator";
  room?: string;
}

/**
 * Ask the control server for a short-lived LiveKit token. The secret never
 * reaches the browser. New room flows use the credentials in `joined`; this
 * remains the fallback for a standalone Director.
 */
export async function fetchDirectorToken(
  request: DirectorTokenRequest = {},
): Promise<DirectorMediaToken> {
  const response = await fetch("/api/livekit-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identity: request.identity ?? "director",
      name: request.name ?? "Director",
      role: request.role ?? "director",
      ...(request.room === undefined ? {} : { room: request.room }),
    }),
  });

  const body = (await response.json().catch(() => ({}))) as Partial<TokenResponse>;
  if (!response.ok || body.token === undefined || body.url === undefined) {
    throw new Error(body.error ?? `The control server answered HTTP ${response.status}.`);
  }
  return { url: body.url, token: body.token };
}

function mapConnectionState(state: ConnectionState): MediaConnectionState {
  switch (state) {
    case ConnectionState.Connected:
      return "connected";
    case ConnectionState.Connecting:
      return "connecting";
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return "reconnecting";
    case ConnectionState.Disconnected:
      return "disconnected";
  }
}

const AUDIO_CAPTURE_DEFAULTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  sampleRate: 48_000,
} as const;

const DEFAULT_ROUTES: AudioRouteLabels = {
  input: "Default microphone",
  output: "Default output",
};

/**
 * LiveKit's browser room adapted to the narrow [DirectorRoom] seam. It owns
 * echo/noise/AGC settings (docs/design.md §10), publishes one local microphone
 * track, and attaches every remote audio track.
 */
export class LiveKitDirectorRoom implements DirectorRoom {
  private room: Room | undefined;
  private localTrack: LocalAudioTrack | undefined;
  private audioContainer: HTMLDivElement | undefined;
  private readonly audioElements = new Map<string, HTMLMediaElement>();
  private readonly participantsChangedHandlers = new Set<() => void>();
  private readonly audioLevelHandlers = new Set<
    (identity: string, level: number) => void
  >();
  private readonly connectionStateHandlers = new Set<
    (state: MediaConnectionState) => void
  >();
  private readonly disconnectedHandlers = new Set<() => void>();

  async connect(url: string, token: string): Promise<void> {
    const room = new Room({
      audioCaptureDefaults: AUDIO_CAPTURE_DEFAULTS,
    });
    this.room = room;
    this.installRoomHandlers(room);
    await room.connect(url, token);
    // The click that opened the room is a user gesture, so playback is allowed.
    await room.startAudio().catch(() => undefined);
    this.attachExistingRemoteAudio(room);
    this.emitParticipantsChanged();
  }

  async publishMicrophone(): Promise<void> {
    const room = this.room;
    if (room === undefined) {
      throw new Error("LiveKit is not connected.");
    }
    if (this.localTrack !== undefined) {
      return;
    }
    const track = await createLocalAudioTrack(AUDIO_CAPTURE_DEFAULTS);
    try {
      await room.localParticipant.publishTrack(track);
      this.localTrack = track;
    } catch (error) {
      track.stop();
      throw error;
    }
  }

  async setMicrophoneMuted(muted: boolean): Promise<void> {
    if (this.localTrack === undefined) {
      if (muted) {
        return;
      }
      throw new Error("The microphone has not been published.");
    }
    // Muting a published track toggles MediaStreamTrack.enabled; it does not
    // renegotiate or republish.
    if (muted) {
      await this.localTrack.mute();
    } else {
      await this.localTrack.unmute();
    }
  }

  async disconnect(): Promise<void> {
    this.cleanupAudio();
    this.localTrack?.stop();
    this.localTrack = undefined;
    const room = this.room;
    this.room = undefined;
    await room?.disconnect();
  }

  onDisconnected(handler: () => void): () => void {
    this.disconnectedHandlers.add(handler);
    return () => {
      this.disconnectedHandlers.delete(handler);
    };
  }

  getParticipants(): DirectorRoomParticipant[] {
    const room = this.room;
    if (room === undefined) {
      return [];
    }
    return [...room.remoteParticipants.values()].map((participant) => ({
      identity: participant.identity,
      name:
        participant.name !== undefined && participant.name.length > 0
          ? participant.name
          : participant.identity,
      hasAudio: this.hasSubscribedAudio(participant),
      setVolume: (volume: number) => {
        participant.setVolume(volume);
      },
    }));
  }

  onParticipantsChanged(handler: () => void): () => void {
    this.participantsChangedHandlers.add(handler);
    return () => {
      this.participantsChangedHandlers.delete(handler);
    };
  }

  onAudioLevel(handler: (identity: string, level: number) => void): () => void {
    this.audioLevelHandlers.add(handler);
    return () => {
      this.audioLevelHandlers.delete(handler);
    };
  }

  onConnectionStateChanged(
    handler: (state: MediaConnectionState) => void,
  ): () => void {
    this.connectionStateHandlers.add(handler);
    return () => {
      this.connectionStateHandlers.delete(handler);
    };
  }

  async getAudioRoutes(): Promise<AudioRouteLabels> {
    if (
      typeof navigator === "undefined" ||
      navigator.mediaDevices?.enumerateDevices === undefined
    ) {
      return DEFAULT_ROUTES;
    }
    const devices = await navigator.mediaDevices
      .enumerateDevices()
      .catch(() => [] as MediaDeviceInfo[]);
    const pick = (kind: MediaDeviceKind): MediaDeviceInfo | undefined =>
      devices.find((device) => device.kind === kind && device.deviceId === "default") ??
      devices.find((device) => device.kind === kind);
    return {
      input: pick("audioinput")?.label || DEFAULT_ROUTES.input,
      output: pick("audiooutput")?.label || DEFAULT_ROUTES.output,
    };
  }

  private installRoomHandlers(room: Room): void {
    room.on(RoomEvent.ParticipantConnected, () => {
      this.emitParticipantsChanged();
    });
    room.on(RoomEvent.ParticipantDisconnected, () => {
      this.emitParticipantsChanged();
    });
    room.on(
      RoomEvent.TrackSubscribed,
      (track: RemoteTrack, _publication: RemoteTrackPublication) => {
        if (track.kind === Track.Kind.Audio) {
          this.attachAudioTrack(track as RemoteAudioTrack);
        }
        this.emitParticipantsChanged();
      },
    );
    room.on(
      RoomEvent.TrackUnsubscribed,
      (track: RemoteTrack) => {
        if (track.kind === Track.Kind.Audio) {
          this.detachAudioTrack(track as RemoteAudioTrack);
        }
        this.emitParticipantsChanged();
      },
    );
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => {
      const speaking = new Set(speakers.map((speaker) => speaker.identity));
      for (const participant of room.remoteParticipants.values()) {
        const level = speaking.has(participant.identity)
          ? participant.audioLevel
          : 0;
        for (const handler of this.audioLevelHandlers) {
          handler(participant.identity, level);
        }
      }
    });
    room.on(RoomEvent.ConnectionStateChanged, (state: ConnectionState) => {
      const mapped = mapConnectionState(state);
      for (const handler of this.connectionStateHandlers) {
        handler(mapped);
      }
    });
    room.on(RoomEvent.Disconnected, () => {
      this.cleanupAudio();
      this.localTrack?.stop();
      this.localTrack = undefined;
      this.room = undefined;
      for (const handler of this.disconnectedHandlers) {
        handler();
      }
    });
  }

  private attachExistingRemoteAudio(room: Room): void {
    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.trackPublications.values()) {
        const track = publication.track;
        if (track !== undefined && track.kind === Track.Kind.Audio) {
          this.attachAudioTrack(track as RemoteAudioTrack);
        }
      }
    }
  }

  private attachAudioTrack(track: RemoteAudioTrack): void {
    const key = track.mediaStreamID;
    if (this.audioElements.has(key)) {
      return;
    }
    if (this.audioContainer === undefined) {
      const container = document.createElement("div");
      container.dataset.role = "church-comms-remote-audio";
      container.style.display = "none";
      document.body.appendChild(container);
      this.audioContainer = container;
    }
    const element = track.attach();
    element.style.display = "none";
    this.audioContainer.appendChild(element);
    this.audioElements.set(key, element);
  }

  private detachAudioTrack(track: RemoteAudioTrack): void {
    const key = track.mediaStreamID;
    const element = this.audioElements.get(key);
    if (element === undefined) {
      track.detach();
    } else {
      track.detach(element);
      element.remove();
    }
    this.audioElements.delete(key);
  }

  private hasSubscribedAudio(participant: RemoteParticipant): boolean {
    for (const publication of participant.trackPublications.values()) {
      if (
        publication.track !== undefined &&
        publication.track.kind === Track.Kind.Audio
      ) {
        return true;
      }
    }
    return false;
  }

  private emitParticipantsChanged(): void {
    for (const handler of this.participantsChangedHandlers) {
      handler();
    }
  }

  private cleanupAudio(): void {
    for (const element of this.audioElements.values()) {
      element.remove();
    }
    this.audioElements.clear();
    this.audioContainer?.remove();
    this.audioContainer = undefined;
  }
}
