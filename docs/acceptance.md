# Acceptance runbook (Definition of Done)

Design: [design.md](design.md) §16. Tickets: `.scratch/v1-intercom/issues/15-prove-definition-of-done.md`.

Record results under `docs/acceptance-results/` (gitignored logs stay in the same
folder; markdown results are committed). A result without a device, a duration,
and a log or measurement is not evidence.

## Hardware available

| Device | Android | Role | Notes |
|---|---|---|---|
| Laptop `LAPTOP-MBU6BG9M` | Windows 11 | Director + servers | Latest run 2026-10-22 |
| Samsung SM-T295 `R9BN805K1GJ` | 11 | Operator | Connected over USB |
| Samsung SM-T295 (second) | 11 | Operator | Owned; connect when available |
| OnePlus Nord CE 5 | 16 | Operator | Owned; connect when available |
| Borrowed phones | — | Load test | Sunday only |

## 1. Two-hour soak, five owned clients

Clients: Director browser, OnePlus, two tablets, second browser Operator
(`?role=operator`). Lock the Android screens. See ticket 15.

```powershell
# On each phone: join MEDIA, confirm READY, then start the sampler.
powershell -ExecutionPolicy Bypass -File tools\acceptance\soak.ps1 `
  -Serial R9BN805K1GJ -Minutes 120 -Label "15-two-hour-soak"
```

Pass: no crash, no ANR, process alive, audio route unchanged, no unplanned
disconnect text, and a person confirms audio at the start and end.

## 2. Simultaneous talkers

Four Android clients and two browser Operator clients transmit at once. Every
client must hear the other five; record which devices confirmed audio.

Pass: stable mix, no stuck mic, no renegotiation storm, level meters move.

## 3. Ten-client control load and room cap

With no active room:

```powershell
node tools\load-test.mjs --clients 10 --minutes 5
```

This creates one Director, ten Operators, verifies the 11th person is refused
with `ROOM_FULL`, and runs five minutes of control pings. Record p50/p95/p99 RTT
and any failures. This measures control-plane load, not audio.

## 4. Failure checklist

| Failure | How | Expected |
|---|---|---|
| Wi-Fi drop | Turn Wi-Fi off on one Operator | `RECONNECTING` with attempt number within 2 s; at most 5 bounded attempts; same camera on restore; one roster entry |
| Server restart | Stop the control server | `SERVER_UNAVAILABLE`, never "director left"; Retry available |
| Headset unplug | Unplug mid-session | Output stops, prompt appears, speaker is not used automatically; reconnect resumes |
| Room end | Director End room | Every Operator returns to join with "Room closed by director"; room gone from list |
| Mute and override | Director mutes a transmitting Operator | Audio stops immediately; banner; in-progress touch does not unmute; fresh press transmits |
| Director return before expiry | Close Director tab, reopen within 5 min | 5:00 countdown visible, then cancelled; roster restored |
| Director return after expiry | Close tab for >5 min | Countdown reaches 0:00; room destroyed; join list no longer shows it |

## 5. Latency, jitter, loss

Record wired and wireless:

- Receiver `getStats`: `jitterBufferDelay / jitterBufferEmittedCount`,
  `currentRoundTripTime`, `jitter`, `packetsLost`, `totalPacketSendDelay`.
- AudioFlinger active track latency (`dumpsys media.audio_flinger`) as a
  system-buffer reading, not an acoustic measurement.
- A mouth-to-ear acoustic loopback if the user is available. The 200 ms target
  is only proven acoustically.

Write the numbers and the residual risks into the ticket's Answer.
