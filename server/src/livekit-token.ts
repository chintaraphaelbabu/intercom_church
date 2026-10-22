import type http from "node:http";
import { AccessToken } from "livekit-server-sdk";
import {
  normalizeRoomName,
  validateRoomName,
  type LiveKitCredentials,
  type ParticipantRole,
} from "@church-comms/protocol";
import type { ResolvedConfig } from "./config.js";

const TOKEN_PATH = "/api/livekit-token";
const MAX_BODY_BYTES = 16 * 1024;

export const LIVEKIT_TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

export type MediaRole = ParticipantRole;

export interface LiveKitTokenResponse {
  url: string;
  room: string;
  token: string;
  expiresAt: string;
}

export interface TokenHandlerConfig {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitRoom: string;
}

export interface TokenIdentity {
  room: string;
  role: MediaRole;
}

export interface LiveKitTokenHandlerOptions {
  /**
   * Registry lookup. When present, every requested identity must resolve to a
   * participant and the token is scoped to that participant's room and role.
   * The resolver is required in production; leaving it out keeps the handler
   * usable in isolation (for example a unit test) with an explicit room.
   */
  resolveIdentity?: (identity: string) => TokenIdentity | undefined;
  now?: () => Date;
}

interface TokenRequest {
  identity: string;
  name: string;
  role: MediaRole;
  room?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function parseTokenRequest(value: unknown): TokenRequest | string {
  if (!isRecord(value)) {
    return "Request body must be a JSON object.";
  }
  if (!nonEmptyString(value.identity)) {
    return "identity must be a non-empty string.";
  }
  if (!nonEmptyString(value.name)) {
    return "name must be a non-empty string.";
  }
  if (value.role !== "director" && value.role !== "operator") {
    return 'role must be "director" or "operator".';
  }
  if (value.room !== undefined && !validateRoomName(value.room)) {
    return "room must be 1-24 characters when present.";
  }

  const request: TokenRequest = {
    identity: value.identity.trim(),
    name: value.name.trim(),
    role: value.role,
  };
  if (typeof value.room === "string") {
    request.room = normalizeRoomName(value.room);
  }
  return request;
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) {
      throw new Error("Request body is too large.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(body));
}

/** Mint the LiveKit credentials handed to a participant in `joined`. */
export async function mintLiveKitCredentials(
  config: Pick<ResolvedConfig, "livekitUrl" | "livekitApiKey" | "livekitApiSecret">,
  input: {
    identity: string;
    name: string;
    role: MediaRole;
    room: string;
    now?: Date;
  },
): Promise<LiveKitCredentials> {
  const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
    identity: input.identity,
    name: input.name,
    ttl: "2h",
  });
  token.addGrant({
    room: input.room,
    roomJoin: true,
    roomCreate: true,
    canPublish: input.role === "director",
    canSubscribe: true,
    canPublishData: false,
  });

  const now = input.now ?? new Date();
  return {
    url: config.livekitUrl,
    room: input.room,
    token: await token.toJwt(),
    expiresAt: new Date(now.getTime() + LIVEKIT_TOKEN_TTL_MS).toISOString(),
  };
}

/**
 * Mint LiveKit join tokens. The control server owns the API secret; browsers
 * and phones never see it. The token is scoped to the participant's named room.
 */
export function createLiveKitTokenHandler(
  config: Pick<
    ResolvedConfig,
    "livekitUrl" | "livekitApiKey" | "livekitApiSecret" | "livekitRoom"
  >,
  options: LiveKitTokenHandlerOptions = {},
): (request: http.IncomingMessage, response: http.ServerResponse) => Promise<boolean> {
  const now = options.now ?? (() => new Date());

  return async (request, response) => {
    let pathname = "";
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      return false;
    }
    if (pathname !== TOKEN_PATH) {
      return false;
    }

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Use POST for this endpoint." }, { allow: "POST" });
      return true;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(request));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Invalid JSON body.";
      sendJson(response, 400, { error: message });
      return true;
    }

    const parsed = parseTokenRequest(body);
    if (typeof parsed === "string") {
      sendJson(response, 400, { error: parsed });
      return true;
    }

    let room: string;
    const resolved = options.resolveIdentity?.(parsed.identity);
    if (resolved !== undefined) {
      const requestedRoom =
        parsed.room === undefined ? resolved.room : normalizeRoomName(parsed.room);
      if (requestedRoom.toLowerCase() !== resolved.room.toLowerCase()) {
        sendJson(response, 403, {
          error: `Identity "${parsed.identity}" is not a participant in room "${requestedRoom}".`,
        });
        return true;
      }
      if (resolved.role !== parsed.role) {
        sendJson(response, 403, {
          error: `Identity "${parsed.identity}" is a ${resolved.role}, not a ${parsed.role}.`,
        });
        return true;
      }
      room = resolved.room;
    } else if (options.resolveIdentity !== undefined) {
      sendJson(response, 403, {
        error: `Identity "${parsed.identity}" is not a participant in a live room.`,
      });
      return true;
    } else {
      room = parsed.room ?? normalizeRoomName(config.livekitRoom);
    }

    const credentials = await mintLiveKitCredentials(config, {
      identity: parsed.identity,
      name: parsed.name,
      role: parsed.role,
      room,
      now: now(),
    });
    const responseBody: LiveKitTokenResponse = {
      url: credentials.url,
      room: credentials.room,
      token: credentials.token,
      expiresAt: credentials.expiresAt,
    };
    sendJson(response, 200, responseBody);
    return true;
  };
}
