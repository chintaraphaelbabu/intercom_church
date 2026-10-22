# intercom_church

Voice intercom for the church video team: the video director on a laptop, camera operators on Android phones, all on the church Wi-Fi, all able to hear and talk to each other.

## Documents

- [Design](docs/design.md) — the agreed product and technical design.
- [Plan](docs/plan.md) — build order and what each milestone proves.
- [Setup](docs/setup.md) — install and run the Director laptop and Operator phones.
- [Glossary](GLOSSARY.md) — the words this project uses.
- [Native WebRTC notes](docs/webrtc-notes.md) — the previous mediasoup failure and the guardrails that prevent it.
- [ADRs](docs/adr/) — decisions worth remembering.
- [church_comms.md](church_comms.md) — the original rough draft, superseded by the design.

## Run the Director laptop

1. Install Node.js 24 or newer (one time).
2. Double-click `tools/start-church-comms.bat`.

The launcher applies the Windows firewall rules (one UAC prompt), downloads the
pinned LiveKit server on first run, builds the control server and Director page
if they are missing, starts both processes, writes logs under `logs/`, and opens
`http://localhost:8765/`. While a room is active it keeps the laptop awake.
Keep the console window open; closing it stops both processes.

Android installation, first-run permissions, OxygenOS battery settings, and
troubleshooting are in [docs/setup.md](docs/setup.md).

## Status

Design agreed 2026-10-21. Implementation starts at M0 (skeleton and contracts).
