export type DirectorMediaPhase =
  | "idle"
  | "connecting"
  | "ready"
  | "publishing"
  | "error";

export interface DirectorMediaState {
  phase: DirectorMediaPhase;
  micEnabled: boolean;
  error?: string;
}

export interface DirectorMediaToken {
  url: string;
  token: string;
}

/**
 * The part of a LiveKit room the Director controller needs.
 *
 * Keeping this narrow lets the controller be tested without a browser or an
 * audio device; the real implementation lives in livekit-room.ts.
 */
export interface DirectorRoom {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  setMicrophoneEnabled(enabled: boolean): Promise<void>;
  onDisconnected(handler: () => void): () => void;
}

export interface DirectorMediaOptions {
  createRoom: () => DirectorRoom;
  fetchToken: () => Promise<DirectorMediaToken>;
}

const initialState: DirectorMediaState = {
  phase: "idle",
  micEnabled: false,
};

/**
 * Owns the Director's LiveKit connection and open-mic state. The UI renders
 * this state and calls [setOpenMic], without knowing about LiveKit.
 */
export class DirectorMedia {
  private readonly createRoom: () => DirectorRoom;
  private readonly fetchToken: () => Promise<DirectorMediaToken>;
  private room: DirectorRoom | undefined;
  private openMicRequested = false;
  private stopDisconnectedListener: (() => void) | undefined;
  private state: DirectorMediaState = initialState;
  private readonly listeners = new Set<() => void>();

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

  async setOpenMic(enabled: boolean): Promise<void> {
    this.openMicRequested = enabled;
    if (!enabled) {
      await this.room?.setMicrophoneEnabled(false);
      this.update({
        micEnabled: false,
        phase: this.room === undefined ? "idle" : "ready",
      });
      return;
    }

    if (this.room === undefined) {
      await this.connect();
    }
    if (!this.openMicRequested) {
      return;
    }

    const room = this.room;
    if (room === undefined) {
      return;
    }

    try {
      await room.setMicrophoneEnabled(true);
    } catch (error) {
      if (this.openMicRequested) {
        this.update({
          phase: "error",
          micEnabled: false,
          error: `Microphone unavailable: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
      return;
    }

    if (!this.openMicRequested) {
      await room.setMicrophoneEnabled(false);
      this.update({ micEnabled: false, phase: "ready" });
      return;
    }

    this.update({ micEnabled: true, phase: "publishing", error: undefined });
  }

  async disconnect(): Promise<void> {
    this.openMicRequested = false;
    this.stopDisconnectedListener?.();
    this.stopDisconnectedListener = undefined;
    await this.room?.disconnect();
    this.room = undefined;
    this.update({ phase: "idle", micEnabled: false, error: undefined });
  }

  private async connect(): Promise<void> {
    this.update({ phase: "connecting", error: undefined });
    try {
      const token = await this.fetchToken();
      const room = this.createRoom();
      await room.connect(token.url, token.token);
      this.room = room;
      this.stopDisconnectedListener = room.onDisconnected(() => {
        this.openMicRequested = false;
        this.room = undefined;
        this.update({
          phase: "error",
          micEnabled: false,
          error: "The media connection closed. Check the director laptop.",
        });
      });
      this.update({ phase: "ready" });
    } catch (error) {
      this.room = undefined;
      this.update({
        phase: "error",
        micEnabled: false,
        error: `Could not start Director audio: ${
          error instanceof Error ? error.message : String(error)
        }`,
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
