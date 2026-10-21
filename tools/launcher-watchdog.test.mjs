import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const launcherFixture = path.join(here, "test-fixtures", "watchdog-launcher.mjs");

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readChildPid(launcher) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => {
      reject(new Error(`launcher did not report a child PID: ${output}`));
    }, 5000);

    const finish = () => {
      clearTimeout(timer);
      launcher.stdout.off("data", onData);
      launcher.off("exit", onExit);
    };
    const onData = (chunk) => {
      output += chunk;
      const pid = Number(output.split(/\r?\n/, 1)[0]);
      if (Number.isInteger(pid) && pid > 0) {
        finish();
        resolve(pid);
      }
    };
    const onExit = (code) => {
      finish();
      reject(new Error(`launcher exited with ${code} before reporting a child PID: ${output}`));
    };

    launcher.stdout.setEncoding("utf8");
    launcher.stdout.on("data", onData);
    launcher.once("exit", onExit);
  });
}

async function waitForDead(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`child ${pid} was still alive after ${timeoutMs} ms`);
}

test(
  "watchdog kills children after the launcher is hard-killed",
  { skip: process.platform !== "win32", timeout: 20_000 },
  async (t) => {
    const launcher = spawn(process.execPath, [launcherFixture], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    t.after(() => {
      if (launcher.exitCode === null && launcher.signalCode === null) {
        launcher.kill();
      }
    });

    const childPid = await readChildPid(launcher);
    t.after(() => {
      if (isAlive(childPid)) {
        try {
          process.kill(childPid);
        } catch {
          // Already gone.
        }
      }
    });

    assert.equal(isAlive(childPid), true, "fake child should be running before the launcher dies");

    // Let the detached watchdog finish starting before simulating the hard close.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    assert.equal(isAlive(childPid), true, "watchdog should leave children alone while the launcher is alive");

    const launcherClosed = once(launcher, "close");
    launcher.kill();
    await launcherClosed;

    await waitForDead(childPid, 10_000);
    assert.equal(isAlive(childPid), false);
  },
);
