import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROTOCOL_VERSION,
  type DebugRosterMessage,
  type ServerInfoMessage,
} from "@church-comms/protocol";
import { App } from "./App";

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

function renderDirector(): FakeWebSocket {
  render(
    <App
      connectionOptions={{
        url: "ws://test.local/ws",
        socketFactory: () => {
          const socket = new FakeWebSocket("ws://test.local/ws");
          return socket as unknown as WebSocket;
        },
      }}
    />,
  );
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) {
    throw new Error("App did not open a WebSocket");
  }
  return socket;
}

const serverInfo: ServerInfoMessage = {
  type: "server_info",
  protocol: PROTOCOL_VERSION,
  serverId: "test-server",
  livekitUrl: "ws://192.168.1.20:7880",
  serverTime: "2026-10-21T09:00:00.000Z",
};

const roster: DebugRosterMessage = {
  type: "debug_roster",
  clients: [
    {
      id: "director-1",
      name: "Director",
      clientType: "director",
      appVersion: "0.1.0",
      connectedAt: "2026-10-21T09:00:00.000Z",
    },
    {
      id: "camera-1",
      name: "Camera 1",
      clientType: "operator",
      appVersion: "0.1.0",
      connectedAt: "2026-10-21T09:00:05.000Z",
    },
  ],
};

beforeEach(() => {
  FakeWebSocket.instances = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Director app", () => {
  it("sends a v1 director hello, then shows server info and the live roster", () => {
    const socket = renderDirector();
    expect(screen.getByTestId("connection-status")).toHaveTextContent("connecting");

    act(() => socket.open());

    expect(JSON.parse(socket.sent[0] ?? "{}")).toMatchObject({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      clientType: "director",
      name: "Director",
    });

    act(() => {
      socket.receive(serverInfo);
      socket.receive(roster);
    });

    expect(screen.getByTestId("protocol-version")).toHaveTextContent("v1");
    expect(screen.getByTestId("connection-status")).toHaveTextContent("connected");
    expect(screen.getByText("test-server")).toBeInTheDocument();
    expect(screen.getByText("ws://192.168.1.20:7880")).toBeInTheDocument();

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("Camera 1")).toBeInTheDocument();
    expect(screen.getByText("Operator")).toBeInTheDocument();
    expect(screen.getByText("Director", { selector: ".chip" })).toBeInTheDocument();
  });

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

  it("explains an empty roster while connected", () => {
    const socket = renderDirector();
    act(() => {
      socket.open();
      socket.receive(serverInfo);
      socket.receive({ type: "debug_roster", clients: [] });
    });

    expect(screen.getByText("No clients connected yet.")).toBeInTheDocument();
  });

  it("shows a disconnected state instead of silently going quiet", () => {
    const socket = renderDirector();
    act(() => {
      socket.open();
      socket.receive(serverInfo);
      socket.close();
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Disconnected");
    expect(screen.getByTestId("connection-status")).toHaveTextContent("disconnected");
  });
});
