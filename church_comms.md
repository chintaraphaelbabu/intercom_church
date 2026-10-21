# Church Production Comms — Android Client Implementation Spec

## Goal
Turn the existing Android mock/prototype into the real production intercom client.

The Android app is an **operator client**, not a generic chat app. It must connect to the local Church Production Comms server over the church LAN and provide reliable, low-latency voice communication.

## Locked Product Requirements

- Android only for V1.
- Target current Android phones, including OnePlus/OxygenOS devices used by the church.
- No accounts.
- No cloud dependency for core operation.
- No chat, video, file sharing, recording, or church-management features.
- Operator normally locks the phone and puts it in a pocket.
- Audio must continue while the screen is locked/backgrounded.
- Operators are muted by default.
- Operator microphone is active only while PTT is pressed.
- Multiple operators may transmit simultaneously.
- Everyone in the room hears everyone else.
- Audio is speech-focused.
- Preferred codec: Opus over WebRTC.
- Use AEC, noise suppression, AGC where appropriate, jitter handling and packet-loss concealment.
- Audio should have priority over ordinary phone media; duck other media where Android permits.
- Wired/Bluetooth headset routing should work, with phone-audio fallback.
- No audio recording.
- Operator should not need to see who is transmitting.
- Operator needs a simple comms-volume control.
- PTT feedback: visual state + brief vibration.
- No confirmation dialogs during PTT.

## UX

### Join
1. Discover the server using mDNS/DNS-SD.
2. Show active rooms.
3. Operator selects a room.
4. Enter operator name.
5. Select available camera assignment.
6. Join.
7. Connect WebRTC.
8. Enter listening state.

### Main Operator Screen
Keep it intentionally minimal:

- Room name
- Operator name
- Camera assignment
- Connection status
- Large PTT button/zone
- Listening/transmitting state
- Comms volume
- Small settings/troubleshooting entry

The app should feel like an intercom, not a social application.

## PTT

### Primary
Large on-screen PTT button.

Press:
- enable microphone
- begin outbound WebRTC audio
- vibrate briefly
- show transmitting state

Release:
- immediately disable microphone
- return to listening state

### Hardware PTT
Support headset inline-button PTT where Android/device APIs permit it.

The implementation must gracefully handle devices where the headset button cannot be intercepted reliably.

### Experimental volume-button PTT
Do NOT make simultaneous volume-button PTT a required V1 feature.

If implemented, isolate it behind a capability check/experimental setting because Android/OEM restrictions may prevent reliable operation while locked.

## Background / Locked Screen

This is P0.

Use a foreground service for active comms.

Requirements:
- audio continues with screen off
- audio continues while app is backgrounded
- notification clearly indicates active comms
- service survives normal activity recreation
- reconnects after transient network changes
- does not unnecessarily keep CPU awake when disconnected

Handle Android battery/background restrictions explicitly.

Include an in-app setup/troubleshooting screen explaining battery optimization/background restrictions, especially for OnePlus/OxygenOS.

## Audio Architecture

Use WebRTC.

Recommended logical pipeline:

Microphone
→ Android AudioRecord/WebRTC audio source
→ speech processing
→ Opus encoder
→ WebRTC uplink
→ local SFU
→ downstream WebRTC audio
→ jitter buffer/decode
→ Android audio output/headset

Do not implement raw microphone streaming over WebSocket.

Do not record audio.

## Server Protocol

The Android client must communicate with the server using a clearly versioned protocol.

Suggested control messages:

- `hello`
- `server_info`
- `list_rooms`
- `create/join_room`
- `leave_room`
- `participant_joined`
- `participant_left`
- `participant_updated`
- `camera_assignment`
- `mute_state`
- `director_state`
- `connection_state`
- `webrtc_offer`
- `webrtc_answer`
- `webrtc_ice`
- `test_comms`
- `error`

Keep protocol definitions separate from UI code.

## mDNS Discovery

Discover service:

`_church-comms._tcp.local`

Discovery must return:
- hostname
- IP/address
- control port
- service metadata/version

If mDNS fails, do not falsely report "server offline".

Differentiate:
- no Wi-Fi
- LAN unreachable
- mDNS unavailable
- TCP/control unavailable
- signaling failure
- WebRTC/media failure

Provide manual server address only under advanced/troubleshooting settings.

## Connection State

Implement explicit states:

- `NO_NETWORK`
- `DISCOVERING`
- `SERVER_FOUND`
- `CONNECTING`
- `CONNECTED`
- `WEBRTC_CONNECTING`
- `READY`
- `RECONNECTING`
- `SERVER_UNAVAILABLE`
- `MEDIA_FAILED`

The UI must distinguish server failure from director absence.

If the director disconnects while the server remains alive, operators remain connected.

## Reconnection

On transient network loss:
1. keep foreground service alive
2. detect connection loss
3. reconnect control channel
4. renegotiate WebRTC as needed
5. restore room membership
6. restore camera assignment
7. return to READY

Use bounded exponential backoff.

Do not create duplicate participant sessions.

## Director / Room Semantics

The client must support:

- director presence state
- server presence state
- participant rename
- camera assignment
- server-authoritative mute state

Do not implement director reassignment logic solely on Android. The server is authoritative.

If the original director disconnects:
- Android should show the correct server/director state.
- Do not locally invent a new director.

## Diagnostics

Normal live UI should stay clean.

A troubleshooting screen may show:

- Wi-Fi connected
- IP address
- server discovered
- control connection
- signaling state
- WebRTC state
- round-trip latency where measurable
- jitter
- packet loss
- audio input route
- audio output route
- microphone permission
- foreground service status
- battery optimization status

Never display raw diagnostic noise on the main live screen.

## Permissions

Request only necessary Android permissions.

Handle:
- microphone permission
- notification permission where required by Android version
- network access
- foreground-service requirements

Do not request unrelated permissions.

## Audio Focus / Routing

Implement Android audio focus appropriately.

Goals:
- prioritize intercom audio
- duck other media where permitted
- restore normal media behavior after leaving comms
- detect headset connect/disconnect
- select appropriate input/output route
- fall back safely if headset disappears

Do not silently route private comms to speaker if a headset is expected unless the user explicitly enables that behavior.

## Security

V1 is local-LAN-first.

- No cloud audio.
- No account system.
- Random room IDs.
- Server validates room membership.
- Do not expose audio streams outside the room.
- Do not log audio content.
- Avoid logging personally unnecessary data.

## Performance Targets

Target:
- low practical conversational latency
- stable audio for 2+ hour services
- no ANRs
- no memory leak
- minimal battery impact while actively connected
- smooth operation on current OnePlus devices

## Testing

Must test:

1. Screen on + wired headset.
2. Screen locked + wired headset.
3. App backgrounded.
4. Bluetooth headset if available.
5. Headset disconnect/reconnect.
6. Wi-Fi transient interruption.
7. Server restart.
8. Director client disconnect while server remains alive.
9. Multiple simultaneous PTT speakers.
10. 6 participants.
11. Target load of 15 participants.
12. 60–120 minute continuous session.
13. OnePlus/OxygenOS background restrictions.
14. Microphone permission denied/granted.
15. Notification permission behavior on supported Android versions.

## Implementation Rules

- Do not replace the existing design with a generic template.
- Preserve the approved visual design where practical.
- Replace mock data and fake connection states with real state.
- Separate UI, networking, WebRTC, audio, discovery and service layers.
- Use Kotlin.
- Prefer Jetpack Compose if the existing project already uses it.
- Keep protocol models strongly typed.
- Make server URL/port configurable only through advanced settings.
- Never hard-code a development laptop IP into production code.
- Add structured logging with levels.
- Do not log microphone/audio payloads.

## Suggested Package Structure

`ui/`
`ui/screens/`
`ui/components/`
`audio/`
`webrtc/`
`network/`
`discovery/`
`service/`
`protocol/`
`models/`
`diagnostics/`
`settings/`

## Definition of Done

The Android client is NOT complete when the UI looks correct.

It is complete when:

- a real server can be discovered on the LAN
- an operator can join a real room
- WebRTC connects
- director audio is heard on the phone
- PTT sends operator audio
- simultaneous speakers work
- locked-screen audio works
- wired headset PTT works where supported
- reconnection works
- server/director states are correctly represented
- diagnostics identify failures accurately
- a 60–120 minute real-world test is stable
