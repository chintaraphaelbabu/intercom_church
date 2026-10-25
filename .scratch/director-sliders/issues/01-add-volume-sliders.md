# 01: Add volume sliders

**What to build:** Per-operator volume range slider (`<input type="range">`) in roster, and master volume range slider (`MasterVolume` component) in Setup/Mixer and Live screens. Use existing `mediaState` (`volume`, `masterVolume`) wired to `media.setParticipantVolume` / `media.setMasterVolume`.

**Blocked by:** None

**Status:** done
- [x] Per-operator range input in roster (`App.tsx`)
- [x] Master volume `MasterVolume` component restored (`App.tsx`)
- [x] `media.setParticipantVolume` / `setMasterVolume` wired correctly
