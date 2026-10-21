# Native WebRTC notes

This project exists after a failed WebRTC attempt on the same church app. These notes keep that failure from being repeated.

## What failed before

| Item | Value |
|---|---|
| Client | Kotlin, `minSdk 26`, `compileSdk 35` |
| SFU | mediasoup |
| Android mediasoup library | `io.dyte.mediasoup` |
| WebRTC dependency | `io.github.webrtc-sdk:android:104.5112.03` |
| Codec / transport | Opus / DTLS |
| Symptom | Crash ~500 ms after joining a room |
| Root cause | Native WebRTC binary API/ABI mismatch with the mediasoup bindings; the integration used getters removed in WebRTC M107 |

The failure was **two native WebRTC providers in one process**. It was not caused by Opus, DTLS, or SFU routing.

## What this project does instead

- One provider only: `io.livekit:livekit-android:2.29.1`, which transitively pins `io.github.webrtc-sdk:android-prefixed:150.7871.01`.
- No `mediasoup-client`, no `io.dyte.mediasoup`, no direct `org.webrtc` or `io.github.webrtc-sdk` declaration.
- The server is LiveKit `1.13.10` (native Windows build), so client and SFU are the same vendor's stack and versioned together.
- Upgrades of the Android SDK are deliberate, never a floating version.

## Checks before UI work

Run these in M0/M1 and after any dependency change:

```powershell
# Exactly one WebRTC implementation must appear.
.\gradlew.bat :app:dependencies --configuration releaseRuntimeClasspath | Select-String -Pattern "webrtc"

# Expected: io.github.webrtc-sdk:android-prefixed:150.7871.01 -> ... (one line)
```

- Ship `arm64-v8a` and `armeabi-v7a`; include `x86_64` only in debug for an emulator.
- Verify 16 KB page-size alignment for Android 15+ before release:
  `zipalign -c -P 16 -v 4 app-release.apk`
- Keep R8 rules required by the LiveKit SDK; do not minify the native bridge.
- First task of M1 is a bare join/publish smoke test on the OnePlus: 10 minutes, screen locked, no UI. If it crashes, stop and fix dependencies before writing product code.
- Capture `adb logcat -b crash` on any native failure.
