# Coding Standards

Retro #4 smells — enforce in all new / edited files.

## Rules

1. **No mutable string routes for domain concepts** — domain routes (audio, video, network) must use an enum / sealed type (`AudioRoute`, etc.), not `String`. (Refer to `docs/standards/retro-smells.md` §1.)

2. **No hardcoded `false` in data class initialization** — boolean flags in data classes / state objects must not default to literal `false`; use an explicit state object or require the value at construction. (Refer to `docs/standards/retro-smells.md` §2.)

3. **No speculative endpoints without spec line** — any endpoint / handler must cite a spec line (`design.md §N`, `.scratch/<feature>/` issue, or ADR) in code comment or PR; no orphan endpoints. (Refer to `docs/standards/retro-smells.md` §3.)
