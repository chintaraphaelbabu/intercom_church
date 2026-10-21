import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type DebugRosterMessage,
  type ErrorMessage,
  type ServerInfoMessage,
} from "@church-comms/protocol";

const fixturesDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../protocol/fixtures",
);

async function fixture<T>(name: string): Promise<T> {
  return JSON.parse(await readFile(path.join(fixturesDir, name), "utf8")) as T;
}

describe("protocol fixtures", () => {
  it("accepts the shared hello fixture", async () => {
    const result = parseClientMessage(JSON.stringify(await fixture("hello.json")));
    expect(result).toMatchObject({
      ok: true,
      value: {
        type: "hello",
        protocol: PROTOCOL_VERSION,
        clientType: "operator",
        name: "Camera 1",
      },
    });
  });

  it("accepts the shared ping fixture", async () => {
    const result = parseClientMessage(JSON.stringify(await fixture("ping.json")));
    expect(result).toEqual({ ok: true, value: { type: "ping" } });
  });

  it("describes server_info, roster and error fixtures that match v1", async () => {
    const info = await fixture<ServerInfoMessage>("server_info.json");
    expect(info).toMatchObject({
      type: "server_info",
      protocol: PROTOCOL_VERSION,
    });

    const roster = await fixture<DebugRosterMessage>("debug_roster.json");
    expect(roster.type).toBe("debug_roster");
    expect(roster.clients.length).toBeGreaterThan(0);
    for (const client of roster.clients) {
      expect(["director", "operator", "debug"]).toContain(client.clientType);
      expect(Number.isNaN(Date.parse(client.connectedAt))).toBe(false);
    }

    const error = await fixture<ErrorMessage>("error_protocol_mismatch.json");
    expect(error).toMatchObject({
      type: "error",
      code: "PROTOCOL_MISMATCH",
    });
    expect(error.message).toContain("v1");
  });
});
