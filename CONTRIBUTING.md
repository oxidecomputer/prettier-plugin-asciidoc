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
bun run test           # the whole vitest suite (~4s)
bun run fmt            # format with Prettier
bun run fmt:check      # check formatting (no writes)
bun run build          # bundle src/ into dist/ (ESM + declarations)
bun vitest run tests/parser/reader.test.ts   # a single test file
```

**Never bare `bun test`** — that invokes Bun's built-in runner, which fails on
vitest-only constructs like `test.fails`. Always `bun run test`.

## Before you push

Run, in order:

```bash
bun run fmt
bun run check
bun run lint
bun run test
bun run build
bun run metrics
bun run coverage
bun run block-structure
```

All eight must pass. They are fast (the slowest is the suite at ~4s;
`block-structure` is about a second) and they are exactly what CI's blocking
`gates` job runs, minus the deep list sweep (`bun run test:deeply-nested-lists`,
~30s) — run that too when your change touches parsing or printing of lists.

If THIS commit intentionally changes formatted output, declare every moved case
id in its own commit message, one line each: `Parity-Diff: <family> <id>`. There
is nothing to reset afterwards - CI reads the trailers of the commits it is
gating, so a declaration expires with the commit that carried it. The syntax,
the verification command and the failure messages are in
[docs/harnesses.md](docs/harnesses.md).

Two heavier checks run on a slower cadence:

- **Mutation testing** (`bun run mutate`, ~11 minutes): batched, not per-commit.
  Run it before a push that meaningfully changes `src/`, or when deliberately
  moving a recorded minimum. It checks every `src` file against its recorded
  mutation minimum in `scripts/metrics/score-minimums.json`.
- **Differential harnesses** (`bun run parity`, `bun run shape-diff`, both with
  `-- --base <rev>`): prove a change against a base revision. CI runs them
  against the merge base on every PR; run locally when you want the answer
  before pushing. See [docs/harnesses.md](docs/harnesses.md) for what each one
  proves and how a commit declares an expected diff.

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
