# 01: Walking skeleton — phone discovers server and appears in a debug roster

**What to build:** A cold laptop can start the whole system with one launcher: LiveKit and the control server come up, the Director page opens on localhost, and an Android phone on the church Wi-Fi discovers the laptop over mDNS and appears in a debug roster with its name and client type. The protocol is versioned and shared between client and server, and the Android build refuses a second native WebRTC artifact.

**Blocked by:** None (can start immediately)

**Status:** ready-for-human

- [ ] Launching starts both processes and opens the Director page; closing the launcher stops both.
- [ ] The Director page shows the server protocol version and a live roster of connected clients.
- [ ] The OnePlus and both tablets discover the laptop and appear in the roster without typing an address.
- [ ] Client and server refuse a protocol version mismatch with a readable error.
- [ ] The Android release build fails if more than one WebRTC implementation is present.
- [ ] The debug roster updates when a client disconnects.

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
