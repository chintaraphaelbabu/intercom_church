# Mixer volume slider check — 2026-10-23

Files: `android/app/src/main/java/com/churchcomms/operator/ui/MixerScreen.kt`, `web/src/media.ts`

## Android MixerScreen (`RosterVolumeRow`)
- Slider `value = 0.75f` hardcoded, `onValueChange = {}` no-op (line 91).
- No per-participant volume param in row (only `name`, `camera`, `muted`).
- No master volume slider in Mixer view (LiveScreen also broken: `value = 1f`, `onValueChange = {}` line 77).
- `OperatorActions` lacks any volume/setVolume/volumeChange method — wire missing at actions layer too.
- No reset-on-session logic visible in MixerScreen; `web/src/media.ts` resets `masterVolume: 100, participants: []` on `connect()` and `disconnect()` (lines 162, 249-256) and has `setParticipantVolume`/`setMasterVolume` + `applyVolumes()` — web layer is functional, Android UI not wired to it.
- Comparison to LiveScreen slider: identical static pattern (hardcoded value, empty lambda).

## Conclusion
Broken — not cosmetic; slider is non-interactive and not connected to per-participant or master volume. No 1-line fix possible because `RosterVolumeRow` needs volume state + action + master slider; actions layer missing volume intents entirely. Document only; do not invent fix.

## Proposed minimal (not applied)
- Add `volume: Float` to `RosterVolumeRow`, pass from `op`; wire `onValueChange` to new `setParticipantVolume` action; add master slider wired to `setMasterVolume`; add reset in session connect/disconnect. Requires actions + state changes beyond 1 line.
