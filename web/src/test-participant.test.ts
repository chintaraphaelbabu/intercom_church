import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@church-comms/protocol";
import type { DirectorConnectionOptions, SessionStorage } from "./connection";
import type {
  DirectorMediaToken,
  DirectorRoom,
  DirectorRoomParticipant,
} from "./media";
import { createOperatorTestParticipant } from "./test-participant";

class FakeWebSocket {
  readonly sent: string[] = [];
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
}

class MemoryStorage implements SessionStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FakeRoom implements DirectorRoom {
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async publishMicrophone(): Promise<void> {}
  async setMicrophoneMuted(): Promise<void> {}
  onDisconnected(): () => void {
    return () => undefined;
  }
  onParticipantsChanged(): () => void {
    return () => undefined;
  }
  onAudioLevel(): () => void {
    return () => undefined;
  }
  onConnectionStateChanged(): () => void {
    return () => undefined;
  }
  getAudioRoutes() {
    return { input: "Default microphone", output: "Default output" };
  }
  getParticipants(): DirectorRoomParticipant[] {
    return [];
  }
  getLatencyMs(): number | undefined {
    return undefined;
  }
  getJitterMs(): number | undefined {
    return undefined;
  }
  getPacketLossPercent(): number | undefined {
    return undefined;
  }
}

describe("createOperatorTestParticipant", () => {
  it("builds an Operator connection but does not connect or join on its own", () => {
    const sockets: FakeWebSocket[] = [];
    const storage = new MemoryStorage();
    const connectionOptions: DirectorConnectionOptions = {
      url: "ws://test.local/ws",
      socketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
      storage,
    };
    const mediaToken: DirectorMediaToken = {
      url: "ws://192.168.1.20:7880",
      token: "operator-token",
    };
    const fetchToken = () => Promise.resolve(mediaToken);

    const participant = createOperatorTestParticipant({
      name: "Browser 2",
      cameraNumber: 2,
      connectionOptions,
      mediaOptions: {
        createRoom: () => new FakeRoom(),
        fetchToken,
      },
    });

    expect(participant.role).toBe("operator");
    expect(participant.connection.getSnapshot().phase).toBe("connecting");

    // The factory must not open a socket or join a room until the caller asks.
    expect(sockets).toHaveLength(0);
    expect(participant.media.getState()).toMatchObject({
      phase: "idle",
      micEnabled: false,
    });

    participant.connection.connect();
    const socket = sockets[0];
    expect(socket).toBeDefined();
    socket?.open();

    expect(JSON.parse(socket?.sent[0] ?? "{}")).toMatchObject({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      clientType: "operator",
      name: "Browser 2",
    });

    participant.join("MEDIA");
    expect(JSON.parse(socket?.sent.at(-1) ?? "{}")).toMatchObject({
      type: "join_room",
      room: "MEDIA",
      name: "Browser 2",
      cameraNumber: 2,
    });
  });
});
