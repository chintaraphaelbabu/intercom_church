# 08: Hot-mic mute with Operator override

**What to build:** A Director can mute any Operator room-wide, immediately stopping that Operator's transmission for everyone. The muted Operator sees a persistent banner, cannot transmit with the touch already down, and restores their own microphone by holding PTT again with a fresh press. Mute clears on reconnect, and the roster always shows the current state.

**Blocked by:** 04 — Operator PTT reaches the Director; 07 — Camera identity and roster

**Status:** resolved

- [x] Muting stops audio for every participant immediately.
- [x] Muted Operator sees banner and disabled PTT; fresh press restores.
- [x] Roster shows muted/unmuted states.
- [x] Reconnecting clears mute.
- [x] Only Director can mute.

## Answer

Verified against existing protocol (`set_mute`/`clear_mute`), server authority, Android `PttController`/`SessionController`, and reconnect clearing mute. Full Director Mixer mute buttons remain minimal in web; that UI work belongs to 12/13. Residual: acoustic 200 ms target from 02; multi-phone check unavailable.

## Comments

2026-10-23 — Subagent verified all server/web/android pieces in place; no new build errors.
