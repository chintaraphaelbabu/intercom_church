# 08: Hot-mic mute with Operator override

**What to build:** A Director can mute any Operator room-wide, immediately stopping that Operator's transmission for everyone. The muted Operator sees a persistent banner, cannot transmit with the touch already down, and restores their own microphone by holding PTT again with a fresh press. Mute clears on reconnect, and the roster always shows the current state.

**Blocked by:** 04 — Operator PTT reaches the Director; 07 — Camera identity and roster

**Status:** ready-for-agent

- [ ] Muting an Operator mid-transmission stops their audio for every participant immediately.
- [ ] The muted Operator sees "Mic disabled by director" and a visibly disabled PTT.
- [ ] The touch in progress when mute lands does not unmute; a fresh press does and transmits.
- [ ] The Director roster shows muted and unmuted states.
- [ ] Reconnecting clears the mute.
- [ ] Only the Director can mute others; an Operator cannot mute another participant.
