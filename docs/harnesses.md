# The harnesses

Everything under `scripts/` is code we maintain, not scaffolding. This is what
each tool PROVES, what its exit code means, and which CI job runs it.

It is a separate file rather than a section of `docs/design.md` on purpose:
`design.md` is about the artifact — how the parser and the printer are built —
and this is about how a change to that artifact is checked. A contributor reads
one of them at a time.

## The exit-code contract

Every script in `scripts/` uses three codes (`scripts/lib/cli.ts`):

| code | means                     | who has to look                                                                                         |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| 0    | pass                      | nobody                                                                                                  |
| 1    | the gate FAILED           | the code changed something it should not have                                                           |
| 2    | the harness COULD NOT RUN | the harness: a bad argument, an unknown base revision, a corpus that did not load, an empty measurement |

The 1/2 split is the reason the contract exists. A gate that cannot tell "I
checked and it is broken" from "I checked nothing" goes quiet exactly when its
inputs disappear, and a quiet failure in CI is a green tick. Every harness here
therefore has a **measured-nothing floor** that exits 2: `parity` has
`MINIMUM_CASES`, `shape-diff` reports the ids its base dump was missing,
`triage` refuses a corpus with no groups, and `metrics` refuses a `src` too
small to be this repository's.

Every script takes `--help`.

## The tools

### `bun run metrics` — the simplicity scorecard

Measures `src` and prints one table; `--base <rev>` adds the comparison columns.
Head-only it holds thirteen absolute gates plus the shape census's five rules,
with no base and no network. With `--base` it adds four ratchets: cognitive MAX,
the escape hatches, each contract's width, each defense counter.
`docs/simplicity-metrics.md` is the full scorecard — what each row is, what it
costs to game, and why cyclomatic complexity is deliberately report-only.

It also PRINTS three things it does not gate on: the census pins (`pin holds` /
`pin moved`, never a win or a loss), the functions over the cyclomatic tail, and
the unread-published-field candidates.

Proves: the tree is well-formed (no cycles, no forbidden layer edges, no dead
exports, no rotted registry, no minimums file that has gone stale, a quarantine
manifest that has not left its pin) and no maintained budget rose.

### `bun run coverage` — the suite, against the recorded minimums

Runs the whole suite under v8 line coverage and compares each `src` file against
its RECORDED MINIMUM in `scripts/metrics/score-minimums.json` — the lowest score
that file is allowed to report. Exit 1 when a file is below its recorded
minimum, exit 2 when a recorded file was not measured at all. It also prints the
report-only suite-size row: tests, test files, wall time.

The mutation half of the same minimums file is checked by `bun run mutate`,
which ends by invoking `bun scripts/score-minimums.ts --mutation` against the
report Stryker just wrote. The split is cost, not principle: coverage is seconds
and belongs in CI, mutation is ~11 minutes and stays manual and periodic.

Proves: no file silently lost the tests it had.

### `bun run parity -- --base <rev>` — same output as revision X

Formats every corpus document and every format fixture under both revisions and
compares two things: the formatted BYTES and `JSON.stringify(parse(src))`,
positions included. Positions are in because Prettier's `--range` and cursor
tracking read `position.*.offset` directly, so an AST that prints the same today
can still break range formatting tomorrow.

`--formatted-ledger` accepts byte differences and gates on the AST alone, for a
change that is MEANT to move bytes; the ids it lists then go into
`scripts/parity-expected-diffs.json`, and `--expected-diffs` gates on that
ledger being exactly right.

Proves: a refactor changed no output. It is the harness a "no behavior change"
claim is checkable against.

### `bun run shape-diff -- --base <rev>` — per-diff render proofs

Formats a deterministic exhaustive product of registry sub-grids under both
revisions. For every shape whose output MOVED it runs the proofs parity cannot:
`render(headOut) === render(input)` (fidelity),
`render(headOut) === render(baseOut)` (neutrality, reported — a corruption fix
is expected to fail it), head idempotence, and a REQUIRED family annotation from
the registry's closed enum. A differing shape with no family fails the run.

Three grids: `standing` (the default), `heading-adjacency` and `list-run`.

Proves: where output moved, the new output still means what the input meant.
This is the only harness that proves fidelity per difference, which is why it is
a standing part of CI rather than plan scaffolding.

### `bun run triage` — the conformance sweep

Assesses every corpus case against the three differential properties and groups
the failures by signature. `--write` regenerates
`tests/conformance/quarantine.json`: still-failing cases keep their issue tag,
new failures are tagged `UNTRIAGED`, and cases that now PASS are dropped — which
is how a fix gets pinned, because the manifest asserts exact agreement and the
suite fails if a quarantined case starts passing.

Proves nothing by itself; it is the report the quarantine manifest is written
from, and the manifest is what the suite gates on.

### `bun run vendor` and `bun run build`

`vendor` re-fetches the Asciidoctor corpus at a pinned commit; the pin is
deliberate because extracted case ids are the quarantine manifest's keys.
`build` bundles `src/index.ts` into `dist/` and emits the declarations. Neither
is a gate, so neither ever exits 1.

### The library modules

`scripts/shape-registry.ts`, `scripts/shape-registry-list-run.ts` and
`scripts/heredoc-extractor.ts` are libraries, not commands. `scripts/lib/` holds
what the commands share: the exit-code contract and the one
`materialize(revision)` that puts another revision on disk.

## CI

`.github/workflows/ci.yml`, two jobs, split by question rather than by command.

**`gates`** — blocking, needs no other revision, so a fresh clone answers it:
`check`, `lint`, `fmt:check`, `build`, `test`, `metrics`.

**`differential`** — needs a base, and is `continue-on-error` for its first
iteration; flipping it to blocking is a one-line change once it has proved
stable. It runs `parity --formatted-ledger`, the three `shape-diff` grids and
`metrics --base`, serially in ONE job: each materializes the base into `$TMPDIR`
and two of them install into it, so parallel jobs would each pay that install
and parallel steps would pay it concurrently on one runner's disk.

The base is a SHA the workflow computes: `git merge-base` against the PR's base
ref, or `HEAD^` on a push to `main`. Never a branch name — this repository is
jj-managed with a colocated `.git` and is routinely on no branch — and never
`github.event.pull_request.base.sha`, which is the base branch's TIP rather than
the merge base, so a long-lived branch would be diffed against commits it never
contained. `fetch-depth: 0`, because a shallow clone has no base revision to
archive.

## Running a differential harness locally

```bash
bun run metrics -- --base <rev>
bun run parity -- --base <rev> --formatted-ledger
bun run shape-diff -- --base <rev> --grid standing
```

`<rev>` is anything `git archive` accepts. Each one materializes that revision
into `$TMPDIR` and deletes it on every path out, including a failure — never
with `process.exit()`, which would skip the cleanup and leave hundreds of
megabytes behind.

**A known limit.** `scripts/` imports from `tests/` — the corpus loader, the
conformance properties, the quarantine manifest and the `formatAdoc` /
`renderedHtml` helpers — and the parity dumper hardcodes those paths INSIDE
whichever checkout it runs in. The direction is backwards, and the practical
cost is that a differential harness cannot span a revision that MOVED those
files. Moving the shared library to a neutral home both sides import is the fix;
the trigger for doing it is the first change that needs to cross such a move.
