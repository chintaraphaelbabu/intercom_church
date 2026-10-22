import { afterEach, describe, expect, it } from "vitest";
import {
  createChurchCommsServer,
  type ChurchCommsServer,
} from "../src/server.js";

const servers: ChurchCommsServer[] = [];

async function startServer(): Promise<ChurchCommsServer> {
  const server = createChurchCommsServer({
    port: 0,
    advertiseMdns: false,
    livekitUrl: "ws://192.168.137.1:7880",
    livekitApiKey: "test-key",
    livekitApiSecret: "test-secret",
    livekitRoom: "media",
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  });
  await server.start();
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()));
});

function tokenClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (payload === undefined) {
    throw new Error("Token is not a JWT");
  }
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("LiveKit token endpoint", () => {
  it("mints an Operator a join token for the configured room and URL", async () => {
    const server = await startServer();

    const response = await fetch(`${server.url()}/api/livekit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identity: "operator-1",
        name: "SM-T295",
        role: "operator",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      url: string;
      room: string;
      token: string;
    };
    expect(body).toMatchObject({
      url: "ws://192.168.137.1:7880",
      room: "media",
    });

    const claims = tokenClaims(body.token);
    expect(claims).toMatchObject({
      iss: "test-key",
      sub: "operator-1",
      name: "SM-T295",
      video: {
        room: "media",
        roomJoin: true,
        canSubscribe: true,
        canPublish: false,
      },
    });
  });

  it("mints a Director token that can publish", async () => {
    const server = await startServer();

    const response = await fetch(`${server.url()}/api/livekit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        identity: "director",
        name: "Director",
        role: "director",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { token: string };
    const claims = tokenClaims(body.token);
    expect(claims).toMatchObject({
      sub: "director",
      video: {
        room: "media",
        roomJoin: true,
        canSubscribe: true,
        canPublish: true,
      },
    });
  });

  it("rejects a token request with no identity", async () => {
    const server = await startServer();

    const response = await fetch(`${server.url()}/api/livekit-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Unnamed", role: "operator" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("identity"),
    });
  });
});
