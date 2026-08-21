# Task Completion Checklist

When a task is completed, run these in order:

1. `bun run fmt` — Prettier formatting is correct
2. `bun run check` — TypeScript type checking passes
3. `bun run lint` — ESLint passes with zero warnings
4. `bun run test` — all Vitest tests pass (never bare `bun test`, which runs
   Bun's own runner and fails on Vitest-only constructs)
5. `bun run build` — build succeeds

All five must pass before considering a task done.
