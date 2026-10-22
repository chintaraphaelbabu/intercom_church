import crypto from "node:crypto";
import {
  GRACE_PERIOD_MS,
  MAX_CAMERA_NUMBER,
  MAX_OPERATORS,
  MIN_CAMERA_NUMBER,
  ROOM_CAPACITY,
  normalizeRoomName,
  validateDisplayName,
  validateRoomName,
  type ErrorCode,
  type Participant,
  type ParticipantRole,
  type RoomClosedReason,
  type RoomSnapshot,
  type RoomStatus,
  type RoomSummary,
} from "@church-comms/protocol";

/** How long a dropped Operator keeps their roster entry and camera number. */
export const OPERATOR_RECONNECT_GRACE_MS = 90_000;

export interface RoomRegistryOptions {
  /** Injectable clock; every timestamp and deadline is derived from it. */
  now?: () => Date;
  gracePeriodMs?: number;
  reconnectGraceMs?: number;
  idFactory?: () => string;
  tokenFactory?: () => string;
}

export interface RoomError {
  ok: false;
  code: ErrorCode;
  message: string;
}

export interface CreatedRoom {
  room: RoomSnapshot;
  participant: Participant;
  sessionToken: string;
}

export interface JoinedRoom {
  room: RoomSnapshot;
  participant: Participant;
  sessionToken: string;
  resumed: boolean;
}

export interface ResumedSession {
  room: RoomSnapshot;
  participant: Participant;
  sessionToken: string;
  role: ParticipantRole;
}

/** The common shape handed to the socket layer when sending `joined`. */
export interface JoinOutcomeLike {
  room: RoomSnapshot;
  participant: Participant;
  sessionToken: string;
}

export type LeaveOutcome =
  | {
      kind: "left";
      participant: Participant;
      room: RoomSnapshot;
    }
  | {
      kind: "room_closed";
      participant: Participant;
      roomName: string;
      room: RoomSnapshot;
      reason: RoomClosedReason;
      participants: Participant[];
    };

export interface CameraChange {
  participant: Participant;
  room: RoomSnapshot;
}

export interface MuteChange {
  participant: Participant;
  room: RoomSnapshot;
  /** Director id for a Director change, null when the Operator cleared it. */
  by: string | null;
}

export interface ClosedRoom {
  roomName: string;
  room: RoomSnapshot;
  reason: RoomClosedReason;
  participants: Participant[];
}

export interface DisconnectedParticipant {
  participant: Participant;
  room: RoomSnapshot;
  directorState?: {
    present: boolean;
    graceDeadline?: string;
  };
}

export interface RemovedParticipant {
  room: string;
  participant: Participant;
  roomSnapshot: RoomSnapshot;
}

export interface RoomTickResult {
  roomClosures: ClosedRoom[];
  participantRemovals: RemovedParticipant[];
}

interface RoomRecord {
  name: string;
  key: string;
  status: RoomStatus;
  directorId: string;
  operatorIds: Set<string>;
  graceDeadline: number | null;
}

interface ParticipantRecord {
  participant: Participant;
  sessionToken: string;
  roomKey: string;
  reconnectDeadline: number | null;
  mutedBy: string | null;
}

function failure(code: ErrorCode, message: string): RoomError {
  return { ok: false, code, message };
}

function cloneParticipant(participant: Participant): Participant {
  return { ...participant };
}

function roomKey(name: string): string {
  return normalizeRoomName(name).toLowerCase();
}

/**
 * In-memory authority for rooms, camera slots, session tokens, mute state and
 * Director presence. All methods return typed results instead of throwing so
 * the socket layer can translate them into protocol error codes.
 */
export class RoomRegistry {
  private readonly now: () => Date;
  private readonly gracePeriodMs: number;
  private readonly reconnectGraceMs: number;
  private readonly idFactory: () => string;
  private readonly tokenFactory: () => string;

  private readonly rooms = new Map<string, RoomRecord>();
  private readonly participants = new Map<string, ParticipantRecord>();
  private readonly sessions = new Map<string, string>();

  constructor(options: RoomRegistryOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.gracePeriodMs = options.gracePeriodMs ?? GRACE_PERIOD_MS;
    this.reconnectGraceMs =
      options.reconnectGraceMs ?? OPERATOR_RECONNECT_GRACE_MS;
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.tokenFactory = options.tokenFactory ?? (() => crypto.randomUUID());
  }

  createRoom(input: { name: string; directorName: string }): ({ ok: true } & CreatedRoom) | RoomError {
    if (!validateRoomName(input.name)) {
      return failure(
        "INVALID_ROOM_NAME",
        "Room names are 1-24 characters after trimming.",
      );
    }
    if (!validateDisplayName(input.directorName)) {
      return failure("INVALID_MESSAGE", "The director name must be 1-32 characters.");
    }

    const name = normalizeRoomName(input.name);
    const key = roomKey(name);
    if (this.rooms.has(key)) {
      return failure("ROOM_EXISTS", `Room "${name}" already exists.`);
    }

    const createdAt = this.now();
    const participant: Participant = {
      id: this.idFactory(),
      name: input.directorName.trim(),
      role: "director",
      cameraNumber: null,
      connectionState: "connected",
      muted: false,
      joinedAt: createdAt.toISOString(),
    };
    const sessionToken = this.tokenFactory();
    const room: RoomRecord = {
      name,
      key,
      status: "open",
      directorId: participant.id,
      operatorIds: new Set(),
      graceDeadline: null,
    };

    this.rooms.set(key, room);
    const record: ParticipantRecord = {
      participant,
      sessionToken,
      roomKey: key,
      reconnectDeadline: null,
      mutedBy: null,
    };
    this.participants.set(participant.id, record);
    this.sessions.set(sessionToken, participant.id);

    return {
      ok: true,
      room: this.toSnapshot(room),
      participant: cloneParticipant(participant),
      sessionToken,
    };
  }

  joinRoom(input: {
    room: string;
    name: string;
    cameraNumber: number;
    sessionToken?: string;
  }): ({ ok: true } & JoinedRoom) | RoomError {
    if (input.sessionToken !== undefined) {
      const existing = this.findParticipantBySession(input.sessionToken);
      if (existing?.participant.role === "director") {
        return failure(
          "SESSION_EXPIRED",
          "That session is not an Operator session. Join again.",
        );
      }
      const resumed = this.resumeSession(input.sessionToken);
      if (!resumed.ok) {
        return resumed;
      }
      if (roomKey(input.room) !== roomKey(resumed.room.name)) {
        return failure(
          "SESSION_EXPIRED",
          "That session belongs to a different room. Join again.",
        );
      }
      return {
        ok: true,
        room: resumed.room,
        participant: resumed.participant,
        sessionToken: resumed.sessionToken,
        resumed: true,
      };
    }

    if (!validateRoomName(input.room)) {
      return failure("INVALID_ROOM_NAME", "That is not a valid room name.");
    }
    const room = this.rooms.get(roomKey(input.room));
    if (room === undefined) {
      return failure("ROOM_NOT_FOUND", `Room "${normalizeRoomName(input.room)}" was not found.`);
    }
    if (room.status === "grace") {
      const deadline = room.graceDeadline;
      if (deadline !== null && deadline <= this.now().getTime()) {
        this.rooms.delete(room.key);
        return failure("ROOM_NOT_FOUND", `Room "${room.name}" was not found.`);
      }
      return failure(
        "ROOM_CLOSED",
        `Room "${room.name}" is closed while the director is offline.`,
      );
    }
    if (!validateDisplayName(input.name)) {
      return failure("INVALID_MESSAGE", "The display name must be 1-32 characters.");
    }
    if (
      !Number.isInteger(input.cameraNumber) ||
      input.cameraNumber < MIN_CAMERA_NUMBER ||
      input.cameraNumber > MAX_CAMERA_NUMBER
    ) {
      return failure("INVALID_CAMERA", "Camera numbers are 1-10.");
    }
    if (room.operatorIds.size >= MAX_OPERATORS) {
      return failure(
        "ROOM_FULL",
        `Room is full: "${room.name}" already has one director and ten operators.`,
      );
    }
    if (this.cameraTaken(room, input.cameraNumber)) {
      return failure(
        "CAMERA_TAKEN",
        `Camera ${input.cameraNumber} is already taken in room "${room.name}".`,
      );
    }

    const participant: Participant = {
      id: this.idFactory(),
      name: input.name.trim(),
      role: "operator",
      cameraNumber: input.cameraNumber,
      connectionState: "connected",
      muted: false,
      joinedAt: this.now().toISOString(),
    };
    const sessionToken = this.tokenFactory();
    const record: ParticipantRecord = {
      participant,
      sessionToken,
      roomKey: room.key,
      reconnectDeadline: null,
      mutedBy: null,
    };
    room.operatorIds.add(participant.id);
    this.participants.set(participant.id, record);
    this.sessions.set(sessionToken, participant.id);

    return {
      ok: true,
      room: this.toSnapshot(room),
      participant: cloneParticipant(participant),
      sessionToken,
      resumed: false,
    };
  }

  resumeSession(sessionToken: string): ({ ok: true } & ResumedSession) | RoomError {
    const participantId = this.sessions.get(sessionToken);
    const record = participantId === undefined ? undefined : this.participants.get(participantId);
    if (record === undefined) {
      return failure("SESSION_EXPIRED", "Your session has expired. Join the room again.");
    }

    const room = this.rooms.get(record.roomKey);
    if (room === undefined) {
      this.removeParticipantRecord(record);
      return failure("SESSION_EXPIRED", "Your session has expired. Join the room again.");
    }

    if (
      record.participant.role === "operator" &&
      record.reconnectDeadline !== null &&
      record.reconnectDeadline <= this.now().getTime()
    ) {
      this.removeParticipantRecord(record);
      return failure("SESSION_EXPIRED", "Your session has expired. Join the room again.");
    }

    if (
      room.status === "grace" &&
      room.graceDeadline !== null &&
      room.graceDeadline <= this.now().getTime()
    ) {
      return failure("SESSION_EXPIRED", "Your session has expired. Join the room again.");
    }

    if (room.status === "grace" && record.participant.role === "director") {
      room.status = "open";
      room.graceDeadline = null;
    }

    record.participant.connectionState = "connected";
    record.reconnectDeadline = null;
    if (record.participant.role === "operator") {
      record.participant.muted = false;
      record.mutedBy = null;
    }

    return {
      ok: true,
      room: this.toSnapshot(room),
      participant: cloneParticipant(record.participant),
      sessionToken: record.sessionToken,
      role: record.participant.role,
    };
  }

  leave(participantId: string): ({ ok: true } & LeaveOutcome) | RoomError {
    const record = this.participants.get(participantId);
    if (record === undefined) {
      return failure("NOT_IN_ROOM", "You are not in a room.");
    }

    if (record.participant.role === "director") {
      const closed = this.endRoom(participantId);
      if (!closed.ok) {
        return closed;
      }
      return {
        ok: true,
        kind: "room_closed",
        participant: cloneParticipant(record.participant),
        roomName: closed.roomName,
        room: closed.room,
        reason: closed.reason,
        participants: closed.participants,
      };
    }

    const room = this.rooms.get(record.roomKey);
    this.removeParticipantRecord(record);
    if (room === undefined) {
      return failure("NOT_IN_ROOM", "You are not in a room.");
    }
    return {
      ok: true,
      kind: "left",
      participant: cloneParticipant(record.participant),
      room: this.toSnapshot(room),
    };
  }

  setCamera(
    participantId: string,
    cameraNumber: number,
  ): ({ ok: true } & CameraChange) | RoomError {
    const record = this.participants.get(participantId);
    if (record === undefined) {
      return failure("NOT_IN_ROOM", "You are not in a room.");
    }
    if (record.participant.role !== "operator") {
      return failure("NOT_OPERATOR", "The director has no camera number.");
    }
    if (
      !Number.isInteger(cameraNumber) ||
      cameraNumber < MIN_CAMERA_NUMBER ||
      cameraNumber > MAX_CAMERA_NUMBER
    ) {
      return failure("INVALID_CAMERA", "Camera numbers are 1-10.");
    }

    const room = this.rooms.get(record.roomKey);
    if (room === undefined) {
      return failure("NOT_IN_ROOM", "You are not in a room.");
    }
    if (this.cameraTaken(room, cameraNumber, participantId)) {
      return failure(
        "CAMERA_TAKEN",
        `Camera ${cameraNumber} is already taken in room "${room.name}".`,
      );
    }

    record.participant.cameraNumber = cameraNumber;
    return {
      ok: true,
      participant: cloneParticipant(record.participant),
      room: this.toSnapshot(room),
    };
  }

  setMute(
    actorId: string,
    participantId: string,
    muted: boolean,
  ): ({ ok: true } & MuteChange) | RoomError {
    const actor = this.participants.get(actorId);
    if (actor === undefined) {
      return failure("NOT_IN_ROOM", "You are not in a room.");
    }
    if (actor.participant.role !== "director") {
      return failure("DIRECTOR_REQUIRED", "Only the director can mute an operator.");
    }

    const target = this.participants.get(participantId);
    if (target === undefined || target.roomKey !== actor.roomKey) {
      return failure("NOT_IN_ROOM", "That participant is not in this room.");
    }
    if (target.participant.role !== "operator") {
      return failure("NOT_OPERATOR", "The director cannot be muted.");
    }

    target.participant.muted = muted;
    target.mutedBy = actorId;
    const room = this.rooms.get(actor.roomKey);
    if (room === undefined) {
      return failure("ROOM_NOT_FOUND", "That room no longer exists.");
    }
    return {
      ok: true,
      participant: cloneParticipant(target.participant),
      room: this.toSnapshot(room),
      by: actorId,
    };
  }

  clearMute(participantId: string): ({ ok: true } & MuteChange) | RoomError {
    const record = this.participants.get(participantId);
    if (record === undefined) {
      return failure("NOT_IN_ROOM", "You are not in a room.");
    }
    if (record.participant.role !== "operator") {
      return failure("NOT_OPERATOR", "Only operators can clear their own mute.");
    }

    const room = this.rooms.get(record.roomKey);
    record.participant.muted = false;
    record.mutedBy = null;
    if (room === undefined) {
      return failure("ROOM_NOT_FOUND", "That room no longer exists.");
    }
    return {
      ok: true,
      participant: cloneParticipant(record.participant),
      room: this.toSnapshot(room),
      by: null,
    };
  }

  endRoom(actorId: string): ({ ok: true } & ClosedRoom) | RoomError {
    const actor = this.participants.get(actorId);
    if (actor === undefined) {
      return failure("NOT_IN_ROOM", "You are not in a room.");
    }
    if (actor.participant.role !== "director") {
      return failure("DIRECTOR_REQUIRED", "Only the director can end the room.");
    }
    const room = this.rooms.get(actor.roomKey);
    if (room === undefined) {
      return failure("ROOM_NOT_FOUND", "That room no longer exists.");
    }
    return { ok: true, ...this.closeRoom(room, "ended_by_director") };
  }

  disconnect(
    participantId: string,
  ): ({ ok: true } & DisconnectedParticipant) | RoomError {
    const record = this.participants.get(participantId);
    if (record === undefined) {
      return failure("NOT_IN_ROOM", "That participant is not in a room.");
    }
    const room = this.rooms.get(record.roomKey);
    if (room === undefined) {
      this.removeParticipantRecord(record);
      return failure("NOT_IN_ROOM", "That participant is not in a room.");
    }

    record.participant.connectionState = "reconnecting";
    record.reconnectDeadline =
      record.participant.role === "operator"
        ? (record.reconnectDeadline ?? this.now().getTime() + this.reconnectGraceMs)
        : null;

    if (record.participant.role === "operator") {
      return {
        ok: true,
        participant: cloneParticipant(record.participant),
        room: this.toSnapshot(room),
      };
    }

    if (room.status !== "grace" || room.graceDeadline === null) {
      room.status = "grace";
      room.graceDeadline = this.now().getTime() + this.gracePeriodMs;
    }
    const graceDeadline = new Date(room.graceDeadline).toISOString();
    return {
      ok: true,
      participant: cloneParticipant(record.participant),
      room: this.toSnapshot(room),
      directorState: { present: false, graceDeadline },
    };
  }

  tick(at: Date = this.now()): RoomTickResult {
    const now = at.getTime();
    const roomClosures: ClosedRoom[] = [];
    for (const room of [...this.rooms.values()]) {
      if (
        room.status === "grace" &&
        room.graceDeadline !== null &&
        room.graceDeadline <= now
      ) {
        roomClosures.push(this.closeRoom(room, "director_timeout"));
      }
    }

    const participantRemovals: RemovedParticipant[] = [];
    for (const record of [...this.participants.values()]) {
      if (record.participant.role !== "operator") {
        continue;
      }
      if (record.participant.connectionState !== "reconnecting") {
        continue;
      }
      if (record.reconnectDeadline === null || record.reconnectDeadline > now) {
        continue;
      }
      const room = this.rooms.get(record.roomKey);
      const participant = cloneParticipant(record.participant);
      this.removeParticipantRecord(record);
      if (room !== undefined) {
        participantRemovals.push({
          room: room.name,
          participant,
          roomSnapshot: this.toSnapshot(room),
        });
      }
    }

    return { roomClosures, participantRemovals };
  }

  snapshot(roomName: string): RoomSnapshot | undefined {
    const room = this.rooms.get(roomKey(roomName));
    return room === undefined ? undefined : this.toSnapshot(room);
  }

  listRooms(options: { includeGrace?: boolean } = {}): RoomSummary[] {
    const includeGrace = options.includeGrace ?? false;
    return [...this.rooms.values()]
      .filter((room) => includeGrace || room.status === "open")
      .map((room) => this.toSummary(room))
      .sort((left, right) =>
        left.name.localeCompare(right.name, "en", { sensitivity: "base" }),
      );
  }

  listJoinableRooms(): RoomSummary[] {
    return this.listRooms();
  }

  listAllRooms(): RoomSummary[] {
    return this.listRooms({ includeGrace: true });
  }

  takenCameras(roomName: string): number[] {
    const room = this.rooms.get(roomKey(roomName));
    if (room === undefined) {
      return [];
    }
    return [...room.operatorIds]
      .map((id) => this.participants.get(id)?.participant.cameraNumber)
      .filter((camera): camera is number => camera !== null && camera !== undefined)
      .sort((left, right) => left - right);
  }

  findParticipant(
    participantId: string,
  ): { participant: Participant; room: string } | undefined {
    const record = this.participants.get(participantId);
    const room = record === undefined ? undefined : this.rooms.get(record.roomKey);
    if (record === undefined || room === undefined) {
      return undefined;
    }
    return { participant: cloneParticipant(record.participant), room: room.name };
  }

  findParticipantBySession(
    sessionToken: string,
  ): { participant: Participant; room: string } | undefined {
    const participantId = this.sessions.get(sessionToken);
    return participantId === undefined ? undefined : this.findParticipant(participantId);
  }

  /** Used by the LiveKit token endpoint to scope tokens to a real participant. */
  resolveMediaIdentity(
    identity: string,
  ): { room: string; role: ParticipantRole; name: string } | undefined {
    const found = this.findParticipant(identity);
    if (found === undefined) {
      return undefined;
    }
    return {
      room: found.room,
      role: found.participant.role,
      name: found.participant.name,
    };
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get operatorCount(): number {
    let total = 0;
    for (const room of this.rooms.values()) {
      total += room.operatorIds.size;
    }
    return total;
  }

  get participantCount(): number {
    return this.participants.size;
  }

  private cameraTaken(
    room: RoomRecord,
    cameraNumber: number,
    ignoreParticipantId?: string,
  ): boolean {
    for (const id of room.operatorIds) {
      if (id === ignoreParticipantId) {
        continue;
      }
      if (this.participants.get(id)?.participant.cameraNumber === cameraNumber) {
        return true;
      }
    }
    return false;
  }

  private toSnapshot(room: RoomRecord): RoomSnapshot {
    const directorRecord = this.participants.get(room.directorId);
    const director =
      room.status === "open" && directorRecord !== undefined
        ? cloneParticipant(directorRecord.participant)
        : null;
    const operators = [...room.operatorIds]
      .map((id) => this.participants.get(id))
      .filter((record): record is ParticipantRecord => record !== undefined)
      .sort(
        (left, right) =>
          (left.participant.cameraNumber ?? MAX_CAMERA_NUMBER + 1) -
            (right.participant.cameraNumber ?? MAX_CAMERA_NUMBER + 1) ||
          left.participant.joinedAt.localeCompare(right.participant.joinedAt),
      )
      .map((record) => cloneParticipant(record.participant));

    const snapshot: RoomSnapshot = {
      name: room.name,
      status: room.status,
      director,
      operators,
      capacity: ROOM_CAPACITY,
    };
    if (room.status === "grace" && room.graceDeadline !== null) {
      snapshot.graceDeadline = new Date(room.graceDeadline).toISOString();
    }
    return snapshot;
  }

  private toSummary(room: RoomRecord): RoomSummary {
    const summary: RoomSummary = {
      name: room.name,
      status: room.status,
      directorPresent: room.status === "open",
      operatorCount: room.operatorIds.size,
      capacity: ROOM_CAPACITY,
    };
    if (room.status === "grace" && room.graceDeadline !== null) {
      summary.graceDeadline = new Date(room.graceDeadline).toISOString();
    }
    return summary;
  }

  private closeRoom(room: RoomRecord, reason: RoomClosedReason): ClosedRoom {
    const snapshot = this.toSnapshot(room);
    const participants: Participant[] = [];
    const director = this.participants.get(room.directorId);
    if (director !== undefined) {
      participants.push(cloneParticipant(director.participant));
    }
    for (const id of room.operatorIds) {
      const record = this.participants.get(id);
      if (record !== undefined) {
        participants.push(cloneParticipant(record.participant));
      }
    }

    this.rooms.delete(room.key);
    if (director !== undefined) {
      this.removeParticipantRecord(director);
    }
    for (const id of [...room.operatorIds]) {
      const record = this.participants.get(id);
      if (record !== undefined) {
        this.removeParticipantRecord(record);
      }
    }

    return { roomName: room.name, room: snapshot, reason, participants };
  }

  private removeParticipantRecord(record: ParticipantRecord): void {
    this.participants.delete(record.participant.id);
    this.sessions.delete(record.sessionToken);
    const room = this.rooms.get(record.roomKey);
    if (room !== undefined) {
      if (room.directorId === record.participant.id) {
        // The Director is only removed with the room itself.
      } else {
        room.operatorIds.delete(record.participant.id);
      }
    }
  }
}
