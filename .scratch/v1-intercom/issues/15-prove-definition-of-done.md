# 15: Prove the Definition of Done

**What to build:** Run the agreed acceptance tests on real hardware and record the results: a two-hour soak at five owned clients, simultaneous talkers on four Android devices and two browsers, a five-minute ten-client load test on borrowed phones, and every failure mode from the design.

**Blocked by:** 14 — Installable release and one-click server

**Status:** partially-done — control-plane load passed (5 min, 10 clients, 0 failures, cap enforced); soak + simultaneous + failure checklist + latency unexecuted due to absent hardware (devices not reachable, borrowed phones unavailable).

- [x] Two-hour soak protocol prepared (`soak.ps1`); execution blocked — `R9BN805K1GJ` not connected.
- [ ] Two-hour soak at five owned clients with locked screens: **PENDING on-site** — no crash/ANR/disconnect evidence yet.
- [ ] Four Android clients and two browser clients transmit simultaneously and hear a stable mix: **PENDING** — requires 6 live endpoints.
- [x] Ten-client load test runs for five minutes on borrowed phones and the room cap is enforced: **EXECUTED** (`load-test-5min-output.txt`; p50 0.6 ms, p95 1.0 ms, p99 1.4 ms, max 1.7 ms, failures 0, `ok: true`, cap verified). Hardware gap: borrowed phones unavailable; control-plane only.
- [ ] Failure checklist passes: **PENDING** — Wi-Fi drop / server restart / headset / room end / mute / director return not injected.
- [ ] Wired and wireless latency, jitter, and packet loss are measured and recorded: **PENDING** — requires active media session + `getStats` / `dumpsys media.audio_flinger` / acoustic loopback.
- [x] Results recorded in repo (`docs/acceptance-results.md`; `docs/acceptance-results/load-test-5min-output.txt`; `load-test-output.txt`).

**Residual hardware gaps (documented in results):** Android devices unreachable via ADB; second tablet / OnePlus not present; borrowed phones unavailable; no headset / acoustic loopback; no second browser/Director session for checklist.

**Answer / evidence:** See `docs/acceptance-results.md`. Control-plane evidence present; audio/hardware evidence must be added at next on-site session (recommended Sunday borrow + connected tablets + laptop Director).
