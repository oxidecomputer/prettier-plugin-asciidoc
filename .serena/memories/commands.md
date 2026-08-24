# Commands

## Development

```bash
bun run check          # TypeScript type checking (tsc --noEmit)
bun run lint           # ESLint, zero warnings policy (--max-warnings=0)
bun run test           # Vitest
bun run build          # bun build → dist/ (ESM)
bun run vendor         # Re-extract the Asciidoctor conformance corpus into
                        # vendor/
bun run triage         # Diff conformance-suite results against the quarantine
                        # manifest; --write updates the manifest
bun run fmt            # Format with Prettier
bun run fmt:check      # Check formatting (no writes)
bun run fuzz           # Run the fuzzer
bun run metrics        # Simplicity scorecard for src/ (see below)
bun run mutate         # StrykerJS mutation testing, incremental (see below)
bun run mutate:full    # StrykerJS, every mutant (rebuilds the incremental file)
bun vitest run tests/parser/reader.test.ts   # Run a single test file
```

## Mutation testing

`bun run mutate` runs StrykerJS over `src/**/*.ts` with the vitest runner
pointed at `vitest.stryker.config.ts` — this repo's own `vitest.config.ts` plus
`fileParallelism: false` — so it runs exactly the tests `bun run test` does. It
is the answer to "is this test load-bearing?": Stryker breaks the code one small
edit at a time (flipped conditional, removed block, emptied literal) and reports
which mutants the suite fails to notice. Config is `stryker.config.json`;
reports land in `reports/` (gitignored — html at
`reports/mutation/html/index.html`, json at `reports/mutation/mutation.json`,
plus the machine-local incremental cache). Thresholds are report-only, so a run
never fails a build. `bun run mutate` is incremental (only mutants in changed
files) and is the per-task cadence; `bun run mutate:full` re-runs everything and
is for plan boundaries and any time tests are added or deleted, since the
incremental cache is keyed on source files and would otherwise report a stale
answer for a `tests/`-only change. **Under Stryker, vitest runs single-process
per worker, so `-c N` means N processes** — that is the only reason
`vitest.stryker.config.ts` exists. Without it vitest sizes its own pool from the
CPU count inside each of Stryker's N workers, and `-c 8` on this 14-core machine
produced a load average of ~200 and thermal throttling. `concurrency` is a fixed
12 in the JSON (JSON cannot compute `cpus - 2`) — override with
`bun run mutate -- -c 6` on a machine you are still using. What the report
means, and the rule for when a new test earns its place, are in
`docs/simplicity-metrics.md` ("Is this test load-bearing?").

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
cyclomatic tail is report-only (it cannot tell a flat dispatch from real
branching), and the script names the functions over it under the table. The base
revision is materialized with `git archive | tar -x` — never `git worktree`,
which would mutate `.git` under a jj repo with a concurrent session. What each
row means and how each is gamed: `docs/simplicity-metrics.md`.

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
