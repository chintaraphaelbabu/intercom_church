import crypto from "node:crypto";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { PROTOCOL_VERSION } from "@church-comms/protocol";
import { primaryLanAddress } from "./lan.js";
import type { Logger } from "./logger.js";

export const DEFAULT_PORT = 8765;
export const DEFAULT_LIVEKIT_PORT = 7880;
export const MDNS_SERVICE_TYPE = "church-comms";

export interface ResolvedConfig {
  host: string;
  port: number;
  serverName: string;
  serverId: string;
  livekitUrl: string;
  webDist: string;
  advertiseMdns: boolean;
  logger: Logger;
  protocolVersion: number;
}

export interface ConfigOverrides {
  host?: string | undefined;
  port?: number | undefined;
  serverName?: string | undefined;
  serverId?: string | undefined;
  livekitUrl?: string | undefined;
  webDist?: string | undefined;
  advertiseMdns?: boolean | undefined;
  logger?: Logger | undefined;
}

function defaultWebDist(): string {
  // src/config.ts (tsx) and dist/config.js (built) both live one level below
  // the server package root, where the built Director app is copied.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web-dist");
}

function defaultLivekitUrl(): string {
  const host = primaryLanAddress() ?? "localhost";
  return `ws://${host}:${DEFAULT_LIVEKIT_PORT}`;
}

export function resolveConfig(overrides: ConfigOverrides = {}): ResolvedConfig {
  const logger = overrides.logger ?? console;
  return {
    host: overrides.host ?? "0.0.0.0",
    port: overrides.port ?? DEFAULT_PORT,
    serverName: overrides.serverName ?? os.hostname(),
    serverId: overrides.serverId ?? crypto.randomUUID(),
    livekitUrl: overrides.livekitUrl ?? defaultLivekitUrl(),
    webDist: overrides.webDist ?? defaultWebDist(),
    advertiseMdns: overrides.advertiseMdns ?? true,
    logger: {
      info: (...args: unknown[]) => logger.info?.(...args),
      warn: (...args: unknown[]) => logger.warn?.(...args),
      error: (...args: unknown[]) => logger.error?.(...args),
    },
    protocolVersion: PROTOCOL_VERSION,
  };
}
