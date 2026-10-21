# 10: Operator reconnect without duplicates

**What to build:** When an Operator loses Wi-Fi, the foreground service stays alive, the app shows Reconnecting with the attempt number, and it retries up to five times. On success it resumes with the stored session token, keeps the same camera number, and does not create a duplicate participant. After five failures it offers Retry and Leave.

**Blocked by:** 07 — Camera identity and roster

**Status:** ready-for-agent

- [ ] Turning Wi-Fi off shows Reconnecting with an attempt number within two seconds.
- [ ] At most five attempts run with bounded backoff.
- [ ] On restore, the Operator keeps the same camera number and audio resumes without rejoining manually.
- [ ] The server roster shows one entry for that person throughout the reconnect.
- [ ] After five failures, an error screen offers Retry and Leave.
- [ ] Retry starts a fresh attempt cycle; Leave returns to the join screen.
- [ ] A force-mute does not survive the reconnect.
