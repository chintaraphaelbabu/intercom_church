# Retro fix #2 — automed guardrail

## Check script
Run sequentially, exit non-zero on first failure:

```bash
node scripts/check-all.mjs
```

Runs: `npm run typecheck`, `npm run build`, `npm test`.

## CI stub
`.github/workflows/ci.yml` runs the same sequence on push/PR.

## Pre-commit wiring
Add to `.pre-commit-config.yaml` (or husky/pre-commit hook):

```yaml
- repo: local
  hooks:
    - id: check-all
      name: check-all
      entry: node scripts/check-all.mjs
      language: system
      pass_filenames: false
      always_run: true
```

Or wire `npm run check-all` if added to package.json; currently invoke via `node scripts/check-all.mjs`.
