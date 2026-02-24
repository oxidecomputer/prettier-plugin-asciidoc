# Commands

## Development

```bash
bun run check          # TypeScript type checking (tsc --noEmit)
bun run lint           # ESLint, zero warnings policy (--max-warnings=0)
bun test               # Vitest
bun run build          # bun build → dist/ (ESM)
bun run vendor         # Re-fetch ASG schema + TCK fixtures into vendor/
bun run fmt            # Format with Prettier
bun run fmt:check      # Check formatting (no writes)
bun run fuzz           # Run the fuzzer
bun vitest run tests/parser/reader.test.ts   # Run a single test file
```

## Version Control

If a `.jj` directory is present, use **jj (Jujutsu)** instead of git:

- `jj st` — status
- `jj diff --git` — show changes
- `jj describe -m "message"` — set commit message
- `jj new` — create a new empty change
- `jj log` — show commit history

**jj squash pitfalls:**

- `jj squash --from X --into Y` opens an interactive editor —
  DO NOT USE from non-interactive shells
- Instead, use: `jj squash --from X --into Y -m "message"`
  (pass `-m` to avoid the editor)
- Or rebase children onto the target and squash without
  `--from`/`--into`
