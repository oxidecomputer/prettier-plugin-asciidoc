# Task Completion Checklist

When a task is completed, run these in order:

1. `bun run fmt` — Prettier formatting is correct
2. `bun run check` — TypeScript type checking passes
3. `bun run lint` — ESLint passes with zero warnings
4. `bun run test` — all Vitest tests pass (never bare `bun test`, which runs
   Bun's own runner and fails on Vitest-only constructs)
5. `bun run build` — build succeeds

All five must pass before considering a task done.

6. `bun run mutate` — StrykerJS over the files the task touched (incremental).
   Run at every task/plan task; NOT required for a trivial doc-only change.
   Report-only: it never fails the build, but surviving mutants in code the task
   wrote are a finding for the task report, and a test the task added that kills
   nothing new has to justify itself under the load-bearing-test rule (see
   `docs/simplicity-metrics.md`, "Is this test load-bearing?"). Use
   `bun run mutate:full` at plan boundaries and whenever tests were added or
   deleted.
