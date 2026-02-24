# Task Completion Checklist

When a task is completed, run these in order:

1. `bun run fmt` — Prettier formatting is correct
2. `bun run check` — TypeScript type checking passes
3. `bun run lint` — ESLint passes with zero warnings
4. `bun test` — all Vitest tests pass
5. `bun run build` — build succeeds

All five must pass before considering a task done.
