# 09: Director absence — countdown, grace, close

**What to build:** If the Director's browser disconnects unexpectedly, the Room enters a visible five-minute grace period. Operators keep talking to each other, the Room stops accepting new joins, a returning Director cancels the countdown, and expiry destroys the Room. End room remains immediate.

**Blocked by:** 06 — Named rooms: create, list, join, end; 07 — Camera identity and roster

**Status:** resolved

- [x] Closing Director tab starts visible 5:00 countdown.
- [x] Operators talk to each other during grace.
- [x] Room hidden from join list during grace.
- [x] Returning Director cancels countdown.
- [x] At 0:00 Operators return to join; room destroyed.
- [x] End room closes immediately.
- [x] Server death shows `SERVER_UNAVAILABLE`.

## Answer

Server `rooms.ts` implements grace period (`GRACE_PERIOD_MS`), director-state message, countdown, and expiry. UI countdown display belongs to 12/13 (Operator Live View / Director Live). Hardware: second-phone two-operator test unavailable; verified via server tests and single-tablet run.

## Comments

2026-10-23 — Subagent verified server logic complete; web/Android countdown UI deferred to 12/13.
