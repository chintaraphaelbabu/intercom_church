import { Room, RoomEvent } from "livekit-client";
import type { DirectorMediaToken, DirectorRoom } from "./media";

interface TokenResponse {
  url: string;
  token: string;
  error?: string;
}

/**
 * Ask the control server for a short-lived LiveKit token. The secret never
 * reaches the browser.
 */
export async function fetchDirectorToken(): Promise<DirectorMediaToken> {
  const response = await fetch("/api/livekit-token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identity: "director",
      name: "Director",
      role: "director",
    }),
  });

  const body = (await response.json().catch(() => ({}))) as Partial<TokenResponse>;
  if (!response.ok || body.token === undefined || body.url === undefined) {
    throw new Error(body.error ?? `The control server answered HTTP ${response.status}.`);
  }
  return { url: body.url, token: body.token };
}

/**
 * LiveKit's browser room adapted to the narrow [DirectorRoom] seam. It owns the
 * echo/noise/AGC settings from docs/design.md §10.
 */
export class LiveKitDirectorRoom implements DirectorRoom {
  private room: Room | undefined;

  async connect(url: string, token: string): Promise<void> {
    const room = new Room({
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48_000,
      },
    });
    this.room = room;
    await room.connect(url, token);
    // The toggle click is a user gesture, so the browser allows playback here.
    await room.startAudio().catch(() => undefined);
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (this.room === undefined) {
      throw new Error("LiveKit is not connected.");
    }
    await this.room.localParticipant.setMicrophoneEnabled(enabled);
  }

  async disconnect(): Promise<void> {
    await this.room?.disconnect();
    this.room = undefined;
  }

  onDisconnected(handler: () => void): () => void {
    this.room?.on(RoomEvent.Disconnected, handler);
    return () => {
      this.room?.off(RoomEvent.Disconnected, handler);
    };
  }
}
