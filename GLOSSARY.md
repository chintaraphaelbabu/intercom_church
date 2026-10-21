# Church Production Comms

Live voice coordination between the video director and camera operators during a church service.

## Roles

**Director**:
The video director who runs the service from a laptop and cues camera operators live.
_Avoid_: Admin, host, operator

**Operator**:
A camera operator who talks from an Android phone, holding push-to-talk while speaking.
_Avoid_: User, participant, cameraman

**Participant**:
Any person currently joined to a room, whether Director or Operator.
_Avoid_: Member, client, user

## Live audio

**Room**:
A named live audio space created by a Director that Operators join to hear and speak to each other. It ends when the Director ends it, or five minutes after the Director disconnects.
_Avoid_: Channel, call, meeting, session

**Push-to-Talk (PTT)**:
Holding a control to transmit, and releasing it to stop transmitting.
_Avoid_: Hold-to-speak, hot mic

**Open Mic**:
A Director microphone that transmits without a hold gesture, governed by a toggle.
_Avoid_: Always-on, hands-free

**Mute**:
A room-wide state set by the Director that stops an Operator's microphone from transmitting. The Operator can restore their own microphone.
_Avoid_: Monitor mute, silence, block

**Volume**:
A listener's own gain for one other Participant, set during setup and reset every session.
_Avoid_: Comms volume, level

**Camera Assignment**:
The camera number an Operator claims when joining a room so others can identify them. Up to ten numbers per room, one occupant each.
_Avoid_: Role, station, slot

## Screens

**Mixer View**:
The setup screen listing Participants with their volumes and levels.
_Avoid_: Setup, settings, mixer

**Live View**:
The minimal screen used during a service, holding the talk control and connection state.
_Avoid_: Main screen, home
