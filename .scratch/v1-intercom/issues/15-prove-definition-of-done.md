# 15: Prove the Definition of Done

**What to build:** Run the agreed acceptance tests on real hardware and record the results: a two-hour soak at five owned clients, simultaneous talkers on four Android devices and two browsers, a five-minute ten-client load test on borrowed phones, and every failure mode from the design.

**Blocked by:** 14 — Installable release and one-click server

**Status:** ready-for-agent

- [ ] Two-hour soak at five owned clients with locked screens: no crash, no ANR, no unplanned disconnect.
- [ ] Four Android clients and two browser clients transmit simultaneously and hear a stable mix.
- [ ] Ten-client load test runs for five minutes on borrowed phones and the room cap is enforced.
- [ ] Failure checklist passes: Wi-Fi drop, server restart, headset unplug, room end, mute and override, Director return before expiry, Director return after expiry.
- [ ] Wired and wireless latency, jitter, and packet loss are measured and recorded.
- [ ] Results are recorded in the repo.
