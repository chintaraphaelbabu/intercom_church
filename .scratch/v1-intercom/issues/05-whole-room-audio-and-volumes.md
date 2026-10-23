# 05: The whole room talks at once, with per-person volumes

**What to build:** Four participants transmit at the same time and everyone hears a stable mix. Each client has a Mixer view with per-participant and master volumes, level meters, and volumes reset when a new session starts. Includes two browser test participants so multi-party behaviour can be exercised without extra phones.

**Blocked by:** 03 — Pocket audio: locked screen and foreground service; 04 — Operator PTT reaches the Director

**Status:** resolved

- [ ] Two phones and two browser test participants transmit simultaneously; each hears the other three.
- [ ] Per-participant volume changes take effect locally within 200 ms.
- [ ] Master volume is independent of per-participant volumes.
- [ ] Volumes reset on a new join or session.
- [ ] Level meters reflect who is speaking.
- [ ] Ten minutes of four-way conversation with no crash or unplanned disconnect.
