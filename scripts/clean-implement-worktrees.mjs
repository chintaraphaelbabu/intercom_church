import { rm, stat, readdir } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), "..");

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
const now = Date.now();

(async () => {
  const targets = [
    path.join(repoRoot, "opencode", "v1-worktrees"),
    path.join(process.env.HOME || process.env.USERPROFILE || "", "opencode", "v1-worktrees"),
    "C:\\Users\\Raphael\\AppData\\Local\\Temp\\opencode\\v1-worktrees",
    path.join(repoRoot, "..", "opencode", "v1-worktrees"),
  ];

  const dirsToRemove = [];
  for (const t of targets) {
    try {
      const entries = await readdir(t, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const full = path.join(t, e.name);
          try {
            const s = await stat(full);
            if (now - s.mtimeMs > SEVEN_DAYS) {
              dirsToRemove.push(full);
            }
          } catch {
            // skip unreadable
          }
        }
      }
    } catch {
      // missing target dir
    }
  }

  for (const d of dirsToRemove) {
    try {
      await rm(d, { recursive: true, force: true });
      console.log("Removed old worktree: " + d);
    } catch (e) {
      console.error("Failed to remove " + d + ": " + e.message);
    }
  }

  try {
    execSync("git worktree prune", { cwd: repoRoot, stdio: "inherit" });
    console.log("Pruned stale git worktrees.");
  } catch (e) {
    console.error("git worktree prune failed: " + e.message);
  }
})();
