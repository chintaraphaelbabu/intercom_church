# 04: Real diagnostic signals instead of hardcoded estimates

**What to build:** The Director Diagnostics screen (`App.tsx` line 288-299) replaces hardcoded latency (~120 ms), jitter (~5 ms), and packet loss (~0%) with real values from the LiveKit/media layer (`mediaState`). Keeps server health (`state.health`) and connection phase accurate.

**Blocked by:** 01 — Per-operator volume and level meters in Director Setup/Mixer (needs real audio-level signal path)

**Status:** ready-for-agent

- [ ] Latency, jitter, and packet loss reflect measured/live values, not static strings.
- [ ] No raw clutter appears on Live view; diagnostics remain on the separate Diagnostics screen.
- [ ] Every diagnostic row maps to a real signal (`mediaState` or server health).
