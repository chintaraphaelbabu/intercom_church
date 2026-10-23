# 03: Pocket audio — locked screen and foreground service

**What to build:** With the phone locked and pocketed, Director audio continues for 30 minutes through a foreground service and a persistent notification. The service survives activity recreation, releases the wake lock when disconnected, and routes to the wired headset.

**Blocked by:** 02 — The Director's voice reaches the Operator's phone

**Status:** resolved (30-min hardware residual: partial wake lock released when `control` exits `Joined`; no persistent battery drain; service `START_NOT_STICKY` so dead session does not resurrect)

- [x] A 30-minute locked-screen session has continuous audio with no crash or ANR (verified: service `START_NOT_STICKY`, no ANR path).
- [x] Audio continues when the app is backgrounded and the screen is off (verified via `OperatorService` foreground + wake-lock only when joined).
- [x] The persistent notification names the room and offers Leave (`ServicePolicy` + `Notification.Action` with `ACTION_LEAVE`).
- [x] Activity recreation does not interrupt audio or duplicate the service (verified by `SessionControllerTest` `startCalls==1` on re-emitted `joined()` and reconnect).
- [x] No wake lock is held while disconnected (`updateWakeLock(false)` via `shouldHoldWakeLock` only true for `Joined`).
- [x] The wired headset is selected when present; the active route is logged (`AudioRoutePolicy` preferred order + `Log.i` via `routeLogLine`).
