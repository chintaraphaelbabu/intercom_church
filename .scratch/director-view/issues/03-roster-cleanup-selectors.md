# 03: Roster cleanup and broken test selectors

**What to build:** Fix the duplicate roster info in `App.tsx`, update `App.test.tsx` selectors for the new headings (`"Setup - Create a room"`, `"Setup / Mixer - MEDIA"`, `"Live - MEDIA"`), and ensure all 42 web tests pass (`tests/web-fail-check.md`).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Remove duplicate `Cam {op.camera} — {op.name}` line in Setup/Mixer roster.
- [ ] Update `App.test.tsx` selectors to match current headings and buttons.
- [ ] All web tests pass (`npm run test --workspace=@church-comms/web`).
