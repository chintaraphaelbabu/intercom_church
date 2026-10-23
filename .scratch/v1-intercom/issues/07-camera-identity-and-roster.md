# 07: Camera identity and roster

**What to build:** An Operator joins with a display name and a free camera number from 1 to 10. Camera numbers are unique per Room, released on leave, and the roster shows name, camera number, and connection state on both clients. The Director has a reserved role with no camera number.

**Blocked by:** 06 — Named rooms: create, list, join, end

**Status:** resolved

- [x] The join screen shows free and taken camera numbers.
- [x] Claiming a taken number is rejected and the list refreshes.
- [x] The roster shows name, camera number, and connection state.
- [x] The Director is labelled Director and has no camera number.
- [x] Leaving releases the camera number for reuse.
- [x] An eleventh person is rejected with "room is full".

**Status:** resolved
