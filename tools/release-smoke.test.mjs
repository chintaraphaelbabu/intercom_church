import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

test("release APK passes 16 KB alignment", () => {
  const apk = path.resolve(__dirname, "../android/app/build/outputs/apk/release/app-release.apk");
  assert.ok(existsSync(apk), "signed APK exists");
  // zipalign is available in the Android SDK build-tools
  const sdk = process.env.ANDROID_HOME || "C:\\Users\\Raphael\\AppData\\Local\\Android\\Sdk";
  // Find the newest build-tools directory with zipalign
  const toolsDir = path.join(sdk, "build-tools");
  const dirs = readdirSync(toolsDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
  const zipalign = path.join(toolsDir, dirs[0].name, "zipalign.exe");
  assert.ok(existsSync(zipalign), "zipalign available");
  const out = execSync(`"${zipalign}" -c -P 16 -v 4 "${apk}"`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  assert.ok(out.includes("Verification successful"), "APK is 16 KB aligned");
});

test("launcher and firewall scripts exist", () => {
  assert.ok(existsSync(path.join(__dirname, "launch.mjs")));
  assert.ok(existsSync(path.join(__dirname, "firewall.ps1")));
  assert.ok(existsSync(path.join(__dirname, "keep-awake.ps1")));
  assert.ok(existsSync(path.join(__dirname, "build-release-apk.ps1")));
});
