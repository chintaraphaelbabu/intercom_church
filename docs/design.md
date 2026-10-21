# Church Production Comms — Design

Status: agreed 2026-10-21. This document supersedes `church_comms.md`, which was a rough draft. Vocabulary lives in [GLOSSARY.md](../GLOSSARY.md).

## 1. Product

A voice intercom for the video team during a church service.

- The **Director** runs the service from a Windows 11 laptop.
- **Operators** work from Android phones, normally with the phone in a pocket and a headset on.
- Everyone is on the church Wi-Fi.
- Everyone can hear everyone; several people can talk at once.
- Today: 1 Director + 4 Operators. Planned ceiling: 10 people in a room.
- Audio only. No accounts, no cloud, no chat, no video, no recording.

## 2. Topology

```
  Operator (Android) ─┐
  Operator (Android) ─┤
  Operator (Android) ─┼── church Wi-Fi ──┬── LiveKit SFU      ┐
  Operator (Android) ─┘                   ├── control server  ┘ director's laptop
                                          └── director browser
```

Two processes run on the Director's laptop:

1. **LiveKit server** (`livekit-server.exe`) — media only.
2. **Church Comms control server** (Node/TypeScript) — rooms, camera slots, presence, mute, discovery, tokens, and the Director web app.

The Director opens `http://localhost:<port>/` on that laptop. `localhost` is a secure context, so the browser grants microphone access without TLS certificates.

## 3. Decisions

| Decision | Choice | Why |
|---|---|---|
| Media plane | Self-hosted LiveKit | [ADR 0001](adr/0001-livekit-media-plane.md) |
| Server host | Director's laptop | [ADR 0002](adr/0002-server-on-director-laptop.md) |
| Director mute | Advisory; Operator can take the mic back | [ADR 0003](adr/0003-director-mute-is-advisory.md) |
| Control server | Node.js + TypeScript | Same language as the Director web app; Node already on the laptop; one shared protocol package |
| Director client | Browser app served by the control server | No install, no updater |
| Operator client | Kotlin + Jetpack Compose, native | Foreground service, audio routing, locked-screen behavior |
| Rooms | Named, created by the Director, ephemeral | No database, no accounts |
| Discovery | mDNS/DNS-SD + manual IP fallback | Operators must join without typing addresses |
| Operator mic | Push-to-talk | Hands and noise |
| Director mic | Open mic with a toggle | Hands are on the switcher |
| Volumes | Per-participant + master, on both clients, reset each session | Director and Operators balance voices themselves |
| Camera slots | Numbers 1–10, one occupant each | Identity without accounts |
| Capacity | 10 people per room including the Director | Hard cap chosen by the Director |

## 4. Start of service

1. Director double-clicks `start-church-comms.bat`.
2. The console starts LiveKit and the control server, prints the LAN address and protocol version, and opens the Director page in the browser.
3. The Director creates a room (default name `MEDIA`).
4. The Director opens **Mixer View**, checks the headset, and sets volumes as Operators arrive.
5. The Director switches to **Live View** and turns open mic on.
6. Closing the console window ends the service and destroys the room. Rooms do not survive a restart.

## 5. Operator join

1. App opens; mDNS discovers the laptop advertising `_church-comms._tcp.local`.
2. The join screen lists active rooms. If discovery fails, the screen says exactly what failed (no Wi-Fi, LAN unreachable, mDNS unavailable, control server unreachable) and offers **Retry**; a manual address exists only under **Advanced**.
3. Operator picks a room, enters a name, and picks a free camera number (1–10).
4. The server validates the slot and returns a session token plus a LiveKit token.
5. The app connects to LiveKit, enters **Mixer View** for volume setup, then the Operator switches to **Live View**.

## 6. Talking

- **Operator:** hold the large PTT control to transmit; release to stop. A fresh press gives a short vibration and a visible transmitting state. There are no confirmation dialogs.
- **Director:** open mic is on/off via one toggle, on both views.
- A stuck or accidental PTT is handled by the Director's **Mute** button:
  - the Operator's mic is disabled for the whole room;
  - the Operator sees a persistent "Mic disabled by director" banner and cannot transmit with the touch already down;
  - holding PTT again with a fresh press restores the mic and transmits;
  - mute clears if the Operator reconnects;
  - the Director's roster always shows the current mic state.

Directors and Operators can mute themselves locally without affecting anyone else, using their own master volume, but there is no separate "mute for me" control per person: the volume slider at 0 is that control.

## 7. Director disconnect and room end

- **End room** in the Director's Live View closes the room immediately; Operators return to the join screen with "Room closed by director".
- If the Director's browser disconnects unexpectedly, the room enters a **5-minute grace period**:
  - Operators stay connected and can keep talking to each other;
  - a countdown is visible ("Director offline — room closes in 4:32");
  - the room is hidden from the join list for new Operators;
  - if the Director returns within 5 minutes, the countdown is cancelled and the room is restored;
  - after 5 minutes the room and all camera slots are destroyed.
- If the laptop itself dies, Operators see `SERVER_UNAVAILABLE` and retry. Nothing is restored, because rooms are in memory.

## 8. Operator reconnect

- On Wi-Fi loss, the foreground service stays alive and the app shows **Reconnecting** with the attempt number.
- The client retries up to **5 times** with bounded exponential backoff.
- On success it resumes with the stored session token, reclaiming the same camera number without creating a duplicate.
- After 5 failures it shows an error with **Retry** and **Leave**.
- A force-mute does not survive reconnect.

## 9. Screens

### Operator

- **Join** — discovery state, room list, name, camera number.
- **Mixer View** — participant roster with per-participant volume and level meter, master volume, "Go live".
- **Live View** — room name, Operator name, camera number, connection state, large PTT zone, transmitting state, master volume, settings entry. No roster, no speaking indicators for others.
- **Diagnostics** — Wi-Fi, IP, discovery, control connection, LiveKit state, latency, jitter, loss, input/output route, mic permission, foreground-service status, battery-optimization status.
- **Setup help** — OnePlus/OxygenOS battery and background restrictions.

### Director

- **Setup/Mixer** — create room, room name, roster with camera numbers, per-Operator volume and level, mute buttons, headset check.
- **Live** — open-mic toggle, room name, roster with mute buttons, connection status, server health, **End room**.
- **Diagnostics** — same signals as the Operator, plus LiveKit server health.

## 10. Audio

- LiveKit forwards Opus; the clients own capture/render.
- Opus 48 kHz mono, 20 ms frames.
- PTT toggles the published microphone track between muted and unmuted; it must not renegotiate the peer connection on every press.
- Echo cancellation, noise suppression, and AGC enabled on both clients, tuned for speech.
- Audio focus: request transient/exclusive focus on join, duck other media, restore on leave.
- Headset routing preferred. If the headset disconnects mid-service, output is muted and a prompt offers reconnect or explicit speaker use; the app never silently switches to the speaker.
- Target: **≤200 ms mouth-to-ear on wired headsets** on healthy Wi-Fi. Bluetooth is best-effort and documented as slower.

## 11. Control protocol

Transport: one WebSocket at `ws://<laptop>:<port>/ws`, versioned JSON, protocol `v1`. LiveKit owns SDP/ICE, so the draft's `webrtc_offer` / `webrtc_answer` / `webrtc_ice` messages are dropped.

Client → server:

| Message | Purpose |
|---|---|
| `hello` | protocol version, client type, app version, optional session token |
| `create_room` | Director creates a named room |
| `end_room` | Director closes the room immediately |
| `join_room` | room, display name, camera number, optional session token |
| `leave_room` | leave cleanly |
| `set_camera` | change camera number |
| `set_mute` | Director mutes an Operator |
| `clear_mute` | Operator clears their own mute (fresh PTT) |
| `ping` | keepalive |

Server → client:

| Message | Purpose |
|---|---|
| `server_info` | protocol version, server id, LiveKit URL, server time |
| `room_list` | joinable rooms and their state |
| `joined` | participant id, session token, LiveKit token, room snapshot |
| `participant_joined` / `participant_left` / `participant_updated` | roster changes |
| `director_state` | present/absent plus grace deadline |
| `mute_state` | who is muted and by whom |
| `room_closed` | reason |
| `error` | stable code + human message |
| `pong` | keepalive |

Rules:

- The server is authoritative for room membership, camera slots, mute state, and Director presence.
- Protocol models live in `protocol/` with JSON fixtures shared by the server and Android tests.
- Unknown message types are ignored with a logged warning; version mismatch is refused at `hello`.

## 12. Discovery

- Service type: `_church-comms._tcp.local`.
- TXT records: `proto=1`, `path=/ws`, `livekit=<ws url>`, `roomcount=<n>`, `name=<display name>`.
- The Director web app is not advertised; it is localhost-only.
- Manual IP/port entry is available only under Advanced/Diagnostics.
- Discovery failures are reported distinctly, never as "server offline".

## 13. Connection states

`NO_NETWORK`, `DISCOVERING`, `SERVER_FOUND`, `CONNECTING`, `CONNECTED`, `WEBRTC_CONNECTING`, `READY`, `RECONNECTING`, `SERVER_UNAVAILABLE`, `MEDIA_FAILED`.

Server failure and Director absence are different states and must never be conflated in the UI.

## 14. Android specifics

- `minSdk 30` (Android 11, covers the test tablets), `targetSdk 36` (Android 16, the OnePlus).
- Exactly one native WebRTC stack: the one `io.livekit:livekit-android` declares. No mediasoup, no separately pinned `webrtc-sdk`, no direct `org.webrtc` dependency. See [webrtc-notes.md](webrtc-notes.md).
- LiveKit Android `2.29.1` (transitive `io.github.webrtc-sdk:android-prefixed:150.7871.01`) and LiveKit server `1.13.10` are pinned. Upgrades are deliberate and re-smoke-tested.
- Ship `arm64-v8a` and `armeabi-v7a`; `x86_64` only in debug builds.
- Foreground service with `microphone` type, declared permission, and a persistent notification showing the room and a **Leave** action.
- Microphone and notification permissions requested in context; refusal is explained, not silently retried.
- The service keeps the CPU awake only while connected; no wake lock when disconnected.
- Audio continues with the screen locked and the app backgrounded.
- LAN traffic to `ws://` and LiveKit requires a cleartext exception for the local network.
- No recording APIs, no audio payload logging.

## 15. Security and privacy

- Trust boundary is the church LAN. Rooms are named and visible to anyone on that Wi-Fi who has the app.
- No passwords or accounts in V1. Session tokens are per-join and only prevent duplicate sessions.
- Audio never leaves the LAN. No cloud STUN/TURN; LiveKit runs on the laptop.
- No audio recording, no transcription, no message content logging.

## 16. Definition of Done

- 2-hour soak at 5 clients on owned devices (1 OnePlus + 2 tablets + 2 browsers), screen locked for the phone portion.
- 10-client load test for 5 minutes on borrowed phones (Sunday), documented but not a gate for the first working release.
- 4 Android + 2 browser clients talking simultaneously.
- Locked-screen audio, headset disconnect/reconnect, Wi-Fi drop and recovery, room end and 5-minute expiry, force-mute and override.
- Diagnostics identify each failure mode correctly.

## 17. Out of scope for V1

Accounts, cloud, recording, transcription, chat, video, file sharing, iOS, Bluetooth-inline-button PTT, volume-button PTT, cross-room audio, per-room permissions. Additional rooms (security, ushers) need no redesign: the Director creates them the same way.
