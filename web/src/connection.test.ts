import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  type DebugRosterMessage,
  type JoinedMessage,
  type RoomClosedMessage,
  type RoomListMessage,
  type RoomSnapshot,
  type ServerHealthMessage,
  type ServerInfoMessage,
} from "@church-comms/protocol";
import {
  DIRECTOR_SESSION_STORAGE_KEY,
  DirectorConnection,
  browserRoleFromSearch,
  type DirectorConnectionOptions,
  type ReconnectScheduler,
  type SessionStorage,
} from "./connection";

class FakeWebSocket {
  readonly sent: string[] = [];
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {}

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

  fail(): void {
    this.readyState = 3;
    this.onerror?.(new Event("error"));
    this.onclose?.(new CloseEvent("close"));
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
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

interface ScheduledTimer {
  delayMs: number;
  handler: () => void;
  cancelled: boolean;
}

interface Harness {
  connection: DirectorConnection;
  storage: MemoryStorage;
  sockets: FakeWebSocket[];
  timers: ScheduledTimer[];
  runNextTimer(): void;
  now: { value: number };
}

function createHarness(overrides: DirectorConnectionOptions = {}): Harness {
  const storage = new MemoryStorage();
  const sockets: FakeWebSocket[] = [];
  const timers: ScheduledTimer[] = [];
  const now = { value: 1_000 };
  let scheduler: ReconnectScheduler;

  scheduler = {
    schedule(handler, delayMs) {
      const timer: ScheduledTimer = { handler, delayMs, cancelled: false };
      timers.push(timer);
      return timer;
    },
    cancel(handle) {
      (handle as ScheduledTimer).cancelled = true;
    },
  };

  const connection = new DirectorConnection({
    url: "ws://test.local/ws",
    socketFactory: (url) => {
      const socket = new FakeWebSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    storage,
    clock: () => now.value,
    scheduler,
    reconnectDelaysMs: [10, 20, 30, 40, 50],
    maxReconnectAttempts: 5,
    ...overrides,
  });

  return {
    connection,
    storage,
    sockets,
    timers,
    now,
    runNextTimer() {
      const timer = timers.find((candidate) => !candidate.cancelled);
      if (timer === undefined) {
        throw new Error("No reconnect timer was scheduled");
      }
      timer.cancelled = true;
      now.value += timer.delayMs;
      timer.handler();
    },
  };
}

function openSocket(harness: Harness): FakeWebSocket {
  const socket = harness.sockets.at(-1);
  if (socket === undefined) {
    throw new Error("No control socket was opened");
  }
  socket.open();
  return socket;
}

function joinedMessage(overrides: Partial<JoinedMessage> = {}): JoinedMessage {
  return {
    type: "joined",
    participantId: "operator-1",
    sessionToken: "session-1",
    room: operatorRoomSnapshot(),
    livekit: {
      url: "ws://192.168.1.20:7880",
      room: "MEDIA",
      token: "livekit-token",
      expiresAt: "2026-10-21T11:00:00.000Z",
    },
    ...overrides,
  };
}

function operatorRoomSnapshot(): RoomSnapshot {
  return {
    name: "MEDIA",
    status: "open",
    director: {
      id: "director-1",
      name: "Director",
      role: "director",
      cameraNumber: null,
      connectionState: "connected",
      muted: false,
      joinedAt: "2026-10-21T09:00:00.000Z",
    },
    operators: [
      {
        id: "operator-1",
        name: "Camera 1",
        role: "operator",
        cameraNumber: 1,
        connectionState: "connected",
        muted: false,
        joinedAt: "2026-10-21T09:01:00.000Z",
      },
    ],
    capacity: 11,
  };
}

const serverInfo: ServerInfoMessage = {
  type: "server_info",
  protocol: PROTOCOL_VERSION,
  serverId: "test-server",
  livekitUrl: "ws://192.168.1.20:7880",
  serverTime: "2026-10-21T09:00:00.000Z",
};

const roomList: RoomListMessage = {
  type: "room_list",
  rooms: [
    {
      name: "MEDIA",
      status: "open",
      directorPresent: true,
      operatorCount: 1,
      capacity: 11,
    },
  ],
};

const debugRoster: DebugRosterMessage = {
  type: "debug_roster",
  clients: [
    {
      id: "director-1",
      name: "Director",
      clientType: "director",
      appVersion: "0.1.0",
      connectedAt: "2026-10-21T09:00:00.000Z",
    },
  ],
};

describe("DirectorConnection", () => {
  it("completes the v1 director handshake and stores server, rooms and roster", () => {
    const harness = createHarness();
    harness.connection.connect();

    expect(harness.connection.getSnapshot().phase).toBe("connecting");
    const socket = openSocket(harness);

    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      clientType: "director",
      name: "Director",
    });
    expect(JSON.parse(socket.sent[0] ?? "{}").sessionToken).toBeUndefined();

    socket.receive(serverInfo);
    socket.receive(roomList);
    socket.receive(debugRoster);

    const state = harness.connection.getSnapshot();
    expect(state.phase).toBe("connected");
    expect(state.serverInfo).toEqual(serverInfo);
    expect(state.rooms).toEqual(roomList.rooms);
    expect(state.roster).toEqual(debugRoster.clients);
  });

  it("persists the joined session token and resumes with it after a dropped socket", () => {
    const harness = createHarness();
    harness.connection.connect();
    const socket = openSocket(harness);

    socket.receive(serverInfo);
    socket.receive(joinedMessage());

    expect(harness.storage.getItem(DIRECTOR_SESSION_STORAGE_KEY)).toBe("session-1");
    expect(harness.connection.getSnapshot()).toMatchObject({
      joinedRoom: { name: "MEDIA" },
      self: { id: "operator-1", cameraNumber: 1 },
      livekit: { token: "livekit-token" },
      ownMute: { muted: false, by: null },
    });

    socket.close();

    const reconnecting = harness.connection.getSnapshot();
    expect(reconnecting.phase).toBe("reconnecting");
    expect(reconnecting.reconnect).toMatchObject({
      attempt: 1,
      maxAttempts: 5,
    });

    harness.runNextTimer();
    const resumed = openSocket(harness);
    expect(JSON.parse(resumed.sent[0] ?? "{}")).toMatchObject({
      type: "hello",
      clientType: "director",
      sessionToken: "session-1",
    });

    resumed.receive(serverInfo);
    expect(harness.connection.getSnapshot().phase).toBe("connected");
    expect(harness.connection.getSnapshot().reconnect).toBeUndefined();
  });

  it("resumes with a session token that was already in storage", () => {
    const harness = createHarness();
    harness.storage.setItem(DIRECTOR_SESSION_STORAGE_KEY, "stored-token");

    harness.connection.connect();
    const socket = openSocket(harness);

    expect(JSON.parse(socket.sent[0] ?? "{}").sessionToken).toBe("stored-token");
  });

  it("creates MEDIA by default, and sends every room command", () => {
    const harness = createHarness();
    harness.connection.connect();
    const socket = openSocket(harness);

    harness.connection.createRoom();
    harness.connection.createRoom("SECURITY");
    harness.connection.joinRoom("MEDIA", { name: "Browser 2", cameraNumber: 2 });
    harness.connection.leaveRoom();
    harness.connection.endRoom();
    harness.connection.setMute("operator-1", true);
    harness.connection.clearMute();
    harness.connection.setCamera(3);

    const sent = socket.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
    expect(sent).toContainEqual({ type: "create_room", name: "MEDIA" });
    expect(sent).toContainEqual({ type: "create_room", name: "SECURITY" });
    expect(sent).toContainEqual({
      type: "join_room",
      room: "MEDIA",
      name: "Browser 2",
      cameraNumber: 2,
    });
    expect(sent).toContainEqual({ type: "leave_room" });
    expect(sent).toContainEqual({ type: "end_room" });
    expect(sent).toContainEqual({
      type: "set_mute",
      participantId: "operator-1",
      muted: true,
    });
    expect(sent).toContainEqual({ type: "clear_mute" });
    expect(sent).toContainEqual({ type: "set_camera", cameraNumber: 3 });
  });

  it("clears the joined room locally after leave and after room_closed", () => {
    const first = createHarness();
    first.connection.connect();
    const socket = openSocket(first);
    socket.receive(joinedMessage());

    first.connection.leaveRoom();
    expect(first.connection.getSnapshot().joinedRoom).toBeUndefined();
    expect(first.connection.getSnapshot().self).toBeUndefined();

    const second = createHarness();
    second.connection.connect();
    const other = openSocket(second);
    other.receive(joinedMessage());

    const closed: RoomClosedMessage = {
      type: "room_closed",
      room: "MEDIA",
      reason: "ended_by_director",
    };
    other.receive(closed);

    expect(second.connection.getSnapshot().joinedRoom).toBeUndefined();
    expect(second.connection.getSnapshot().roomClosedReason).toBe("ended_by_director");
  });

  it("tracks the director presence, grace deadline and server health", () => {
    const harness = createHarness();
    harness.connection.connect();
    const socket = openSocket(harness);
    socket.receive(joinedMessage());

    socket.receive({
      type: "director_state",
      room: { ...operatorRoomSnapshot(), status: "grace" },
      present: false,
      graceDeadline: "2026-10-21T09:05:00.000Z",
    });

    expect(harness.connection.getSnapshot()).toMatchObject({
      directorPresent: false,
      graceDeadline: "2026-10-21T09:05:00.000Z",
      joinedRoom: { status: "grace" },
    });

    const health: ServerHealthMessage = {
      type: "server_health",
      status: "running",
      rooms: 1,
      operators: 1,
      clients: 2,
      uptimeSeconds: 120,
      livekitUrl: "ws://192.168.1.20:7880",
    };
    socket.receive(health);
    expect(harness.connection.getSnapshot().health).toEqual(health);
  });

  it("tracks the Operator's own mute state from mute_state and roster updates", () => {
    const harness = createHarness({ role: "operator", name: "Browser 1" });
    harness.connection.connect();
    const socket = openSocket(harness);
    socket.receive(joinedMessage());

    socket.receive({
      type: "mute_state",
      room: "MEDIA",
      participantId: "operator-1",
      muted: true,
      by: "director-1",
    });

    expect(harness.connection.getSnapshot().ownMute).toEqual({
      muted: true,
      by: "director-1",
    });
    expect(harness.connection.getSnapshot().self?.muted).toBe(true);
    expect(
      harness.connection.getSnapshot().joinedRoom?.operators[0]?.muted,
    ).toBe(true);

    socket.receive({
      type: "mute_state",
      room: "MEDIA",
      participantId: "operator-1",
      muted: false,
      by: null,
    });

    expect(harness.connection.getSnapshot().ownMute).toEqual({
      muted: false,
      by: null,
    });

    socket.receive({
      type: "participant_updated",
      participant: {
        id: "operator-1",
        name: "Camera 1",
        role: "operator",
        cameraNumber: 1,
        connectionState: "reconnecting",
        muted: true,
        joinedAt: "2026-10-21T09:01:00.000Z",
      },
      room: {
        ...operatorRoomSnapshot(),
        operators: [
          {
            ...operatorRoomSnapshot().operators[0]!,
            connectionState: "reconnecting",
            muted: true,
          },
        ],
      },
    });

    expect(harness.connection.getSnapshot().self).toMatchObject({
      connectionState: "reconnecting",
      muted: true,
    });
    expect(harness.connection.getSnapshot().ownMute.muted).toBe(true);
  });

  it("falls back to the join screen when the stored session has expired", () => {
    const harness = createHarness();
    harness.storage.setItem(DIRECTOR_SESSION_STORAGE_KEY, "stale-token");
    harness.connection.connect();
    const socket = openSocket(harness);

    socket.receive({
      type: "error",
      code: "SESSION_EXPIRED",
      message: "That session has expired. Join the room again.",
    });

    const state = harness.connection.getSnapshot();
    expect(state.phase).toBe("connected");
    expect(state.errorCode).toBe("SESSION_EXPIRED");
    expect(state.error).toMatch(/expired/i);
    expect(harness.storage.getItem(DIRECTOR_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("shows a non-fatal server error without dropping the control connection", () => {
    const harness = createHarness();
    harness.connection.connect();
    const socket = openSocket(harness);
    socket.receive(serverInfo);

    socket.receive({
      type: "error",
      code: "ROOM_EXISTS",
      message: 'A room named "MEDIA" already exists.',
    });

    expect(harness.connection.getSnapshot()).toMatchObject({
      phase: "connected",
      errorCode: "ROOM_EXISTS",
    });
    expect(harness.connection.getSnapshot().error).toMatch(/already exists/);
  });

  it("retries with bounded backoff and exposes reconnect attempts", () => {
    const harness = createHarness({ maxReconnectAttempts: 3 });
    harness.connection.connect();
    const socket = openSocket(harness);
    socket.receive(serverInfo);

    socket.fail();

    expect(harness.connection.getSnapshot()).toMatchObject({
      phase: "reconnecting",
      reconnect: { attempt: 1, maxAttempts: 3, nextRetryAt: 1_010 },
    });
    expect(harness.timers[0]?.delayMs).toBe(10);

    harness.runNextTimer();
    openSocket(harness).receive(serverInfo);
    expect(harness.connection.getSnapshot().phase).toBe("connected");

    // A successful handshake resets the backoff for the next drop.
    const resumed = harness.sockets.at(-1);
    resumed?.fail();
    expect(harness.connection.getSnapshot().reconnect).toMatchObject({ attempt: 1 });
  });

  it("gives up after the retry budget and lets retry() start over", () => {
    const harness = createHarness({ maxReconnectAttempts: 2 });
    harness.connection.connect();
    openSocket(harness).fail();

    harness.runNextTimer();
    openSocket(harness).fail();

    harness.runNextTimer();
    openSocket(harness).fail();

    const exhausted = harness.connection.getSnapshot();
    expect(exhausted.phase).toBe("disconnected");
    expect(exhausted.reconnect).toBeUndefined();
    expect(exhausted.error).toMatch(/control server/i);
    expect(harness.sockets).toHaveLength(3);

    harness.connection.retry();
    expect(harness.connection.getSnapshot().phase).toBe("connecting");
    expect(harness.sockets).toHaveLength(4);
  });

  it("stops retrying after a protocol mismatch", () => {
    const harness = createHarness();
    harness.connection.connect();
    const socket = openSocket(harness);
    socket.receive(serverInfo);

    socket.receive({
      type: "error",
      code: "PROTOCOL_MISMATCH",
      message: "Protocol mismatch: server v2, client v1.",
    });
    socket.close();

    expect(harness.connection.getSnapshot().phase).toBe("error");
    expect(harness.connection.getSnapshot().reconnect).toBeUndefined();
    expect(harness.timers).toHaveLength(0);
  });

  it("ignores a late roster event after leaving instead of resurrecting the room", () => {
    const harness = createHarness();
    harness.connection.connect();
    const socket = openSocket(harness);
    socket.receive(joinedMessage());

    harness.connection.leaveRoom();
    socket.receive({
      type: "participant_left",
      participantId: "director-1",
      room: operatorRoomSnapshot(),
    });

    expect(harness.connection.getSnapshot().joinedRoom).toBeUndefined();
  });

  it("does not schedule a reconnect after an intentional disconnect", () => {
    const harness = createHarness();
    harness.connection.connect();
    const socket = openSocket(harness);
    socket.receive(serverInfo);

    harness.connection.disconnect();

    expect(harness.connection.getSnapshot().phase).toBe("disconnected");
    expect(harness.timers).toHaveLength(0);
  });
});

describe("browserRoleFromSearch", () => {
  it("reads the operator test-participant role from the query string", () => {
    expect(browserRoleFromSearch("?role=operator")).toBe("operator");
    expect(browserRoleFromSearch("?foo=1&role=operator")).toBe("operator");
    expect(browserRoleFromSearch("?role=director")).toBe("director");
    expect(browserRoleFromSearch("")).toBe("director");
    expect(browserRoleFromSearch("?role=whatever")).toBe("director");
  });
});
