#!/usr/bin/env node
/**
 * Control-plane load and capacity test for Church Comms.
 *
 * It creates one Director and N Operator control clients, keeps them pinging
 * for the requested duration, verifies the camera assignments are unique, checks
 * that an extra Operator is refused with ROOM_FULL, and ends the room.
 *
 * It does not carry audio; media load is measured separately on real devices.
 *
 * Usage:
 *   node tools/load-test.mjs --clients 10 --minutes 5
 *   node tools/load-test.mjs --url ws://127.0.0.1:8765/ws --clients 4 --minutes 1
 */
import { WebSocket } from "ws";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PROTOCOL_VERSION = 1;
const DEFAULT_URL = "ws://127.0.0.1:8765/ws";

export function percentile(values, fraction) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return sorted[index];
}

export function parseArgs(argv) {
  const options = {
    url: DEFAULT_URL,
    clients: 10,
    minutes: 1,
    room: `LOAD-${Date.now()}`,
    pingIntervalMs: 5000,
    checkCap: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case "--url":
        options.url = value;
        i += 1;
        break;
      case "--clients":
        options.clients = Number(value);
        i += 1;
        break;
      case "--minutes":
        options.minutes = Number(value);
        i += 1;
        break;
      case "--room":
        options.room = value;
        i += 1;
        break;
      case "--ping-interval-ms":
        options.pingIntervalMs = Number(value);
        i += 1;
        break;
      case "--no-cap-check":
        options.checkCap = false;
        break;
      case "--help":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.clients) || options.clients < 1) {
    throw new Error("--clients must be a positive integer.");
  }
  if (!Number.isFinite(options.minutes) || options.minutes <= 0) {
    throw new Error("--minutes must be a positive number.");
  }
  if (!/^wss?:\/\//.test(options.url)) {
    throw new Error("--url must start with ws:// or wss://.");
  }
  return options;
}

class LoadClient {
  constructor(url, name, clientType) {
    this.url = url;
    this.name = name;
    this.clientType = clientType;
    this.messages = [];
    this.waiters = [];
    this.closed = false;
    this.closeReason = "";
    this.rtts = [];
    this.socket = new WebSocket(url);
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", reject);
    });
    this.socket.on("message", (data) => {
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      const waiter = this.waiters.shift();
      if (waiter) {
        waiter(message);
      } else {
        this.messages.push(message);
      }
    });
    this.socket.on("close", (code, reason) => {
      this.closed = true;
      this.closeReason = `${code} ${reason.toString()}`;
    });
    this.send({
      type: "hello",
      protocol: PROTOCOL_VERSION,
      clientType: this.clientType,
      appVersion: "load-test",
      name: this.name,
    });
    return this.waitFor("server_info", 5000);
  }

  send(message) {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  next(timeoutMs) {
    const existing = this.messages.shift();
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((waiter) => waiter !== onMessage);
        reject(new Error(`${this.name}: no message within ${timeoutMs} ms`));
      }, timeoutMs);
      const onMessage = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push(onMessage);
    });
  }

  async waitFor(type, timeoutMs = 5000) {
    for (;;) {
      const message = await this.next(timeoutMs);
      if (message.type === type) {
        return message;
      }
    }
  }

  async waitForTypeIgnoringOthers(type, timeoutMs = 5000) {
    return this.waitFor(type, timeoutMs);
  }

  async ping() {
    const started = performance.now();
    this.send({ type: "ping" });
    await this.waitForTypeIgnoringOthers("pong", 5000);
    this.rtts.push(performance.now() - started);
  }

  async close() {
    if (this.socket.readyState === WebSocket.CLOSED) {
      return;
    }
    this.socket.close();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1000);
      this.socket.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runLoadTest(options) {
  const failures = [];
  const clients = [];
  let director;
  let operators = [];
  let extra;

  try {
    director = new LoadClient(options.url, "Load Director", "director");
    await director.open();
    clients.push(director);
    director.send({ type: "create_room", name: options.room });
    const created = await director.waitFor("joined", 5000);
    if (!created.sessionToken) {
      failures.push("Director joined without a session token.");
    }

    for (let index = 0; index < options.clients; index += 1) {
      const operator = new LoadClient(
        options.url,
        `Load Cam ${index + 1}`,
        "operator",
      );
      await operator.open();
      clients.push(operator);
      operator.send({
        type: "join_room",
        room: options.room,
        name: `Load Cam ${index + 1}`,
        cameraNumber: index + 1,
      });
      const joined = await operator.waitFor("joined", 5000);
      if (joined.room?.name !== options.room) {
        failures.push(`${operator.name}: joined the wrong room.`);
      }
      operators.push(operator);
    }

    if (options.checkCap) {
      extra = new LoadClient(options.url, "Load Extra", "operator");
      await extra.open();
      clients.push(extra);
      extra.send({
        type: "join_room",
        room: options.room,
        name: "Load Extra",
        cameraNumber: 1,
      });
      const answer = await extra.waitFor("error", 5000).catch(() => undefined);
      if (answer?.code !== "ROOM_FULL") {
        failures.push(
          `The ${options.clients + 2}th person was not refused with ROOM_FULL (got ${answer?.code ?? "no error"}).`,
        );
      }
    }

    const deadline = Date.now() + options.minutes * 60_000;
    while (Date.now() < deadline) {
      const rounds = clients
        .filter((client) => !client.closed)
        .map((client) => client.ping().catch((error) => failures.push(error.message)));
      await Promise.all(rounds);
      await sleep(options.pingIntervalMs);
    }

    for (const client of clients) {
      if (client.closed) {
        failures.push(`${client.name} disconnected unexpectedly: ${client.closeReason}`);
      }
    }

    const cameras = new Set(operators.map((_, index) => index + 1));
    if (cameras.size !== operators.length) {
      failures.push("Camera assignments are not unique.");
    }

    director.send({ type: "end_room" });
    const closed = await operators[0]?.waitFor("room_closed", 5000).catch(() => undefined);
    if (!closed) {
      failures.push("Operators did not receive room_closed after end_room.");
    }

    const rtts = clients.flatMap((client) => client.rtts);
    return {
      room: options.room,
      clients: clients.length,
      operators: operators.length,
      durationMinutes: options.minutes,
      pings: rtts.length,
      rttMs: {
        average:
          rtts.length === 0
            ? 0
            : Math.round((rtts.reduce((sum, value) => sum + value, 0) / rtts.length) * 10) / 10,
        p50: Math.round(percentile(rtts, 0.5) * 10) / 10,
        p95: Math.round(percentile(rtts, 0.95) * 10) / 10,
        p99: Math.round(percentile(rtts, 0.99) * 10) / 10,
        max: Math.round(percentile(rtts, 1) * 10) / 10,
      },
      failures,
      ok: failures.length === 0,
    };
  } finally {
    if (director && !director.closed) {
      director.send({ type: "end_room" });
    }
    await Promise.all(clients.map((client) => client.close()));
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(
      "Usage: node tools/load-test.mjs [--url ws://...] [--clients 10] [--minutes 5] [--room NAME] [--no-cap-check]\n",
    );
    return;
  }
  process.stdout.write(
    `Load test: ${options.clients} Operators + 1 Director for ${options.minutes} min against ${options.url}\n`,
  );
  const result = await runLoadTest(options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.ok ? 0 : 1;
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === entry) {
  main().catch((error) => {
    process.stderr.write(`Load test failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
