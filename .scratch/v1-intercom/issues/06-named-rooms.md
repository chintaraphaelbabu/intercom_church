# 06: Named rooms — create, list, join, end

**What to build:** The Director creates a named Room (default `MEDIA`), Operators see active Rooms and join or leave, and End room closes it immediately. The server is authoritative for room state, and duplicate names are rejected.

**Blocked by:** 02 — The Director's voice reaches the Operator's phone

**Status:** ready-for-agent

- [ ] The Director creates a named room and it appears in the Operator join list.
- [ ] Two Operators join and leave without affecting each other.
- [ ] A duplicate room name is rejected with a readable message.
- [ ] End room returns every Operator to the join screen with "Room closed by director".
- [ ] The room disappears from the join list immediately.
- [ ] Refreshing the Director page does not fabricate or duplicate room state.
