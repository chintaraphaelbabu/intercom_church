# 01: Per-operator volume and level meters in Director Setup/Mixer

**What to build:** The Director's Setup/Mixer view shows a volume slider and a live level meter for each Operator in the roster, matching the design spec (`docs/design.md` line 112; `.scratch/v1-intercom/issues/13-director-setup-live-and-diagnostics.md`). Changes apply locally to the Director's audio render without renegotiating LiveKit.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Setup/Mixer roster includes a per-Operator volume slider (0–100) wired to local audio.
- [ ] Each Operator row shows a live level meter that reflects speaking activity.
- [ ] Volume changes take effect locally within 200 ms.
- [ ] No duplicate `Cam {op.camera}` line in roster (`App.tsx` line 242/248 fix included or separate).
