Web test failure check — main b257005+d84962b (ticket 12/13 merge d84962b)

Run: npm run test --workspace=@church-comms/web -> 4 failed in App.test.tsx (38 passed, 2 files failed)
Errors at App.test.tsx:344 `getByRole("heading", { name: "Create a room" })`; 226/283/294/318/324/345 around "End room".

UI source (App.tsx):
- h2 id="create-heading" now "Setup - Create a room" (line 142)
- Room sections now "Setup / Mixer - {room}" (line 225) and "Live - {room}" (line 263)
- "End room" button still present at line 285 (only when in-room)
- Nav buttons: Setup / Live / Diagnostics (new 13 views)

Root cause: merge d84962b (ticket 13 mixer/live + director setup/diag) changed headings/roles to reflect Setup / Mixer / Live views. Tests not updated.

Verdict: failure from new UI (intended), not broken test logic.

Suggested fix (prefer over revert): update selectors in App.test.tsx:
- headings -> "Setup - Create a room", "Setup / Mixer - MEDIA", "Live - MEDIA" (or query by id/aria-label for stability)
- button -> keep "End room" but only when joined room state; adjust expectations for expired/session states accordingly
- optionally add assertions for new nav buttons (Setup/Live/Diagnostics)

Do not revert headings; 13 views are deliberate.
