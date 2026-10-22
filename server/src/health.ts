import net from "node:net";
import type http from "node:http";
import type { ServerHealthStatus } from "@church-comms/protocol";

export const HEALTH_PATH = "/api/health";
const DEFAULT_REFRESH_INTERVAL_MS = 5_000;
const DEFAULT_PROBE_TIMEOUT_MS = 300;

export interface HealthCounts {
  rooms: number;
  clients: number;
}

export interface HealthMonitorOptions {
  livekitUrl: string;
  /** Optional override, used by tests; defaults to a TCP reachability probe. */
  probe?: () => Promise<boolean>;
  /** mDNS advertisement state; a failed advertisement degrades the server. */
  mdnsHealthy?: () => boolean;
  now?: () => Date;
  refreshIntervalMs?: number;
}

/** Tracks whether LiveKit is reachable and whether mDNS advertising worked. */
export class HealthMonitor {
  private readonly probe: () => Promise<boolean>;
  private readonly mdnsHealthy: () => boolean;
  private readonly now: () => Date;
  private readonly refreshIntervalMs: number;
  private lastCheckedAt = 0;
  private livekitReachable: boolean | undefined;

  constructor(options: HealthMonitorOptions) {
    this.probe =
      options.probe ??
      (() => probeLiveKit(options.livekitUrl, DEFAULT_PROBE_TIMEOUT_MS));
    this.mdnsHealthy = options.mdnsHealthy ?? (() => true);
    this.now = options.now ?? (() => new Date());
    this.refreshIntervalMs =
      options.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS;
  }

  /** Refresh (at most once per interval) and return the current status. */
  async check(): Promise<ServerHealthStatus> {
    const now = this.now().getTime();
    if (
      this.livekitReachable === undefined ||
      now - this.lastCheckedAt >= this.refreshIntervalMs
    ) {
      this.lastCheckedAt = now;
      try {
        this.livekitReachable = await this.probe();
      } catch {
        this.livekitReachable = false;
      }
    }
    return this.status();
  }

  /** Last known status without touching the network. */
  status(): ServerHealthStatus {
    if (!this.mdnsHealthy()) {
      return "degraded";
    }
    return this.livekitReachable === false ? "degraded" : "running";
  }
}

/** A plain TCP connect is enough to tell whether LiveKit is listening. */
export function probeLiveKit(
  url: string,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  return new Promise((resolve) => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      resolve(false);
      return;
    }
    if (parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
      resolve(false);
      return;
    }

    const port =
      parsed.port !== ""
        ? Number(parsed.port)
        : parsed.protocol === "wss:"
          ? 443
          : 80;
    const socket = net.connect({ host: parsed.hostname, port });
    let settled = false;
    const finish = (reachable: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

export interface HealthHandlerOptions {
  monitor: HealthMonitor;
  snapshot: () => HealthCounts;
  startedAt: () => number;
  livekitUrl: string;
  protocol: number;
  now?: () => Date;
}

function sendJson(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

export function createHealthHandler(
  options: HealthHandlerOptions,
): (request: http.IncomingMessage, response: http.ServerResponse) => Promise<boolean> {
  const now = options.now ?? (() => new Date());

  return async (request, response) => {
    let pathname = "";
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      return false;
    }
    if (pathname !== HEALTH_PATH) {
      return false;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD" });
      response.end("Method not allowed");
      return true;
    }

    const status = await options.monitor.check();
    const counts = options.snapshot();
    const uptimeSeconds = Math.max(
      0,
      Math.floor((now().getTime() - options.startedAt()) / 1000),
    );
    if (request.method === "HEAD") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end();
      return true;
    }
    sendJson(response, 200, {
      status,
      uptimeSeconds,
      rooms: counts.rooms,
      clients: counts.clients,
      livekitUrl: options.livekitUrl,
      protocol: options.protocol,
    });
    return true;
  };
}
