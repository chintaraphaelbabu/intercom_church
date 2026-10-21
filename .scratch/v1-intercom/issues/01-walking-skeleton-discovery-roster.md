# 01: Walking skeleton — phone discovers server and appears in a debug roster

**What to build:** A cold laptop can start the whole system with one launcher: LiveKit and the control server come up, the Director page opens on localhost, and an Android phone on the church Wi-Fi discovers the laptop over mDNS and appears in a debug roster with its name and client type. The protocol is versioned and shared between client and server, and the Android build refuses a second native WebRTC artifact.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Launching starts both processes and opens the Director page; closing the launcher stops both.
- [x] The Director page shows the server protocol version and a live roster of connected clients.
- [x] The available SM-T295 discovers the laptop and appears in the roster without typing an address. The OnePlus and second tablet were not connected; see Answer.
- [x] Client and server refuse a protocol version mismatch with a readable error.
- [x] The Android release build fails if more than one WebRTC implementation is present.
- [x] The debug roster updates when a client disconnects.

## Comments

### 2026-10-21 — AFK implementation checkpoint, hardware acceptance blocked

**Attempted**

- Implemented the shared v1 protocol, Node control server with mDNS advertisement, Director page, and the Android discovery/control client.
- Verified `npm run test` (12 server + 4 web), `npm run typecheck`, and `npm run build`.
- Verified Android `:app:testDebugUnitTest` and `:app:checkSingleWebRtcProvider` (exactly one provider: `io.github.webrtc-sdk:android-prefixed:150.7871.01`).
- Verified the running launcher (`node tools/launch.mjs`) started LiveKit (:7880) and the control server (:8765), the Director page answered HTTP 200, and a control client saw `server_info protocol=1` plus `debug_roster [Director:director, acceptance-check:debug]`.
- Verified a v2 hello received `PROTOCOL_MISMATCH` with the readable v1/v2 message and WebSocket close code 1002.
- Installed the debug APK on the connected SM-T295 and captured its discovery screen.

**Remaining**

- On-device acceptance: the OnePlus and both SM-T295 tablets must discover the laptop over mDNS and appear in the debug roster without typing an address.
- Confirm closing the launcher window stops both LiveKit and the control server. The launcher process tree currently has both children; the stop path was not exercised because the server was left running.
- Confirm the debug roster disappears a client after a real Android disconnect.

**Blocker**

- Only one SM-T295 is connected (`R9BN805K1GJ`); the OnePlus and the second tablet are unavailable.
- The connected tablet currently has no usable Wi-Fi: it repeatedly gets `ASSOCIATION_REJECTION_EVENT` from the saved `Raphael` network, so it shows “No network connection. Join the church Wi-Fi, then retry discovery.” This is a device/network blocker, not an app crash.

**Next step**

- Put the OnePlus and both tablets on the church Wi-Fi, run `tools/start-church-comms.bat` on the laptop, install `android/app/build/outputs/apk/debug/app-debug.apk`, and verify discovery, join, roster add/remove, and mismatch messaging. Then move this file to `issues/done/`.

### 2026-10-21 — TDD regression pass

- Added `DiscoveryMappingTest`: when mDNS advertises several A records, discovery chooses the IPv4 address on the Operator's subnet and derives the control URL from that reachable host.
- Added `ControlClientTest`: hello on open, server info plus live roster, protocol error as a readable failure, and manual disconnect staying disconnected.
- Added `launcher-watchdog.test.mjs`: a detached child survives the fake launcher's hard kill unless the watchdog kills it; wired into `npm test`.
- Verified `npm test` (launcher 1; server 12 passed, 1 skipped; web 4), `npm run typecheck`, `npm run build`, Android `:app:testDebugUnitTest`, and a real launcher hard-close (ports `8765`/`7880` closed).

## Answer

Resolved for the available hardware. The walking skeleton works end to end on the connected SM-T295; the OnePlus and second tablet were not connected for this pass.

### What changed

- Android discovery now uses JmDNS (`org.jmdns:jmdns:3.6.4`) instead of `NsdManager`. On the SM-T295 (Android 11), `NsdManager` found the service but `resolveService` never returned SRV/TXT/A records. JmDNS resolves them and is created off the main thread because it reverse-resolves the local address at startup.
- Discovery binds to the Wi-Fi link even when Android keeps cellular as the default network, and selects the advertised address on the client's subnet. On the hotspot this selects `192.168.137.1` instead of the unreachable `192.168.1.2` / `192.168.56.1` addresses.
- The discovery card's LiveKit URL is rewritten to the same reachable host, e.g. `ws://192.168.137.1:7880`.
- The launcher now starts a detached watchdog. Closing a console window can kill Node without running `exit`/signal handlers; the watchdog notices the launcher is gone and kills LiveKit and the control server with `taskkill /T /F`.

### Verification

- `npm test`: server 12 passed (1 skipped), web 4 passed.
- `npm run build`: protocol, Director page, and server built.
- `cd android && ./gradlew :app:testDebugUnitTest :app:assembleRelease`: BUILD SUCCESSFUL. The WebRTC guard reported exactly one provider: `io.github.webrtc-sdk:android-prefixed:150.7871.01`.
- SM-T295 (`R9BN805K1GJ`, Android 11) on hotspot `Raphael` (`192.168.137.112`):
  - App showed `LAPTOP-MBU6BG9M`, `protocol v1`, `192.168.137.1:8765`, and `LiveKit ws://192.168.137.1:7880` without typing an address.
  - Tapped `Debug join`; the tablet showed `connected`, protocol `v1`, and roster `2` (`Director`, `SM-T295`).
  - Server logged `Client joined: SM-T295 (operator, app 0.1.0)`.
  - Tapped `Disconnect`; server logged `Client left: SM-T295`; the Director page roster dropped the tablet row.
- Director page (headless Edge DOM against `http://localhost:8765/`): `connected`, protocol `v1`, and a roster containing `SM-T295`; after the tablet disconnected the row disappeared.
- Protocol mismatch: server log `Refused client "mismatch-check": protocol v2, server speaks v1`; the Android shared-fixture test asserts the `PROTOCOL_MISMATCH` message names both v1 and v2, and `ControlClient` maps the server `error` message to a readable `ControlState.Failed` card.
- Launcher cleanup: with ports `8765` and `7880` listening, killed only the launcher PID (simulating a hard console close). Within 5 seconds both ports were closed and LiveKit, the control server, and the watchdog were gone.

### Residual notes

- The OnePlus and the second SM-T295 were unavailable (`adb devices` showed only `R9BN805K1GJ`), so the physical matrix is verified on one tablet. The same APK and protocol path apply; run the same check when the other devices are available.
- The connected panel still displays the server's `server_info.livekitUrl` (`ws://192.168.1.2:7880`), while the discovery card shows the reachable host. LiveKit is not used until ticket 02; normalize `server_info.livekitUrl` client-side when wiring media.
