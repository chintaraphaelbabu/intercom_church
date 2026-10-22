import { WebSocket } from "ws";
import type { RawData } from "ws";
import {
  PROTOCOL_VERSION,
  type ClientType,
  type ServerMessage,
} from "@church-comms/protocol";

/** A tiny promise-friendly control client used by the server tests. */
export class TestClient {
  readonly socket: WebSocket;
  readonly messages: ServerMessage[] = [];
  readonly closeCode: Promise<number>;
  private waiters: Array<(message: ServerMessage) => void> = [];

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.closeCode = new Promise((resolve) => {
      socket.once("close", (code) => resolve(code));
    });
    socket.on("message", (data: RawData) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(message);
      } else {
        this.messages.push(message);
      }
    });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      const client = new TestClient(socket);
      socket.once("open", () => resolve(client));
      socket.once("error", reject);
    });
  }

  send(value: unknown): void {
    this.socket.send(JSON.stringify(value));
  }

  sendRaw(value: string): void {
    this.socket.send(value);
  }

  hello(
    overrides: Partial<{
      protocol: number;
      clientType: ClientType;
      appVersion: string;
      name: string;
      sessionToken: string;
    }> = {},
  ): void {
    this.send({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      clientType: "operator",
      appVersion: "0.1.0",
      name: "Camera 1",
      ...overrides,
    });
  }

  next(timeoutMs = 2000): Promise<ServerMessage> {
    const existing = this.messages.shift();
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== onMessage);
        reject(new Error(`No message within ${timeoutMs} ms`));
      }, timeoutMs);
      const onMessage = (message: ServerMessage): void => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push(onMessage);
    });
  }

  async nextOfType<T extends ServerMessage["type"]>(
    type: T,
    predicate: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    for (;;) {
      const message = await this.next();
      if (
        message.type === type &&
        predicate(message as Extract<ServerMessage, { type: T }>)
      ) {
        return message as Extract<ServerMessage, { type: T }>;
      }
    }
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) {
      return;
    }
    this.socket.close();
    await this.closeCode.catch(() => undefined);
  }
}
