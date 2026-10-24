# 02: Master volume slider and session reset

**What to build:** A master volume slider in the Director Setup/Mixer (and optionally Live) controls the overall mix independently of per-participant volumes. Volumes reset to defaults on each new session/connect (`docs/design.md` line 47, 79; issue 05 checklist).

**Blocked by:** 01 — Per-operator volume and level meters in Director Setup/Mixer (needs the volume framework)

**Status:** ready-for-agent

- [ ] Master volume slider present in Setup/Mixer and affects all participants.
- [ ] Master volume is independent of per-operator volumes.
- [ ] Master and per-participant volumes reset on a new session start (`media.connect`).
