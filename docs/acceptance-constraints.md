# Acceptance Constraints - Retro Fix #5 (Hardware / Prerequisites)

Prerequisites that must be satisfied before any acceptance test or soak can begin.

## Hardware

| Item | Requirement / Note |
|---|---|
| Tablet (director / viewer) | `R9BN805K1GJ` - OnePlus - second SM-T295 needed (borrowed or owned) |
| Operator phones | Borrowed Android devices for 10-client load test |
| Network | Church Wi-Fi named `Raphael` (same LAN, no internet needed after build) |
| Audio | Wired headset for each Operator; Bluetooth works but adds latency |

## Acceptance / Test Gates

- **Acoustic loopback** - waived (not required for this retro fix).
- **30-minute locked-screen test** - device must stay in session / not drop connection when screen locked.
- **2-hour soak at 5 clients** - stable with five simultaneous Operator connections.
- **10-client load** - executed on borrowed phones; passes if no server or client crashes, audio stays synchronized.

## References

- Hardware setup and Wi-Fi / headset prerequisites: [`docs/setup.md`](setup.md)
- Full design and test plan: [`docs/design.md`](design.md) / [`docs/plan.md`](plan.md)
