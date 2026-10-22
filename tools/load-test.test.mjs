import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, percentile } from "./load-test.mjs";

test("percentiles use nearest-rank and tolerate empty input", () => {
  assert.equal(percentile([], 0.95), 0);
  assert.equal(percentile([5], 0.5), 5);
  assert.equal(percentile([1, 2, 3, 4, 100], 0.5), 3);
  assert.equal(percentile([1, 2, 3, 4, 100], 0.95), 100);
});

test("load-test arguments have safe defaults", () => {
  const options = parseArgs([]);
  assert.equal(options.clients, 10);
  assert.equal(options.minutes, 1);
  assert.equal(options.checkCap, true);
  assert.equal(options.url, "ws://127.0.0.1:8765/ws");
});

test("load-test arguments reject nonsense", () => {
  assert.throws(() => parseArgs(["--clients", "0"]));
  assert.throws(() => parseArgs(["--minutes", "-1"]));
  assert.throws(() => parseArgs(["--url", "http://localhost"]));
  assert.throws(() => parseArgs(["--wat"]));
  assert.equal(parseArgs(["--clients", "4", "--minutes", "2"]).clients, 4);
});
