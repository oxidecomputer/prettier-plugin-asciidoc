# Commands

## Development

```bash
bun run check          # TypeScript type checking (tsc --noEmit)
bun run lint           # ESLint, zero warnings policy (--max-warnings=0)
bun run test           # Vitest
bun run build          # bun build → dist/ (ESM)
bun run vendor         # Re-fetch ASG schema + TCK fixtures, and re-extract the
                        # Asciidoctor conformance corpus, into vendor/
bun run triage         # Diff conformance-suite results against the quarantine
                        # manifest; --write updates the manifest
bun run fmt            # Format with Prettier
bun run fmt:check      # Check formatting (no writes)
bun run fuzz           # Run the fuzzer
bun run metrics        # Simplicity scorecard for src/ (see below)
bun vitest run tests/parser/reader.test.ts   # Run a single test file
```

## Metrics

```bash
bun run metrics                       # head only
bun run metrics -- --base 0298a2ba    # base | head | delta for a revision
bun run metrics -- --json             # raw snapshots, for a task report
bun run metrics -- --duplication      # also jscpd (report-only), via bunx
bun run metrics -- --root <dir>       # measure another checkout
```

Prints code and comment LoC, cyclomatic and cognitive complexity (SUM/MAX/tail),
import edges, files in cycles, exported names and escape-hatch counts, per
layer. Counting is done by the TypeScript parser, eslint, dependency-cruiser,
knip and jscpd — nothing hand-rolled; `tests/scripts/metrics.test.ts` covers it.
Exits non-zero on an import cycle, an unresolved relative import, or an unused
exported symbol under `src` (knip is a devDependency and runs every time), and —
with `--base` — if cognitive MAX or an escape-hatch count went UP. The
cyclomatic tail is report-only (Ruling 35: it cannot tell a flat dispatch from
real branching), and the script names the functions over it under the table. The
base revision is materialized with `git archive | tar -x` — never
`git worktree`, which would mutate `.git` under a jj repo with a concurrent
session. What each row means and how each is gamed:
`docs/simplicity-metrics.md`.

**Note:** Bare `bun test` invokes Bun's built-in test runner, which fails on
Vitest-only constructs like `test.fails`; always use `bun run test` instead.

## Version Control

If a `.jj` directory is present, use **jj (Jujutsu)** instead of git:

- `jj st` — status
- `jj diff --git` — show changes
- `jj describe -m "message"` — set commit message
- `jj new` — create a new empty change
- `jj log` — show commit history

**jj squash pitfalls:**

- `jj squash --from X --into Y` opens an interactive editor — DO NOT USE from
  non-interactive shells
- Instead, use: `jj squash --from X --into Y -m "message"` (pass `-m` to avoid
  the editor)
- Or rebase children onto the target and squash without `--from`/`--into`
