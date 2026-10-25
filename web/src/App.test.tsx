import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  type JoinedMessage,
  type RoomListMessage,
  type ServerInfoMessage,
} from "@church-comms/protocol";
import { App, type DirectorMediaControls } from "./App";
import {
  DIRECTOR_SESSION_STORAGE_KEY,
  type SessionStorage,
} from "./connection";
import type { DirectorMediaState, DirectorMediaToken } from "./media";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly sent: string[] = [];
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.(new CloseEvent("close"));
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }

  receive(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }
}

class MemoryStorage implements SessionStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function renderDirector(
  options: { storage?: SessionStorage; media?: DirectorMediaControls } = {},
): FakeWebSocket {
  render(
    <App
      connectionOptions={{
        url: "ws://test.local/ws",
        socketFactory: () => {
          const socket = new FakeWebSocket("ws://test.local/ws");
          return socket as unknown as WebSocket;
        },
        ...(options.storage !== undefined ? { storage: options.storage } : {}),
      }}
      {...(options.media !== undefined ? { media: options.media } : {})}
    />,
  );
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) {
    throw new Error("App did not open a WebSocket");
  }
  return socket;
}

class FakeDirectorMedia implements DirectorMediaControls {
  private state: DirectorMediaState = {
    phase: "idle",
    micEnabled: false,
    connectionState: "idle",
    participants: [],
    masterVolume: 100,
    inputRoute: "Default microphone",
    outputRoute: "Default output",
  };
  private listeners = new Set<() => void>();
  lastCredentials: DirectorMediaToken | undefined;

  getState = (): DirectorMediaState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  async setOpenMic(
    enabled: boolean,
    credentials?: DirectorMediaToken,
  ): Promise<void> {
    this.lastCredentials = credentials;
    this.state = {
      ...this.state,
      phase: enabled ? "publishing" : "ready",
      micEnabled: enabled,
    };
    for (const listener of this.listeners) {
      listener();
    }
  }

  setParticipantVolume(identity: string, volume: number): void {
    const participants = this.state.participants.map((p) =>
      p.identity === identity ? { ...p, volume } : p,
    );
    this.state = { ...this.state, participants };
    for (const listener of this.listeners) listener();
  }

  setMasterVolume(volume: number): void {
    this.state = { ...this.state, masterVolume: volume };
    for (const listener of this.listeners) listener();
  }

  muteRemoteParticipant(identity: string, muted: boolean): void {
    // Hard mute handled by media layer; no-op for test mock.
  }

  async disconnect(): Promise<void> {
    this.state = {
      ...this.state,
      phase: "idle",
      micEnabled: false,
      connectionState: "idle",
    };
  }
}

const serverInfo: ServerInfoMessage = {
  type: "server_info",
  protocol: PROTOCOL_VERSION,
  serverId: "test-server",
  livekitUrl: "ws://192.168.1.20:7880",
  serverTime: "2026-10-21T09:00:00.000Z",
};

const joinedRoom: JoinedMessage = {
  type: "joined",
  participantId: "director-1",
  sessionToken: "session-1",
  room: {
    name: "MEDIA",
    status: "open",
    capacity: 11,
    director: {
      id: "director-1",
      name: "Director",
      role: "director",
      cameraNumber: null,
      connectionState: "connected",
      muted: false,
      joinedAt: "2026-10-21T09:00:00.000Z",
    },
    operators: [
      {
        id: "operator-1",
        name: "Camera 1",
        role: "operator",
        cameraNumber: 1,
        connectionState: "connected",
        muted: false,
        joinedAt: "2026-10-21T09:01:00.000Z",
      },
    ],
  },
  livekit: {
    url: "ws://192.168.1.20:7880",
    room: "MEDIA",
    token: "director-token",
    expiresAt: "2026-10-21T11:00:00.000Z",
  },
};

const roomList: RoomListMessage = {
  type: "room_list",
  rooms: [
    {
      name: "MEDIA",
      status: "open",
      directorPresent: true,
      operatorCount: 0,
      capacity: 11,
    },
  ],
};

function sentMessages(socket: FakeWebSocket): Array<Record<string, unknown>> {
  return socket.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
}

beforeEach(() => {
  FakeWebSocket.instances = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Director room workflow", () => {
  it("creates a named room with the MEDIA default and shows the server snapshot", () => {
    const storage = new MemoryStorage();
    const socket = renderDirector({ storage });
    act(() => {
      socket.open();
      socket.receive(serverInfo);
    });

    expect(screen.getByLabelText("Room name")).toHaveValue("MEDIA");
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    expect(sentMessages(socket)).toContainEqual({
      type: "create_room",
      name: "MEDIA",
    });
    expect(screen.getByText("Creating room…")).toBeInTheDocument();

    act(() => socket.receive(joinedRoom));

    expect(screen.getByRole("heading", { name: "Setup / Mixer - MEDIA" })).toBeInTheDocument();
    expect(screen.getByTestId("endpoint-status")).toHaveTextContent("connected");
    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByRole("button", { name: "End room" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setup - Create a room" })).not.toBeInTheDocument();
    expect(storage.getItem(DIRECTOR_SESSION_STORAGE_KEY)).toBe("session-1");
  });

  it("keeps the form and shows the server's readable duplicate-name error", () => {
    const socket = renderDirector();
    act(() => {
      socket.open();
      socket.receive(serverInfo);
    });

    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    act(() =>
      socket.receive({
        type: "error",
        code: "ROOM_EXISTS",
        message: 'Room "MEDIA" already exists.',
      }),
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      'Room "MEDIA" already exists.',
    );
    expect(screen.getByLabelText("Room name")).toHaveValue("MEDIA");
    expect(screen.getByRole("button", { name: "Create room" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "End room" })).not.toBeInTheDocument();
  });

  it("validates an empty room name before sending it to the server", () => {
    const socket = renderDirector();
    act(() => {
      socket.open();
      socket.receive(serverInfo);
    });

    fireEvent.change(screen.getByLabelText("Room name"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a room name of 1-24 characters.",
    );
    expect(sentMessages(socket).some((message) => message.type === "create_room")).toBe(
      false,
    );
  });

  it("ends the room immediately and returns to setup using the server broadcast", () => {
    const socket = renderDirector();
    act(() => {
      socket.open();
      socket.receive(serverInfo);
      socket.receive(joinedRoom);
    });

    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    fireEvent.click(screen.getByRole("button", { name: "End room" }));
    expect(sentMessages(socket).at(-1)).toEqual({ type: "end_room" });

    act(() =>
      socket.receive({
        type: "room_closed",
        room: "MEDIA",
        reason: "ended_by_director",
      }),
    );

    expect(screen.getByRole("heading", { name: "Setup - Create a room" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Room closed by director");
    expect(screen.queryByRole("button", { name: "End room" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setup / Mixer - MEDIA" })).not.toBeInTheDocument();
  });

  it("resumes with the stored session token and restores the server snapshot", () => {
    const storage = new MemoryStorage();
    storage.setItem(DIRECTOR_SESSION_STORAGE_KEY, "stored-token");
    const socket = renderDirector({ storage });
    act(() => socket.open());

    expect(sentMessages(socket)[0]).toMatchObject({
      type: "hello",
      clientType: "director",
      sessionToken: "stored-token",
    });

    act(() => {
      socket.receive(serverInfo);
      socket.receive(roomList);
    });

    // A room list is not participation: the Director must not invent a room.
    expect(screen.getByRole("heading", { name: "Setup - Create a room" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End room" })).not.toBeInTheDocument();

    act(() => socket.receive(joinedRoom));

    expect(screen.getByRole("heading", { name: "Setup / Mixer - MEDIA" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Live" }));
    expect(screen.getByRole("button", { name: "End room" })).toBeInTheDocument();
  });

  it("does not fabricate room state when a stale session token expires", () => {
    const storage = new MemoryStorage();
    storage.setItem(DIRECTOR_SESSION_STORAGE_KEY, "stale-token");
    const socket = renderDirector({ storage });
    act(() => {
      socket.open();
      socket.receive(serverInfo);
      socket.receive(roomList);
      socket.receive({
        type: "error",
        code: "SESSION_EXPIRED",
        message: "Your session has expired. Join the room again.",
      });
    });

    expect(storage.getItem(DIRECTOR_SESSION_STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Your session has expired.");
    expect(screen.getByRole("heading", { name: "Setup - Create a room" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End room" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Setup / Mixer - MEDIA" })).not.toBeInTheDocument();
  });
});

describe("Director connection", () => {
  it("shows a protocol mismatch as a readable error", () => {
    const socket = renderDirector();
    act(() => {
      socket.open();
      socket.receive({
        type: "error",
        code: "PROTOCOL_MISMATCH",
        message:
          "Protocol mismatch: this server speaks v1, the client speaks v2. Update the app or the server so both use v1.",
      });
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Protocol mismatch");
    expect(screen.getByTestId("connection-status")).toHaveTextContent("error");
  });

  it("shows a reconnecting state instead of silently going quiet", () => {
    const socket = renderDirector();
    act(() => {
      socket.open();
      socket.receive(serverInfo);
      socket.close();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Disconnected");
    expect(screen.getByTestId("connection-status")).toHaveTextContent("reconnecting");
  });

  it("turns open mic on and off from the Director page", async () => {
    const media = new FakeDirectorMedia();
    renderDirector({ media });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn open mic on" }));
    });

    expect(screen.getByTestId("media-status")).toHaveTextContent("on air");
    expect(
      screen.getByRole("button", { name: "Turn open mic off" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn open mic off" }));
    });

    expect(screen.getByTestId("media-status")).toHaveTextContent("ready");
    expect(
      screen.getByRole("button", { name: "Turn open mic on" }),
    ).toBeInTheDocument();
  });

  it("joins Director audio with the named room credentials", async () => {
    const media = new FakeDirectorMedia();
    const socket = renderDirector({ media });

    act(() => {
      socket.open();
      socket.receive(serverInfo);
      socket.receive(joinedRoom);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Turn open mic on" }));
    });

    expect(media.lastCredentials).toEqual(joinedRoom.livekit);
  });
});
