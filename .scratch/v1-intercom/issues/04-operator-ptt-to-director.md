# 04: Operator PTT reaches the Director

**What to build:** The Operator holds the on-screen PTT, transmits, and releases to stop. The Director hears the Operator while still being heard. Press gives a brief vibration and a visible transmitting state; release returns to listening. There are no dialogs.

**Blocked by:** 02 — The Director's voice reaches the Operator's phone

**Status:** ready-for-agent

- [ ] Audio reaches the Director within 300 ms of press and stops within 300 ms of release.
- [ ] The Operator hears other participants while holding PTT.
- [ ] Haptic and visible state on press and release.
- [ ] No confirmation dialog during PTT.
- [ ] Twenty press/release cycles do not renegotiate the connection or leak tracks.
- [ ] Releasing always stops transmission, including when the touch leaves the control.
