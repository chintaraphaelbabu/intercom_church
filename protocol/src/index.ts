/**
 * Church Comms control protocol v1.
 *
 * The control channel is a single WebSocket at /ws carrying versioned JSON.
 * LiveKit owns media transport, so no SDP or ICE messages appear here.
 */

export const PROTOCOL_VERSION = 1;

export type ClientType = "director" | "operator" | "debug";

export const CLIENT_TYPES: readonly ClientType[] = ["director", "operator", "debug"];

export interface HelloMessage {
  type: "hello";
  /** Protocol version the client speaks. A mismatch is refused. */
  protocol: number;
  clientType: ClientType;
  appVersion: string;
  /** Name shown in the debug roster. */
  name: string;
  /** Per-join session token, used from M3 onward to resume without duplicates. */
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
 * A connected control client. This is the M0 debug roster, not a room roster:
 * it exists before rooms so discovery and the control channel can be proven.
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

export type ErrorCode =
  | "PROTOCOL_MISMATCH"
  | "INVALID_MESSAGE"
  | "ALREADY_GREETED";

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

export type ClientMessage = HelloMessage | PingMessage;

export type ServerMessage =
  | ServerInfoMessage
  | DebugRosterMessage
  | ErrorMessage
  | PongMessage;

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isClientType(value: unknown): value is ClientType {
  return typeof value === "string" && (CLIENT_TYPES as readonly string[]).includes(value);
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

  if (value.type === "ping") {
    return { ok: true, value: { type: "ping" } };
  }

  if (value.type !== "hello") {
    return { ok: false, error: `Unknown message type: ${String(value.type)}` };
  }

  if (typeof value.protocol !== "number" || !Number.isInteger(value.protocol)) {
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
