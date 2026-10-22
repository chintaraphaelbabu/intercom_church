import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  protocolMismatchError,
  type DebugRosterMessage,
  type ErrorMessage,
  type RosterClient,
  type ServerInfoMessage,
  type ServerMessage,
} from "@church-comms/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import { resolveConfig, type ConfigOverrides } from "./config.js";
import type { Logger } from "./logger.js";
import { createLiveKitTokenHandler } from "./livekit-token.js";
import { advertise, type MdnsAdvertisement } from "./mdns.js";
import { ClientRegistry } from "./roster.js";
import { createStaticHandler } from "./static.js";

const WS_PATH = "/ws";
const KNOWN_CLIENT_MESSAGE_TYPES = new Set(["hello", "ping"]);

export interface ChurchCommsServerOptions extends ConfigOverrides {}

export interface ChurchCommsServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  port(): number;
  url(): string;
}

function messageTypeOf(raw: string): string | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === "object" && value !== null && "type" in value) {
      return String((value as { type: unknown }).type);
    }
  } catch {
    // Fall through: the parser reports the human-readable error.
  }
  return undefined;
}

export function createChurchCommsServer(
  overrides: ChurchCommsServerOptions = {},
): ChurchCommsServer {
  const config = resolveConfig(overrides);
  const logger = config.logger;
  const registry = new ClientRegistry();
  const entries = new Map<WebSocket, RosterClient>();
  const staticHandler = createStaticHandler(config.webDist);
  const tokenHandler = createLiveKitTokenHandler(config);

  let httpServer: http.Server | undefined;
  let webSocketServer: WebSocketServer | undefined;
  let mdns: MdnsAdvertisement | undefined;
  let actualPort = config.port;
  let started = false;

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function sendError(socket: WebSocket, error: ErrorMessage): void {
    send(socket, error);
  }

  function broadcastRoster(): void {
    const message: DebugRosterMessage = {
      type: "debug_roster",
      clients: registry.list(),
    };
    for (const socket of entries.keys()) {
      send(socket, message);
    }
  }

  function handleMessage(socket: WebSocket, data: RawData): void {
    const raw = data.toString();
    const parsed = parseClientMessage(raw);
    const entry = entries.get(socket);

    if (!parsed.ok) {
      const type = messageTypeOf(raw);
      if (type !== undefined && !KNOWN_CLIENT_MESSAGE_TYPES.has(type)) {
        logger.warn(`Ignoring unknown control message type "${type}"`);
        return;
      }
      sendError(socket, {
        type: "error",
        code: "INVALID_MESSAGE",
        message: parsed.error,
      });
      return;
    }

    const message = parsed.value;

    if (entry === undefined) {
      if (message.type === "ping") {
        send(socket, { type: "pong" });
        return;
      }

      if (message.type !== "hello") {
        sendError(socket, {
          type: "error",
          code: "INVALID_MESSAGE",
          message: `Send hello before ${message.type}.`,
        });
        return;
      }

      if (message.protocol !== PROTOCOL_VERSION) {
        logger.warn(
          `Refused client "${message.name}": protocol v${message.protocol}, server speaks v${PROTOCOL_VERSION}`,
        );
        sendError(socket, protocolMismatchError(PROTOCOL_VERSION, message.protocol));
        socket.close(1002, "protocol mismatch");
        return;
      }

      const client = registry.add({
        name: message.name,
        clientType: message.clientType,
        appVersion: message.appVersion,
      });
      entries.set(socket, client);
      logger.info(
        `Client joined: ${client.name} (${client.clientType}, app ${client.appVersion}) [${client.id}]`,
      );

      const info: ServerInfoMessage = {
        type: "server_info",
        protocol: config.protocolVersion,
        serverId: config.serverId,
        livekitUrl: config.livekitUrl,
        serverTime: new Date().toISOString(),
      };
      send(socket, info);
      broadcastRoster();
      return;
    }

    if (message.type === "hello") {
      sendError(socket, {
        type: "error",
        code: "ALREADY_GREETED",
        message: `Client "${entry.name}" already completed the handshake.`,
      });
      return;
    }

    if (message.type === "ping") {
      send(socket, { type: "pong" });
    }
  }

  function handleConnection(socket: WebSocket): void {
    socket.on("message", (data) => handleMessage(socket, data));
    socket.on("close", () => {
      const entry = entries.get(socket);
      if (entry === undefined) {
        return;
      }
      entries.delete(socket);
      registry.remove(entry.id);
      logger.info(`Client left: ${entry.name} [${entry.id}]`);
      broadcastRoster();
    });
    socket.on("error", (error) => {
      logger.warn(`Control socket error: ${error.message}`);
    });
  }

  return {
    async start(): Promise<void> {
      if (started) {
        return;
      }
      started = true;

      httpServer = http.createServer((request, response) => {
        void tokenHandler(request, response)
          .then((handled) => {
            if (handled) {
              return;
            }
            return staticHandler(request, response);
          })
          .catch((error: unknown) => {
            logger.error("HTTP request failed", error);
            if (!response.headersSent) {
              response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            }
            response.end("Internal server error");
          });
      });

      webSocketServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

      httpServer.on("upgrade", (request, socket, head) => {
        let pathname = "/";
        try {
          pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        } catch {
          socket.destroy();
          return;
        }
        if (pathname !== WS_PATH) {
          socket.destroy();
          return;
        }
        webSocketServer?.handleUpgrade(request, socket, head, (webSocket) => {
          webSocketServer?.emit("connection", webSocket, request);
        });
      });

      webSocketServer.on("connection", handleConnection);

      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error): void => {
          httpServer?.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          httpServer?.off("error", onError);
          resolve();
        };
        httpServer?.once("error", onError);
        httpServer?.once("listening", onListening);
        httpServer?.listen(config.port, config.host);
      });

      const address = httpServer.address() as AddressInfo;
      actualPort = address.port;

      if (config.advertiseMdns) {
        try {
          mdns = await advertise({
            serviceName: config.serverName,
            port: actualPort,
            livekitUrl: config.livekitUrl,
            roomCount: 0,
            logger,
          });
        } catch (error) {
          logger.error(
            "mDNS advertisement failed; operators can still use a manual address.",
            error,
          );
        }
      }
    },

    async stop(): Promise<void> {
      if (!started) {
        return;
      }
      started = false;

      await mdns?.stop();
      mdns = undefined;

      for (const socket of entries.keys()) {
        socket.terminate();
      }
      entries.clear();

      const webSocketClosed = new Promise<void>((resolve) => {
        webSocketServer?.close(() => resolve());
        if (webSocketServer === undefined) {
          resolve();
        }
      });
      webSocketServer = undefined;

      const httpClosed = new Promise<void>((resolve) => {
        httpServer?.close(() => resolve());
        if (httpServer === undefined) {
          resolve();
        }
      });
      httpServer = undefined;

      await Promise.all([webSocketClosed, httpClosed]);
    },

    port(): number {
      return actualPort;
    },

    url(): string {
      return `http://127.0.0.1:${actualPort}`;
    },
  };
}
