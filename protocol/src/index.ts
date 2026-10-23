/**
 * Church Comms control protocol v1.
 *
 * The control channel is a single WebSocket at /ws carrying versioned JSON.
 * LiveKit owns media transport, so no SDP or ICE messages appear here.
 *
 * The server is authoritative for room membership, camera assignments, mute
 * state, and Director presence. Clients render the server's snapshots; they do
 * not invent room state locally.
 */

export const PROTOCOL_VERSION = 1;

export const ROOM_CAPACITY = 11;
export const MAX_OPERATORS = 10;
export const MIN_CAMERA_NUMBER = 1;
export const MAX_CAMERA_NUMBER = 10;
export const MAX_ROOM_NAME_LENGTH = 24;
export const MAX_DISPLAY_NAME_LENGTH = 32;

export type ClientType = "director" | "operator" | "debug";

export const CLIENT_TYPES: readonly ClientType[] = ["director", "operator", "debug"];

export type ParticipantRole = "director" | "operator";

export type ConnectionState = "connected" | "reconnecting";

export type RoomStatus = "open" | "grace";

export const GRACE_PERIOD_MS = 5 * 60 * 1000;

export interface Participant {
  id: string;
  name: string;
  role: ParticipantRole;
  /** Camera numbers are unique per room; the Director has no camera number. */
  cameraNumber: number | null;
  connectionState: ConnectionState;
  muted: boolean;
  /** ISO-8601 timestamp. */
  joinedAt: string;
}

export interface RoomSummary {
  name: string;
  status: RoomStatus;
  directorPresent: boolean;
  operatorCount: number;
  capacity: number;
  /** ISO-8601 deadline, only present while the room is in its grace period. */
  graceDeadline?: string;
}

export interface RoomSnapshot {
  name: string;
  status: RoomStatus;
  director: Participant | null;
  operators: Participant[];
  capacity: number;
  graceDeadline?: string;
}

export interface LiveKitCredentials {
  url: string;
  room: string;
  token: string;
  /** ISO-8601 expiry of the token. */
  expiresAt: string;
}

export interface HelloMessage {
  type: "hello";
  /** Protocol version the client speaks. A mismatch is refused. */
  protocol: number;
  clientType: ClientType;
  appVersion: string;
  /** Name shown in the debug roster. */
  name: string;
  /** Per-join session token, used to resume without duplicates. */
  sessionToken?: string;
}

export interface ServerInfoMessage {
  type: "server_info";
  protocol: number;
  serverId: string;
  livekitUrl: string;
  /** ISO-8601 timestamp from the server clock. */
  serverTime: string;
}

/**
 * A connected control client. This is the debug roster, not a room roster: it
 * exists before rooms so discovery and the control channel can be proven.
 */
export interface RosterClient {
  id: string;
  name: string;
  clientType: ClientType;
  appVersion: string;
  /** ISO-8601 timestamp. */
  connectedAt: string;
}

export interface DebugRosterMessage {
  type: "debug_roster";
  clients: RosterClient[];
}

export interface RoomListMessage {
  type: "room_list";
  rooms: RoomSummary[];
}

export interface JoinedMessage {
  type: "joined";
  participantId: string;
  /** Store this and send it in `hello` to resume after a network drop. */
  sessionToken: string;
  room: RoomSnapshot;
  livekit: LiveKitCredentials;
}

export interface ParticipantJoinedMessage {
  type: "participant_joined";
  participant: Participant;
  room: RoomSnapshot;
}

export interface ParticipantLeftMessage {
  type: "participant_left";
  participantId: string;
  room: RoomSnapshot;
}

export interface ParticipantUpdatedMessage {
  type: "participant_updated";
  participant: Participant;
  room: RoomSnapshot;
}

export interface DirectorStateMessage {
  type: "director_state";
  room: RoomSnapshot;
  present: boolean;
  /** ISO-8601 deadline, only present while the room is in its grace period. */
  graceDeadline?: string;
}

export interface MuteStateMessage {
  type: "mute_state";
  room: string;
  participantId: string;
  muted: boolean;
  /** Participant id of the Director who changed the state, or null when the Operator cleared it. */
  by: string | null;
}

export type RoomClosedReason =
  | "ended_by_director"
  | "director_timeout"
  | "server_shutdown";

export interface RoomClosedMessage {
  type: "room_closed";
  room: string;
  reason: RoomClosedReason;
}

export type ServerHealthStatus = "running" | "room_active" | "degraded";

export interface ServerHealthMessage {
  type: "server_health";
  status: ServerHealthStatus;
  rooms: number;
  operators: number;
  clients: number;
  uptimeSeconds: number;
  livekitUrl: string;
}

export interface CreateRoomMessage {
  type: "create_room";
  name: string;
}

export interface EndRoomMessage {
  type: "end_room";
}

export interface JoinRoomMessage {
  type: "join_room";
  room: string;
  name: string;
  cameraNumber: number;
  sessionToken?: string;
}

export interface LeaveRoomMessage {
  type: "leave_room";
}

export interface SetCameraMessage {
  type: "set_camera";
  cameraNumber: number;
}

export interface SetMuteMessage {
  type: "set_mute";
  participantId: string;
  muted: boolean;
}

export interface ClearMuteMessage {
  type: "clear_mute";
}

export type ErrorCode =
  | "PROTOCOL_MISMATCH"
  | "INVALID_MESSAGE"
  | "ALREADY_GREETED"
  | "DIRECTOR_REQUIRED"
  | "ROOM_EXISTS"
  | "ROOM_NOT_FOUND"
  | "ROOM_CLOSED"
  | "ROOM_FULL"
  | "INVALID_ROOM_NAME"
  | "INVALID_CAMERA"
  | "CAMERA_TAKEN"
  | "NOT_IN_ROOM"
  | "NOT_OPERATOR"
  | "SESSION_EXPIRED";

export interface ErrorMessage {
  type: "error";
  code: ErrorCode;
  /** Human-readable, safe to show directly in the client. */
  message: string;
}

export interface PingMessage {
  type: "ping";
}

export interface PongMessage {
  type: "pong";
}

export type ClientMessage =
  | HelloMessage
  | CreateRoomMessage
  | EndRoomMessage
  | JoinRoomMessage
  | LeaveRoomMessage
  | SetCameraMessage
  | SetMuteMessage
  | ClearMuteMessage
  | PingMessage;

export type ServerMessage =
  | ServerInfoMessage
  | DebugRosterMessage
  | RoomListMessage
  | JoinedMessage
  | ParticipantJoinedMessage
  | ParticipantLeftMessage
  | ParticipantUpdatedMessage
  | DirectorStateMessage
  | MuteStateMessage
  | RoomClosedMessage
  | ServerHealthMessage
  | ErrorMessage
  | PongMessage;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function isClientType(value: unknown): value is ClientType {
  return typeof value === "string" && (CLIENT_TYPES as readonly string[]).includes(value);
}

export function isCameraNumber(value: unknown): value is number {
  return (
    isInteger(value) &&
    value >= MIN_CAMERA_NUMBER &&
    value <= MAX_CAMERA_NUMBER
  );
}

/** Room names are trimmed, non-empty, and limited to 24 characters. */
export function normalizeRoomName(value: string): string {
  return value.trim();
}

export function validateRoomName(value: unknown): value is string {
  return (
    nonEmptyString(value) &&
    normalizeRoomName(value).length <= MAX_ROOM_NAME_LENGTH
  );
}

export function validateDisplayName(value: unknown): value is string {
  return (
    nonEmptyString(value) &&
    value.trim().length <= MAX_DISPLAY_NAME_LENGTH
  );
}

function parseHello(value: Record<string, unknown>): ParseResult<HelloMessage> {
  if (!isInteger(value.protocol)) {
    return { ok: false, error: "hello.protocol must be an integer." };
  }
  if (!isClientType(value.clientType)) {
    return { ok: false, error: "hello.clientType must be director, operator, or debug." };
  }
  if (!nonEmptyString(value.appVersion)) {
    return { ok: false, error: "hello.appVersion must be a non-empty string." };
  }
  if (!nonEmptyString(value.name)) {
    return { ok: false, error: "hello.name must be a non-empty string." };
  }
  if (value.sessionToken !== undefined && typeof value.sessionToken !== "string") {
    return { ok: false, error: "hello.sessionToken must be a string when present." };
  }

  const hello: HelloMessage = {
    type: "hello",
    protocol: value.protocol,
    clientType: value.clientType,
    appVersion: value.appVersion,
    name: value.name,
  };
  if (typeof value.sessionToken === "string") {
    hello.sessionToken = value.sessionToken;
  }
  return { ok: true, value: hello };
}

function parseJoinRoom(value: Record<string, unknown>): ParseResult<JoinRoomMessage> {
  if (!validateRoomName(value.room)) {
    return { ok: false, error: "join_room.room must be a room name." };
  }
  if (!validateDisplayName(value.name)) {
    return {
      ok: false,
      error: `join_room.name must be 1-${MAX_DISPLAY_NAME_LENGTH} characters.`,
    };
  }
  if (!isCameraNumber(value.cameraNumber)) {
    return {
      ok: false,
      error: `join_room.cameraNumber must be an integer from ${MIN_CAMERA_NUMBER} to ${MAX_CAMERA_NUMBER}.`,
    };
  }
  if (value.sessionToken !== undefined && typeof value.sessionToken !== "string") {
    return { ok: false, error: "join_room.sessionToken must be a string when present." };
  }

  const message: JoinRoomMessage = {
    type: "join_room",
    room: normalizeRoomName(value.room),
    name: value.name.trim(),
    cameraNumber: value.cameraNumber,
  };
  if (typeof value.sessionToken === "string") {
    message.sessionToken = value.sessionToken;
  }
  return { ok: true, value: message };
}

/**
 * Parse and validate a raw client message. Unknown message types are rejected
 * here so the caller can log them; the server ignores them per the design.
 */
export function parseClientMessage(raw: string): ParseResult<ClientMessage> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { ok: false, error: "Message is not valid JSON." };
  }

  if (!isRecord(value)) {
    return { ok: false, error: "Message must be a JSON object." };
  }

  switch (value.type) {
    case "ping":
      return { ok: true, value: { type: "ping" } };

    case "hello":
      return parseHello(value);

    case "create_room":
      if (!validateRoomName(value.name)) {
        return {
          ok: false,
          error: `create_room.name must be 1-${MAX_ROOM_NAME_LENGTH} characters.`,
        };
      }
      return {
        ok: true,
        value: { type: "create_room", name: normalizeRoomName(value.name) },
      };

    case "end_room":
      return { ok: true, value: { type: "end_room" } };

    case "join_room":
      return parseJoinRoom(value);

    case "leave_room":
      return { ok: true, value: { type: "leave_room" } };

    case "set_camera":
      if (!isCameraNumber(value.cameraNumber)) {
        return {
          ok: false,
          error: `set_camera.cameraNumber must be an integer from ${MIN_CAMERA_NUMBER} to ${MAX_CAMERA_NUMBER}.`,
        };
      }
      return {
        ok: true,
        value: { type: "set_camera", cameraNumber: value.cameraNumber },
      };

    case "set_mute":
      if (!nonEmptyString(value.participantId)) {
        return { ok: false, error: "set_mute.participantId must be a non-empty string." };
      }
      if (typeof value.muted !== "boolean") {
        return { ok: false, error: "set_mute.muted must be a boolean." };
      }
      return {
        ok: true,
        value: {
          type: "set_mute",
          participantId: value.participantId,
          muted: value.muted,
        },
      };

    case "clear_mute":
      return { ok: true, value: { type: "clear_mute" } };

    default:
      return { ok: false, error: `Unknown message type: ${String(value.type)}` };
  }
}

export function protocolMismatchMessage(
  serverVersion: number,
  clientVersion: number,
): string {
  return `Protocol mismatch: this server speaks v${serverVersion}, the client speaks v${clientVersion}. Update the app or the server so both use v${serverVersion}.`;
}

export function protocolMismatchError(
  serverVersion: number,
  clientVersion: number,
): ErrorMessage {
  return {
    type: "error",
    code: "PROTOCOL_MISMATCH",
    message: protocolMismatchMessage(serverVersion, clientVersion),
  };
}

/** Turn a server response reason into the text Operators see. */
export function roomClosedMessage(reason: RoomClosedReason): string {
  switch (reason) {
    case "ended_by_director":
      return "Room closed by director";
    case "director_timeout":
      return "Room closed because the director did not return";
    case "server_shutdown":
      return "Server stopped";
  }
}
