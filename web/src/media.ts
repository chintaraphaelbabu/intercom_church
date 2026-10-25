export type DirectorMediaPhase =
  | "idle"
  | "connecting"
  | "ready"
  | "publishing"
  | "error";

export type MediaConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface MediaParticipantState {
  identity: string;
  name: string;
  /** Per-participant volume from 0 to 100. */
  volume: number;
  /** Live audio level from 0 to 1. */
  level: number;
  /** False while the participant has no subscribed audio track. */
  hasAudio: boolean;
}

export interface AudioRouteLabels {
  input: string;
  output: string;
}

export interface DirectorMediaState {
  phase: DirectorMediaPhase;
  micEnabled: boolean;
  error?: string;
  connectionState: MediaConnectionState;
  participants: MediaParticipantState[];
  masterVolume: number;
  inputRoute: string;
  outputRoute: string;
  latencyMs?: number;
  jitterMs?: number;
  packetLossPercent?: number;
}

export interface DirectorMediaToken {
  url: string;
  token: string;
}

/**
 * The part of a remote participant the controller needs. Keeping this narrow
 * lets the controller be tested without a browser, a LiveKit server, or an
 * audio device; the real implementation lives in livekit-room.ts.
 */
export interface DirectorRoomParticipant {
  identity: string;
  name: string;
  hasAudio: boolean;
  /** Volume from 0 to 1, as LiveKit expects. */
  setVolume(volume: number): void;
}

/**
 * The LiveKit room seam. All media lifecycle and event wiring stays behind
 * this interface, so switching Director views cannot create a second Room.
 */
export interface DirectorRoom {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  /** Publish the local mic once; later calls must be idempotent. */
  publishMicrophone(): Promise<void>;
  /** Mute or unmute the already-published track without renegotiating. */
  setMicrophoneMuted(muted: boolean): Promise<void>;
  onDisconnected(handler: () => void): () => void;
  getParticipants(): DirectorRoomParticipant[];
  onParticipantsChanged(handler: () => void): () => void;
  onAudioLevel(handler: (identity: string, level: number) => void): () => void;
  onConnectionStateChanged(
    handler: (state: MediaConnectionState) => void,
  ): () => void;
  getAudioRoutes(): AudioRouteLabels | Promise<AudioRouteLabels>;
  /** Hard mute/unmute a remote participant's audio playback. */

  getLatencyMs(): number | undefined;
  getJitterMs(): number | undefined;
  getPacketLossPercent(): number | undefined;
}

export interface DirectorMediaOptions {
  createRoom: () => DirectorRoom;
  /** Used when setOpenMic(true) has no credentials from the joined room. */
  fetchToken?: () => Promise<DirectorMediaToken>;
}

const DEFAULT_ROUTES: AudioRouteLabels = {
  input: "Default microphone",
  output: "Default output",
};

const initialState: DirectorMediaState = {
  phase: "idle",
  micEnabled: false,
  connectionState: "idle",
  participants: [],
  masterVolume: 100,
  inputRoute: DEFAULT_ROUTES.input,
  outputRoute: DEFAULT_ROUTES.output,
  latencyMs: undefined,
  jitterMs: undefined,
  packetLossPercent: undefined,
};

function clampVolume(volume: number): number {
  if (Number.isNaN(volume)) {
    return 0;
  }
  return Math.min(100, Math.max(0, volume));
}

function clampLevel(level: number): number {
  if (Number.isNaN(level)) {
    return 0;
  }
  return Math.min(1, Math.max(0, level));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the Director's LiveKit room and open-mic state. The UI renders this
 * state and calls the volume/mute methods; it never touches LiveKit itself.
 * One instance lives for the whole session, so view switches cannot recreate
 * the media room.
 */
export class DirectorMedia {
  private readonly createRoom: () => DirectorRoom;
  private readonly fetchToken: (() => Promise<DirectorMediaToken>) | undefined;
  private room: DirectorRoom | undefined;
  private connecting: Promise<boolean> | undefined;
  private microphonePublished = false;
  private openMicRequested = false;
  private state: DirectorMediaState = initialState;
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: Array<() => void> = [];
  private readonly handles = new Map<string, DirectorRoomParticipant>();

  constructor(options: DirectorMediaOptions) {
    this.createRoom = options.createRoom;
    this.fetchToken = options.fetchToken;
  }

  getState = (): DirectorMediaState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Connect with the LiveKit credentials from the server's `joined` message.
   * Callers can omit this and let [setOpenMic] fetch a token instead.
   */
  async connect(credentials: DirectorMediaToken): Promise<void> {
    if (this.room !== undefined) {
      return;
    }
    // Reset volumes on a fresh session start.
    this.update({ masterVolume: 100, participants: [] });
    await this.ensureConnected(credentials);
  }

  async setOpenMic(
    enabled: boolean,
    /** Credentials from the server's `joined` message for the named room. */
    credentials?: DirectorMediaToken,
  ): Promise<void> {
    this.openMicRequested = enabled;
    if (!enabled) {
      await this.mutePublishedMicrophone(true);
      this.update({
        micEnabled: false,
        phase: this.room === undefined ? "idle" : "ready",
        error: undefined,
      });
      return;
    }

    const connected = await this.ensureConnected(credentials);
    if (!connected) {
      return;
    }
    const room = this.room;
    if (room === undefined || !this.openMicRequested) {
      return;
    }

    try {
      if (!this.microphonePublished) {
        await room.publishMicrophone();
        this.microphonePublished = true;
      }
      await room.setMicrophoneMuted(false);
    } catch (error) {
      this.update({
        phase: "error",
        micEnabled: false,
        error: `Microphone unavailable: ${errorMessage(error)}`,
      });
      return;
    }

    if (!this.openMicRequested) {
      await room.setMicrophoneMuted(true);
      this.update({ micEnabled: false, phase: "ready" });
      return;
    }

    this.update({
      micEnabled: true,
      phase: "publishing",
      error: undefined,
    });
  }

  setParticipantVolume(identity: string, volume: number): void {
    const clamped = clampVolume(volume);
    const participants = this.state.participants.map((participant) =>
      participant.identity === identity
        ? { ...participant, volume: clamped }
        : participant,
    );
    this.update({ participants });
    this.applyVolumes();
  }

  setMasterVolume(volume: number): void {
    this.update({ masterVolume: clampVolume(volume) });
    this.applyVolumes();
  }

  async disconnect(): Promise<void> {
    this.openMicRequested = false;
    this.microphonePublished = false;
    this.detachListeners();
    const room = this.room;
    this.room = undefined;
    this.handles.clear();
    if (room !== undefined) {
      try {
        await room.disconnect();
      } catch {
        // The room is already gone; state is reset below either way.
      }
    }
    this.update({
      phase: "idle",
      micEnabled: false,
      error: undefined,
      connectionState: "idle",
      participants: [],
      masterVolume: 100,
      latencyMs: undefined,
      jitterMs: undefined,
      packetLossPercent: undefined,
    });
  }

  private async ensureConnected(
    credentials?: DirectorMediaToken,
  ): Promise<boolean> {
    if (this.room !== undefined) {
      return true;
    }
    if (this.connecting !== undefined) {
      return this.connecting;
    }
    this.connecting = this.connectInternal(credentials);
    const connected = await this.connecting;
    this.connecting = undefined;
    return connected;
  }

  private async connectInternal(
    credentials?: DirectorMediaToken,
  ): Promise<boolean> {
    this.update({ phase: "connecting", connectionState: "connecting", error: undefined });
    try {
      const token =
        credentials ??
        (this.fetchToken !== undefined
          ? await this.fetchToken()
          : undefined);
      if (token === undefined) {
        throw new Error("No LiveKit credentials are available.");
      }

      const room = this.createRoom();
      await room.connect(token.url, token.token);
      this.room = room;
      this.microphonePublished = false;
      this.attachListeners(room);

      const routes = await this.readRoutes(room);
      this.update({
        phase: "ready",
        connectionState: "connected",
        inputRoute: routes.input,
        outputRoute: routes.output,
        error: undefined,
      });
      this.refreshParticipants();
      this.refreshStats();
      return true;
    } catch (error) {
      this.room = undefined;
      this.update({
        phase: "error",
        connectionState: "error",
        micEnabled: false,
        error: `Could not start Director audio: ${errorMessage(error)}`,
      });
      return false;
    }
  }

  private refreshStats(): void {
    const room = this.room;
    if (room === undefined) {
      return;
    }
    this.update({
      latencyMs: room.getLatencyMs(),
      jitterMs: room.getJitterMs(),
      packetLossPercent: room.getPacketLossPercent(),
    });
  }

  private attachListeners(room: DirectorRoom): void {
    this.cleanups.push(
      room.onDisconnected(() => {
        this.room = undefined;
        this.microphonePublished = false;
        this.openMicRequested = false;
        this.handles.clear();
        this.detachListeners();
        this.update({
          phase: "error",
          micEnabled: false,
          connectionState: "disconnected",
          participants: [],
          error: "The media connection closed. Check the director laptop.",
        });
      }),
      room.onParticipantsChanged(() => {
        this.refreshParticipants();
      }),
      room.onAudioLevel((identity, level) => {
        this.updateLevel(identity, level);
      }),
      room.onConnectionStateChanged((state) => {
        this.update({ connectionState: state });
        this.refreshStats();
      }),
    );
  }

  private detachListeners(): void {
    for (const cleanup of this.cleanups.splice(0)) {
      cleanup();
    }
  }

  private async readRoutes(room: DirectorRoom): Promise<AudioRouteLabels> {
    try {
      const routes = await room.getAudioRoutes();
      return {
        input: routes.input.length > 0 ? routes.input : DEFAULT_ROUTES.input,
        output: routes.output.length > 0 ? routes.output : DEFAULT_ROUTES.output,
      };
    } catch {
      return DEFAULT_ROUTES;
    }
  }

  private refreshParticipants(): void {
    const room = this.room;
    if (room === undefined) {
      return;
    }
    const previous = new Map(
      this.state.participants.map((participant) => [participant.identity, participant]),
    );
    const handles = room.getParticipants();
    this.handles.clear();

    const participants = handles.map((handle) => {
      this.handles.set(handle.identity, handle);
      const old = previous.get(handle.identity);
      return {
        identity: handle.identity,
        name: handle.name,
        volume: old?.volume ?? 100,
        level: handle.hasAudio ? (old?.level ?? 0) : 0,
        hasAudio: handle.hasAudio,
      };
    });

    this.update({ participants });
    this.applyVolumes();
  }

  private updateLevel(identity: string, level: number): void {
    const participants = this.state.participants.map((participant) =>
      participant.identity === identity
        ? { ...participant, level: clampLevel(level) }
        : participant,
    );
    this.update({ participants });
  }

  private applyVolumes(): void {
    const master = this.state.masterVolume / 100;
    for (const participant of this.state.participants) {
      const handle = this.handles.get(participant.identity);
      handle?.setVolume((participant.volume / 100) * master);
    }
  }

  private async mutePublishedMicrophone(muted: boolean): Promise<void> {
    if (!this.microphonePublished || this.room === undefined) {
      return;
    }
    try {
      await this.room.setMicrophoneMuted(muted);
    } catch (error) {
      this.update({
        error: `Could not change the microphone: ${errorMessage(error)}`,
      });
    }
  }

  private update(partial: Partial<DirectorMediaState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
