# 05: Real latency, jitter, and packet-loss from LiveKit stats

**What to build:** Wire LiveKit's `Room` stats (or `RemoteParticipant` audio stats) through `DirectorRoom` (`livekit-room.ts`) into `mediaState`, then surface them in the Director Diagnostics card (`App.tsx` line 349) instead of `"unmeasured"`. Keeps server health and connection phase accurate.

**Blocked by:** 01 — Per-operator volume and level meters (needs media layer signal path).

**Status:** ready-for-agent

- [ ] `LiveKitDirectorRoom` exposes `getLatency()`, `getJitter()`, `getPacketLoss()` (or equivalent) reading from LiveKit room/participant stats.
- [ ] `DirectorMediaState` gains `latencyMs`, `jitterMs`, `packetLossPercent` fields.
- [ ] `App.tsx` diagnostics shows measured values; no hardcoded estimates or unmeasured placeholders remain.
