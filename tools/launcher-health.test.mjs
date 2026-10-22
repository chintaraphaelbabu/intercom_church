import assert from "node:assert/strict";
import { test } from "node:test";
import {
  logFileName,
  parseHealth,
  shouldKeepAwake,
} from "./launcher-health.mjs";

test("keep-awake is active only while a room exists", () => {
  assert.equal(shouldKeepAwake({ rooms: 0 }), false);
  assert.equal(shouldKeepAwake({ rooms: 1 }), true);
  assert.equal(shouldKeepAwake({ rooms: 3 }), true);
  assert.equal(shouldKeepAwake(null), false);
  assert.equal(shouldKeepAwake(undefined), false);
  assert.equal(shouldKeepAwake({}), false);
  assert.equal(shouldKeepAwake({ rooms: "1" }), false);
});

test("health parsing ignores malformed bodies", () => {
  assert.deepEqual(parseHealth({ rooms: 2, status: "running" }), {
    rooms: 2,
    status: "running",
  });
  assert.equal(parseHealth({ rooms: "2" }), undefined);
  assert.equal(parseHealth(null), undefined);
  assert.equal(parseHealth("no"), undefined);
});

test("log names are stable and filesystem-safe", () => {
  const name = logFileName(new Date(2026, 9, 22, 9, 5, 7));
  assert.equal(name, "church-comms-20261022-090507.log");
  assert.doesNotMatch(name, /[:/\\]/);
});
