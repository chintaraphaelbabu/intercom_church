import type {
  ClientMessage,
  DebugRosterMessage,
  ErrorCode,
  HelloMessage,
  JoinedMessage,
  LiveKitCredentials,
  Participant,
  RoomClosedReason,
  RoomSnapshot,
  RoomSummary,
  RosterClient,
  ServerHealthMessage,
  ServerInfoMessage,
  ServerMessage,
} from "@church-comms/protocol";
import { PROTOCOL_VERSION } from "@church-comms/protocol";

export const DIRECTOR_APP_VERSION = "0.1.0";

const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000];

export const DIRECTOR_SESSION_STORAGE_KEY =
  "church-comms.v1.director.session-token";
export const OPERATOR_SESSION_STORAGE_KEY =
  "church-comms.v1.operator.session-token";

export type ConnectionPhase =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export type BrowserRole = "director" | "operator";

export interface OwnMuteState {
  muted: boolean;
  /** Participant id of the Director who muted the Operator, or null. */
  by: string | null;
}

export interface ReconnectInfo {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  /** Clock time (ms) at which the next attempt is due. */
  nextRetryAt: number | null;
}

export interface DirectorState {
  phase: ConnectionPhase;
  serverInfo?: ServerInfoMessage;
  roster: RosterClient[];
  rooms: RoomSummary[];
  /** The room snapshot after joining, or undefined before joining/after leaving. */
  joinedRoom?: RoomSnapshot;
  /** This client's participant entry inside [joinedRoom]. */
  self?: Participant;
  directorPresent?: boolean;
  /** ISO-8601 grace deadline while the Director is absent. */
  graceDeadline?: string;
  ownMute: OwnMuteState;
  health?: ServerHealthMessage;
  livekit?: LiveKitCredentials;
  error?: string;
  errorCode?: ErrorCode;
  reconnect?: ReconnectInfo;
  roomClosedReason?: RoomClosedReason;
}

const initialState: DirectorState = {
  phase: "connecting",
  roster: [],
  rooms: [],
  ownMute: { muted: false, by: null },
};

/** The slice of localStorage the client needs; injectable for tests. */
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Injectable reconnect timer so tests never wait on real wall time. */
export interface ReconnectScheduler {
  schedule(handler: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface DirectorConnectionOptions {
  url?: string;
  socketFactory?: (url: string) => WebSocket;
  appVersion?: string;
  /** Director by default; operator enables the browser test participant. */
  role?: BrowserRole;
  /** Display name sent in hello. */
  name?: string;
  storage?: SessionStorage;
  clock?: () => number;
  scheduler?: ReconnectScheduler;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectDelaysMs?: number[];
}

/** Read `?role=operator` for the browser test-participant path. */
export function browserRoleFromSearch(search: string): BrowserRole {
  const params = new URLSearchParams(search);
  return params.get("role") === "operator" ? "operator" : "director";
}

function defaultSocketFactory(url: string): WebSocket {
  return new WebSocket(url);
}

function defaultUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

function memoryStorage(): SessionStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function defaultStorage(role: BrowserRole): SessionStorage {
  try {
    if (typeof window !== "undefined") {
      // The Director survives a tab reload on the laptop. Browser Operator test
      // participants use sessionStorage so two tabs never share one identity.
      const storage =
        role === "director" ? window.localStorage : window.sessionStorage;
      if (storage !== undefined) {
        return storage;
      }
    }
  } catch {
    // Private-mode browsers can throw on storage access.
  }
  return memoryStorage();
}

function defaultClock(): number {
  return Date.now();
}

function defaultScheduler(): ReconnectScheduler {
  return {
    schedule(handler, delayMs) {
      return setTimeout(handler, delayMs);
    },
    cancel(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
}

function participantById(
  room: RoomSnapshot,
  participantId: string,
): Participant | undefined {
  if (room.director?.id === participantId) {
    return room.director;
  }
  return room.operators.find((participant) => participant.id === participantId);
}

/**
 * The Director's control-channel client. It owns the WebSocket, the v1
 * handshake, session resume, reconnect attempts, and every room command; the UI
 * is a pure render of [DirectorState].
 */
export class DirectorConnection {
  private readonly url: string;
  private readonly socketFactory: (url: string) => WebSocket;
  private readonly appVersion: string;
  private readonly role: BrowserRole;
  private readonly name: string;
  private readonly storage: SessionStorage;
  private readonly clock: () => number;
  private readonly scheduler: ReconnectScheduler;
  private readonly autoReconnect: boolean;
  private readonly maxReconnectAttempts: number;
  private readonly reconnectDelaysMs: number[];
  private readonly sessionStorageKey: string;
  private socket: WebSocket | undefined;
  private state: DirectorState = initialState;
  private readonly listeners = new Set<() => void>();
  private manuallyClosed = false;
  private reconnectAttempt = 0;
  private reconnectHandle: unknown;

  constructor(options: DirectorConnectionOptions = {}) {
    this.url = options.url ?? defaultUrl();
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.appVersion = options.appVersion ?? DIRECTOR_APP_VERSION;
    this.role = options.role ?? "director";
    this.name =
      options.name ?? (this.role === "director" ? "Director" : "Operator");
    this.storage = options.storage ?? defaultStorage(this.role);
    this.clock = options.clock ?? defaultClock;
    this.scheduler = options.scheduler ?? defaultScheduler();
    this.autoReconnect = options.autoReconnect ?? true;
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS;
    this.reconnectDelaysMs =
      options.reconnectDelaysMs === undefined || options.reconnectDelaysMs.length === 0
        ? [...DEFAULT_RECONNECT_DELAYS_MS]
        : [...options.reconnectDelaysMs];
    this.sessionStorageKey =
      this.role === "director"
        ? DIRECTOR_SESSION_STORAGE_KEY
        : OPERATOR_SESSION_STORAGE_KEY;
  }

  getSnapshot = (): DirectorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  connect(): void {
    if (this.socket !== undefined) {
      return;
    }
    this.manuallyClosed = false;
    this.reconnectAttempt = 0;
    this.cancelReconnect();
    this.openSocket();
  }

  /** User-initiated retry after the automatic attempts are exhausted. */
  retry(): void {
    if (this.socket !== undefined) {
      return;
    }
    this.manuallyClosed = false;
    this.reconnectAttempt = 0;
    this.cancelReconnect();
    this.update({
      phase: "connecting",
      error: undefined,
      errorCode: undefined,
      reconnect: undefined,
    });
    this.openSocket();
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.cancelReconnect();
    const socket = this.socket;
    this.socket = undefined;
    try {
      socket?.close();
    } catch {
      // Already closed.
    }
    this.update({ phase: "disconnected", reconnect: undefined });
  }

  createRoom(name = "MEDIA"): void {
    this.send({ type: "create_room", name });
  }

  joinRoom(
    roomName: string,
    options: { name: string; cameraNumber: number },
  ): void {
    const sessionToken = this.storedSessionToken();
    const message: ClientMessage = {
      type: "join_room",
      room: roomName,
      name: options.name,
      cameraNumber: options.cameraNumber,
    };
    if (sessionToken !== undefined) {
      message.sessionToken = sessionToken;
    }
    this.send(message);
  }

  leaveRoom(): void {
    this.send({ type: "leave_room" });
    this.clearJoinedRoom();
  }

  endRoom(): void {
    this.send({ type: "end_room" });
  }

  setMute(participantId: string, muted = true): void {
    this.send({ type: "set_mute", participantId, muted });
  }

  clearMute(): void {
    this.send({ type: "clear_mute" });
  }

  setCamera(cameraNumber: number): void {
    this.send({ type: "set_camera", cameraNumber });
  }

  private openSocket(): void {
    this.update({
      phase: this.reconnectAttempt > 0 ? "reconnecting" : "connecting",
      reconnect:
        this.reconnectAttempt > 0 ? this.state.reconnect : undefined,
    });

    let socket: WebSocket;
    try {
      socket = this.socketFactory(this.url);
    } catch {
      this.socket = undefined;
      this.update({
        phase: "error",
        error: "Could not open the control connection. Is the server running?",
      });
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) {
        return;
      }
      this.sendHello(socket);
    };

    socket.onmessage = (event) => {
      if (this.socket !== socket) {
        return;
      }
      this.handleMessage(event.data);
    };

    socket.onerror = () => {
      if (this.socket !== socket) {
        return;
      }
      this.update({
        error: "Control connection failed. Check that the server is running.",
      });
    };

    socket.onclose = () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = undefined;
      this.handleClose();
    };
  }

  private sendHello(socket: WebSocket): void {
    const hello: HelloMessage = {
      type: "hello",
      protocol: PROTOCOL_VERSION,
      clientType: this.role,
      appVersion: this.appVersion,
      name: this.name,
    };
    const sessionToken = this.storedSessionToken();
    if (sessionToken !== undefined) {
      hello.sessionToken = sessionToken;
    }
    socket.send(JSON.stringify(hello));
  }

  private send(message: ClientMessage): void {
    const socket = this.socket;
    if (socket === undefined || socket.readyState !== 1) {
      return;
    }
    socket.send(JSON.stringify(message));
  }

  private storedSessionToken(): string | undefined {
    const token = this.storage.getItem(this.sessionStorageKey);
    return token === null || token.length === 0 ? undefined : token;
  }

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      return;
    }
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (typeof message !== "object" || message === null || !("type" in message)) {
      return;
    }

    switch (message.type) {
      case "server_info":
        this.onServerInfo(message);
        break;
      case "debug_roster":
        this.update({ roster: (message as DebugRosterMessage).clients });
        break;
      case "room_list":
        this.update({ rooms: message.rooms });
        break;
      case "joined":
        this.onJoined(message);
        break;
      case "participant_joined":
        this.update(this.snapshotState(message.room));
        break;
      case "participant_left":
        this.update(this.snapshotState(message.room));
        break;
      case "participant_updated":
        this.update(this.snapshotState(message.room));
        break;
      case "director_state":
        this.update({
          ...this.snapshotState(message.room),
          directorPresent: message.present,
          graceDeadline: message.graceDeadline,
        });
        break;
      case "mute_state":
        this.onMuteState(message.participantId, message.muted, message.by);
        break;
      case "room_closed":
        this.clearJoinedRoom();
        this.update({ roomClosedReason: message.reason });
        break;
      case "server_health":
        this.update({ health: message });
        break;
      case "error":
        this.onError(message.code, message.message);
        break;
      case "pong":
        break;
      default:
        break;
    }
  }

  private onServerInfo(message: ServerInfoMessage): void {
    this.reconnectAttempt = 0;
    this.cancelReconnect();
    this.update({
      phase: "connected",
      serverInfo: message,
      reconnect: undefined,
      error: undefined,
      errorCode: undefined,
    });
  }

  private onJoined(message: JoinedMessage): void {
    this.storage.setItem(this.sessionStorageKey, message.sessionToken);
    const self = participantById(message.room, message.participantId);
    this.update({
      phase: "connected",
      joinedRoom: message.room,
      self,
      livekit: message.livekit,
      ownMute: { muted: self?.muted ?? false, by: null },
      roomClosedReason: undefined,
      reconnect: undefined,
      error: undefined,
      errorCode: undefined,
    });
  }

  /**
   * The server sends a full room snapshot with every roster event, so the
   * client never has to patch participants itself.
   */
  private snapshotState(room: RoomSnapshot): Partial<DirectorState> {
    // Never resurrect a room after leave/room_closed from a late roster event.
    if (this.state.joinedRoom === undefined) {
      return {};
    }
    const self =
      this.state.self === undefined
        ? undefined
        : participantById(room, this.state.self.id);
    const ownMute = self === undefined ? this.state.ownMute : {
      muted: self.muted,
      by: self.muted ? this.state.ownMute.by : null,
    };
    return { joinedRoom: room, self, ownMute };
  }

  private onMuteState(
    participantId: string,
    muted: boolean,
    by: string | null,
  ): void {
    const room = this.state.joinedRoom;
    if (room === undefined) {
      return;
    }
    const patchParticipant = (participant: Participant): Participant =>
      participant.id === participantId ? { ...participant, muted } : participant;

    const updatedRoom: RoomSnapshot = {
      ...room,
      director: room.director === null ? null : patchParticipant(room.director),
      operators: room.operators.map(patchParticipant),
    };
    const currentSelf = this.state.self;
    const nextSelf =
      currentSelf === undefined
        ? undefined
        : participantById(updatedRoom, currentSelf.id);
    const isSelf = currentSelf !== undefined && currentSelf.id === participantId;

    this.update({
      joinedRoom: updatedRoom,
      self: nextSelf,
      ownMute: isSelf ? { muted, by } : this.state.ownMute,
    });
  }

  private onError(code: ErrorCode, message: string): void {
    if (code === "SESSION_EXPIRED") {
      this.storage.removeItem(this.sessionStorageKey);
      this.clearJoinedRoom();
      this.update({
        phase: this.socket === undefined ? this.state.phase : "connected",
        error: message,
        errorCode: code,
        reconnect: undefined,
      });
      return;
    }

    if (code === "PROTOCOL_MISMATCH") {
      this.update({ phase: "error", error: message, errorCode: code });
      return;
    }

    this.update({ error: message, errorCode: code });
  }

  private handleClose(): void {
    if (this.manuallyClosed) {
      this.update({ phase: "disconnected", reconnect: undefined });
      return;
    }

    // A protocol mismatch cannot heal by retrying; it needs a matching build.
    if (this.state.errorCode === "PROTOCOL_MISMATCH") {
      this.update({ phase: "error", reconnect: undefined });
      return;
    }

    if (
      !this.autoReconnect ||
      this.reconnectAttempt >= this.maxReconnectAttempts
    ) {
      this.update({
        phase: "disconnected",
        reconnect: undefined,
        error:
          this.reconnectAttempt >= this.maxReconnectAttempts
            ? "Could not reach the control server. Check that it is running, then retry."
            : "Disconnected from the control server.",
      });
      return;
    }

    this.reconnectAttempt += 1;
    const delayMs =
      this.reconnectDelaysMs[
        Math.min(this.reconnectAttempt - 1, this.reconnectDelaysMs.length - 1)
      ] ?? 500;
    this.update({
      phase: "reconnecting",
      error: "Disconnected from the control server.",
      reconnect: {
        attempt: this.reconnectAttempt,
        maxAttempts: this.maxReconnectAttempts,
        delayMs,
        nextRetryAt: this.clock() + delayMs,
      },
    });

    this.reconnectHandle = this.scheduler.schedule(() => {
      this.reconnectHandle = undefined;
      if (this.manuallyClosed) {
        return;
      }
      this.openSocket();
    }, delayMs);
  }

  private cancelReconnect(): void {
    if (this.reconnectHandle !== undefined) {
      this.scheduler.cancel(this.reconnectHandle);
      this.reconnectHandle = undefined;
    }
  }

  private clearJoinedRoom(): void {
    this.update({
      joinedRoom: undefined,
      self: undefined,
      livekit: undefined,
      directorPresent: undefined,
      graceDeadline: undefined,
      ownMute: { muted: false, by: null },
    });
  }

  private update(partial: Partial<DirectorState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
