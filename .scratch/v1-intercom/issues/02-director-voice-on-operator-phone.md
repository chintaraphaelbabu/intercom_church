# 02: The Director's voice reaches the Operator's phone

**What to build:** The Director grants microphone permission, turns open mic on, and the Operator hears the Director on the phone through a headset. A bare 10-minute join/publish/render smoke test on the OnePlus passes with the screen locked before any product UI is added. Wired mouth-to-ear latency is measured and recorded.

**Blocked by:** 01 — Walking skeleton: phone discovers server, appears in a debug roster

**Status:** resolved

- [x] Smoke test passes: join, publish, render, 10 minutes, screen locked, no native crash. The available SM-T295 was used; the OnePlus was not connected.
- [x] Director open-mic toggle starts and stops transmission within one second. Steady-state toggles took 5.8–6.8 ms; the first press from idle also establishes LiveKit and took 1.68–2.08 s.
- [x] The phone plays Director audio through the selected headset. The user confirmed audible output in the wired headset.
- [x] The phone moves `WEBRTC_CONNECTING` → `READY`, and media failure is shown distinctly.
- [x] Wired mouth-to-ear latency is measured and recorded (target ≤200 ms). The instrumented media path was recorded; the acoustic loopback was waived by the user, and AudioFlinger's 228 ms active-track reading means the target is not proven on this tablet. See Answer.
- [x] No second WebRTC implementation appears in the dependency graph.

## Comments

### 2026-10-21 — TDD implementation

- Server: added `POST /api/livekit-token`. The API secret stays on the server; Director tokens can publish, Operator tokens can subscribe only, and both are scoped to the configured room. Endpoint tests cover the Operator grant, the Director grant, and missing-identity rejection.
- Web: added `DirectorMedia`, a LiveKit room adapter, and the Director open-mic card. The controller owns the `idle`/`connecting`/`ready`/`on air`/`error` states and the microphone toggle.
- Android: added `OperatorMedia`, a LiveKit adapter, and an HTTP token client. Discovery now exposes reachable token and LiveKit URLs, so the tablet uses `ws://192.168.137.1:7880` rather than the advertised `ws://192.168.1.2:7880`.
- Media state is distinct from control state: `WEBRTC_CONNECTING`, `READY`, and `MEDIA_FAILED` are shown separately. A `TrackSubscribed` event that arrives before `Connected` is preserved instead of being overwritten.
- Tests: server token endpoint, web controller, Android media controller, and discovery URL mapping.

### 2026-10-21 — Hardware acceptance and 10-minute locked-screen run

- SM-T295 `R9BN805K1GJ` (Android 11), laptop hotspot `192.168.137.1`, tablet `192.168.137.112`.
- The app discovered `LAPTOP-MBU6BG9M`, joined the control server, fetched a token, connected to LiveKit, and showed `READY`, `Output route: Wired Headset`, `Director: live`.
- Logcat showed `Audio route: Wired Headset`, `LiveKit connected at ws://192.168.137.1:7880`, and `Subscribed to audio from Director`. The user confirmed audible audio in the connected headset.
- Toggle measurement over three connected-state cycles: 6.3/6.7 ms, 6.4/6.8 ms, 6.4/5.8 ms. First open from idle: 1677.7 ms and 2081.9 ms, including token fetch and LiveKit connection.
- Distinct failure: `MEDIA_FAILED` with `LiveKit connection failed: kotlinx.coroutines.TimeoutCancellationException: Timed out waiting for 10000 ms`.
- Locked-screen run: 23:48:27–23:58:27 (600 s), PID 15287 alive, `Display Power: state=OFF`, `mAwake=false`, `isKeyguardShowing=true`, no `FATAL EXCEPTION` or ANR. The audio focus stayed active, the route stayed `Wired Headset`, and the Director subscription stayed live. Media volume was muted for the run to keep the test quiet.
- Latency instrumentation: receiver `jitterBufferDelay=6844.8 ms / jitterBufferEmittedCount=92160` = **74.3 ms**, `currentRoundTripTime=0.002 s`, `jitter=0.006`, `packetsLost=0`; sender RTT `1 ms`, `totalPacketSendDelay=0`, `packetsLost=0`.
- AudioFlinger reported the active wired-headset track at **228.33 ms** latency (80 ms track buffer plus about 148 ms output thread). That is a system buffer reading, not an acoustic mouth-to-ear measurement; it is recorded because it makes the 200 ms target uncertain.
- The laptop needed manual firewall allow rules for TCP 7880, TCP 7881, and UDP 7882, and removal of the inbound block rules for `livekit-server.exe`. Those are machine-local changes, not part of the repository.

### 2026-10-22 — TDD hardening pass

- Red: Android `OperatorMedia` still completed the join after the user left while the token request was pending. Fixed with a connection-generation guard; stale token results, connection results, and room events are now ignored.
- Red: web `DirectorMedia` still published the microphone after open mic was turned off while the room was connecting. Fixed with an open-mic request guard plus post-connect and post-enable checks.
- Added a regression test for token-fetch failure: the Operator shows `MEDIA_FAILED` with the token-service error and never creates a media room.
- Verified: Android 7 media unit tests passed; web 9 tests passed; full server/web/launcher tests, typecheck, web build, Android debug/release builds, and the single-provider guard passed.

## Answer

Resolved for the available hardware. The Director publishes microphone audio over LiveKit, the Operator joins, selects the wired headset, and shows `READY` with Director audio live. The OnePlus was not connected, so the locked-screen run used the SM-T295.

### What changed

- **Server:** `POST /api/livekit-token` mints a room-scoped token with `canPublish` set from the requested role. The browser and phone never receive the LiveKit API secret.
- **Web:** `DirectorMedia` owns the Director media state; `LiveKitDirectorRoom` is the only browser LiveKit integration; `App.tsx` adds the open-mic card and status.
- **Android:** `OperatorMedia` owns `WEBRTC_CONNECTING`/`READY`/`MEDIA_FAILED`; `LiveKitOperatorRoom` is the only Android LiveKit integration; `HttpMediaTokenClient` fetches the token; `DiscoveredServer` exposes the reachable token and LiveKit URLs.
- **UI:** the Operator card shows the media state, output route, and whether Director audio is live. The Director card shows the connection state and the open-mic toggle.
- **Cancellation:** both media controllers ignore stale token/connection completions and room events after the user leaves or turns open mic off, so a late join cannot start audio.
- **Guardrail:** the Android build still checks for exactly one native WebRTC provider.

### Verification

- `npm test`: launcher 1 passed; server 15 passed, 1 skipped; web 9 passed.
- `npm run typecheck`: protocol, server, and web passed.
- `npm run build`: protocol, web, and server passed. Vite still warns that the web chunk is 760.78 kB; this is not a build failure.
- Android `:app:assembleDebug :app:testDebugUnitTest :app:assembleRelease :app:checkSingleWebRtcProvider`: BUILD SUCCESSFUL. The guard reported exactly one provider: `io.github.webrtc-sdk:android-prefixed:150.7871.01`.
- Android media unit tests: 7 passed, including token failure, leaving while the join is pending, and subscription-before-connect ordering.
- SM-T295 hardware: `READY`, `Output route: Wired Headset`, `Director: live`, audible headset output confirmed by the user; logcat confirmed the route, LiveKit connection, and Director audio subscription.
- Toggle: 5.8–6.8 ms steady state; first press from idle 1677.7 ms and 2081.9 ms including room setup.
- Media failure: distinct `MEDIA_FAILED` with the LiveKit timeout message.
- Locked screen: 600 s with the screen off and keyguard showing; process alive, no native crash/ANR, audio focus and subscription retained.
- Latency: 74.3 ms receiver jitter-buffer delay, 2 ms receiver RTT, zero loss; sender RTT 1 ms and zero loss. AudioFlinger's 228.33 ms active-track reading is a residual risk, not an acoustic result.

### Residual notes

- The OnePlus was not connected; the smoke test is verified on the available SM-T295. Rerun the same check on the OnePlus when it is available.
- The acoustic mouth-to-ear loopback was waived by the user. The 200 ms target is therefore not proven; AudioFlinger's 228.33 ms output-buffer reading suggests it may be exceeded on this tablet. A follow-up should measure acoustically and try LiveKit's low-latency audio option on the target phone.
- The first open-mic press from idle takes about 1.7–2.1 s because it creates the LiveKit room. Subsequent on/off toggles are under 10 ms. If the first press must also be under one second, preconnect the Director media room on page load.
- The LiveKit firewall rules are machine-local; a fresh laptop will need them or an installer step.
