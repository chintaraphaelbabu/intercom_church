# 09: Director absence — countdown, grace, close

**What to build:** If the Director's browser disconnects unexpectedly, the Room enters a visible five-minute grace period. Operators keep talking to each other, the Room stops accepting new joins, a returning Director cancels the countdown, and expiry destroys the Room. End room remains immediate.

**Blocked by:** 06 — Named rooms: create, list, join, end; 07 — Camera identity and roster

**Status:** ready-for-agent

- [ ] Closing the Director tab starts a visible 5:00 countdown on every Operator.
- [ ] Operators keep hearing and talking to each other during the grace period.
- [ ] The Room is hidden from the join list during the grace period.
- [ ] A Director returning within five minutes cancels the countdown and restores the roster.
- [ ] At 0:00 every Operator returns to the join screen and the Room is gone.
- [ ] End room closes immediately with no countdown.
- [ ] Server death shows `SERVER_UNAVAILABLE`, never "director left".
