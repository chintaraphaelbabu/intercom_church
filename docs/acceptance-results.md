# Acceptance results — Ticket 15 (Prove Definition of Done)

Branch: `ticket/15-dod` (base `b257005`).
Run date: 2026-10-23. Subagent execution environment (no physical Android/borrowed-phone access).

## Hardware available (from `docs/acceptance.md`)

| Device | Role | Status for this run |
|---|---|---|
| Laptop `LAPTOP-MBU6BG9M` | Director + server | Used for load test (control plane) |
| Samsung SM-T295 `R9BN805K1GJ` | Operator | **Not connected** — USB/debug not available in this env |
| Second Samsung SM-T295 | Operator | **Not available** — not in worktree environment |
| OnePlus Nord CE 5 | Operator | **Not available** — owned but unreachable |
| Borrowed phones (Sunday only) | Load test / 10-client | **Not available** — borrow window missed; 10-client test executed on control plane only |

> **Residual hardware gap:** All audio/soak tests require physical devices that were not in the worktree environment. Results below document protocol execution, control-plane evidence, and the exact gaps that must be re-run on-site.

---

## 1. Two-hour soak at five owned clients (locked screens)

**Protocol:** `tools/acceptance/soak.ps1 -Serial R9BN805K1GJ -Minutes 120 -Label "15-two-hour-soak"` (per `docs/acceptance.md`). Requires device joined, room locked, screen locked, process alive, audio route unchanged, no unplanned disconnect.

**Status:** NOT EXECUTED — device `R9BN805K1GJ` not reachable via ADB in this environment.

**Evidence prepared:** Script exists at `tools/acceptance/soak.ps1`; output directory `docs/acceptance-results/` created by script; no log/file produced.

**Pass criteria (pending on-site):** no crash, no ANR, process alive (`pidof com.churchcomms.operator`), audio route unchanged (`getActiveMicrophone` / audio-route check), no unplanned disconnect text, person confirms audio start/end.

---

## 2. Simultaneous talkers — 4 Android + 2 browser operators

**Protocol:** All six clients join same room, transmit at once (`?role=operator` on browsers; app on Android), confirm stable mix, record which devices confirmed audio.

**Status:** NOT EXECUTED — requires 4 Android devices + 2 browser clients on real LAN/Wi-Fi.

**Pass criteria (pending):** stable mix, no stuck mic, no renegotiation storm, level meters move on all six, every client hears other five.

---

## 3. Ten-client load test + room cap enforcement (5 min)

**Protocol:** `node tools/load-test.mjs --clients 10 --minutes 5 --room LOAD-TICKET15-5MIN`

**Status:** EXECUTED — control plane only (no audio/media). Uses default `ws://127.0.0.1:8765/ws`; server responded; 12 clients (1 Director + 10 Operators) + cap-check (11th refused with `ROOM_FULL` verified by script logic; script reports `ok: true`).

**Results (from `load-test-5min-output.txt`):**

```json
{
  "room": "LOAD-TICKET15-5MIN",
  "clients": 12,
  "operators": 10,
  "durationMinutes": 5,
  "pings": 720,
  "rttMs": {
    "average": 0.6,
    "p50": 0.6,
    "p95": 1,
    "p99": 1.4,
    "max": 1.7
  },
  "failures": [],
  "ok": true
}
```

| Metric | Value | Target / note |
|---|---|---|
| Duration | 5 min | Required |
| Clients | 10 Operators + 1 Director | Required |
| Pings | 720 | 5000 ms interval |
| Failures | 0 | Required |
| Room cap (`ROOM_FULL`) | Verified by script (`checkCap: true`) | Required — 11th refused |
| p50 RTT | 0.6 ms | Control-plane; not acoustic |
| p95 RTT | 1.0 ms | Control-plane |
| p99 RTT | 1.4 ms | Control-plane |
| Max RTT | 1.7 ms | Control-plane |

**Evidence file:** `load-test-5min-output.txt` (committed reference; full JSON preserved).

**Residual gap:** This is control-plane load, not audio/media load. A true 10-client audio load requires 10 real phones on the church LAN; borrowed phones unavailable in this session.

---

## 4. Failure checklist

Per `docs/acceptance.md` |

| Failure | How | Expected | Status / Evidence |
|---|---|---|---|
| Wi-Fi drop | Turn Wi-Fi off on one Operator | `RECONNECTING` within 2 s; ≤5 bounded attempts; same camera on restore; one roster entry | **NOT TESTED** — requires live device + Wi-Fi control |
| Server restart | Stop control server | `SERVER_UNAVAILABLE`; never "director left"; Retry available | **PARTIAL** — script reconnects to `ws://127.0.0.1:8765`; server restart not injected |
| Headset unplug | Unplug mid-session | Output stops; prompt; speaker not used automatically; reconnect resumes | **NOT TESTED** — requires headset + device |
| Room end | Director End room | Every Operator returns with "Room closed by director"; room gone | **NOT TESTED** — requires Director browser session |
| Mute and override | Director mutes transmitting Operator | Audio stops immediately; banner; in-progress touch does not unmute; fresh press transmits | **NOT TESTED** — requires audio + UI interaction |
| Director return before expiry | Close Director tab, reopen within 5 min | 5:00 countdown visible, then cancelled; roster restored | **NOT TESTED** — requires browser + timing |
| Director return after expiry | Close tab >5 min | Countdown reaches 0:00; room destroyed; join list removed | **NOT TESTED** — requires browser + timing |

**Evidence prepared:** Checklist table above; `docs/acceptance.md` references; no pass/fail logs produced for untested items.

---

## 5. Latency, jitter, packet loss

Per `docs/acceptance.md`: receiver `getStats` (`jitterBufferDelay / jitterBufferEmittedCount`, `currentRoundTripTime`, `jitter`, `packetsLost`, `totalPacketSendDelay`); AudioFlinger `dumpsys media.audio_flinger`; acoustic loopback if listener available (200 ms target only proven acoustically).

**Status:** NOT MEASURED — requires active media session on real Android/browser endpoints.

**Evidence prepared:** Protocol documented; measurement tools (`getStats`, `adb shell dumpsys media.audio_flinger`) known; no values recorded.

**Control-plane latency (from load test, not acoustic):**
- Wired/control RTT p50 0.6 ms, p95 1.0 ms, p99 1.4 ms, max 1.7 ms.
- This does NOT prove 200 ms mouth-to-ear acoustic target.

---

## Residual hardware / access gaps

1. **Android devices unreachable:** `R9BN805K1GJ` and second tablet not present; `adb` not available for device selection.
2. **Borrowed phones unavailable:** 10-client load performed on control plane; real 10-phone audio load requires Sunday-borrow window or alternative borrow.
3. **No headset / acoustic loopback:** Latency, jitter, loss unmeasured; 200 ms target unproven.
4. **No second browser / Director session:** Failure checklist items 4–7 (room end, mute, director return) untested.
5. **Server restart / Wi-Fi drop not injected:** Only natural reconnect behavior observed via load-test reconnect logic.

**Recommendation:** Schedule on-site run (Sunday borrow + connected tablets + OnePlus + laptop Director) and re-run soak (2 h), simultaneous talkers (6 clients), failure checklist, and acoustic loopback. Update this file with device IDs, log filenames, and measured values.

---

## Committed artifacts

- `docs/acceptance-results.md` (this file)
- `load-test-output.txt` (1 min control test; reference)
- `load-test-5min-output.txt` (5 min required test; primary evidence)
- `tools/acceptance/soak.ps1` (protocol preserved; no output produced)
- `.scratch/v1-intercom/issues/15-prove-definition-of-done.md` (ticket updated below)
