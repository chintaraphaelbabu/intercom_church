# 11: Headset unplug and audio focus

**What to build:** Losing the headset mid-session stops output and asks the Operator what to do; the app never silently switches to the speaker. Reconnecting the headset resumes audio, an explicit speaker choice lasts only for the session, other media ducks on join and restores on leave, and the active route is visible in diagnostics.

**Blocked by:** 03 — Pocket audio: locked screen and foreground service; 04 — Operator PTT reaches the Director

**Status:** ready-for-agent

- [ ] Unplugging the headset mid-session stops output and shows a prompt; the speaker is not used automatically.
- [ ] Reconnecting the headset resumes output.
- [ ] Choosing speaker is explicit and applies only to the current session.
- [ ] Other media ducks on join and restores normal behaviour on leave.
- [ ] The active input and output routes are visible in diagnostics.
- [ ] Bluetooth connect and disconnect do not crash the app or leave it silent without explanation.
