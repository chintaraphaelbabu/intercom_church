# 02: The Director's voice reaches the Operator's phone

**What to build:** The Director grants microphone permission, turns open mic on, and the Operator hears the Director on the phone through a headset. A bare 10-minute join/publish/render smoke test on the OnePlus passes with the screen locked before any product UI is added. Wired mouth-to-ear latency is measured and recorded.

**Blocked by:** 01 — Walking skeleton: phone discovers server, appears in a debug roster

**Status:** ready-for-agent

- [ ] Smoke test passes: join, publish, render, 10 minutes, screen locked, no native crash.
- [ ] Director open-mic toggle starts and stops transmission within one second.
- [ ] The phone plays Director audio through the selected headset.
- [ ] The phone moves `WEBRTC_CONNECTING` → `READY`, and media failure is shown distinctly.
- [ ] Wired mouth-to-ear latency is measured and recorded (target ≤200 ms).
- [ ] No second WebRTC implementation appears in the dependency graph.
