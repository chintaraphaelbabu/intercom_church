import { spawn } from "node:child_process";
import { startWatchdog } from "../launcher-processes.mjs";

const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  stdio: "ignore",
  windowsHide: true,
});
if (child.pid === undefined) {
  throw new Error("fake child did not start");
}

process.stdout.write(`${child.pid}\n`);
startWatchdog([child]);

setInterval(() => {}, 1000);
