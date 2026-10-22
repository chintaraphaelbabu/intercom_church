import { afterEach, describe, expect, it } from "vitest";
import {
  createChurchCommsServer,
  type ChurchCommsServer,
} from "../src/server.js";
import { TestClient } from "./support/test-client.js";

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

async function createRoom(server: ChurchCommsServer, name = "MEDIA") {
  const director = await TestClient.connect(server.port());
  director.hello({ clientType: "director", name: "Director" });
  await director.nextOfType("server_info");
  director.send({ type: "create_room", name });
  const joined = await director.nextOfType("joined");
  return { director, joined };
}

async function joinOperator(
  server: ChurchCommsServer,
  room = "MEDIA",
  name = "Camera 1",
  cameraNumber = 1,
) {
  const operator = await TestClient.connect(server.port());
  operator.hello({ clientType: "operator", name });
  await operator.nextOfType("server_info");
  operator.send({ type: "join_room", room, name, cameraNumber });
  const joined = await operator.nextOfType("joined");
  return { operator, joined };
}

async function requestToken(
  server: ChurchCommsServer,
  body: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${server.url()}/api/livekit-token`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("LiveKit token endpoint", () => {
  it("mints the Director a publishing token for the named room", async () => {
    const server = await startServer();
    const { joined } = await createRoom(server, "MEDIA");

    const response = await requestToken(server, {
      identity: joined.participantId,
      name: "Director",
      role: "director",
      room: "MEDIA",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      url: string;
      room: string;
      token: string;
    };
    expect(body).toMatchObject({
      url: "ws://192.168.137.1:7880",
      room: "MEDIA",
    });

    const claims = tokenClaims(body.token);
    expect(claims).toMatchObject({
      iss: "test-key",
      sub: joined.participantId,
      name: "Director",
      video: {
        room: "MEDIA",
        roomJoin: true,
        canSubscribe: true,
        canPublish: true,
      },
    });
    expect((claims.video as Record<string, unknown>).canPublishSources).toBeUndefined();
  });

  it("mints an Operator a token that publishes only their microphone", async () => {
    const server = await startServer();
    await createRoom(server, "MEDIA");
    const { joined } = await joinOperator(server, "MEDIA", "Camera 1", 1);

    const response = await requestToken(server, {
      identity: joined.participantId,
      name: "Camera 1",
      role: "operator",
      room: "MEDIA",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { room: string; token: string };
    expect(body.room).toBe("MEDIA");
    expect(tokenClaims(body.token)).toMatchObject({
      sub: joined.participantId,
      video: {
        room: "MEDIA",
        roomJoin: true,
        canSubscribe: true,
        canPublish: true,
        canPublishSources: ["microphone"],
      },
    });
  });

  it("defaults to the participant's room when the request omits it", async () => {
    const server = await startServer();
    await createRoom(server, "MEDIA");
    const { joined } = await joinOperator(server, "MEDIA", "Camera 1", 1);

    const response = await requestToken(server, {
      identity: joined.participantId,
      name: "Camera 1",
      role: "operator",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ room: "MEDIA" });
  });

  it("refuses a token for a different room than the participant is in", async () => {
    const server = await startServer();
    await createRoom(server, "MEDIA");
    await createRoom(server, "SECURITY");
    const { joined } = await joinOperator(server, "MEDIA", "Camera 1", 1);

    const response = await requestToken(server, {
      identity: joined.participantId,
      name: "Camera 1",
      role: "operator",
      room: "SECURITY",
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/not a participant/i),
    });
  });

  it("refuses a role that does not match the participant", async () => {
    const server = await startServer();
    await createRoom(server, "MEDIA");
    const { joined } = await joinOperator(server, "MEDIA", "Camera 1", 1);

    const response = await requestToken(server, {
      identity: joined.participantId,
      name: "Camera 1",
      role: "director",
      room: "MEDIA",
    });

    expect(response.status).toBe(403);
  });

  it("refuses an identity that is not an active participant", async () => {
    const server = await startServer();
    await createRoom(server, "MEDIA");

    const response = await requestToken(server, {
      identity: "mallory",
      name: "Mallory",
      role: "operator",
      room: "MEDIA",
    });

    expect(response.status).toBe(403);
  });

  it("rejects a token request with no identity", async () => {
    const server = await startServer();

    const response = await requestToken(server, {
      name: "Unnamed",
      role: "operator",
      room: "MEDIA",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("identity"),
    });
  });

  it("rejects an invalid room name", async () => {
    const server = await startServer();

    const response = await requestToken(server, {
      identity: "someone",
      name: "Someone",
      role: "operator",
      room: "x".repeat(25),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringMatching(/room/i),
    });
  });
});
