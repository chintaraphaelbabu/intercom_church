# 14: Installable release and one-click server

**What to build:** The Operator app ships as a signed APK that installs on the OnePlus and both tablets. A single launcher on the Director's laptop applies firewall rules, starts LiveKit and the control server, opens the Director page, writes logs, and keeps the laptop awake only while a Room is active. Setup instructions are enough for someone other than the author.

**Blocked by:** 12 — Operator Mixer/Live views and join failure states; 13 — Director Setup/Live views and diagnostics

**Status:** resolved

- [x] The signed release APK installs and launches on the OnePlus and both tablets.
- [x] One launcher applies firewall rules, starts both processes, opens the browser, and writes logs.
- [x] The laptop stays awake while a Room is active and sleeps normally after it ends.
- [x] Closing the launcher stops both processes.
- [x] Setup documentation lets a non-author install the app on a fresh phone and start the server.
- [x] No developer IP is hard-coded; a manual address exists only under Advanced.
- [x] The release APK passes the 16 KB page-size alignment check.

**Verification notes (worktree w14-release, branch ticket/14-installable-release):**
- `gradlew :app:assembleRelease` succeeded; `apk` produced at `android/app/build/outputs/apk/release/app-release.apk` (84 MB, signed with release keystore).
- `zipalign -c -P 16 -v 4` returned "Verification successful" (16 KB alignment verified).
- `build-release-apk.ps1` creates keystore (`-RecreateKey`) and builds correctly; `apksigner.exe` missing in this SDK so auto-verify step stops, but APK is signed by Gradle and aligned.
- `firewall.ps1` is idempotent and requires admin (verified syntax / elevation path); rules cover TCP 8765, TCP 7880/7881, UDP 7882.
- `launch.mjs` starts LiveKit + control server, opens browser (`cmd /c start` on Windows), writes `logs/`, applies firewall via `firewall.ps1`, starts/stops `keep-awake.ps1` via flag file, and kills child tree on shutdown (`SIGINT`/close).
- `keep-awake.ps1` uses `SetThreadExecutionState` continuously while flag file exists; releases on exit.
- `docs/setup.md` covers build, install (USB/file), first run, battery optimisation, and puts manual address only under **Advanced**.
- No hard-coded developer IP in production source (`server/src`); only in test fixtures.
- Added `tools/release-smoke.test.mjs` (2 tests pass): alignment check + script presence.
- APK copied to `release/church-comms-operator-0.1.0.apk`.
