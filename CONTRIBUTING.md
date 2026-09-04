# Contributing

## Setup

```bash
bun install
```

Bun is the runtime for everything: build, scripts, and the test runner (through
vitest — see the note below about bare `bun test`).

## Everyday commands

```bash
bun run check          # TypeScript type checking (tsc --noEmit)
bun run lint           # ESLint, zero warnings (--max-warnings=0)
bun run test           # the whole vitest suite (~10-17s, machine-dependent)
bun run fmt            # format with Prettier
bun run fmt:check      # check formatting (no writes)
bun run build          # bundle src/ into dist/ (ESM + declarations)
bun vitest run tests/parser/reader.test.ts   # a single test file
```

**Never bare `bun test`** — that invokes Bun's built-in runner, which fails on
vitest-only constructs like `test.fails`. Always `bun run test`.

## Before you push

```bash
bun run gates
```

runs, in order: `fmt`, `check`, `lint`, `test`, `build`, `metrics`, `coverage`,
`block-structure`, `citation-check`, `internal-citations`. All ten must pass.
They are fast but not instant: the slowest are the suite and `coverage`, which
re-runs it instrumented, at ten to seventeen seconds each depending on how
loaded the machine is - two generated sweeps run inside the suite and both
inflate under contention - and the rest are a few seconds or less. Together they
are exactly what CI's blocking `gates` job runs, minus the deep sweeps
(`bun run test:deeply-nested-lists`, about three minutes); run those too when
your change touches parsing or printing of lists, or the shape or inline
registries.

Run `bun run gates` rather than the ten commands by hand: two lanes in one night
each ran a partial local battery that skipped `citation-check` and shipped
citations it rejects, because the step was in CI but not in anyone's local list
(issue #138). A single command that always runs the full set is what keeps
"gates green" locally from meaning something narrower than "gates green" in CI.

If THIS commit intentionally changes formatted output, declare every moved case
id in its own commit message, one line each: `Parity-Diff: <family> <id>`. There
is nothing to reset afterwards - CI reads the trailers of the commits it is
gating, so a declaration expires with the commit that carried it. The one
exception is a family that declares its AST keys: it may be declared once, bare
(`Parity-Diff: <family>`), which covers exactly the cases whose bytes are
identical and whose tree diff is confined to those keys. The syntax, the
verification command and the failure messages are in
[docs/harnesses.md](docs/harnesses.md).

Two heavier checks run on a slower cadence:

- **Mutation testing** (`bun run mutate`, ~11 minutes): batched, not per-commit.
  Run it before a push that meaningfully changes `src/`, or when deliberately
  moving a recorded minimum. It checks every `src` file against its recorded
  mutation minimum in `scripts/metrics/score-minimums.json`.
- **Differential harnesses** (`bun run parity`, `bun run shape-diff`,
  `bun run probe-domains`, each with `-- --base <rev>`): prove a change against
  a base revision. CI runs them against the merge base on every PR; run locally
  when you want the answer before pushing. See
  [docs/harnesses.md](docs/harnesses.md) for what each one proves and how a
  commit declares an expected diff.

## The verification model

The repo enforces more than "tests pass":

- Per-file **coverage and mutation minimums** are recorded in
  `scripts/metrics/score-minimums.json`. A change may not drop a file below its
  recorded minimum; a change that raises a score should raise the recorded
  minimum in the same commit. Exceptions carry a classification — fixable now /
  fixable when <condition> / not practical to fix — and a reason.
- **`bun run metrics`** holds thirteen absolute gates over `src/` (cycles, layer
  rules, dead exports, registry freshness, and more) plus the shape census. See
  [docs/harnesses.md](docs/harnesses.md).
- Formatting changes that intentionally move bytes must be declared with
  `Parity-Diff:` trailers in the commit message that moves them, and proven
  meaning-preserving; see [docs/harnesses.md](docs/harnesses.md).

## Coding standards

Lint rules, comment conventions, JSDoc discipline, and the three-step recipe for
adding a new line-shaped or inline construct live in
[docs/coding-standards.md](docs/coding-standards.md). The architecture — what
each module is and the invariants the guard tests enforce — is in
[docs/architecture.md](docs/architecture.md).

## Version control

The maintainer works in [jj](https://github.com/jj-vcs/jj) on a colocated
`.git`; plain git works fine for contributions. One consequence: CI never keys
on branch names (the repo is routinely on no branch), so don't add workflow
logic that does.
