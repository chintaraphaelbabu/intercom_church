# 03: Pocket audio — locked screen and foreground service

**What to build:** With the phone locked and pocketed, Director audio continues for 30 minutes through a foreground service and a persistent notification. The service survives activity recreation, releases the wake lock when disconnected, and routes to the wired headset.

**Blocked by:** 02 — The Director's voice reaches the Operator's phone

**Status:** ready-for-agent

- [ ] A 30-minute locked-screen session has continuous audio with no crash or ANR.
- [ ] Audio continues when the app is backgrounded and the screen is off.
- [ ] The persistent notification names the room and offers Leave.
- [ ] Activity recreation does not interrupt audio or duplicate the service.
- [ ] No wake lock is held while disconnected.
- [ ] The wired headset is selected when present; the active route is logged.
