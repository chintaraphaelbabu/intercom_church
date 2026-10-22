import { describe, expect, it, vi } from "vitest";
import { DirectorMedia, type DirectorRoom } from "./media";

class FakeRoom implements DirectorRoom {
  connectCalls = 0;
  connectGate: Promise<void> | undefined;
  micEnabled = false;
  failMic: Error | undefined;
  private disconnectedHandler: (() => void) | undefined;

  async connect(): Promise<void> {
    this.connectCalls += 1;
    await this.connectGate;
  }

  async disconnect(): Promise<void> {
    this.disconnectedHandler?.();
  }

  async setMicrophoneEnabled(enabled: boolean): Promise<void> {
    if (enabled && this.failMic !== undefined) {
      throw this.failMic;
    }
    this.micEnabled = enabled;
  }

  onDisconnected(handler: () => void): () => void {
    this.disconnectedHandler = handler;
    return () => {
      this.disconnectedHandler = undefined;
    };
  }
}

function createMedia(room: FakeRoom): {
  media: DirectorMedia;
  fetchToken: ReturnType<typeof vi.fn>;
} {
  const fetchToken = vi.fn(async () => ({
    url: "ws://192.168.137.1:7880",
    token: "join-token",
  }));
  const media = new DirectorMedia({
    createRoom: () => room,
    fetchToken,
  });
  return { media, fetchToken };
}

describe("Director media", () => {
  it("publishes the Director microphone when open mic is turned on", async () => {
    const room = new FakeRoom();
    const { media } = createMedia(room);

    await media.setOpenMic(true);

    expect(room.connectCalls).toBe(1);
    expect(room.micEnabled).toBe(true);
    expect(media.getState()).toMatchObject({
      phase: "publishing",
      micEnabled: true,
    });
  });

  it("stops the microphone without reconnecting or minting another token", async () => {
    const room = new FakeRoom();
    const { media, fetchToken } = createMedia(room);

    await media.setOpenMic(true);
    await media.setOpenMic(false);

    expect(room.micEnabled).toBe(false);
    expect(room.connectCalls).toBe(1);
    expect(fetchToken).toHaveBeenCalledTimes(1);
    expect(media.getState()).toMatchObject({
      phase: "ready",
      micEnabled: false,
    });
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

    expect(room.micEnabled).toBe(false);
    expect(media.getState()).toMatchObject({
      phase: "ready",
      micEnabled: false,
    });
  });

  it("surfaces a denied microphone as a media failure", async () => {
    const room = new FakeRoom();
    room.failMic = new Error("Permission denied");
    const { media } = createMedia(room);

    await media.setOpenMic(true);

    expect(media.getState()).toMatchObject({
      phase: "error",
      micEnabled: false,
    });
    expect(media.getState().error).toMatch(/microphone/i);
  });
});
