import type http from "node:http";
import { AccessToken } from "livekit-server-sdk";
import type { ResolvedConfig } from "./config.js";

const TOKEN_PATH = "/api/livekit-token";
const MAX_BODY_BYTES = 16 * 1024;

export type MediaRole = "director" | "operator";

export interface LiveKitTokenResponse {
  url: string;
  room: string;
  token: string;
}

export interface TokenHandlerConfig {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitRoom: string;
}

interface TokenRequest {
  identity: string;
  name: string;
  role: MediaRole;
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
  return {
    identity: value.identity.trim(),
    name: value.name.trim(),
    role: value.role,
  };
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

/**
 * Mint a LiveKit join token for the single M1 room. The control server owns the
 * API secret; browsers and phones never see it.
 */
export function createLiveKitTokenHandler(
  config: Pick<
    ResolvedConfig,
    "livekitUrl" | "livekitApiKey" | "livekitApiSecret" | "livekitRoom"
  >,
): (request: http.IncomingMessage, response: http.ServerResponse) => Promise<boolean> {
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

    const token = new AccessToken(config.livekitApiKey, config.livekitApiSecret, {
      identity: parsed.identity,
      name: parsed.name,
      ttl: "2h",
    });
    token.addGrant({
      room: config.livekitRoom,
      roomJoin: true,
      roomCreate: true,
      canPublish: parsed.role === "director",
      canSubscribe: true,
      canPublishData: false,
    });

    const responseBody: LiveKitTokenResponse = {
      url: config.livekitUrl,
      room: config.livekitRoom,
      token: await token.toJwt(),
    };
    sendJson(response, 200, responseBody);
    return true;
  };
}
