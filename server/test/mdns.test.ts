import { afterEach, describe, expect, it } from "vitest";
import { Bonjour } from "bonjour-service";
import { advertise, type MdnsAdvertisement } from "../src/mdns.js";
import type { Logger } from "../src/logger.js";

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const runMdns = process.env.RUN_MDNS_TEST === "1";

describe.skipIf(!runMdns)("mDNS advertisement", () => {
  let advertisement: MdnsAdvertisement | undefined;
  let bonjour: Bonjour | undefined;

  afterEach(async () => {
    await advertisement?.stop();
    advertisement = undefined;
    bonjour?.destroy();
    bonjour = undefined;
  });

  it("is discoverable as _church-comms._tcp with the v1 TXT contract", async () => {
    const port = 18765;
    advertisement = await advertise({
      serviceName: "Church Comms mDNS test",
      port,
      livekitUrl: "ws://192.168.1.20:7880",
      roomCount: 0,
      logger,
    });

    bonjour = new Bonjour();
    const browser = bonjour.find({ type: "church-comms" });

    const service = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("mDNS service was not discovered within 10 seconds")),
        10_000,
      );
      browser.on("up", (found: unknown) => {
        const typed = found as { name?: string; port?: number; txt?: Record<string, string> };
        if (typed.name === "Church Comms mDNS test") {
          clearTimeout(timer);
          resolve(found as Record<string, unknown>);
        }
      });
    });

    expect(service.port).toBe(port);
    expect(service.txt).toMatchObject({
      proto: "1",
      path: "/ws",
      livekit: "ws://192.168.1.20:7880",
      roomcount: "0",
      name: "Church Comms mDNS test",
    });
  }, 15_000);
});
