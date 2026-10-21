# 12: Operator Mixer/Live views and join failure states

**What to build:** After joining, the Operator sets up volumes in Mixer View and switches manually to a minimal Live View for the service. The join screen distinguishes each discovery and connection failure, manual addresses live only under Advanced, and OxygenOS battery help is reachable from settings.

**Blocked by:** 05 — Whole room at once, with volumes; 07 — Camera identity and roster; 08 — Hot-mic mute with Operator override; 09 — Director absence: countdown, grace, close; 10 — Operator reconnect without duplicates; 11 — Headset unplug and audio focus

**Status:** ready-for-agent

- [ ] After joining, the Operator lands in Mixer View with roster, per-person volumes, level meters, and a Go Live control.
- [ ] The Operator can switch manually between Mixer View and Live View at any time.
- [ ] Live View shows room, Operator name, camera number, connection state, large PTT, master volume, and settings.
- [ ] Live View shows no roster and no indicators for other speakers.
- [ ] The join screen distinguishes no Wi-Fi, LAN unreachable, mDNS unavailable, control server unreachable, and media failure.
- [ ] Manual server address appears only under Advanced.
- [ ] OxygenOS battery help is reachable from settings.
- [ ] The Director-absence countdown is visible in Live View.
