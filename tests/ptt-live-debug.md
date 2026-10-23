# PTT Live View Debug — R9BN805K1GJ (USB, Wi-Fi Raphael)

Date: 2026-10-23
Device: R9BN805K1GJ (Samsung SM-T295, Android 11, Wi-Fi 192.168.137.112)
App: com.churchcomms.operator (pid 25863, MainActivity active)
Server: node.exe (PIDs 8948/10728/9120), livekit-server.exe (PID 12388) running
APK: new install (post-install failure reported)

---

## 1. ADB logcat filter (PTT / transmit / mute / forceMuted)

Command: `adb -s R9BN805K1GJ logcat -d -t 30` and expanded (`-t 200`, `-t 1000`)
Filter patterns: `PTT|ptt|transmit|TRANSMIT|mute|Muted|forceMuted|setOpenMic|openMic`
Result: **No matching lines in last 1000 logcat entries** (only cnss-daemon errors, InputReader touches, SemGameManager, ViewRootImpl).
Specific expected tags `ChurchComms.Ptt`, `PTT press`, `PTT release` absent.
Implication: PTT button press/release events never reached app logs — consistent with non-interactive PTT zone in LiveScreen.

---

## 2. PttButton / SessionScreen mute state and `forceMuted`

File: `android/app/src/main/java/com/churchcomms/operator/ui/SessionScreen.kt`
- Line 202: `val me = control.room.operators.firstOrNull { it.id == control.participantId }`
- Line 204: `val forceMuted = me?.muted == true`
- Lines 205-209: chip label uses `forceMuted` and `state.transmitting`
- Line 227: chip accent = `state.transmitting || (ready && !forceMuted)`
- Lines 230-235: `PttButton(...)` call:
  - `transmitting = state.transmitting`
  - `enabled = ready`  **← button enabled does NOT incorporate `forceMuted`**
  - `onPress = actions.pressPtt`
  - `onRelease = actions.releasePtt`
- Lines 251-271: `MuteBanner()` shown when director muted; text references taking mic back with fresh press.

File: `android/app/src/main/java/com/churchcomms/operator/ui/PttButton.kt`
- Lines 42-48: composable takes `transmitting: Boolean`, `enabled: Boolean`
- Lines 91-109: `pointerInput(enabled)` — if `!enabled`, returns immediately (no press handled); otherwise `detectTapGestures` with `onPress` calling `currentOnPress()` / `currentOnRelease()` and logging `ChurchComms.Ptt` / `PTT press` / `PTT release`.
- No `forceMuted` parameter; mute state handled by caller (`SessionScreen`).

File: `android/app/src/main/java/com/churchcomms/operator/media/PttController.kt`
- Lines 19-23: `class PttController(private val media: MediaController, private val scope: CoroutineScope, private val onClearMute: () -> Unit)`
- Lines 49-58: `press(forceMuted: Boolean)`:
  - Line 50: if `media.state.value !is MediaState.Ready` → return (no transmit)
  - Lines 53-55: if `forceMuted` → `onClearMute()` (clear mute before transmit)
  - Lines 56-57: `desired = true`; `applyDesired()`
- Lines 61-64: `release()` sets `desired = false`; `applyDesired()`
- Lines 78-105: `applyDesired()` coalesces via mutex; calls `media.setMicrophoneTransmitting(target)`. If exception or generation mismatch → `reset()` (line 71-76) sets `_transmitting = false`.
- Line 92: transmission only occurs through `media.setMicrophoneTransmitting(target)`; no server-side event emitted directly.

---

## 3. LiveScreen.kt — PTT zone visibility / enabled

File: `android/app/src/main/java/com/churchcomms/operator/ui/LiveScreen.kt`
- Line 29: `fun LiveScreen(state: SessionState, actions: OperatorActions, ...)`
- Lines 34-35: `joined = state.control as? ControlState.Joined`; `me = joined?.room?.operators?.firstOrNull { it.id == joined.participantId }`
- Lines 53-56: StatusChip with `state.transmitting`; no mute/forceMuted reference
- Lines 61-72: **"Large PTT" zone** — purely static `Surface` with `Text("PUSH TO TALK")` and `Text(state.transmitting.toString())`; no `Button`, no `PttButton`, no `pointerInput`, no `onPress/onRelease`, no `enabled` check, no `forceMuted` handling.
- Lines 82-83: connection/audio status only.
- Lines 90-97: grace deadline banner; unrelated.

**Conclusion:** In Live View (`LiveScreen`), the PTT zone is visible but **not interactive**; it is a display label only, not the functional `PttButton` used in `SessionScreen`. Because it has no touch handling, `PttController.press()` is never triggered from Live View, regardless of `ready` or `forceMuted`.

---

## 4. Server logs (node / livekit-server) for TRANSMITTING / setOpenMic

Server running: `node.exe` (PIDs 8948, 10728, 9120) and `livekit-server.exe` (PID 12388).
Log sources checked: `logs/church-comms-20261023-155751.log` (largest, ~3.15MB, 2026-10-23 15:57:51) and nearby.
Commands: `Select-String -Pattern "TRANSMITTING|setOpenMic"` on latest log → **no matches**.
Broader mic-related hits: only livekit `signal connection`, `RTC session` start, `join validated` (room MEDIA, participant SM-T295, identity debf5b67-8124-47e0-9d6f-89bffa7e7c54, node ND_iyoYsWzQd8Rz, version 1.13.10, SDK ANDROID 2.29.1).
No `TRANSMITTING`, `openMic`, `setOpenMic`, or server-side transmission events recorded for this participant in the accessible window.
Implication: Server is not receiving / not logging any PTT transmission events from client — consistent with client button non-interactive.

---

## 5. Exact failure identification (with file/line)

**Primary failure:** `LiveScreen.kt` does not include the working `PttButton`; PTT zone (lines 61-72) is static label only — no `onPress`/`onRelease`, no `enabled`, no interaction with `PttController`. Therefore in Live View, user cannot press to transmit regardless of mute state or media readiness.

**Secondary / contributing:** `SessionScreen.kt` (line 232) passes `enabled = ready` to `PttButton`, ignoring `forceMuted`. `forceMuted` (line 204) only affects chip accent (line 227), banner text (lines 239-242), and directive text, but does **not** disable the button. The button remains enabled when `forceMuted == true` (unless `ready == false`). This is a design gap, but only relevant if the user is on SessionScreen (not LiveScreen).

**Tertiary / client-controller:** `PttController.kt` `press()` (line 49) requires `media.state.value is MediaState.Ready`; if not ready, transmission is silently blocked. `release()` always applies. `forceMuted` triggers `onClearMute()` (line 54) but does not block transmission — it clears mute first.

**No server-side failure confirmed:** Server logs lack transmission events because client never sends them (button not interactive in LiveScreen). Cannot confirm server ignores; only that no `TRANSMITTING` / `setOpenMic` events appear in logs.

**Device log absence:** No `ChurchComms.Ptt` or `PTT press/release` entries across 1000 line window, confirming button press is not occurring / not being handled.

---

## References (exact)

- `android/app/src/main/java/com/churchcomms/operator/ui/LiveScreen.kt` — PTT static zone (61-72), no interaction
- `android/app/src/main/java/com/churchcomms/operator/ui/SessionScreen.kt` — `forceMuted` (204), `PttButton` call (230-235), `enabled = ready` (232), `MuteBanner` (251-271)
- `android/app/src/main/java/com/churchcomms/operator/ui/PttButton.kt` — composable definition (42-48), touch input (91-109), log tags (99, 104)
- `android/app/src/main/java/com/churchcomms/operator/media/PttController.kt` — `press` (49-58), `release` (61-64), `applyDesired` (78-105), `media.setMicrophoneTransmitting` (92)
- ADB device: R9BN805K1GJ (pid 25863), logcat 30/200/1000 lines, zero PTT matches
- Server: `node.exe` (8948/10728/9120), `livekit-server.exe` (12388); log `logs/church-comms-20261023-155751.log`; zero TRANSMITTING / setOpenMic matches
- Activity: `com.churchcomms.operator/.MainActivity` (pid 25863)

---

## Status

Documented only. No fixes proposed or applied. No invented server-side changes. Diagnosis points to missing/interfaced PTT control in `LiveScreen.kt` as the observable failure after APK install.
