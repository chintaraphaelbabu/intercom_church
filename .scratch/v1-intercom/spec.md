# v1-intercom

First working release of Church Production Comms: the Director's laptop runs the server and a browser client; Operators join from Android phones over the church Wi-Fi and talk with push-to-talk.

## Source of truth

- Design: `docs/design.md`
- Plan: `docs/plan.md`
- Terms: `GLOSSARY.md`
- Decisions: `docs/adr/`
- Native WebRTC guardrails: `docs/webrtc-notes.md`

If this file and the design disagree, the design wins.

## Tickets

| # | Ticket | Blocked by |
|---|---|---|
| 01 | Walking skeleton: discovery and debug roster | — |
| 02 | Director's voice on the Operator's phone | 01 |
| 03 | Pocket audio: locked screen and foreground service | 02 |
| 04 | Operator PTT reaches the Director | 02 |
| 05 | Whole room at once, with volumes | 03, 04 |
| 06 | Named rooms: create, list, join, end | 02 |
| 07 | Camera identity and roster | 06 |
| 08 | Hot-mic mute with Operator override | 04, 07 |
| 09 | Director absence: countdown, grace, close | 06, 07 |
| 10 | Operator reconnect without duplicates | 07 |
| 11 | Headset unplug and audio focus | 03, 04 |
| 12 | Operator Mixer/Live views and join failure states | 05, 07, 08, 09, 10, 11 |
| 13 | Director Setup/Live views and diagnostics | 05, 07, 08, 09, 11 |
| 14 | Installable release and one-click server | 12, 13 |
| 15 | Prove the Definition of Done | 14 |

## Frontier

Start with 01. After it lands, 02 is the only unblocked ticket. 03 and 04 can then proceed independently; everything else follows the table.
