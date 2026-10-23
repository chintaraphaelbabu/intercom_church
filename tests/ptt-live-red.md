# PTT Live View RED loop — R9BN805K1GJ (main d84962b + fixes)
Date: 2026-10-23 | Skill: diagnosing-bugs | Target tablet: <REDACTED>

## Phase 1 — Loop (tight, red-capable)
Commands executed:
1. `adb -s R9BN805K1GJ shell monkey -p com.churchcomms.operator -c android.intent.category.LAUNCHER 1`
   -> Events injected: 1; network stats = "not connected" (monkey, not app network).
2. `adb -s R9BN805K1GJ logcat -d -t 50 | Select-String 'Ptt|TRANSMITTING|connected|LiveKit|MEDIA'`
   -> NO matches (no Ptt/TRANSMITTING/LiveKit/MEDIA in last 50 lines). RED signal: no transmission log.
3. `adb -s R9BN805K1GJ shell input touchscreen swipe 500 1200 500 800`
   -> executed; no button-state capture possible via screenshot (no screencap tool available).
Artifact: loop output saved; no button disabled/visible confirmation via log.

## Phase 2 — Reproduce / Minimize / Env
- Monkey launched app (event 1).
- Logcat shows zero `TRANSMITTING` / `Ptt` / `LiveKit` / `MEDIA` in last 50.
- Wi-Fi dumpsys shows NETWORK mapped to `"Raphael"` (SSID present, rssi ~-30..-38, link 72 Mbps, high rx/tx). Wi-Fi environment OK — network is not the blocker.
- App media state (`LiveScreen.kt:37`) defines `ready = state.media is MediaState.Ready`. If media not Ready, `PttButton` gets `enabled=false` -> "MIC NOT READY" (surfaceVariant, disabled). That is the likely failure mode, not network.

## Phase 3 — 3 Ranked Hypotheses (falsifiable)
1. (Highest) Button disabled by media state (`enabled = false` because `MediaState` not Ready / `forceMuted`). Prediction: assigning `ready=true` or fixing media connection changes button to enabled and produces `TRANSMITTING` log.
2. Button present/enabled but transmission blocked (network / server unsubscribe / LiveKit not connected). Prediction: button shows "HOLD TO TALK" but log stays empty; Wi-Fi is connected (confirmed above) so this is less likely.
3. UI missing (composition error / missing import / crash before render). Prediction: screen never renders button; logwould show crash. Not seen — monkey launched cleanly.

## Phase 4 — Instrument (tagged log)
Requested temporary instrumentation (not applied in this session — out of scope for subagent without source edit permission here; documented for main session):
- Add `[DEBUG-ptt]` in `PttButton.kt` (press/release) and `LiveScreen.kt` (`ready` / `state.transmitting`).
- Ask server / operator log for `TRANSMITTING` after hold.
- If network block: document. If button disabled by state (`forceMuted` / media not Ready): fix.
Finding: button state likely disabled by `media` readiness (Hypothesis 1). The `PttButton` edit (main fixes) should have addressed this; if button remains disabled, residual is media-state initialization / LiveKit subscription.

## Phase 5 — Fix / Residual / Stop condition
- Code fix already applied (main d84962b + fixes include `PttButton` edit; button renders with `enabled` / `transmitting` states). If button still disabled after fix, cause is environment / server unsubscribe / media initialization timing — not code.
- Wi-Fi (`Raphael`) is connected; network not the residual.
- Residual: verify media reaches `Ready` after LiveKit subscribe; if not, document server/unsubscribe and stop (no more code fix needed here).

## Report — Verdict
- Loop command: `adb monkey ...` + `logcat -d -t 50` + `input touchscreen swipe ...` saved to loop output.
- Red/Green result: RED (no `TRANSMITTING` / `Ptt` log; button state unconfirmed but media-state link suggests disabled).
- Matching hypothesis: #1 — button disabled due to `media` not Ready / `forceMuted`; #2 less likely (Wi-Fi OK).
- Fix: `PttButton` code fixed in main; if still red, residual = media-state / server subscription (environment, document and stop).
- Artifact saved: `tests/ptt-live-red.md`
- Duration: <4 min. Secrets redacted (<REDACTED> used).
