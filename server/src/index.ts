import { PROTOCOL_VERSION } from "@church-comms/protocol";
import { DEFAULT_PORT, resolveConfig } from "./config.js";
import { lanAddresses } from "./lan.js";
import { consoleLogger } from "./logger.js";
import { createChurchCommsServer } from "./server.js";

function envPort(): number | undefined {
  const raw = process.env.PORT;
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 65535) {
    throw new Error(`PORT must be an integer between 0 and 65535, got "${raw}".`);
  }
  return value;
}

async function main(): Promise<void> {
  const port = envPort() ?? DEFAULT_PORT;
  const config = resolveConfig({
    port,
    serverName: process.env.SERVER_NAME,
    livekitUrl: process.env.LIVEKIT_URL,
    webDist: process.env.WEB_DIST,
    advertiseMdns: process.env.MDNS !== "0",
    logger: consoleLogger,
  });

  const server = createChurchCommsServer({
    port: config.port,
    serverName: config.serverName,
    livekitUrl: config.livekitUrl,
    webDist: config.webDist,
    advertiseMdns: config.advertiseMdns,
    logger: config.logger,
  });

  try {
    await server.start();
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "EADDRINUSE"
    ) {
      console.error(
        `Port ${port} is already in use. Close the other Church Comms server or set PORT to a free port.`,
      );
    } else {
      console.error("Church Comms control server failed to start:", error);
    }
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("Church Production Comms");
  console.log(`  Protocol      v${PROTOCOL_VERSION}`);
  console.log(`  Server        ${config.serverName} (${config.serverId})`);
  console.log(`  Director page http://localhost:${server.port()}/`);
  for (const address of lanAddresses()) {
    console.log(`  LAN           http://${address}:${server.port()}/`);
  }
  console.log(`  Control       ws://<laptop>:${server.port()}/ws`);
  console.log(`  LiveKit       ${config.livekitUrl}`);
  console.log("");
  console.log("Press Ctrl+C to stop. Rooms are in memory and do not survive a restart.");
  console.log("");

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    console.log(`\nReceived ${signal}. Stopping Church Comms...`);
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

await main();
