import http from "node:http";
import type { AddressInfo } from "node:net";
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  protocolMismatchError,
  type ClientMessage,
  type DebugRosterMessage,
  type DirectorStateMessage,
  type ErrorMessage,
  type HelloMessage,
  type Participant,
  type RosterClient,
  type RoomSnapshot,
  type ServerHealthMessage,
  type ServerInfoMessage,
  type ServerMessage,
} from "@church-comms/protocol";
import { WebSocket, WebSocketServer } from "ws";
import type { RawData } from "ws";
import { resolveConfig, type ConfigOverrides } from "./config.js";
import {
  HealthMonitor,
  createHealthHandler,
  type HealthMonitorOptions,
} from "./health.js";
import type { Logger } from "./logger.js";
import {
  createLiveKitTokenHandler,
  mintLiveKitCredentials,
} from "./livekit-token.js";
import { advertise, type MdnsAdvertisement } from "./mdns.js";
import { ClientRegistry } from "./roster.js";
import {
  RoomRegistry,
  type ClosedRoom,
  type JoinOutcomeLike,
  type RoomRegistryOptions,
} from "./rooms.js";
import { createStaticHandler } from "./static.js";

const WS_PATH = "/ws";
const DEFAULT_SWEEP_INTERVAL_MS = 1_000;
const KNOWN_CLIENT_MESSAGE_TYPES = new Set<ClientMessage["type"]>([
  "hello",
  "ping",
  "create_room",
  "end_room",
  "join_room",
  "leave_room",
  "set_camera",
  "set_mute",
  "clear_mute",
]);

export interface ChurchCommsServerOptions extends ConfigOverrides {
  /** Test seam: supply a clock-driven registry (fake time, short grace, ...). */
  registry?: RoomRegistry;
  clock?: () => Date;
  roomGraceMs?: number;
  reconnectGraceMs?: number;
  sweepIntervalMs?: number;
  livekitHealthCheck?: () => Promise<boolean>;
}

export interface ChurchCommsServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  port(): number;
  url(): string;
  /** Run the periodic sweep immediately (used by tests with an injected clock). */
  sweep(): void;
  registry(): RoomRegistry;
}

interface ClientEntry {
  client: RosterClient;
  participantId?: string;
  sessionToken?: string;
  roomName?: string;
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

function participantIds(room: RoomSnapshot): string[] {
  const ids = room.operators.map((operator) => operator.id);
  if (room.director !== null) {
    ids.unshift(room.director.id);
  }
  return ids;
}

export function createChurchCommsServer(
  overrides: ChurchCommsServerOptions = {},
): ChurchCommsServer {
  const config = resolveConfig(overrides);
  const logger: Logger = config.logger;
  const clock = overrides.clock ?? (() => new Date());

  const registryOptions: RoomRegistryOptions = { now: clock };
  if (overrides.roomGraceMs !== undefined) {
    registryOptions.gracePeriodMs = overrides.roomGraceMs;
  }
  if (overrides.reconnectGraceMs !== undefined) {
    registryOptions.reconnectGraceMs = overrides.reconnectGraceMs;
  }
  const rooms = overrides.registry ?? new RoomRegistry(registryOptions);

  const clients = new ClientRegistry();
  const entries = new Map<WebSocket, ClientEntry>();
  const participantSockets = new Map<string, WebSocket>();
  const staticHandler = createStaticHandler(config.webDist);

  let mdnsHealthy = true;
  const healthOptions: HealthMonitorOptions = {
    livekitUrl: config.livekitUrl,
    mdnsHealthy: () => mdnsHealthy,
    now: clock,
  };
  if (overrides.livekitHealthCheck !== undefined) {
    healthOptions.probe = overrides.livekitHealthCheck;
  }
  const healthMonitor = new HealthMonitor(healthOptions);

  const tokenHandler = createLiveKitTokenHandler(config, {
    resolveIdentity: (identity) => rooms.resolveMediaIdentity(identity),
    now: clock,
  });
  const healthHandler = createHealthHandler({
    monitor: healthMonitor,
    snapshot: () => ({ rooms: rooms.roomCount, clients: entries.size }),
    startedAt: () => startedAt,
    livekitUrl: config.livekitUrl,
    protocol: config.protocolVersion,
    now: clock,
  });

  let httpServer: http.Server | undefined;
  let webSocketServer: WebSocketServer | undefined;
  let mdns: MdnsAdvertisement | undefined;
  let actualPort = config.port;
  let startedAt = clock().getTime();
  let started = false;
  let sweepTimer: ReturnType<typeof setInterval> | undefined;

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  }

  function sendError(socket: WebSocket, error: ErrorMessage): void {
    send(socket, error);
  }

  function uptimeSeconds(): number {
    return Math.max(0, Math.floor((clock().getTime() - startedAt) / 1000));
  }

  function serverHealthMessage(): ServerHealthMessage {
    return {
      type: "server_health",
      status: healthMonitor.status(),
      rooms: rooms.roomCount,
      operators: rooms.operatorCount,
      clients: entries.size,
      uptimeSeconds: uptimeSeconds(),
      livekitUrl: config.livekitUrl,
    };
  }

  function broadcastRoster(): void {
    const message: DebugRosterMessage = {
      type: "debug_roster",
      clients: clients.list(),
    };
    for (const socket of entries.keys()) {
      send(socket, message);
    }
  }

  function broadcastRoomList(): void {
    const message = {
      type: "room_list" as const,
      rooms: rooms.listJoinableRooms(),
    };
    for (const socket of entries.keys()) {
      send(socket, message);
    }
  }

  function broadcastHealth(): void {
    const message = serverHealthMessage();
    for (const socket of entries.keys()) {
      send(socket, message);
    }
  }

  function socketsFor(ids: readonly string[]): WebSocket[] {
    const sockets: WebSocket[] = [];
    for (const id of ids) {
      const socket = participantSockets.get(id);
      if (socket !== undefined) {
        sockets.push(socket);
      }
    }
    return sockets;
  }

  function sendToRoom(
    room: RoomSnapshot,
    message: ServerMessage,
    options: { except?: string } = {},
  ): void {
    for (const socket of socketsFor(participantIds(room))) {
      const entry = entries.get(socket);
      if (options.except !== undefined && entry?.participantId === options.except) {
        continue;
      }
      send(socket, message);
    }
  }

  function sendToParticipants(ids: readonly string[], message: ServerMessage): void {
    for (const socket of socketsFor(ids)) {
      send(socket, message);
    }
  }

  function unbind(socket: WebSocket, entry: ClientEntry): void {
    if (
      entry.participantId !== undefined &&
      participantSockets.get(entry.participantId) === socket
    ) {
      participantSockets.delete(entry.participantId);
    }
    delete entry.participantId;
    delete entry.sessionToken;
    delete entry.roomName;
  }

  function bind(
    socket: WebSocket,
    entry: ClientEntry,
    participantId: string,
    sessionToken: string,
    roomName: string,
  ): void {
    const previous = participantSockets.get(participantId);
    if (previous !== undefined && previous !== socket) {
      const previousEntry = entries.get(previous);
      if (previousEntry !== undefined) {
        unbind(previous, previousEntry);
        send(previous, {
          type: "error",
          code: "ALREADY_GREETED",
          message: "This session resumed on another connection.",
        });
      }
    }
    unbind(socket, entry);
    entry.participantId = participantId;
    entry.sessionToken = sessionToken;
    entry.roomName = roomName;
    participantSockets.set(participantId, socket);
  }

  function releaseParticipant(participantId: string): void {
    const socket = participantSockets.get(participantId);
    if (socket === undefined) {
      return;
    }
    const entry = entries.get(socket);
    if (entry === undefined) {
      participantSockets.delete(participantId);
      return;
    }
    unbind(socket, entry);
  }

  function closeRoomForEveryone(closed: ClosedRoom): void {
    const ids = closed.participants.map((participant) => participant.id);
    sendToParticipants(ids, {
      type: "room_closed",
      room: closed.roomName,
      reason: closed.reason,
    });
    for (const id of ids) {
      releaseParticipant(id);
    }
    broadcastRoomList();
  }

  function directorState(
    room: RoomSnapshot,
    present: boolean,
  ): DirectorStateMessage {
    const message: DirectorStateMessage = {
      type: "director_state",
      room,
      present,
    };
    if (room.graceDeadline !== undefined) {
      message.graceDeadline = room.graceDeadline;
    }
    return message;
  }

  async function sendJoined(
    socket: WebSocket,
    outcome: JoinOutcomeLike,
  ): Promise<void> {
    const livekit = await mintLiveKitCredentials(config, {
      identity: outcome.participant.id,
      name: outcome.participant.name,
      role: outcome.participant.role,
      room: outcome.room.name,
      now: clock(),
    });
    send(socket, {
      type: "joined",
      participantId: outcome.participant.id,
      sessionToken: outcome.sessionToken,
      room: outcome.room,
      livekit,
    });
  }

  async function handleHello(
    socket: WebSocket,
    message: HelloMessage,
  ): Promise<void> {
    if (message.protocol !== PROTOCOL_VERSION) {
      logger.warn(
        `Refused client "${message.name}": protocol v${message.protocol}, server speaks v${PROTOCOL_VERSION}`,
      );
      sendError(socket, protocolMismatchError(PROTOCOL_VERSION, message.protocol));
      socket.close(1002, "protocol mismatch");
      return;
    }

    let resumed:
      | {
          participant: Participant;
          room: RoomSnapshot;
          sessionToken: string;
        }
      | undefined;
    if (message.sessionToken !== undefined) {
      const result = rooms.resumeSession(message.sessionToken);
      if (result.ok) {
        resumed = result;
      } else {
        sendError(socket, {
          type: "error",
          code: result.code,
          message: result.message,
        });
      }
    }

    const client = clients.add({
      name: message.name,
      clientType: message.clientType,
      appVersion: message.appVersion,
    });
    const entry: ClientEntry = { client };
    entries.set(socket, entry);
    logger.info(
      `Client joined: ${client.name} (${client.clientType}, app ${client.appVersion}) [${client.id}]`,
    );

    const info: ServerInfoMessage = {
      type: "server_info",
      protocol: config.protocolVersion,
      serverId: config.serverId,
      livekitUrl: config.livekitUrl,
      serverTime: clock().toISOString(),
    };
    send(socket, info);
    broadcastRoster();

    if (resumed !== undefined) {
      bind(
        socket,
        entry,
        resumed.participant.id,
        resumed.sessionToken,
        resumed.room.name,
      );
      await sendJoined(socket, resumed);
      sendToRoom(
        resumed.room,
        {
          type: "participant_updated",
          participant: resumed.participant,
          room: resumed.room,
        },
        { except: resumed.participant.id },
      );
      if (resumed.participant.role === "director") {
        sendToRoom(
          resumed.room,
          directorState(resumed.room, true),
          { except: resumed.participant.id },
        );
      }
      logger.info(
        `Session resumed: ${resumed.participant.name} in "${resumed.room.name}" [${resumed.participant.id}]`,
      );
      broadcastRoomList();
      return;
    }

    send(socket, {
      type: "room_list",
      rooms: rooms.listJoinableRooms(),
    });
    send(socket, serverHealthMessage());
  }

  async function handleCreateRoom(
    socket: WebSocket,
    entry: ClientEntry,
    message: Extract<ClientMessage, { type: "create_room" }>,
  ): Promise<void> {
    if (entry.client.clientType !== "director") {
      sendError(socket, {
        type: "error",
        code: "DIRECTOR_REQUIRED",
        message: "Only the director can create a room.",
      });
      return;
    }
    if (entry.participantId !== undefined) {
      sendError(socket, {
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Leave the current room before creating another.",
      });
      return;
    }

    const result = rooms.createRoom({
      name: message.name,
      directorName: entry.client.name,
    });
    if (!result.ok) {
      sendError(socket, {
        type: "error",
        code: result.code,
        message: result.message,
      });
      return;
    }

    bind(socket, entry, result.participant.id, result.sessionToken, result.room.name);
    logger.info(
      `Room created: "${result.room.name}" by ${result.participant.name} [${result.participant.id}]`,
    );
    await sendJoined(socket, result);
    broadcastRoomList();
  }

  async function handleJoinRoom(
    socket: WebSocket,
    entry: ClientEntry,
    message: Extract<ClientMessage, { type: "join_room" }>,
  ): Promise<void> {
    if (entry.client.clientType !== "operator") {
      sendError(socket, {
        type: "error",
        code: "NOT_OPERATOR",
        message: "Only Operators can join a room. The director creates one instead.",
      });
      return;
    }
    if (entry.participantId !== undefined) {
      sendError(socket, {
        type: "error",
        code: "INVALID_MESSAGE",
        message: "You are already in a room.",
      });
      return;
    }

    const result = rooms.joinRoom({
      room: message.room,
      name: message.name,
      cameraNumber: message.cameraNumber,
      ...(message.sessionToken !== undefined
        ? { sessionToken: message.sessionToken }
        : {}),
    });
    if (!result.ok) {
      sendError(socket, {
        type: "error",
        code: result.code,
        message: result.message,
      });
      return;
    }

    bind(socket, entry, result.participant.id, result.sessionToken, result.room.name);
    logger.info(
      `Participant joined: ${result.participant.name} as camera ${result.participant.cameraNumber ?? "-"} in "${result.room.name}" [${result.participant.id}]`,
    );
    await sendJoined(socket, result);
    if (result.resumed) {
      sendToRoom(
        result.room,
        {
          type: "participant_updated",
          participant: result.participant,
          room: result.room,
        },
        { except: result.participant.id },
      );
    } else {
      sendToRoom(
        result.room,
        {
          type: "participant_joined",
          participant: result.participant,
          room: result.room,
        },
        { except: result.participant.id },
      );
    }
    broadcastRoomList();
  }

  function handleLeaveRoom(
    socket: WebSocket,
    entry: ClientEntry,
  ): void {
    if (entry.participantId === undefined) {
      sendError(socket, {
        type: "error",
        code: "NOT_IN_ROOM",
        message: "You are not in a room.",
      });
      return;
    }

    const result = rooms.leave(entry.participantId);
    if (!result.ok) {
      sendError(socket, {
        type: "error",
        code: result.code,
        message: result.message,
      });
      unbind(socket, entry);
      return;
    }

    if (result.kind === "room_closed") {
      closeRoomForEveryone({
        roomName: result.roomName,
        room: result.room,
        reason: result.reason,
        participants: result.participants,
      });
    } else {
      sendToRoom(result.room, {
        type: "participant_left",
        participantId: result.participant.id,
        room: result.room,
      });
    }
    unbind(socket, entry);
    broadcastRoomList();
  }

  function handleSetCamera(
    socket: WebSocket,
    entry: ClientEntry,
    message: Extract<ClientMessage, { type: "set_camera" }>,
  ): void {
    if (entry.participantId === undefined) {
      sendError(socket, {
        type: "error",
        code: "NOT_IN_ROOM",
        message: "You are not in a room.",
      });
      return;
    }

    const result = rooms.setCamera(entry.participantId, message.cameraNumber);
    if (!result.ok) {
      sendError(socket, {
        type: "error",
        code: result.code,
        message: result.message,
      });
      return;
    }
    sendToRoom(result.room, {
      type: "participant_updated",
      participant: result.participant,
      room: result.room,
    });
  }

  function handleSetMute(
    socket: WebSocket,
    entry: ClientEntry,
    message: Extract<ClientMessage, { type: "set_mute" }>,
  ): void {
    if (entry.participantId === undefined) {
      sendError(socket, {
        type: "error",
        code: "NOT_IN_ROOM",
        message: "You are not in a room.",
      });
      return;
    }

    const result = rooms.setMute(
      entry.participantId,
      message.participantId,
      message.muted,
    );
    if (!result.ok) {
      sendError(socket, {
        type: "error",
        code: result.code,
        message: result.message,
      });
      return;
    }
    sendToRoom(result.room, {
      type: "mute_state",
      room: result.room.name,
      participantId: result.participant.id,
      muted: result.participant.muted,
      by: result.by,
    });
    sendToRoom(result.room, {
      type: "participant_updated",
      participant: result.participant,
      room: result.room,
    });
  }

  function handleClearMute(
    socket: WebSocket,
    entry: ClientEntry,
  ): void {
    if (entry.participantId === undefined) {
      sendError(socket, {
        type: "error",
        code: "NOT_IN_ROOM",
        message: "You are not in a room.",
      });
      return;
    }

    const result = rooms.clearMute(entry.participantId);
    if (!result.ok) {
      sendError(socket, {
        type: "error",
        code: result.code,
        message: result.message,
      });
      return;
    }
    sendToRoom(result.room, {
      type: "mute_state",
      room: result.room.name,
      participantId: result.participant.id,
      muted: result.participant.muted,
      by: result.by,
    });
    sendToRoom(result.room, {
      type: "participant_updated",
      participant: result.participant,
      room: result.room,
    });
  }

  function handleEndRoom(socket: WebSocket, entry: ClientEntry): void {
    if (entry.participantId === undefined) {
      sendError(socket, {
        type: "error",
        code: "NOT_IN_ROOM",
        message: "You are not in a room.",
      });
      return;
    }

    const result = rooms.endRoom(entry.participantId);
    if (!result.ok) {
      sendError(socket, {
        type: "error",
        code: result.code,
        message: result.message,
      });
      return;
    }
    closeRoomForEveryone(result);
  }

  async function handleCommand(
    socket: WebSocket,
    entry: ClientEntry,
    message: ClientMessage,
  ): Promise<void> {
    switch (message.type) {
      case "ping":
        send(socket, { type: "pong" });
        return;
      case "create_room":
        await handleCreateRoom(socket, entry, message);
        return;
      case "join_room":
        await handleJoinRoom(socket, entry, message);
        return;
      case "leave_room":
        handleLeaveRoom(socket, entry);
        return;
      case "set_camera":
        handleSetCamera(socket, entry, message);
        return;
      case "set_mute":
        handleSetMute(socket, entry, message);
        return;
      case "clear_mute":
        handleClearMute(socket, entry);
        return;
      case "end_room":
        handleEndRoom(socket, entry);
        return;
      case "hello":
        sendError(socket, {
          type: "error",
          code: "ALREADY_GREETED",
          message: `Client "${entry.client.name}" already completed the handshake.`,
        });
        return;
      default:
        return;
    }
  }

  async function handleMessage(socket: WebSocket, data: RawData): Promise<void> {
    const raw = data.toString();
    const parsed = parseClientMessage(raw);
    const entry = entries.get(socket);

    if (!parsed.ok) {
      const type = messageTypeOf(raw);
      if (
        type !== undefined &&
        !KNOWN_CLIENT_MESSAGE_TYPES.has(type as ClientMessage["type"])
      ) {
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
          message: "Send hello before joining a room.",
        });
        return;
      }
      await handleHello(socket, message);
      return;
    }

    await handleCommand(socket, entry, message);
  }

  function handleClose(socket: WebSocket): void {
    const entry = entries.get(socket);
    if (entry === undefined) {
      return;
    }

    if (entry.participantId !== undefined) {
      const participantId = entry.participantId;
      const result = rooms.disconnect(participantId);
      if (result.ok) {
        if (result.participant.role === "director") {
          sendToRoom(result.room, directorState(result.room, false));
          logger.info(
            `Director offline: room "${result.room.name}" is in grace until ${result.room.graceDeadline ?? "unknown"}`,
          );
          broadcastRoomList();
        } else {
          sendToRoom(
            result.room,
            {
              type: "participant_updated",
              participant: result.participant,
              room: result.room,
            },
            { except: participantId },
          );
        }
      }
      unbind(socket, entry);
    }

    entries.delete(socket);
    clients.remove(entry.client.id);
    logger.info(`Client left: ${entry.client.name} [${entry.client.id}]`);
    broadcastRoster();
  }

  function sweep(): void {
    const result = rooms.tick();
    for (const closed of result.roomClosures) {
      closeRoomForEveryone(closed);
    }
    for (const removal of result.participantRemovals) {
      sendToRoom(
        removal.roomSnapshot,
        {
          type: "participant_left",
          participantId: removal.participant.id,
          room: removal.roomSnapshot,
        },
        { except: removal.participant.id },
      );
      releaseParticipant(removal.participant.id);
    }
    if (result.roomClosures.length > 0 || result.participantRemovals.length > 0) {
      broadcastRoomList();
    }
    broadcastHealth();
    void healthMonitor.check();
  }

  function handleConnection(socket: WebSocket): void {
    socket.on("message", (data) => {
      void handleMessage(socket, data).catch((error: unknown) => {
        logger.error("Control message failed", error);
        sendError(socket, {
          type: "error",
          code: "INVALID_MESSAGE",
          message: "The server could not process that message.",
        });
      });
    });
    socket.on("close", () => handleClose(socket));
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
      startedAt = clock().getTime();

      httpServer = http.createServer((request, response) => {
        void (async () => {
          if (await tokenHandler(request, response)) {
            return;
          }
          if (await healthHandler(request, response)) {
            return;
          }
          await staticHandler(request, response);
        })().catch((error: unknown) => {
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
            roomCount: rooms.roomCount,
            logger,
          });
        } catch (error) {
          mdnsHealthy = false;
          logger.error(
            "mDNS advertisement failed; operators can still use a manual address.",
            error,
          );
        }
      }

      sweepTimer = setInterval(
        sweep,
        overrides.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
      );
      sweepTimer.unref?.();
      void healthMonitor.check();
    },

    async stop(): Promise<void> {
      if (!started) {
        return;
      }
      started = false;

      if (sweepTimer !== undefined) {
        clearInterval(sweepTimer);
        sweepTimer = undefined;
      }

      for (const summary of rooms.listAllRooms()) {
        const snapshot = rooms.snapshot(summary.name);
        if (snapshot !== undefined) {
          sendToParticipants(participantIds(snapshot), {
            type: "room_closed",
            room: summary.name,
            reason: "server_shutdown",
          });
        }
      }

      await mdns?.stop();
      mdns = undefined;

      for (const socket of entries.keys()) {
        socket.terminate();
      }
      entries.clear();
      participantSockets.clear();
      for (const client of clients.list()) {
        clients.remove(client.id);
      }

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

    sweep(): void {
      sweep();
    },

    registry(): RoomRegistry {
      return rooms;
    },
  };
}
