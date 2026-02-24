# Suggested Commands

## Development

- `bun run build` — build (ESM to dist/)
- `bun run check` — TypeScript type checking (tsc --noEmit)
- `bun run lint` — ESLint with zero warnings policy
- `bun test` — run Vitest tests

## Version Control

This project uses **jj (Jujutsu)**, not git:

- `jj st` — status
- `jj diff --git` — show changes
- `jj describe -m "message"` — set commit message
- `jj new` — create a new empty change
- `jj log` — show commit history

**IMPORTANT: jj squash pitfalls:**
- `jj squash --from X --into Y` opens an interactive editor — DO NOT USE from non-interactive shells
- Instead, use: `jj squash --from X --into Y -m "message"` (pass `-m` to avoid the editor)
- Or rebase children onto the target and squash without `--from`/`--into`

