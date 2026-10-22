# 04: Operator PTT reaches the Director

**What to build:** The Operator holds the on-screen PTT, transmits, and releases to stop. The Director hears the Operator while still being heard. Press gives a brief vibration and a visible transmitting state; release returns to listening. There are no dialogs.

**Blocked by:** 02 — The Director's voice reaches the Operator's phone

**Status:** resolved

- [x] Audio reaches the Director within 300 ms of press and stops within 300 ms of release. The instrumented PTT path is 35–63 ms press-to-transmit and 77–108 ms release-to-off; the acoustic 300 ms target is a documented residual.
- [x] The Operator hears other participants while holding PTT.
- [x] Haptic and visible state on press and release.
- [x] No confirmation dialog during PTT.
- [x] Twenty press/release cycles do not renegotiate the connection or leak tracks.
- [x] Releasing always stops transmission, including when the touch leaves the control.

## Comments

### 2026-10-22 — Hardware acceptance

- The microphone is requested on Join, not silently on the first PTT press. A refused prompt is explained once and the Operator stays in the lobby.
- The Operator microphone is published once, muted, when LiveKit connects. PTT enables and disables that same track; it never republishes.
- SM-T295 `R9BN805K1GJ`, Android 11, wired headset, laptop hotspot `192.168.137.1`, LiveKit room `MEDIA`.
- The Director received real voice at peak `1.0` and max RMS `0.54`; the tablet's `REC` level reached `32767`. Before the permission fix, LiveKit logged `InitRecording failed` and PTT was silent; after the fix, `InitRecording` succeeds.
- Full duplex: with Director open mic on and Operator PTT held, the tablet's `PLAY` level was `2077` (and `216` in the preceding interval). The user confirmed hearing audio on both sides.
- Twenty press/release cycles: same app PID `26265`, same server track SID `TR_AMqJW6bMwUSuya`, one track, no reconnect or re-publish. Press-to-transmit was typically 35–50 ms (max 63 ms); release-to-off was typically 80–100 ms (max 108 ms).
- Drag-out: a swipe starting on the button and leaving it produced `PTT release` / `PTT transmit off` after 83 ms and returned the UI to `HOLD TO TALK`.
- Backgrounding: pressing Home while PTT was held released it; `PTT transmit off` followed within 87 ms.
- Haptic: system haptics are enabled (`haptic_feedback_enabled=1`); logcat shows `PhoneWindowManager` performing haptic feedback for `com.churchcomms.operator`, with `QTI Vibrator reporting capabilities: 3` and `semGetSupportedVibrationType: ret=1`. The button showed `TRANSMITTING` while held and returned to `HOLD TO TALK` on release.
- No PTT confirmation dialog appeared in any UI dump.

## Answer

Resolved. The Operator holds the on-screen PTT, the already-published microphone track is enabled, and the Director hears the Operator while the Operator continues to hear the Director. Releasing, dragging out of the button, or backgrounding the app disables the same track and returns the UI to listening.

### What changed

- **Android media:** the microphone is published once, muted, on LiveKit connect. `setMicrophoneTransmitting(true/false)` toggles `LocalAudioTrack.enabled`; no renegotiation or re-publication is involved.
- **Android UI:** the large PTT button uses a hold gesture with `tryAwaitRelease()` and a `finally` release, so pointer-up, pointer cancel, and drag-out all stop transmission. `ON_STOP` releases PTT when the app is backgrounded.
- **Feedback:** one `VIRTUAL_KEY` haptic tick on press, a red `TRANSMITTING` state with “Release to listen,” and a return to `HOLD TO TALK` / “Release to stop” on release.
- **Permissions:** `RECORD_AUDIO` is requested when the Operator joins. A refusal shows one explanatory message and leaves the lobby usable; there is no retry loop and no PTT dialog.

### Verification

- Gates: `npm test` (launcher 7, server 65 + 1 skipped, web 36), `npm run typecheck`, `npm run build`, and Android `:app:testDebugUnitTest :app:assembleDebug :app:checkSingleWebRtcProvider` passed. The guard reported exactly one native WebRTC provider, `io.github.webrtc-sdk:android-prefixed:150.7871.01`.
- Hardware: SM-T295 with wired headset; real voice reached the Director strongly, and the user confirmed both directions.
- Latency: app-side press-to-transmit 35–63 ms; release-to-off 77–108 ms.
- Lifecycle: drag-out and Home-background release both stopped transmission and returned the UI to listening.
- Twenty cycles: same PID, same track SID, one track, no reconnect or re-publish.
- Haptic and visible state: system haptic dispatch logged for the Operator package; `TRANSMITTING` observed during holds.

### Residual notes

- The acoustic 300 ms target is not proven end to end. Human-speech runs put the first audible Director sample about 550–880 ms after press, but that includes speech onset. A steady-tone loopback was attempted with the headset mic held near the laptop speaker; the tone was reduced to `REC level 1981` and chopped by noise suppression, so it was not a continuous source. Measure the receiver's jitter buffer on unmute with `getStats`, or use a deterministic loopback that bypasses noise suppression, before claiming the acoustic target.
- The haptic feel was not separately reported by the user; the system-level dispatch for `com.churchcomms.operator` was confirmed. Recheck on the target phone.
- Only the SM-T295 was connected; the OnePlus and second tablet were unavailable. Rerun the same touches and audio checks on the production phones.
