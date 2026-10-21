# Director mute is advisory

A Director can force-mute any Operator room-wide to stop an accidental or stuck push-to-talk. The muted Operator sees a banner and can take the mic back by holding PTT again, but only with a fresh press. We rejected Google Meet-style hard mute (only the host can restore the mic) because an Operator may need to warn the Director of a hazard immediately, and being locked out of the channel is worse than a brief interruption.

## Consequences

- The Director cannot guarantee silence; mute is a circuit breaker, not a permission.
- The control server treats mute as room state, not an authorization gate.
- A touch already in progress when the mute lands does not count as a fresh press, so a physically stuck PTT stays muted.
- Mute clears when the Operator reconnects.
- The roster always shows the Operator's current mic state.
