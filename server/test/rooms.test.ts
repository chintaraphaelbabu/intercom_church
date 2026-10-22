import { describe, expect, it } from "vitest";
import {
  GRACE_PERIOD_MS,
  MAX_OPERATORS,
  type ErrorCode,
} from "@church-comms/protocol";
import {
  OPERATOR_RECONNECT_GRACE_MS,
  RoomRegistry,
  type RoomError,
  type RoomRegistryOptions,
} from "../src/rooms.js";

function unwrap<T>(result: ({ ok: true } & T) | RoomError): { ok: true } & T {
  if (!result.ok) {
    throw new Error(`Expected success, got ${result.code}: ${result.message}`);
  }
  return result;
}

function expectError<T>(result: ({ ok: true } & T) | RoomError, code: ErrorCode): RoomError {
  if (result.ok) {
    throw new Error(`Expected ${code}, got success`);
  }
  expect(result.code).toBe(code);
  expect(result.message.length).toBeGreaterThan(0);
  return result;
}

function setup(options: Partial<RoomRegistryOptions> = {}) {
  let current = new Date("2026-10-22T10:00:00.000Z");
  let nextId = 1;
  let nextToken = 1;
  const registry = new RoomRegistry({
    now: () => new Date(current),
    idFactory: () => `participant-${nextId++}`,
    tokenFactory: () => `session-${nextToken++}`,
    ...options,
  });

  return {
    registry,
    advance(ms: number): void {
      current = new Date(current.getTime() + ms);
    },
    now: (): Date => new Date(current),
  };
}

function createMedia(registry: RoomRegistry, name = "MEDIA") {
  return unwrap(registry.createRoom({ name, directorName: "Director" }));
}

function joinMedia(
  registry: RoomRegistry,
  name: string,
  cameraNumber: number,
  room = "MEDIA",
) {
  return unwrap(registry.joinRoom({ room, name, cameraNumber }));
}

describe("RoomRegistry rooms", () => {
  it("creates a room with a Director who has no camera number", () => {
    const { registry } = setup();
    const created = createMedia(registry);

    expect(created.room).toMatchObject({
      name: "MEDIA",
      status: "open",
      capacity: 11,
    });
    expect(created.participant).toMatchObject({
      name: "Director",
      role: "director",
      cameraNumber: null,
      connectionState: "connected",
      muted: false,
    });
    expect(created.room.director).toMatchObject({ id: created.participant.id });
    expect(created.room.operators).toEqual([]);
    expect(created.sessionToken).toBeTruthy();
    expect(Number.isNaN(Date.parse(created.participant.joinedAt))).toBe(false);

    expect(registry.listRooms()).toEqual([
      {
        name: "MEDIA",
        status: "open",
        directorPresent: true,
        operatorCount: 0,
        capacity: 11,
      },
    ]);
  });

  it("normalizes room names and rejects duplicates case-insensitively", () => {
    const { registry } = setup();
    createMedia(registry, "  MEDIA  ");

    const duplicate = registry.createRoom({ name: " media ", directorName: "Other" });
    expectError(duplicate, "ROOM_EXISTS");
    expect(registry.roomCount).toBe(1);
  });

  it("rejects empty and over-long room names", () => {
    const { registry } = setup();

    expectError(
      registry.createRoom({ name: "   ", directorName: "Director" }),
      "INVALID_ROOM_NAME",
    );
    expectError(
      registry.createRoom({ name: "x".repeat(25), directorName: "Director" }),
      "INVALID_ROOM_NAME",
    );
  });

  it("lists rooms deterministically by name", () => {
    const { registry } = setup();
    createMedia(registry, "SECURITY");
    createMedia(registry, "alpha");
    createMedia(registry, "MEDIA");

    expect(registry.listRooms().map((room) => room.name)).toEqual([
      "alpha",
      "MEDIA",
      "SECURITY",
    ]);
  });
});

describe("RoomRegistry camera slots", () => {
  it("joins an Operator with a camera number and a session token", () => {
    const { registry } = setup();
    const created = createMedia(registry);
    const joined = joinMedia(registry, "Camera 1", 1);

    expect(joined.participant).toMatchObject({
      name: "Camera 1",
      role: "operator",
      cameraNumber: 1,
      connectionState: "connected",
      muted: false,
    });
    expect(joined.sessionToken).toBeTruthy();
    expect(joined.room.operators).toHaveLength(1);
    expect(joined.room.director?.id).toBe(created.participant.id);
    expect(registry.listRooms()[0]?.operatorCount).toBe(1);
  });

  it("rejects a camera number that another Operator holds", () => {
    const { registry } = setup();
    createMedia(registry);
    joinMedia(registry, "Camera 1", 1);

    expectError(
      registry.joinRoom({ room: "MEDIA", name: "Camera 2", cameraNumber: 1 }),
      "CAMERA_TAKEN",
    );
  });

  it("allows an Operator to refresh the camera number they already hold", () => {
    const { registry } = setup();
    createMedia(registry);
    const joined = joinMedia(registry, "Camera 1", 3);

    const refreshed = unwrap(registry.setCamera(joined.participant.id, 3));
    expect(refreshed.participant.cameraNumber).toBe(3);
    expect(refreshed.room.operators).toHaveLength(1);
  });

  it("changes cameras and rejects a camera held by another Operator", () => {
    const { registry } = setup();
    createMedia(registry);
    const first = joinMedia(registry, "Camera 1", 1);
    joinMedia(registry, "Camera 2", 2);

    const changed = unwrap(registry.setCamera(first.participant.id, 5));
    expect(changed.participant.cameraNumber).toBe(5);

    expectError(registry.setCamera(first.participant.id, 2), "CAMERA_TAKEN");
  });

  it("rejects camera numbers outside 1-10", () => {
    const { registry } = setup();
    createMedia(registry);
    const joined = joinMedia(registry, "Camera 1", 1);

    expectError(registry.setCamera(joined.participant.id, 0), "INVALID_CAMERA");
    expectError(registry.setCamera(joined.participant.id, 11), "INVALID_CAMERA");
    expectError(
      registry.joinRoom({ room: "MEDIA", name: "Camera 2", cameraNumber: 11 }),
      "INVALID_CAMERA",
    );
  });

  it("never gives the Director a camera number", () => {
    const { registry } = setup();
    const created = createMedia(registry);

    expect(created.participant.cameraNumber).toBeNull();
    expectError(registry.setCamera(created.participant.id, 1), "NOT_OPERATOR");
  });

  it("releases a camera number immediately on a clean leave", () => {
    const { registry } = setup();
    createMedia(registry);
    const joined = joinMedia(registry, "Camera 1", 1);

    const left = unwrap(registry.leave(joined.participant.id));
    expect(left.kind).toBe("left");
    if (left.kind === "left") {
      expect(left.room.operators).toEqual([]);
    }
    expectError(registry.disconnect(joined.participant.id), "NOT_IN_ROOM");

    const rejoined = joinMedia(registry, "Camera 2", 1);
    expect(rejoined.participant.cameraNumber).toBe(1);
  });

  it("rejects an eleventh person with room is full", () => {
    const { registry } = setup();
    createMedia(registry);

    for (let camera = 1; camera <= MAX_OPERATORS; camera += 1) {
      joinMedia(registry, `Camera ${camera}`, camera);
    }
    expect(registry.listRooms()[0]?.operatorCount).toBe(MAX_OPERATORS);

    const rejected = expectError(
      registry.joinRoom({ room: "MEDIA", name: "Camera 11", cameraNumber: 1 }),
      "ROOM_FULL",
    );
    expect(rejected.message).toMatch(/full/i);
  });
});

describe("RoomRegistry mute state", () => {
  it("lets only the Director mute and records who did it", () => {
    const { registry } = setup();
    const created = createMedia(registry);
    const joined = joinMedia(registry, "Camera 1", 1);

    const muted = unwrap(registry.setMute(created.participant.id, joined.participant.id, true));
    expect(muted.participant.muted).toBe(true);
    expect(muted.by).toBe(created.participant.id);
    expect(muted.room.operators[0]?.muted).toBe(true);

    const unmuted = unwrap(
      registry.setMute(created.participant.id, joined.participant.id, false),
    );
    expect(unmuted.participant.muted).toBe(false);
    expect(unmuted.by).toBe(created.participant.id);

    expectError(
      registry.setMute(joined.participant.id, joined.participant.id, true),
      "DIRECTOR_REQUIRED",
    );
  });

  it("rejects a mute target outside the room and the Director as a target", () => {
    const { registry } = setup();
    const created = createMedia(registry);

    expectError(
      registry.setMute(created.participant.id, "nobody", true),
      "NOT_IN_ROOM",
    );
    expectError(
      registry.setMute(created.participant.id, created.participant.id, true),
      "NOT_OPERATOR",
    );
  });

  it("lets the muted Operator clear their own mute with a fresh PTT", () => {
    const { registry } = setup();
    const created = createMedia(registry);
    const joined = joinMedia(registry, "Camera 1", 1);
    unwrap(registry.setMute(created.participant.id, joined.participant.id, true));

    const cleared = unwrap(registry.clearMute(joined.participant.id));
    expect(cleared.participant.muted).toBe(false);
    expect(cleared.by).toBeNull();
    expect(cleared.room.operators[0]?.muted).toBe(false);

    expectError(registry.clearMute(created.participant.id), "NOT_OPERATOR");
  });
});

describe("RoomRegistry reconnect retention", () => {
  it("keeps a disconnected Operator as one reconnecting roster entry", () => {
    const { registry } = setup();
    const created = createMedia(registry);
    const joined = joinMedia(registry, "Camera 2", 2);
    unwrap(registry.setMute(created.participant.id, joined.participant.id, true));

    const disconnected = unwrap(registry.disconnect(joined.participant.id));
    expect(disconnected.participant.connectionState).toBe("reconnecting");
    expect(disconnected.participant.cameraNumber).toBe(2);
    expect(disconnected.room.operators).toHaveLength(1);
    expect(disconnected.room.operators[0]).toMatchObject({
      id: joined.participant.id,
      cameraNumber: 2,
      connectionState: "reconnecting",
      muted: true,
    });

    const resumed = unwrap(registry.resumeSession(joined.sessionToken));
    expect(resumed.participant).toMatchObject({
      id: joined.participant.id,
      cameraNumber: 2,
      connectionState: "connected",
      muted: false,
    });
    expect(resumed.room.operators).toHaveLength(1);
  });

  it("keeps a reconnecting Operator for 90 seconds then removes the entry", () => {
    const { registry, advance } = setup();
    createMedia(registry);
    const joined = joinMedia(registry, "Camera 2", 2);
    unwrap(registry.disconnect(joined.participant.id));

    advance(OPERATOR_RECONNECT_GRACE_MS - 1);
    expect(registry.tick().participantRemovals).toEqual([]);
    expect(registry.snapshot("MEDIA")?.operators).toHaveLength(1);

    advance(1);
    const ticked = registry.tick();
    expect(ticked.participantRemovals).toHaveLength(1);
    expect(ticked.participantRemovals[0]?.participant).toMatchObject({
      id: joined.participant.id,
      cameraNumber: 2,
    });
    expect(registry.snapshot("MEDIA")?.operators).toEqual([]);
    expectError(registry.resumeSession(joined.sessionToken), "SESSION_EXPIRED");

    const replacement = joinMedia(registry, "Camera 3", 2);
    expect(replacement.participant.cameraNumber).toBe(2);
  });

  it("does not extend the reconnect deadline on a repeated disconnect", () => {
    const { registry, advance } = setup();
    createMedia(registry);
    const joined = joinMedia(registry, "Camera 2", 2);
    unwrap(registry.disconnect(joined.participant.id));

    advance(OPERATOR_RECONNECT_GRACE_MS - 10);
    unwrap(registry.disconnect(joined.participant.id));
    advance(10);

    expect(registry.tick().participantRemovals).toHaveLength(1);
  });
});

describe("RoomRegistry Director grace", () => {
  it("enters grace for five minutes and hides the room from the join list", () => {
    const { registry, advance } = setup();
    const created = createMedia(registry);
    joinMedia(registry, "Camera 1", 1);

    const disconnected = unwrap(registry.disconnect(created.participant.id));
    expect(disconnected.directorState?.present).toBe(false);
    expect(disconnected.room.status).toBe("grace");
    expect(disconnected.room.director).toBeNull();
    expect(disconnected.room.operators).toHaveLength(1);

    const deadline = Date.parse(disconnected.directorState?.graceDeadline ?? "");
    const startedAt = Date.parse("2026-10-22T10:00:00.000Z");
    expect(deadline - startedAt).toBe(GRACE_PERIOD_MS);
    expect(registry.listRooms()).toEqual([]);
    expect(registry.listAllRooms()).toHaveLength(1);
    expect(registry.listAllRooms()[0]).toMatchObject({
      status: "grace",
      directorPresent: false,
      operatorCount: 1,
    });

    expectError(
      registry.joinRoom({ room: "MEDIA", name: "Late Camera", cameraNumber: 2 }),
      "ROOM_CLOSED",
    );
  });

  it("does not cancel grace when an Operator reconnects during it", () => {
    const { registry, advance } = setup();
    const created = createMedia(registry);
    const operator = joinMedia(registry, "Camera 1", 1);
    unwrap(registry.disconnect(operator.participant.id));
    unwrap(registry.disconnect(created.participant.id));

    advance(1_000);
    const resumed = unwrap(registry.resumeSession(operator.sessionToken));
    expect(resumed.participant.connectionState).toBe("connected");
    expect(resumed.room.status).toBe("grace");
    expect(registry.listRooms()).toEqual([]);

    const director = unwrap(registry.resumeSession(created.sessionToken));
    expect(director.room.status).toBe("open");
  });

  it("lets the Director return with the session token and cancels grace", () => {
    const { registry } = setup();
    const created = createMedia(registry);
    joinMedia(registry, "Camera 1", 1);
    unwrap(registry.disconnect(created.participant.id));

    const resumed = unwrap(registry.resumeSession(created.sessionToken));
    expect(resumed.participant.id).toBe(created.participant.id);
    expect(resumed.room.status).toBe("open");
    expect(resumed.room.graceDeadline).toBeUndefined();
    expect(resumed.room.director?.id).toBe(created.participant.id);
    expect(registry.listRooms()).toHaveLength(1);
  });

  it("closes the room when the five minutes expire", () => {
    const { registry, advance } = setup();
    const created = createMedia(registry);
    const operator = joinMedia(registry, "Camera 1", 1);
    unwrap(registry.disconnect(created.participant.id));

    advance(GRACE_PERIOD_MS - 1);
    expect(registry.tick().roomClosures).toEqual([]);
    expect(registry.roomCount).toBe(1);

    advance(1);
    const ticked = registry.tick();
    expect(ticked.roomClosures).toHaveLength(1);
    expect(ticked.roomClosures[0]).toMatchObject({
      roomName: "MEDIA",
      reason: "director_timeout",
    });
    expect(ticked.roomClosures[0]?.participants.map((row) => row.id)).toContain(
      operator.participant.id,
    );
    expect(registry.roomCount).toBe(0);
    expect(registry.listAllRooms()).toEqual([]);
    expectError(registry.resumeSession(created.sessionToken), "SESSION_EXPIRED");
    expectError(registry.resumeSession(operator.sessionToken), "SESSION_EXPIRED");
  });

  it("rejects a duplicate room name while the room is in grace", () => {
    const { registry } = setup();
    const created = createMedia(registry);
    unwrap(registry.disconnect(created.participant.id));

    expectError(registry.createRoom({ name: "media", directorName: "Other" }), "ROOM_EXISTS");
  });
});

describe("RoomRegistry room end", () => {
  it("ends a room immediately and invalidates every session", () => {
    const { registry } = setup();
    const created = createMedia(registry);
    const operator = joinMedia(registry, "Camera 1", 1);

    const closed = unwrap(registry.endRoom(created.participant.id));
    expect(closed.reason).toBe("ended_by_director");
    expect(closed.roomName).toBe("MEDIA");
    expect(closed.participants.map((row) => row.id).sort()).toEqual(
      [created.participant.id, operator.participant.id].sort(),
    );
    expect(registry.roomCount).toBe(0);
    expect(registry.listRooms()).toEqual([]);
    expectError(registry.resumeSession(created.sessionToken), "SESSION_EXPIRED");
    expectError(registry.resumeSession(operator.sessionToken), "SESSION_EXPIRED");
  });

  it("requires the Director to end a room", () => {
    const { registry } = setup();
    createMedia(registry);
    const operator = joinMedia(registry, "Camera 1", 1);

    expectError(registry.endRoom(operator.participant.id), "DIRECTOR_REQUIRED");
    expectError(registry.endRoom("nobody"), "NOT_IN_ROOM");
    expect(registry.roomCount).toBe(1);
  });
});

describe("RoomRegistry identity lookup", () => {
  it("resolves a participant id to its room and role for media tokens", () => {
    const { registry } = setup();
    createMedia(registry);
    const operator = joinMedia(registry, "Camera 1", 1);

    expect(registry.resolveMediaIdentity(operator.participant.id)).toEqual({
      room: "MEDIA",
      role: "operator",
      name: "Camera 1",
    });
    expect(registry.resolveMediaIdentity("nobody")).toBeUndefined();
  });
});
