import { describe, expect, it, vi } from "vitest";
import {
  DirectorMedia,
  type AudioRouteLabels,
  type DirectorMediaToken,
  type DirectorRoom,
  type DirectorRoomParticipant,
  type MediaConnectionState,
} from "./media";

class FakeParticipant implements DirectorRoomParticipant {
  volume = 1;

  constructor(
    readonly identity: string,
    readonly name: string,
    public hasAudio = true,
  ) {}

  setVolume(volume: number): void {
    this.volume = volume;
  }
}

class FakeRoom implements DirectorRoom {
  connectCalls = 0;
  connectGate: Promise<void> | undefined;
  connectedWith: { url: string; token: string } | undefined;
  publishCalls = 0;
  muted = false;
  failPublish: Error | undefined;
  routes: AudioRouteLabels = {
    input: "USB microphone",
    output: "Headset earphones",
  };
  private readonly participants = new Map<string, FakeParticipant>();
  private disconnectedHandler: (() => void) | undefined;
  private participantsChangedHandler: (() => void) | undefined;
  private audioLevelHandler: ((identity: string, level: number) => void) | undefined;
  private connectionStateHandler:
    | ((state: MediaConnectionState) => void)
    | undefined;

  async connect(url: string, token: string): Promise<void> {
    this.connectCalls += 1;
    this.connectedWith = { url, token };
    await this.connectGate;
  }

  async disconnect(): Promise<void> {
    this.disconnectedHandler?.();
  }

  async publishMicrophone(): Promise<void> {
    this.publishCalls += 1;
    if (this.failPublish !== undefined) {
      throw this.failPublish;
    }
  }

  async setMicrophoneMuted(muted: boolean): Promise<void> {
    this.muted = muted;
  }

  onDisconnected(handler: () => void): () => void {
    this.disconnectedHandler = handler;
    return () => {
      this.disconnectedHandler = undefined;
    };
  }

  onParticipantsChanged(handler: () => void): () => void {
    this.participantsChangedHandler = handler;
    return () => {
      this.participantsChangedHandler = undefined;
    };
  }

  onAudioLevel(handler: (identity: string, level: number) => void): () => void {
    this.audioLevelHandler = handler;
    return () => {
      this.audioLevelHandler = undefined;
    };
  }

  onConnectionStateChanged(
    handler: (state: MediaConnectionState) => void,
  ): () => void {
    this.connectionStateHandler = handler;
    return () => {
      this.connectionStateHandler = undefined;
    };
  }

  async getAudioRoutes(): Promise<AudioRouteLabels> {
    return this.routes;
  }

  getParticipants(): DirectorRoomParticipant[] {
    return [...this.participants.values()];
  }

  addParticipant(identity: string, name: string): FakeParticipant {
    const participant = new FakeParticipant(identity, name);
    this.participants.set(identity, participant);
    this.participantsChangedHandler?.();
    return participant;
  }

  removeParticipant(identity: string): void {
    this.participants.delete(identity);
    this.participantsChangedHandler?.();
  }

  setTrackAvailability(identity: string, hasAudio: boolean): void {
    const participant = this.participants.get(identity);
    if (participant !== undefined) {
      participant.hasAudio = hasAudio;
      this.participantsChangedHandler?.();
    }
  }

  emitAudioLevel(identity: string, level: number): void {
    this.audioLevelHandler?.(identity, level);
  }

  emitConnectionState(state: MediaConnectionState): void {
    this.connectionStateHandler?.(state);
  }

  dropConnection(): void {
    this.disconnectedHandler?.();
  }
}

function createMedia(
  room: FakeRoom,
  options: {
    fetchToken?: () => Promise<DirectorMediaToken>;
  } = {},
): {
  media: DirectorMedia;
  fetchToken: ReturnType<typeof vi.fn>;
} {
  const fetchToken = vi.fn(
    options.fetchToken ??
      (async () => ({
        url: "ws://192.168.137.1:7880",
        token: "join-token",
      })),
  );
  const media = new DirectorMedia({
    createRoom: () => room,
    fetchToken,
  });
  return { media, fetchToken };
}

describe("DirectorMedia", () => {
  it("publishes the Director mic once and toggles track mute without reconnecting", async () => {
    const room = new FakeRoom();
    const { media, fetchToken } = createMedia(room);

    await media.setOpenMic(true);

    expect(room.connectCalls).toBe(1);
    expect(room.publishCalls).toBe(1);
    expect(room.muted).toBe(false);
    expect(media.getState()).toMatchObject({
      phase: "publishing",
      micEnabled: true,
      connectionState: "connected",
    });

    await media.setOpenMic(false);
    expect(room.muted).toBe(true);
    expect(media.getState()).toMatchObject({
      phase: "ready",
      micEnabled: false,
    });

    await media.setOpenMic(true);
    expect(room.connectCalls).toBe(1);
    expect(room.publishCalls).toBe(1);
    expect(room.muted).toBe(false);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(media.getState().micEnabled).toBe(true);
  });

  it("uses credentials from the joined room when they are supplied", async () => {
    const room = new FakeRoom();
    const { media, fetchToken } = createMedia(room);

    await media.connect({
      url: "ws://192.168.1.20:7880",
      token: "livekit-token",
    });

    expect(fetchToken).not.toHaveBeenCalled();
    expect(room.connectedWith).toEqual({
      url: "ws://192.168.1.20:7880",
      token: "livekit-token",
    });
    expect(media.getState().connectionState).toBe("connected");
  });

  it("does not publish when open mic is turned off while connecting", async () => {
    const room = new FakeRoom();
    let releaseConnect: (() => void) | undefined;
    room.connectGate = new Promise((resolve) => {
      releaseConnect = resolve;
    });
    const { media } = createMedia(room);

    const turningOn = media.setOpenMic(true);
    await vi.waitFor(() => expect(room.connectCalls).toBe(1));

    await media.setOpenMic(false);
    releaseConnect?.();
    await turningOn;

    expect(room.publishCalls).toBe(0);
    expect(media.getState()).toMatchObject({
      phase: "ready",
      micEnabled: false,
    });
  });

  it("surfaces a denied microphone as a media failure", async () => {
    const room = new FakeRoom();
    room.failPublish = new Error("Permission denied");
    const { media } = createMedia(room);

    await media.setOpenMic(true);

    expect(media.getState()).toMatchObject({
      phase: "error",
      micEnabled: false,
    });
    expect(media.getState().error).toMatch(/microphone/i);
  });

  it("exposes remote participants with volume and audio level", async () => {
    const room = new FakeRoom();
    const { media } = createMedia(room);
    await media.connect({ url: "ws://room", token: "token" });

    const operator = room.addParticipant("operator-1", "Camera 1");

    expect(media.getState().participants).toEqual([
      {
        identity: "operator-1",
        name: "Camera 1",
        volume: 100,
        level: 0,
        hasAudio: true,
      },
    ]);

    media.setParticipantVolume("operator-1", 35);
    expect(operator.volume).toBeCloseTo(0.35);
    expect(media.getState().participants[0]?.volume).toBe(35);

    room.emitAudioLevel("operator-1", 0.42);
    expect(media.getState().participants[0]?.level).toBeCloseTo(0.42);

    media.setParticipantVolume("operator-1", 150);
    expect(media.getState().participants[0]?.volume).toBe(100);
    expect(operator.volume).toBeCloseTo(1);

    media.setParticipantVolume("operator-1", -10);
    expect(media.getState().participants[0]?.volume).toBe(0);
    expect(operator.volume).toBe(0);
  });

  it("applies master volume to existing and newly joined participants", async () => {
    const room = new FakeRoom();
    const { media } = createMedia(room);
    await media.connect({ url: "ws://room", token: "token" });

    const first = room.addParticipant("operator-1", "Camera 1");
    media.setMasterVolume(50);
    expect(media.getState().masterVolume).toBe(50);
    expect(first.volume).toBeCloseTo(0.5);

    const second = room.addParticipant("operator-2", "Camera 2");
    expect(second.volume).toBeCloseTo(0.5);

    media.setParticipantVolume("operator-1", 40);
    expect(first.volume).toBeCloseTo(0.2);
    expect(second.volume).toBeCloseTo(0.5);
  });

  it("tracks track subscription, participant departure and connection state", async () => {
    const room = new FakeRoom();
    const { media } = createMedia(room);
    await media.connect({ url: "ws://room", token: "token" });

    room.addParticipant("operator-1", "Camera 1");
    room.setTrackAvailability("operator-1", false);
    expect(media.getState().participants[0]?.hasAudio).toBe(false);

    room.setTrackAvailability("operator-1", true);
    expect(media.getState().participants[0]?.hasAudio).toBe(true);

    room.emitConnectionState("reconnecting");
    expect(media.getState().connectionState).toBe("reconnecting");

    room.emitConnectionState("connected");
    expect(media.getState().connectionState).toBe("connected");

    room.removeParticipant("operator-1");
    expect(media.getState().participants).toEqual([]);
  });

  it("reports the browser input and output route labels", async () => {
    const room = new FakeRoom();
    const { media } = createMedia(room);

    await media.connect({ url: "ws://room", token: "token" });

    expect(media.getState().inputRoute).toBe("USB microphone");
    expect(media.getState().outputRoute).toBe("Headset earphones");
  });

  it("reports an unexpected LiveKit disconnect as a media failure", async () => {
    const room = new FakeRoom();
    const { media } = createMedia(room);
    await media.connect({ url: "ws://room", token: "token" });
    await media.setOpenMic(true);

    room.dropConnection();

    expect(media.getState()).toMatchObject({
      phase: "error",
      micEnabled: false,
      connectionState: "disconnected",
    });
    expect(media.getState().error).toMatch(/media connection/i);
  });
});
