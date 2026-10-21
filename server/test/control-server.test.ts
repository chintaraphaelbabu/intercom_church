import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { RawData } from "ws";
import {
  PROTOCOL_VERSION,
  type ClientType,
  type ServerMessage,
} from "@church-comms/protocol";
import {
  createChurchCommsServer,
  type ChurchCommsServer,
} from "../src/server.js";

class TestClient {
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

const servers: ChurchCommsServer[] = [];

async function startServer(
  options: Partial<Parameters<typeof createChurchCommsServer>[0]> = {},
): Promise<ChurchCommsServer> {
  const server = createChurchCommsServer({
    port: 0,
    advertiseMdns: false,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    ...options,
  });
  await server.start();
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

describe("control channel", () => {
  it("answers hello with server_info at the current protocol version", async () => {
    const server = await startServer();
    const client = await TestClient.connect(server.port());

    client.hello();

    const info = await client.nextOfType("server_info");
    expect(info.protocol).toBe(PROTOCOL_VERSION);
    expect(info.serverId).toBeTruthy();
    expect(info.livekitUrl).toMatch(/^ws:\/\//);
    expect(Number.isNaN(Date.parse(info.serverTime))).toBe(false);

    await client.close();
  });

  it("shows every connected client in the debug roster", async () => {
    const server = await startServer();
    const director = await TestClient.connect(server.port());
    const operator = await TestClient.connect(server.port());

    director.hello({ clientType: "director", name: "Director" });
    await director.nextOfType("server_info");
    operator.hello({ clientType: "operator", name: "Camera 2", appVersion: "9.9.9" });

    const roster = await operator.nextOfType("debug_roster");
    expect(roster.clients).toHaveLength(2);

    const directorRow = roster.clients.find((row) => row.clientType === "director");
    const operatorRow = roster.clients.find((row) => row.clientType === "operator");
    expect(directorRow?.name).toBe("Director");
    expect(operatorRow).toMatchObject({
      name: "Camera 2",
      appVersion: "9.9.9",
    });
    expect(operatorRow?.id).toBeTruthy();
    expect(Number.isNaN(Date.parse(operatorRow?.connectedAt ?? ""))).toBe(false);

    await director.close();
    await operator.close();
  });

  it("removes a client from the roster when it disconnects", async () => {
    const server = await startServer();
    const watcher = await TestClient.connect(server.port());
    const leaver = await TestClient.connect(server.port());

    watcher.hello({ name: "Watcher" });
    await watcher.nextOfType("server_info");
    leaver.hello({ name: "Leaver" });
    await watcher.nextOfType("debug_roster", (message) => message.clients.length === 2);

    await leaver.close();

    const roster = await watcher.nextOfType(
      "debug_roster",
      (message) => message.clients.length === 1,
    );
    expect(roster.clients.map((row) => row.name)).toEqual(["Watcher"]);

    await watcher.close();
  });

  it("refuses a protocol mismatch with a readable error before closing", async () => {
    const server = await startServer();
    const client = await TestClient.connect(server.port());

    client.hello({ protocol: PROTOCOL_VERSION + 1 });

    const error = await client.nextOfType("error");
    expect(error.code).toBe("PROTOCOL_MISMATCH");
    expect(error.message).toContain(`v${PROTOCOL_VERSION}`);
    expect(error.message).toContain(`v${PROTOCOL_VERSION + 1}`);
    expect(error.message).toMatch(/update/i);
    await expect(client.closeCode).resolves.toBe(1002);
  });

  it("reports invalid messages without dropping the connection", async () => {
    const server = await startServer();
    const client = await TestClient.connect(server.port());

    client.sendRaw("{not json");
    const error = await client.nextOfType("error");
    expect(error.code).toBe("INVALID_MESSAGE");
    expect(error.message).toMatch(/JSON/i);

    client.hello();
    const info = await client.nextOfType("server_info");
    expect(info.protocol).toBe(PROTOCOL_VERSION);

    await client.close();
  });

  it("ignores unknown message types with a log warning", async () => {
    const warnings: unknown[] = [];
    const server = await startServer({
      logger: {
        info: () => undefined,
        error: () => undefined,
        warn: (...args: unknown[]) => warnings.push(...args),
      },
    });
    const client = await TestClient.connect(server.port());
    client.hello();
    await client.nextOfType("server_info");

    client.send({ type: "webrtc_offer", sdp: "stale draft message" });
    client.send({ type: "ping" });

    const pong = await client.nextOfType("pong");
    expect(pong.type).toBe("pong");
    expect(warnings.join(" ")).toContain("webrtc_offer");

    await client.close();
  });

  it("answers ping with pong", async () => {
    const server = await startServer();
    const client = await TestClient.connect(server.port());
    client.hello();
    await client.nextOfType("server_info");

    client.send({ type: "ping" });

    await expect(client.nextOfType("pong")).resolves.toMatchObject({ type: "pong" });
    await client.close();
  });
});

describe("director app hosting", () => {
  it("serves index.html and reports a missing build clearly", async () => {
    const server = await startServer();
    const response = await fetch(`http://127.0.0.1:${server.port()}/`);
    expect([200, 503]).toContain(response.status);
    const body = await response.text();
    if (response.status === 503) {
      expect(body).toMatch(/not built/i);
    } else {
      expect(body).toMatch(/Church Comms/i);
    }
  });

  it("refuses path traversal", async () => {
    const server = await startServer();
    const response = await fetch(
      `http://127.0.0.1:${server.port()}/..%2f..%2fpackage.json`,
    );
    expect(response.status).toBe(404);
  });
});
