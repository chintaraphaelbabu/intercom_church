import type {
  DebugRosterMessage,
  HelloMessage,
  RosterClient,
  ServerInfoMessage,
  ServerMessage,
} from "@church-comms/protocol";
import { PROTOCOL_VERSION } from "@church-comms/protocol";

export const DIRECTOR_APP_VERSION = "0.1.0";

export type ConnectionPhase =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export interface DirectorState {
  phase: ConnectionPhase;
  serverInfo?: ServerInfoMessage;
  roster: RosterClient[];
  error?: string;
}

const initialState: DirectorState = {
  phase: "connecting",
  roster: [],
};

export interface DirectorConnectionOptions {
  url?: string;
  socketFactory?: (url: string) => WebSocket;
  appVersion?: string;
}

function defaultSocketFactory(url: string): WebSocket {
  return new WebSocket(url);
}

function defaultUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

/**
 * The Director's control-channel client. It owns the WebSocket, the v1
 * handshake, and the M0 debug roster so the UI stays a pure render of state.
 */
export class DirectorConnection {
  private readonly url: string;
  private readonly socketFactory: (url: string) => WebSocket;
  private readonly appVersion: string;
  private socket: WebSocket | undefined;
  private state: DirectorState = initialState;
  private readonly listeners = new Set<() => void>();
  private manuallyClosed = false;

  constructor(options: DirectorConnectionOptions = {}) {
    this.url = options.url ?? defaultUrl();
    this.socketFactory = options.socketFactory ?? defaultSocketFactory;
    this.appVersion = options.appVersion ?? DIRECTOR_APP_VERSION;
  }

  getSnapshot = (): DirectorState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  connect(): void {
    this.manuallyClosed = false;
    this.update({ phase: "connecting", error: undefined, roster: [] });

    let socket: WebSocket;
    try {
      socket = this.socketFactory(this.url);
    } catch {
      this.update({
        phase: "error",
        error: "Could not open the control connection. Is the server running?",
      });
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      const hello: HelloMessage = {
        type: "hello",
        protocol: PROTOCOL_VERSION,
        clientType: "director",
        appVersion: this.appVersion,
        name: "Director",
      };
      socket.send(JSON.stringify(hello));
    };

    socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    socket.onerror = () => {
      this.update({
        phase: "error",
        error: "Control connection failed. Check that the server is running.",
      });
    };

    socket.onclose = () => {
      this.socket = undefined;
      if (!this.manuallyClosed && this.state.phase !== "error") {
        this.update({
          phase: "disconnected",
          error: "Disconnected from the control server.",
        });
      }
    };
  }

  disconnect(): void {
    this.manuallyClosed = true;
    this.socket?.close();
    this.socket = undefined;
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

    switch (message.type) {
      case "server_info":
        this.update({ phase: "connected", serverInfo: message, error: undefined });
        break;
      case "debug_roster":
        this.update({ roster: (message as DebugRosterMessage).clients });
        break;
      case "error":
        this.update({ phase: "error", error: message.message });
        break;
      default:
        break;
    }
  }

  private update(partial: Partial<DirectorState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) {
      listener();
    }
  }
}
