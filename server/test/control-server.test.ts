import { afterEach, describe, expect, it } from "vitest";
import { GRACE_PERIOD_MS, PROTOCOL_VERSION } from "@church-comms/protocol";
import {
  createChurchCommsServer,
  type ChurchCommsServer,
} from "../src/server.js";
import { TestClient } from "./support/test-client.js";

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

async function connectClient(
  server: ChurchCommsServer,
  overrides: Parameters<TestClient["hello"]>[0] = {},
): Promise<TestClient> {
  const client = await TestClient.connect(server.port());
  client.hello(overrides);
  await client.nextOfType("server_info");
  return client;
}

async function connectDirector(
  server: ChurchCommsServer,
  name = "Director",
): Promise<TestClient> {
  return connectClient(server, { clientType: "director", name });
}

async function createNamedRoom(director: TestClient, name = "MEDIA") {
  director.send({ type: "create_room", name });
  return director.nextOfType("joined");
}

async function connectOperator(
  server: ChurchCommsServer,
  name: string,
  room = "MEDIA",
  cameraNumber = 1,
) {
  const operator = await connectClient(server, { clientType: "operator", name });
  operator.send({ type: "join_room", room, name, cameraNumber });
  const joined = await operator.nextOfType("joined");
  return { operator, joined };
}

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

describe("named rooms", () => {
  it("creates a room, mints LiveKit credentials and broadcasts the join list", async () => {
    const server = await startServer({
      livekitUrl: "ws://192.168.137.1:7880",
      livekitApiKey: "test-key",
      livekitApiSecret: "test-secret",
    });
    const watcher = await connectClient(server, { name: "Watcher" });
    await watcher.nextOfType("room_list", (message) => message.rooms.length === 0);
    const director = await connectDirector(server);

    director.send({ type: "create_room", name: "  MEDIA  " });
    const joined = await director.nextOfType("joined");

    expect(joined.room).toMatchObject({
      name: "MEDIA",
      status: "open",
      capacity: 11,
      operators: [],
    });
    expect(joined.room.director).toMatchObject({
      id: joined.participantId,
      name: "Director",
      role: "director",
      cameraNumber: null,
      connectionState: "connected",
    });
    expect(joined.sessionToken).toBeTruthy();
    expect(joined.livekit).toMatchObject({
      url: "ws://192.168.137.1:7880",
      room: "MEDIA",
    });
    expect(joined.livekit.token).toBeTruthy();
    const expiresAt = Date.parse(joined.livekit.expiresAt);
    expect(expiresAt).toBeGreaterThan(Date.now());

    const list = await watcher.nextOfType("room_list", (message) =>
      message.rooms.some((room) => room.name === "MEDIA"),
    );
    expect(list.rooms).toEqual([
      {
        name: "MEDIA",
        status: "open",
        directorPresent: true,
        operatorCount: 0,
        capacity: 11,
      },
    ]);
  });

  it("rejects a duplicate room name case-insensitively", async () => {
    const server = await startServer();
    const first = await connectDirector(server, "Director One");
    await createNamedRoom(first, "MEDIA");

    const second = await connectDirector(server, "Director Two");
    second.send({ type: "create_room", name: "media" });

    const error = await second.nextOfType("error");
    expect(error.code).toBe("ROOM_EXISTS");
    expect(error.message).toMatch(/MEDIA/i);
  });

  it("joins and leaves Operators, releasing the camera number", async () => {
    const server = await startServer();
    const director = await connectDirector(server);
    await createNamedRoom(director);

    const { operator: first, joined: firstJoined } = await connectOperator(
      server,
      "Camera 1",
      "MEDIA",
      1,
    );
    const joinedBroadcast = await director.nextOfType(
      "participant_joined",
      (message) => message.participant.id === firstJoined.participantId,
    );
    expect(joinedBroadcast.room.operators).toHaveLength(1);

    const { joined: secondJoined } = await connectOperator(server, "Camera 2", "MEDIA", 2);
    const secondBroadcast = await first.nextOfType(
      "participant_joined",
      (message) => message.participant.id === secondJoined.participantId,
    );
    expect(secondBroadcast.room.operators.map((row) => row.cameraNumber)).toEqual([1, 2]);

    first.send({ type: "leave_room" });
    const left = await director.nextOfType(
      "participant_left",
      (message) => message.participantId === firstJoined.participantId,
    );
    expect(left.room.operators.map((row) => row.cameraNumber)).toEqual([2]);

    const replacement = await connectOperator(server, "Camera 3", "MEDIA", 1);
    expect(replacement.joined.room.operators[0]?.cameraNumber).toBe(1);
  });

  it("rejects a camera that another Operator holds", async () => {
    const server = await startServer();
    const director = await connectDirector(server);
    await createNamedRoom(director);
    await connectOperator(server, "Camera 1", "MEDIA", 1);

    const late = await connectClient(server, { name: "Camera 2" });
    late.send({
      type: "join_room",
      room: "MEDIA",
      name: "Camera 2",
      cameraNumber: 1,
    });

    const error = await late.nextOfType("error");
    expect(error.code).toBe("CAMERA_TAKEN");
  });

  it("rejects the eleventh person with room is full", async () => {
    const server = await startServer();
    const director = await connectDirector(server);
    await createNamedRoom(director);
    for (let camera = 1; camera <= 10; camera += 1) {
      await connectOperator(server, `Camera ${camera}`, "MEDIA", camera);
    }

    const late = await connectClient(server, { name: "Late Camera" });
    late.send({
      type: "join_room",
      room: "MEDIA",
      name: "Late Camera",
      cameraNumber: 1,
    });

    const error = await late.nextOfType("error");
    expect(error.code).toBe("ROOM_FULL");
    expect(error.message).toMatch(/full/i);
  });

  it("refreshes a duplicate camera claim without duplicating the roster", async () => {
    const server = await startServer();
    const director = await connectDirector(server);
    await createNamedRoom(director);
    const { operator, joined } = await connectOperator(server, "Camera 1", "MEDIA", 3);

    operator.send({ type: "set_camera", cameraNumber: 3 });
    const refreshed = await operator.nextOfType(
      "participant_updated",
      (message) => message.participant.id === joined.participantId,
    );
    expect(refreshed.participant.cameraNumber).toBe(3);
    expect(refreshed.room.operators).toHaveLength(1);

    operator.send({ type: "set_camera", cameraNumber: 4 });
    const changed = await operator.nextOfType(
      "participant_updated",
      (message) => message.participant.cameraNumber === 4,
    );
    expect(changed.room.operators).toHaveLength(1);

    director.send({ type: "set_camera", cameraNumber: 5 });
    const error = await director.nextOfType("error");
    expect(error.code).toBe("NOT_OPERATOR");
  });
});

describe("mute", () => {
  it("lets only the Director mute and lets the Operator override it", async () => {
    const server = await startServer();
    const director = await connectDirector(server);
    const directorJoined = await createNamedRoom(director);
    const { operator, joined } = await connectOperator(server, "Camera 1", "MEDIA", 1);

    director.send({
      type: "set_mute",
      participantId: joined.participantId,
      muted: true,
    });
    const muted = await operator.nextOfType(
      "mute_state",
      (message) => message.participantId === joined.participantId,
    );
    expect(muted).toMatchObject({
      room: "MEDIA",
      muted: true,
      by: directorJoined.participantId,
    });
    const mutedRoster = await director.nextOfType(
      "participant_updated",
      (message) => message.participant.muted,
    );
    expect(mutedRoster.participant.id).toBe(joined.participantId);

    operator.send({
      type: "set_mute",
      participantId: joined.participantId,
      muted: true,
    });
    const denied = await operator.nextOfType("error");
    expect(denied.code).toBe("DIRECTOR_REQUIRED");

    operator.send({ type: "clear_mute" });
    const cleared = await operator.nextOfType(
      "mute_state",
      (message) => !message.muted,
    );
    expect(cleared).toMatchObject({
      participantId: joined.participantId,
      muted: false,
      by: null,
    });
  });
});

describe("Operator reconnect", () => {
  it("keeps one roster entry, the same camera and clears the mute", async () => {
    const server = await startServer();
    const director = await connectDirector(server);
    await createNamedRoom(director);
    const { operator, joined } = await connectOperator(server, "Camera 2", "MEDIA", 2);

    director.send({
      type: "set_mute",
      participantId: joined.participantId,
      muted: true,
    });
    await operator.nextOfType("mute_state", (message) => message.muted);

    await operator.close();

    const reconnecting = await director.nextOfType(
      "participant_updated",
      (message) =>
        message.participant.id === joined.participantId &&
        message.participant.connectionState === "reconnecting",
    );
    expect(reconnecting.participant).toMatchObject({
      cameraNumber: 2,
      connectionState: "reconnecting",
    });
    expect(reconnecting.room.operators).toHaveLength(1);

    const resumed = await connectClient(server, {
      clientType: "operator",
      name: "Camera 2",
      sessionToken: joined.sessionToken,
    });
    const rejoined = await resumed.nextOfType("joined");
    expect(rejoined.participantId).toBe(joined.participantId);
    expect(rejoined.sessionToken).toBe(joined.sessionToken);
    expect(rejoined.room.operators).toHaveLength(1);
    expect(rejoined.room.operators[0]).toMatchObject({
      id: joined.participantId,
      cameraNumber: 2,
      connectionState: "connected",
      muted: false,
    });

    const restored = await director.nextOfType(
      "participant_updated",
      (message) =>
        message.participant.id === joined.participantId &&
        message.participant.connectionState === "connected",
    );
    expect(restored.participant.muted).toBe(false);
  });

  it("expires a reconnecting Operator after 90 seconds", async () => {
    let current = new Date("2026-10-22T10:00:00.000Z");
    const server = await startServer({ clock: () => new Date(current) });
    const director = await connectDirector(server);
    await createNamedRoom(director);
    const { operator, joined } = await connectOperator(server, "Camera 2", "MEDIA", 2);
    await operator.close();
    await director.nextOfType(
      "participant_updated",
      (message) => message.participant.id === joined.participantId,
    );

    current = new Date(current.getTime() + 90_000);
    server.sweep();

    const left = await director.nextOfType(
      "participant_left",
      (message) => message.participantId === joined.participantId,
    );
    expect(left.room.operators).toEqual([]);
  });
});

describe("Director grace", () => {
  it("enters a five minute grace period, hides the room and restores it on return", async () => {
    const server = await startServer();
    const watcher = await connectClient(server, { name: "Watcher" });
    await watcher.nextOfType("room_list", (message) => message.rooms.length === 0);
    const director = await connectDirector(server);
    const created = await createNamedRoom(director);
    const { operator } = await connectOperator(server, "Camera 1", "MEDIA", 1);
    await watcher.nextOfType("room_list", (message) =>
      message.rooms.some((room) => room.name === "MEDIA"),
    );

    await director.close();

    const state = await operator.nextOfType("director_state");
    expect(state.present).toBe(false);
    expect(state.room.status).toBe("grace");
    expect(state.room.director).toBeNull();
    expect(state.graceDeadline).toBeDefined();
    const remaining = Date.parse(state.graceDeadline ?? "") - Date.now();
    expect(remaining).toBeGreaterThan(GRACE_PERIOD_MS - 10_000);
    expect(remaining).toBeLessThanOrEqual(GRACE_PERIOD_MS);

    await watcher.nextOfType("room_list", (message) =>
      message.rooms.every((room) => room.name !== "MEDIA"),
    );

    const late = await connectClient(server, { name: "Late Camera" });
    late.send({
      type: "join_room",
      room: "MEDIA",
      name: "Late Camera",
      cameraNumber: 2,
    });
    const closed = await late.nextOfType("error");
    expect(closed.code).toBe("ROOM_CLOSED");

    const returning = await connectClient(server, {
      clientType: "director",
      name: "Director",
      sessionToken: created.sessionToken,
    });
    const rejoined = await returning.nextOfType("joined");
    expect(rejoined.room.status).toBe("open");
    expect(rejoined.room.director?.id).toBe(created.participantId);

    const restored = await operator.nextOfType("director_state");
    expect(restored.present).toBe(true);
    expect(restored.room.status).toBe("open");

    await watcher.nextOfType("room_list", (message) =>
      message.rooms.some((room) => room.name === "MEDIA"),
    );
  });

  it("closes the room when the grace period expires", async () => {
    let current = new Date("2026-10-22T10:00:00.000Z");
    const server = await startServer({ clock: () => new Date(current) });
    const watcher = await connectClient(server, { name: "Watcher" });
    await watcher.nextOfType("room_list", (message) => message.rooms.length === 0);
    const director = await connectDirector(server);
    const created = await createNamedRoom(director);
    const { operator, joined } = await connectOperator(server, "Camera 1", "MEDIA", 1);
    await watcher.nextOfType("room_list", (message) =>
      message.rooms.some((room) => room.name === "MEDIA"),
    );

    await director.close();
    await operator.nextOfType("director_state", (message) => !message.present);

    current = new Date(current.getTime() + GRACE_PERIOD_MS);
    server.sweep();

    const closed = await operator.nextOfType("room_closed");
    expect(closed).toMatchObject({ room: "MEDIA", reason: "director_timeout" });

    await watcher.nextOfType("room_list", (message) =>
      message.rooms.every((room) => room.name !== "MEDIA"),
    );

    const returning = await TestClient.connect(server.port());
    returning.hello({
      clientType: "director",
      name: "Director",
      sessionToken: created.sessionToken,
    });
    await expect(returning.nextOfType("error")).resolves.toMatchObject({
      code: "SESSION_EXPIRED",
    });

    const operatorReturn = await TestClient.connect(server.port());
    operatorReturn.hello({
      clientType: "operator",
      name: "Camera 1",
      sessionToken: joined.sessionToken,
    });
    await expect(operatorReturn.nextOfType("error")).resolves.toMatchObject({
      code: "SESSION_EXPIRED",
    });
  });

  it("ends the room immediately without a grace countdown", async () => {
    const server = await startServer();
    const watcher = await connectClient(server, { name: "Watcher" });
    await watcher.nextOfType("room_list", (message) => message.rooms.length === 0);
    const director = await connectDirector(server);
    await createNamedRoom(director);
    const { operator, joined } = await connectOperator(server, "Camera 1", "MEDIA", 1);
    await watcher.nextOfType("room_list", (message) =>
      message.rooms.some((room) => room.name === "MEDIA"),
    );

    director.send({ type: "end_room" });

    const closed = await operator.nextOfType("room_closed");
    expect(closed).toMatchObject({ room: "MEDIA", reason: "ended_by_director" });
    await watcher.nextOfType("room_list", (message) =>
      message.rooms.every((room) => room.name !== "MEDIA"),
    );

    const returning = await TestClient.connect(server.port());
    returning.hello({
      clientType: "operator",
      name: "Camera 1",
      sessionToken: joined.sessionToken,
    });
    await expect(returning.nextOfType("error")).resolves.toMatchObject({
      code: "SESSION_EXPIRED",
    });
  });

  it("reports SESSION_EXPIRED for an unknown token but keeps the socket usable", async () => {
    const server = await startServer();
    const client = await TestClient.connect(server.port());
    client.hello({ sessionToken: "not-a-session" });

    const error = await client.nextOfType("error");
    expect(error.code).toBe("SESSION_EXPIRED");
    await expect(client.nextOfType("server_info")).resolves.toMatchObject({
      protocol: PROTOCOL_VERSION,
    });

    client.send({ type: "ping" });
    await expect(client.nextOfType("pong")).resolves.toMatchObject({ type: "pong" });
  });
});

describe("server health", () => {
  it("broadcasts server_health with live counts", async () => {
    const server = await startServer({ livekitHealthCheck: async () => true });
    const client = await connectClient(server, { name: "Watcher" });

    const initial = await client.nextOfType("server_health");
    expect(initial).toMatchObject({
      status: "running",
      rooms: 0,
      operators: 0,
      clients: 1,
      livekitUrl: expect.stringMatching(/^ws:\/\//),
    });
    expect(initial.uptimeSeconds).toBeGreaterThanOrEqual(0);

    const director = await connectDirector(server);
    await createNamedRoom(director);
    const health = await client.nextOfType(
      "server_health",
      (message) => message.rooms === 1 && message.clients === 2,
    );
    expect(health.operators).toBe(0);
  });

  it("serves GET /api/health with status and counts", async () => {
    const server = await startServer({ livekitHealthCheck: async () => true });
    const director = await connectDirector(server);
    await createNamedRoom(director);

    const response = await fetch(`${server.url()}/api/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "running",
      rooms: 1,
      clients: 1,
      protocol: PROTOCOL_VERSION,
      livekitUrl: expect.stringMatching(/^ws:\/\//),
    });

    const post = await fetch(`${server.url()}/api/health`, { method: "POST" });
    expect(post.status).toBe(405);
  });

  it("reports degraded when LiveKit is unreachable", async () => {
    const server = await startServer({ livekitHealthCheck: async () => false });
    const response = await fetch(`${server.url()}/api/health`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "degraded" });
  });
});

describe("v1 client message validation", () => {
  it("reports INVALID_MESSAGE for every malformed room command", async () => {
    const server = await startServer();
    const client = await connectClient(server);

    const invalidMessages: unknown[] = [
      { type: "create_room", name: "x".repeat(25) },
      { type: "create_room", name: "   " },
      { type: "join_room", room: "MEDIA", name: "Camera 1", cameraNumber: 0 },
      { type: "join_room", room: "MEDIA", name: "Camera 1", cameraNumber: 11 },
      { type: "join_room", room: "MEDIA", cameraNumber: 1 },
      { type: "join_room", room: "MEDIA", name: "Camera 1", cameraNumber: 1.5 },
      { type: "set_camera", cameraNumber: 0 },
      { type: "set_camera", cameraNumber: 11 },
      { type: "set_mute", participantId: "someone" },
      { type: "set_mute", participantId: "someone", muted: "yes" },
      { type: "set_mute", muted: true },
    ];

    for (const message of invalidMessages) {
      client.send(message);
      const error = await client.nextOfType("error");
      expect(error.code).toBe("INVALID_MESSAGE");
    }

    client.send({ type: "ping" });
    await expect(client.nextOfType("pong")).resolves.toMatchObject({ type: "pong" });
  });
});
