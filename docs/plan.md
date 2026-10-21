# Implementation Plan

Design: [design.md](design.md). Vocabulary: [GLOSSARY.md](../GLOSSARY.md). ADRs: [adr/](adr/).

## Environment (verified on this machine, 2026-10-21)

- Node.js 24.20, npm 11.19 — control server and Director web app.
- JDK 17, Android SDK with platforms 33–36.1 and build-tools 36/37, `adb` present — Android client.
- Gradle wrapper will be generated with the project; no system Gradle needed.
- Go is not installed and is not needed.
- LiveKit server ships a native `windows_amd64` build (`livekit_1.13.10_windows_amd64.zip`, 2026-10-14). No Docker, no WSL.
- Pinned versions: LiveKit server `1.13.10`; LiveKit Android `2.29.1` → `io.github.webrtc-sdk:android-prefixed:150.7871.01`. See [webrtc-notes.md](webrtc-notes.md).
- Android test hardware: OnePlus Nord CE 5 (Android 16), 2 × Samsung SM-T295 (Android 11).

## Repository layout

```
android/     Kotlin + Compose operator app
server/      Node/TypeScript control server, serves web/dist, owns mDNS + LiveKit tokens
web/         React + LiveKit JS Director client, built into server/web-dist
protocol/    v1 message schemas + JSON fixtures shared by tests
tools/       LiveKit binaries, start-church-comms.bat, Windows firewall script
docs/        design.md, plan.md, adr/
```

## Milestones

Each milestone ends with something demonstrable. No milestone is "UI looks done".

### M0 — Skeleton and contracts

Build: repo layout; protocol v1 types and fixtures; Node console app with WS `hello`/`server_info`, mDNS advertisement, static file serving; React Director shell; Android Compose shell with discovery and a debug join; a Gradle guard that fails the build if more than one WebRTC artifact appears; `.bat` that starts LiveKit + control server and opens the browser.

Proof: phone discovers the laptop over mDNS; handshake succeeds; Director page shows server info and the phone appears in a debug roster; closing the console kills both services.

Needs from you: permission to add Windows firewall rules; USB debugging enabled on the OnePlus.

### M1 — Director to phone, locked screen (go/no-go)

Build: **Step 0 — native smoke test:** a bare LiveKit join/publish/render screen on the OnePlus, no product UI, 10 minutes with the screen locked. Verify exactly one WebRTC implementation in the dependency graph and no native crash. Only then: LiveKit config and token minting; Director open-mic publish; Android subscribe and render through the headset; foreground service with microphone type and notification; latency instrumentation.

Proof: 10-minute smoke test passes, then 30 minutes with the phone locked in a pocket and a wired headset, hearing the Director continuously; measured mouth-to-ear latency; audio survives screen-off and app backgrounding.

This is the technical go/no-go for the whole product. If locked-screen audio or latency fails here, stop and reassess before building the rest.

### M2 — PTT and simultaneous talkers

Build: Operator PTT publishing/unmuting; vibration and transmitting state; per-participant and master volume sliders; multiple simultaneous subscriptions; force-mute plumbing (server state + track mute).

Proof: 2 phones + 2 browsers all transmitting at once, intelligible mix, no stuck mic, no renegotiation on each press.

### M3 — Rooms, cameras, presence, mute

Build: Director creates/ends room; join flow with name + camera slot; server-side slot uniqueness; roster and level meters; Director mute plus Operator fresh-press override; Director disconnect countdown and 5-minute expiry; session token resume without duplicates.

Proof: full flow on two phones: create `MEDIA`, join as CAM 1 and CAM 2, reject duplicate CAM 2, mute CAM 2, override by fresh PTT, close browser, watch countdown, return before expiry, then End room.

### M4 — Reliability and Android reality

Build: reconnect with 5 attempts and Retry/Leave; headset disconnect handling; audio focus and ducking; battery/OEM setup screen; laptop keep-awake while a room is active; distinct failure states; structured logs.

Proof: pull Wi-Fi mid-session, kill and restart the control server, unplug the headset, lock the phone for 2 hours; each failure produces the correct state and recovers as specified.

### M5 — Mixer/Live split and diagnostics

Build: Operator Mixer View and Live View; Director Setup/Mixer and Live; diagnostics screens; Advanced manual address; setup help for OxygenOS.

Proof: UI review against the screen list in the design; no raw diagnostics on the live screen; every diagnostic row maps to a real signal.

### M6 — Release and load

Build: signed release APK; install and server setup docs; firewall script; final tuning of jitter buffer against the latency target.

Proof: Definition of Done in the design — 2-hour soak at 5 owned clients, 4 Android + 2 browsers simultaneous, 10-client load test for 5 minutes on borrowed phones, all failure-mode tests green.

## Risks

| Risk | Early signal | Mitigation |
|---|---|---|
| Church Wi-Fi blocks mDNS (AP isolation) | M0 discovery fails on the real network | Manual IP under Advanced; test on-site before M1 |
| Native WebRTC dependency collision | Crash seconds after join, as in the previous mediasoup attempt | One provider only; dependency graph check; M1 Step 0 smoke test; see [webrtc-notes.md](webrtc-notes.md) |
| Windows firewall blocks LiveKit UDP | M1 media connects but no audio | Firewall script in `tools/`, verified in M1 |
| Laptop sleep or update kills the room | M4 soak | Keep-awake while room active; documentation; visible server health |
| Bluetooth latency | M1 measurement | Wired recommended; target applies to wired only |
| Borrowed phones cannot be soaked | M6 | Soak on owned devices; borrowed phones only for the 5-minute load test |
| Browser tab throttling in background | M1 | Verify audio continuity with the Director page unfocused; keep it visible if needed |

## Order of work

M0 → M1 first, because they decide whether the product is viable. M2 and M3 can then proceed in parallel in spirit, but M2 lands first so the audio path is proven before domain state grows around it. M4 before UI polish, because reliability is the product. M5 last among build work so the screens reflect the real states rather than guesses.
