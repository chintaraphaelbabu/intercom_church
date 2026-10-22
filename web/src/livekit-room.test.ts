import { afterEach, describe, expect, it, vi } from "vitest";

const livekit = vi.hoisted(() => {
  const rooms: FakeRoom[] = [];

  class FakeRoom {
    readonly handlers = new Map<string, (...args: unknown[]) => void>();
    readonly remoteParticipants = new Map<string, unknown>();
    readonly localParticipant = {
      publishTrack: vi.fn(),
    };

    constructor() {
      rooms.push(this);
    }

    on(event: string, handler: (...args: unknown[]) => void): void {
      this.handlers.set(event, handler);
    }

    async connect(): Promise<void> {}

    async startAudio(): Promise<void> {}

    async disconnect(): Promise<void> {}

    emit(event: string, ...args: unknown[]): void {
      this.handlers.get(event)?.(...args);
    }
  }

  return {
    rooms,
    Room: FakeRoom,
    RoomEvent: {
      ParticipantConnected: "participantConnected",
      ParticipantDisconnected: "participantDisconnected",
      TrackSubscribed: "trackSubscribed",
      TrackUnsubscribed: "trackUnsubscribed",
      ActiveSpeakersChanged: "activeSpeakersChanged",
      ConnectionStateChanged: "connectionStateChanged",
      Disconnected: "disconnected",
    },
    ConnectionState: {
      Connected: "connected",
      Connecting: "connecting",
      Reconnecting: "reconnecting",
      SignalReconnecting: "signalReconnecting",
      Disconnected: "disconnected",
    },
    Track: { Kind: { Audio: "audio", Video: "video" } },
    createLocalAudioTrack: vi.fn(),
  };
});

vi.mock("livekit-client", () => livekit);

import { LiveKitDirectorRoom } from "./livekit-room";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("LiveKitDirectorRoom", () => {
  it("attaches subscribed Operator audio so the Director hears it", async () => {
    const room = new LiveKitDirectorRoom();
    await room.connect("ws://192.168.137.1:7880", "director-token");
    const fakeRoom = livekit.rooms[0];
    if (fakeRoom === undefined) {
      throw new Error("The Director room was not created");
    }

    const element = document.createElement("audio");
    const operatorAudio = {
      kind: "audio",
      mediaStreamID: "operator-camera-1-microphone",
      attach: vi.fn(() => element),
      detach: vi.fn(),
    };

    fakeRoom.emit("trackSubscribed", operatorAudio, {});

    expect(operatorAudio.attach).toHaveBeenCalledTimes(1);
    expect(element.isConnected).toBe(true);
    const container = document.querySelector(
      '[data-role="church-comms-remote-audio"]',
    );
    expect(container?.contains(element)).toBe(true);
  });
});
