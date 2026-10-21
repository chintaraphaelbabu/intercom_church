# The server runs on the director's laptop

The comms server runs on the video director's Windows 11 laptop, not on a dedicated machine. The director is always present for a service, the laptop is already powering the production workflow, and there is no always-on box to maintain. This makes the laptop the room: if it sleeps, reboots, or loses power, every operator loses comms.

## Consequences

- The director must start the server before each service. Rooms are in-memory and disappear when the server stops; nothing is restored across restarts.
- The director's browser talks to `localhost`, which is a secure context, so microphone access works without TLS certificates.
- Operators cannot keep talking if the laptop dies, unlike a browser-tab close while the server stays up.
- Sleep must be blocked while a room is active, and the server needs launch-at-login and a visible running state.
- Moving to a dedicated box later changes packaging and discovery, not the client architecture.
