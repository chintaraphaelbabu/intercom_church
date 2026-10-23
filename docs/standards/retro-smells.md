# Retro Smells — Review #4 (coding standards)

Source review: `AudioRoutePolicy.kt`, `SessionController.kt`, `diagnostics.ts`.

## 1. Mutable string routes for domain concepts
- **File**: `audio/app/src/main/java/com/churchcomms/operator/media/AudioRoutePolicy.kt` (routes passed as `String`); `server/src/diagnostics.ts` (lines 3–4, `let activeInputRoute = "Wired Headset"`).
- **Smell**: Domain route concepts (`Wired Headset`, `Bluetooth Headset`, etc.) carried as mutable strings instead of an enum.
- **Fix**: Define `AudioRoute` enum; use it in policy, controller, and diagnostics. No more `String` routes for domain concepts.

## 2. Hardcoded `false` in data-class initialization
- **File**: `android/app/src/main/java/com/churchcomms/operator/session/SessionController.kt` (lines 38–43, `serviceRunning`, `transmitting`, `headsetDisconnected`, `headsetReconnectPrompt`, `speakerSessionOnly = false`).
- **Smell**: Boolean flags defaulted to `false` directly in constructor/default args, masking real state intent and making copy/restore error-prone.
- **Fix**: Use an explicit `State` or `Status` object / sealed class, or pass state explicitly; avoid literal `false` as default in data-class init.

## 3. Speculative endpoints without spec line
- **File**: `server/src/diagnostics.ts` (line 12, `request.url === "/api/diagnostics/routes"`); no `docs/design.md` / spec reference.
- **Smell**: Endpoint added without a spec line (design.md section, issue spec, or ADR line) — future maintenance has no owner.
- **Fix**: Every endpoint needs a spec line (e.g., `design.md §X` or `.scratch/...` issue). No endpoint without a trace.
