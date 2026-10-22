# 06: Named rooms — create, list, join, end

**What to build:** The Director creates a named Room (default `MEDIA`), Operators see active Rooms and join or leave, and End room closes it immediately. The server is authoritative for room state, and duplicate names are rejected.

**Blocked by:** 02 — The Director's voice reaches the Operator's phone

**Status:** resolved

- [x] The Director creates a named room and it appears in the Operator join list.
- [x] Two Operators join and leave without affecting each other.
- [x] A duplicate room name is rejected with a readable message.
- [x] End room returns every Operator to the join screen with "Room closed by director".
- [x] The room disappears from the join list immediately.
- [x] Refreshing the Director page does not fabricate or duplicate room state.

## Comments

### 2026-10-22 — Hardware and server acceptance

- Live room `MEDIA`: the Director page showed `MEDIA`, `Open`, and `2 of 11`. The Operator tablet discovered it, joined, and saw the room roster. The user confirmed audio in both directions.
- Duplicate room name: a second Director control client sent `create_room` with `media`; the server replied `ROOM_EXISTS` and `Room "media" already exists.` The live `MEDIA` room was unaffected.
- Room list: a fresh Operator control client received `{"name":"MEDIA","status":"open","directorPresent":true,"operatorCount":1,"capacity":11}` before joining.
- Duplicate camera: joining `MEDIA` as camera 1 was rejected with `CAMERA_TAKEN` and `Camera 1 is already taken in room "MEDIA".`
- Second Operator: the same control client joined `MEDIA` as camera 10, received `joined`, then left. The Director page returned to `2 of 11`; the tablet PID `26265` stayed alive and its PTT still showed `HOLD TO TALK`.
- End room: a throwaway `ACCEPT` room was created, an Operator joined it, and the Director ended it. The Operator received `room_closed` with reason `ended_by_director`; a fresh observer's room list no longer contained `ACCEPT`, while `MEDIA` remained open.
- Earlier in this pass the live `MEDIA` room was ended from the Director page and the tablet returned to the join screen with “Room closed by director”; the room disappeared from the join list. A Director page refresh was also checked without creating a second room record.

## Answer

Resolved. Rooms are server-authoritative: the Director creates a named room, Operators list and join it, duplicate names and camera numbers are rejected with readable messages, and End room removes the room and notifies every Operator with `Room closed by director`.

### What changed

- **Server:** the room registry owns creation, normalization, capacity, camera claims, ending, and the joinable-room list. Duplicate names are rejected case-insensitively; camera numbers are 1–10 and unique per room.
- **Web:** the Director creates a named room (default `MEDIA`), sees the server snapshot and participant count, and ends the room from the Live View. The Director’s LiveKit media uses the named room’s credentials.
- **Android:** the lobby lists active rooms, joins with the selected camera number, leaves without closing the room, and maps `room_closed` reasons to the readable lobby notice.

### Verification

- Server tests cover create/list/join/end, duplicate names, duplicate cameras, capacity, and room-close reasons.
- Web tests cover the create form, duplicate-name error, room snapshot, and End room notice. Android tests cover the lobby list, join/leave, and `Room closed by director` mapping.
- `npm test` passed: launcher 7, server 65 passed with 1 skipped, web 36. `npm run typecheck` and `npm run build` passed. Android JVM tests and the single-WebRTC-provider guard passed.
- Hardware/server acceptance: see the dated comment above.

### Residual notes

- Only one Android tablet was connected. The second Operator was a second control client, not a second phone; rerun the two-Operator join/leave and End room flow with two physical phones.
- The current End room re-check used a throwaway `ACCEPT` room to avoid interrupting the live `MEDIA` session; the live `MEDIA` End room path was exercised earlier in this pass.
- The Director refresh check was not repeated against the live `MEDIA` session because it would drop the Director's media connection. The server snapshot and duplicate-name tests cover the authoritative state; recheck refresh on the final hardware pass.
