# 13: Director Setup/Live views and diagnostics

**What to build:** The Director gets a Setup/Mixer view for creating the Room, balancing voices, and checking the headset, and a Live view with the open-mic toggle, per-Operator mute buttons, server health, and End room. Diagnostics report the real signals without cluttering the live screen.

**Blocked by:** 05 — Whole room at once, with volumes; 07 — Camera identity and roster; 08 — Hot-mic mute with Operator override; 09 — Director absence: countdown, grace, close; 11 — Headset unplug and audio focus

**Status:** ready-for-agent

- [ ] Setup/Mixer supports creating a Room, roster, per-Operator volume and levels, mute buttons, and a headset check.
- [ ] Live view keeps the open-mic toggle, per-Operator mute buttons, room name, server health, and End room.
- [ ] Switching views preserves audio and state.
- [ ] Diagnostics show Wi-Fi, IP, discovery, control connection, LiveKit state, round-trip latency, jitter, packet loss, input and output route, and server health.
- [ ] No raw diagnostics appear on Live view.
- [ ] Server health distinguishes running, room active, and degraded.
