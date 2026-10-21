import { spawn } from "node:child_process";

/**
 * Starts a detached watchdog that kills the launcher's children when the
 * launcher process disappears without running its exit handlers.
 *
 * Closing a console window can terminate Node without `exit` or signal handlers.
 * The watchdog polls the parent PID and uses `taskkill /T /F` on Windows, so the
 * ports do not stay open after the launcher window is gone.
 */
export function startWatchdog(children, log = () => undefined) {
  if (process.platform !== "win32") {
    return;
  }
  const childPids = children
    .map((child) => child.pid)
    .filter((pid) => typeof pid === "number");
  if (childPids.length === 0) {
    return;
  }

  const script = `
    const { spawnSync } = require("node:child_process");
    const parent = Number(process.env.CHURCH_PARENT_PID);
    const pids = String(process.env.CHURCH_CHILD_PIDS || "")
      .split(",")
      .map(Number)
      .filter(Boolean);
    const alive = (pid) => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    };
    const timer = setInterval(() => {
      if (alive(parent)) {
        if (!pids.some(alive)) {
          clearInterval(timer);
          process.exit(0);
        }
        return;
      }
      for (const pid of pids) {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      }
      clearInterval(timer);
      process.exit(0);
    }, 1000);
  `;

  try {
    const watchdog = spawn(process.execPath, ["-e", script], {
      env: {
        ...process.env,
        CHURCH_PARENT_PID: String(process.pid),
        CHURCH_CHILD_PIDS: childPids.join(","),
      },
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    watchdog.unref();
    return watchdog;
  } catch (error) {
    log(`Could not start the shutdown watchdog: ${error.message}`);
    return undefined;
  }
}
