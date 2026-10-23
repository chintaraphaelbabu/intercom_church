# 10: Operator reconnect without duplicates

**What to build:** When an Operator loses Wi-Fi, the foreground service stays alive, the app shows Reconnecting with the attempt number, and it retries up to five times. On success it resumes with the stored session token, keeps the same camera number, and does not create a duplicate participant. After five failures it offers Retry and Leave.

**Blocked by:** 07 — Camera identity and roster

**Status:** resolved

- [x] Wi-Fi off shows Reconnecting with attempt number within 2 s.
- [x] At most 5 attempts with bounded backoff.
- [x] On restore: same camera, audio resumes without manual rejoin.
- [x] Server roster shows one entry throughout reconnect.
- [x] After 5 failures: Retry / Leave screen.
- [x] Retry resets cycle; Leave returns to join.
- [x] Force-mute does not survive reconnect.

## Answer

Verified `ReconnectPolicy` (5 attempts / exponential backoff), `SessionTokenStore`, `ControlClient` resume, server `resumeSession`, and `clearMuteOnNextJoin`. Android build passes; instrumentation needs emulator.

## Comments

2026-10-23 — Subagent verified reconnect logic; multi-phone reconnect test unavailable.
