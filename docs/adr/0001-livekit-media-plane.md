# LiveKit is the media plane

The app needs N-way, full-duplex voice for up to 10 participants on a church LAN, with Opus, jitter buffering, packet-loss concealment, and echo cancellation. We use a self-hosted LiveKit server rather than a custom SFU or peer mesh: mesh collapses beyond ~4 participants on mobile uplinks, and a hand-rolled SFU would make us own codec, jitter, and reconnection bugs that nobody on this project has time to debug on a Sunday. LiveKit runs entirely on the LAN, so there is no cloud dependency.

## Prior failure this prevents

A previous attempt used `mediasoup-client` (`io.dyte.mediasoup`) with a separately pinned `webrtc-sdk:android:104.5112.03`. The app compiled and joined, then crashed about 500 ms in: the native WebRTC binary did not match the API the mediasoup bindings expected (getters removed in WebRTC M107). That was an integration problem between two native WebRTC providers, not an audio or SFU problem. LiveKit's Android SDK owns both sides of that boundary and declares exactly one WebRTC dependency.

## Consequences

- The Android client is a LiveKit client plus our own control channel; it is not a WebRTC stack of our own.
- The director's browser client uses LiveKit JS.
- Our protocol owns room, camera assignment, mute, and director presence. LiveKit owns tracks and transport.
- Swapping media planes later means replacing both clients' audio transport, not just a library call.
