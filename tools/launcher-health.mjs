/**
 * Pure helpers for the launcher's keep-awake decision and log naming.
 *
 * Kept separate from launch.mjs so the behaviour can be tested without
 * spawning LiveKit or the control server.
 */

/**
 * A room is active when the control server reports at least one room. Rooms
 * in their Director-absence grace period still count: Operators are still
 * talking, so the laptop must not sleep.
 */
export function shouldKeepAwake(health) {
  if (health === null || typeof health !== "object") {
    return false;
  }
  if (typeof health.rooms !== "number" || !Number.isFinite(health.rooms)) {
    return false;
  }
  return health.rooms > 0;
}

/** Parse a health response without trusting its shape. */
export function parseHealth(value) {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  if (typeof value.rooms !== "number") {
    return undefined;
  }
  return value;
}

/** Stable, filesystem-safe log name for one launcher run. */
export function logFileName(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `church-comms-${stamp}.log`;
}
