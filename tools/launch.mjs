#!/usr/bin/env node
/**
 * One-click launcher for the Director's laptop.
 *
 * Starts the pinned LiveKit server and the Church Comms control server, waits
 * for the Director page to answer, then opens it. Closing this console (or
 * Ctrl+C) stops both child processes.
 *
 * LiveKit is downloaded once into tools/livekit/; the build artifacts are
 * produced on first run if they are missing.
 */
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { parseHealth, logFileName, shouldKeepAwake } from "./launcher-health.mjs";
import { startWatchdog } from "./launcher-processes.mjs";

const LIVEKIT_VERSION = "1.13.10";
const LIVEKIT_ZIP = `livekit_${LIVEKIT_VERSION}_windows_amd64.zip`;
const LIVEKIT_URL =
  `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/${LIVEKIT_ZIP}`;
const LIVEKIT_SHA256 =
  "FD4B7C2C3C1E4C71ADAA4F6A046AD1C0ABAAAF1E09FAE904B35BF231FFAE11D2";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const livekitDir = path.join(here, "livekit");
const livekitExe = path.join(livekitDir, "livekit-server.exe");
const controlEntry = path.join(root, "server", "dist", "index.js");
const webIndex = path.join(root, "server", "web-dist", "index.html");
const controlUrl = "http://127.0.0.1:8765/";
const healthUrl = `${controlUrl}api/health`;
const livekitPort = 7880;
const logDir = path.join(root, "logs");
const firewallScript = path.join(here, "firewall.ps1");
const keepAwakeScript = path.join(here, "keep-awake.ps1");
const keepAwakeFlag = path.join(os.tmpdir(), `church-comms-keep-awake-${process.pid}.flag`);

const children = [];
let shuttingDown = false;
let logStream;
let keepAwakeChild;
let healthTimer;
let keepAwakeActive = false;

mkdirSync(logDir, { recursive: true });
const logPath = path.join(logDir, logFileName());
logStream = createWriteStream(logPath, { flags: "a" });

function log(message) {
  const line = `${message}\n`;
  process.stdout.write(line);
  logStream.write(line);
}

function writeLogOnly(prefix, message) {
  logStream.write(`${prefix} ${message}\n`);
}

function fail(message) {
  const line = `\nChurch Comms could not start: ${message}`;
  process.stderr.write(`${line}\n`);
  logStream.write(`${line}\n`);
  shutdown(1);
}

function killTree(child) {
  if (child === undefined || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  child.kill("SIGTERM");
}

function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  if (healthTimer !== undefined) {
    clearInterval(healthTimer);
  }
  stopKeepAwake();
  for (const child of children) {
    killTree(child);
  }
  log(`Launcher stopped. Log: ${logPath}`);
  logStream.end();
  process.exit(exitCode);
}

function pipeOutput(stream, prefix) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      writeLogOnly(prefix, line);
      process.stdout.write(`${prefix} ${line}\n`);
    }
  });
  stream.on("end", () => {
    if (buffer.length > 0) {
      writeLogOnly(prefix, buffer);
      process.stdout.write(`${prefix} ${buffer}\n`);
    }
  });
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status}`);
  }
}

function ensureBuild() {
  if (existsSync(controlEntry) && existsSync(webIndex)) {
    return;
  }
  log("Building the control server and Director page (first run)...");
  run("npm", ["run", "build"]);
}

async function ensureLiveKit() {
  if (existsSync(livekitExe)) {
    return;
  }

  mkdirSync(livekitDir, { recursive: true });
  const zipPath = path.join(livekitDir, LIVEKIT_ZIP);
  const tmpPath = `${zipPath}.download`;

  log(`Downloading LiveKit ${LIVEKIT_VERSION} (one time)...`);
  const response = await fetch(LIVEKIT_URL);
  if (!response.ok || response.body === null) {
    throw new Error(`LiveKit download failed with HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), createWriteStream(tmpPath));

  const digest = createHash("sha256").update(readFileSync(tmpPath)).digest("hex");
  if (digest.toUpperCase() !== LIVEKIT_SHA256) {
    rmSync(tmpPath, { force: true });
    throw new Error(
      `LiveKit download checksum mismatch: expected ${LIVEKIT_SHA256}, got ${digest.toUpperCase()}`,
    );
  }

  log("Extracting LiveKit...");
  const extract = spawnSync("tar", ["-xf", tmpPath, "-C", livekitDir], {
    stdio: "inherit",
  });
  rmSync(tmpPath, { force: true });
  rmSync(zipPath, { force: true });
  if (extract.status !== 0 || !existsSync(livekitExe)) {
    throw new Error("LiveKit archive did not contain livekit-server.exe");
  }
}

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(500);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const control = children.find((child) => child.churchCommsName === "control");
    if (control !== undefined && control.exitCode !== null) {
      throw new Error(`the control server exited with code ${control.exitCode}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        return;
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`the Director page did not answer at ${url} within 30 seconds`);
}

function openBrowser(url) {
  if (process.platform === "win32") {
    spawn("cmd", ["/c", "start", "", url], {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    }).unref();
    return;
  }
  const opener = process.platform === "darwin" ? "open" : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", detached: true }).unref();
}

function ensureFirewall() {
  if (process.platform !== "win32") {
    return;
  }
  if (!existsSync(firewallScript)) {
    log("Firewall script is missing; skipping firewall rules.");
    return;
  }
  log("Checking Windows Firewall rules...");
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      firewallScript,
      "-Root",
      root,
    ],
    { cwd: root, encoding: "utf8", windowsHide: true },
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (output.length > 0) {
    for (const line of output.split(/\r?\n/)) {
      log(`  ${line}`);
    }
  }
  if (result.status !== 0) {
    log(
      "  Firewall rules were not applied. Media may be blocked. " +
        "Run start-church-comms.bat as administrator once.",
    );
  }
}

function stopKeepAwake() {
  if (keepAwakeChild !== undefined) {
    killTree(keepAwakeChild);
    keepAwakeChild = undefined;
  }
  rmSync(keepAwakeFlag, { force: true });
  if (keepAwakeActive) {
    keepAwakeActive = false;
    log("Room ended: laptop may sleep normally.");
  }
}

function updateKeepAwake(health) {
  const active = shouldKeepAwake(health);
  if (active === keepAwakeActive) {
    return;
  }
  keepAwakeActive = active;
  if (!active) {
    stopKeepAwake();
    return;
  }

  writeFileSync(keepAwakeFlag, "active", "utf8");
  keepAwakeChild = spawn(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      keepAwakeScript,
      "-FlagFile",
      keepAwakeFlag,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  log("Room active: keeping the laptop awake until it ends.");
}

async function pollHealth() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) {
      updateKeepAwake(undefined);
      return;
    }
    updateKeepAwake(parseHealth(await response.json()));
  } catch {
    // The server may be starting or stopping. Do not hold the laptop awake
    // for a server that is not answering.
    updateKeepAwake(undefined);
  }
}

function startHealthPolling() {
  healthTimer = setInterval(() => {
    void pollHealth();
  }, 5000);
  void pollHealth();
}

async function main() {
  if (await portIsOpen(livekitPort)) {
    throw new Error(
      `port ${livekitPort} is already in use. Close the other LiveKit instance and try again.`,
    );
  }
  if (await portIsOpen(8765)) {
    throw new Error(
      "port 8765 is already in use. Close the other Church Comms server and try again.",
    );
  }

  ensureBuild();
  await ensureLiveKit();
  ensureFirewall();

  log("");
  log("Church Production Comms");
  log(`  LiveKit       ${LIVEKIT_VERSION} (dev mode, port ${livekitPort})`);
  log(`  Director page ${controlUrl}`);
  log(`  Log           ${logPath}`);
  log("  Keep this window open. Closing it stops both processes.");
  log("");

  const livekit = spawn(
    livekitExe,
    ["--dev", "--bind", "0.0.0.0"],
    {
      cwd: livekitDir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  livekit.churchCommsName = "livekit";
  children.push(livekit);
  pipeOutput(livekit.stdout, "[livekit]");
  pipeOutput(livekit.stderr, "[livekit]");
  livekit.on("exit", (code, signal) => {
    if (!shuttingDown) {
      log(`\nLiveKit stopped (${signal ?? `exit ${code}`}).`);
      shutdown(code ?? 1);
    }
  });

  const control = spawn(process.execPath, [controlEntry], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  control.churchCommsName = "control";
  children.push(control);
  pipeOutput(control.stdout, "[server]");
  pipeOutput(control.stderr, "[server]");
  control.on("exit", (code, signal) => {
    if (!shuttingDown) {
      log(`\nControl server stopped (${signal ?? `exit ${code}`}).`);
      shutdown(code ?? 1);
    }
  });

  startWatchdog(children, log);

  await waitForHttp(controlUrl, 30_000);
  startHealthPolling();
  if (process.env.CHURCH_COMMS_NO_BROWSER === "1") {
    log(`Director page ready at ${controlUrl} (browser not opened).`);
  } else {
    openBrowser(controlUrl);
    log("Director page opened in the default browser.");
  }
  log("Press Ctrl+C or close this window to stop Church Comms.");
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  process.on(signal, () => {
    log(`\nReceived ${signal}. Stopping Church Comms...`);
    shutdown(0);
  });
}

process.on("exit", () => {
  rmSync(keepAwakeFlag, { force: true });
  for (const child of children) {
    killTree(child);
  }
});

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
