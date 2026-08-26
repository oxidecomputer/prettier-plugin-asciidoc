# Harnesses and metrics

Everything under `scripts/` is code we maintain, not scaffolding. This document
covers what each tool proves, what its exit code means, which CI job runs it,
and the measurement discipline behind `bun run metrics` — the scorecard, the
budgets, and the recorded minimums.

One sentence governs all of it:

> Metrics are instrumentation, not the objective — if our metrics didn't tell us
> to do the simplest thing, they were the wrong metrics.

A row that moves the wrong way is a question to answer in the task report. It is
never a target to adjust, and never a reason to make the code worse in the
direction the number likes.

## The exit-code contract

Every script in `scripts/` uses three codes (`scripts/lib/cli.ts`):

| code | means                     | who has to look                                                                                         |
| ---- | ------------------------- | ------------------------------------------------------------------------------------------------------- |
| 0    | pass                      | nobody                                                                                                  |
| 1    | the gate failed           | the code changed something it should not have                                                           |
| 2    | the harness could not run | the harness: a bad argument, an unknown base revision, a corpus that did not load, an empty measurement |

The 1/2 split is the reason the contract exists. A gate that cannot tell "I
checked and it is broken" from "I checked nothing" goes quiet exactly when its
inputs disappear, and a quiet failure in CI is a green tick. Every harness
therefore has a measured-nothing floor that exits 2: `parity` has
`MINIMUM_CASES`, `shape-diff` reports the ids its base dump was missing,
`triage` refuses a corpus with no groups, and `metrics` refuses a `src` too
small to be this repository's. Without the split, an empty `src` would score a
perfect card — no files means no cycles, no unused exports, and no escape
hatches, all vacuously true.

Every script takes `--help`, and an unrecognized argument is an error, not a
shrug: a silently dropped `--base` would print a head-only table that looks like
a passing comparison.

## The tools

### `bun run metrics` — the simplicity scorecard

Measures `src` and prints one table; `--base <rev>` adds comparison columns.
Head-only it holds thirteen absolute gates plus the shape census; with `--base`
it adds four ratchets. The full scorecard is [described below](#the-scorecard).
Useful flags: `--json` (raw snapshots), `--duplication` (also run jscpd, fetched
with `bunx`), `--root <dir>` (measure another checkout).

Proves: the tree is well-formed (no cycles, no forbidden layer edges, no dead
exports, no rotted registry, no stale minimums file, a quarantine manifest on
its pin) and no maintained budget rose.

### `bun run coverage` — the suite, against the recorded minimums

Runs the whole suite under v8 line coverage and compares each `src` file against
its recorded minimum in `scripts/metrics/score-minimums.json` — the lowest score
that file is allowed to report. Exit 1 when a file is below its minimum, exit 2
when a recorded file was not measured at all. Also prints the report-only
suite-size row (tests, test files, wall time — report-only forever, because a
ratchet on suite size would penalize adding a spec-citation pin).

The mutation half of the same minimums file is checked by `bun run mutate` (see
[Mutation testing](#mutation-testing)). The split is cost, not principle:
coverage is seconds and belongs in CI; mutation is minutes and runs batched.

Proves: no file silently lost the tests it had.

### `bun run parity -- --base <rev>` — same output as revision X

Formats every corpus document and every format fixture under both revisions and
compares the formatted bytes **and** `JSON.stringify(parse(src))`, positions
included — positions because Prettier's `--range` and cursor tracking read
offsets directly, so an AST that prints the same today can still break range
formatting tomorrow.

For a change that is meant to move bytes: `--formatted-ledger` accepts byte
differences and gates on the AST alone, listing the ids that differ; those ids
go into `scripts/parity-expected-diffs.json`, and `--expected-diffs <file>`
gates on that ledger being exactly right — every listed id must still differ (a
stale entry fails) and every differing id must be listed (an undeclared diff
fails).

**The ledger's lifecycle.** An entry is `{"id": ..., "family": ...}`: a corpus
or fixture id plus a family from the closed enum in `scripts/parity-ledger.ts`
(each family is declared once, with a doc comment saying what moved and why).
The ledger describes exactly one commit: the diff between the head being checked
and the base CI resolves for it (the merge base on a pull request, the pushed
commit's parent on a push to `main`). Every commit is judged against its OWN
parent, so an entry is never valid for two consecutive commits. Three rules
follow, applied per commit:

1. A commit that does not intentionally change formatted output carries the file
   as `[]`. That includes every commit stacked on top of one that carried
   entries: resetting the file to `[]` is part of authoring the NEXT commit,
   whatever that commit is about. This is the rule that bites - the entries pass
   locally forever on the commit that earned them, and only fail in CI once a
   later commit is compared against a parent that already contains the change
   (CI run 32916094459 failed exactly this way).
2. A commit that intentionally moves bytes lands WITH its entries in the same
   commit. `bun run parity -- --base <parent sha> --formatted-ledger` lists the
   ids whose formatted output differs; give each a family (adding to the enum in
   `parity-ledger.ts` first if no existing family names the change) and prove
   the change meaning-preserving with `bun run shape-diff` or a render check.
3. Verify with CI's exact gate before describing any commit:
   `bun run parity -- --base <parent sha> --expected-diffs scripts/parity-expected-diffs.json`
   (with jj, the parent sha is `jj log -r @- --no-graph -T commit_id`; `--base`
   feeds `git archive`, so it takes git revisions, not revsets). It runs in a
   few seconds.

The gate is exact in both directions, and each failure message names its cure:
"stale entry - delete it" (the id vanished or no longer differs) means the entry
outlived its commit - delete it, there is no phantom diff to chase; "differs ...
and is not in scripts/parity-expected-diffs.json" is an undeclared behavior
change - unintended means fix the code, intended means ledger it; "unknown
family" means declare the family in `parity-ledger.ts` first; "differs in the
AST but <family> is a formatted-only family" means the change moved the tree,
not just bytes - the family is wrong or the change does more than believed.

Proves: a refactor changed no output. It is the harness a "no behavior change"
claim is checkable against.

### `bun run shape-diff -- --base <rev>` — per-diff render proofs

Formats a deterministic exhaustive product of registry sub-grids under both
revisions. For every shape whose output moved, it runs the proofs parity cannot:
`render(headOut) === render(input)` (fidelity),
`render(headOut) === render(baseOut)` (neutrality, reported — a corruption fix
is expected to fail it), head idempotence, and a required family annotation from
a closed enum. A differing shape with no family fails the run, so an unexplained
behavior change cannot pass quietly.

Three grids, selected with `--grid`: `standing` (the default — the whole
container × construct product), `heading-adjacency` (the pairs where a line
above a heading can destroy it), and `list-run` (a list item's leading metadata
run). The generators live in `scripts/shape-registry.ts` and
`scripts/shape-registry-list-run.ts`; the completeness gate is
`scripts/metrics/shape-census.ts`, wired into `bun run metrics`, which requires
every delimiter kind and every `line-shapes.ts` runtime export to have a
covering dimension (or a written-down exemption) — so a parser that learns a new
construct must teach these generators in the same commit. The grids exist
because the corpus can be blind to a construct (the #44 corruption had zero
corpus instances).

Proves: where output moved, the new output still means what the input meant —
the only harness that proves fidelity per difference.

### `bun run test:deeply-nested-lists` — the exhaustive list-shape product

Runs `tests/format/list-shape-sweep.deep.test.ts` under its own vitest config:
every nested-list shape to depth 5 — 111,121 documents, each formatted twice and
rendered on both sides — against the allowlist of known-failing shapes in
`tests/format/list-shape-allowlist.ts`, each entry tagged with its tracker
issue. Exit 1 when the failing set does not match the allowlist in either
direction; exit 2 when vitest collected nothing.

The default suite runs the same product at depth 4, and that depth is
load-bearing: Stryker runs the default suite, so a shallower default would let
sweep-killed mutants survive.

Proves: no list shape regressed, and no known-broken shape got quietly fixed
without its allowlist entry (and issue) being retired.

### `bun run triage` — the conformance sweep

Assesses every corpus case against the three differential properties and groups
the failures by signature. `--write` regenerates
`tests/conformance/quarantine.json`: still-failing cases keep their issue tag,
new failures are tagged `UNTRIAGED`, and cases that now pass are dropped — which
is how a fix gets pinned, because the manifest asserts exact agreement and the
suite fails if a quarantined case starts passing.

Proves nothing by itself; it writes the report the quarantine manifest is
generated from, and the manifest is what the suite gates on.

### `bun run vendor` and `bun run build`

`vendor` re-fetches the Asciidoctor corpus at a pinned commit; the pin matters
because extracted case ids are the quarantine manifest's keys. `build` bundles
`src/index.ts` into `dist/`. Neither is a gate, so neither ever exits 1.

### The library modules

`scripts/shape-registry.ts`, `scripts/shape-registry-list-run.ts`, and
`scripts/heredoc-extractor.ts` are libraries, not commands. `scripts/lib/` holds
what the commands share: the exit-code contract and the one
`materialize(revision)` that puts another revision on disk —
`git archive | tar -x` into a temp directory, never `git worktree`, because this
repository is jj-managed with concurrent sessions and a worktree mutates `.git`.

## CI

`.github/workflows/ci.yml`, two jobs, split by question rather than by command.

**`gates`** — blocking, needs no other revision: `check`, `lint`, `fmt:check`,
`build`, `coverage` (the suite runs under it), `metrics`,
`test:deeply-nested-lists`. Every step carries `if: ${{ !cancelled() }}`, so one
failing gate never hides the others.

**`differential`** — needs a base, and is `continue-on-error` for its first
iteration; flipping it to blocking is a one-line change once it has proved
stable. It runs `parity --expected-diffs`, the three `shape-diff` grids, and
`metrics --base`, serially in one job, because each step materializes the base
into `$TMPDIR` and parallel steps would pay that concurrently.

The base is a SHA the workflow computes: `git merge-base` against the PR's base
ref, or `HEAD^` on a push to `main`. Never a branch name — the repo is routinely
on no branch — and never `github.event.pull_request.base.sha`, which is the base
branch's tip, not the merge base. `fetch-depth: 0`, because a shallow clone has
no base revision to archive.

### Running a differential harness locally

```bash
bun run metrics -- --base <rev>
bun run parity -- --base <rev> --expected-diffs scripts/parity-expected-diffs.json
bun run shape-diff -- --base <rev> --grid standing
```

`<rev>` is anything `git archive` accepts. Each run materializes that revision
into `$TMPDIR` and deletes it on every path out, including failure.

**A known limit:** `scripts/` imports from `tests/` (the corpus loader, the
conformance properties, the format helpers), and the parity dumper hardcodes
those paths inside whichever checkout it runs in — so a differential harness
cannot span a revision that moved those files. Moving the shared library to a
neutral home is the fix; the trigger is the first change that needs to cross
such a move.

## The scorecard

`scripts/metrics.ts` (with `scripts/metrics/`) measures `src` only — the shipped
code, not the tests. Nothing is counted by hand: lines and escape hatches come
from the TypeScript compiler's parser, complexity from eslint, coupling from
`dependency-cruiser`, dead code from `knip`, duplication from `jscpd`. The
layers reported are `src/parse/lines`, `src/parse`, `src/print`, and `src`
overall.

| #   | Metric                      | Definition                                                                                                         | Better                              | Gate                                                                       |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | -------------------------------------------------------------------------- |
| 1   | **Cognitive complexity**    | SonarSource cognitive complexity per function: sum, max, count over 15                                             | down                                | Ratchet on max with `--base`; sum and tail reported                        |
| 2   | **Code LoC + comment LoC**  | Lines carrying a real token, and comment-only lines, counted separately                                            | code down at a constant feature set | Report-only, always printed as a pair                                      |
| 3   | **Cyclomatic complexity**   | eslint's `complexity` per function: sum, max, count over 10                                                        | down                                | Report-only — see below                                                    |
| 4   | **Coupling**                | Unique intra-`src` import edges (type-only included), files in cycles, unresolved relative imports, exported names | edges and exports down              | Hard gates: cycles = 0, unresolved imports = 0                             |
| 5   | **Escape hatches**          | `eslint-disable` comments, `as X` / `<X>` assertions (`as const` excluded), non-null `!`, `any`                    | down                                | Ratchet with `--base`                                                      |
| 6   | **Dead code + duplication** | Unused exports under `src` and `scripts`; `src` exports with no `src` consumer; duplication %                      | zero unused                         | Hard gates: zero unused symbols, every test-only export tagged `@internal` |

The thirteen absolute gates (all in `scripts/metrics/gates.ts`) cover: import
cycles, unresolved relative imports, layer-rule violations, unused exports,
untagged test-only exports, a resident agreement harness, a stale or unreadable
interior-validation registry, a split defense marker, a missing or unmeasurable
named seam, an unregistered or stale crossing, a quarantine manifest off its
pin, and a minimums file that no longer describes the source tree. The four
ratchets (need `--base`): cognitive max per layer, each escape-hatch count, each
named contract's width, each defense counter. None may rise; a layer, contract,
or marker the base does not carry is skipped, since it cannot have regressed. A
ratchet that fires is a question to answer in the task report — either the
change is justified and the report says why, or the code goes back.

The gates that read this repository's own conventions and registries judge this
repository only: a `--base` archive or `--root` checkout is measured, not judged
(`Snapshot.repository`).

**Why cyclomatic is report-only.** Cyclomatic complexity counts decision points
and is blind to nesting, so a flat twelve-arm `switch` scores the same as three
nested loops with labelled breaks — and for a parser that matters: dispatch
tables score badly and read fine. The live case: `itemContent`
(`src/parse/lines/list-reader.ts`) is a flat `switch` over `LineKind`, one arm
per branch of Asciidoctor's `read_lines_for_list_item`, cyclomatic 11, cognitive
below 11. Gating on the cyclomatic tail would have asked for that `switch` to
become a handler table keyed by a string — better score, worse code. So the row
stays on the table and the script prints the offending functions by name;
cognitive complexity is the one that is ratcheted.

**What disagreement between the rows tells you.** The pattern of disagreement is
the diagnosis:

- LoC down, cognitive flat or up → compression, not simplification.
- Cyclomatic down, function count and import edges up → the decision did not
  disappear, it was spread across call sites.
- Per-file complexity down, files in cycles up → the problem moved across a
  module boundary and now needs two files open to read.
- Comment lines up, code lines down → either a spec citation being recorded
  (good — `src/parse/line-shapes.ts` is mostly comments, each naming the Ruby it
  mirrors) or documentation papering over an unclear mechanism. Tell them apart
  by where: comments in a registry citing `parser.rb` are good; comments inside
  a long function explaining its own control flow are not.
- Everything down, escape hatches up → simplicity bought with casts and
  `eslint-disable`.

**Anti-gaming.** Every reported metric is paired with one that moves the
opposite way when it is gamed, printed on the same table:

| Metric         | How it is gamed                                             | What catches it                                                                   |
| -------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Code LoC       | Delete comments; dense one-liners; move logic into data     | Comment LoC alongside; cognitive complexity                                       |
| Cyclomatic     | Split one 20-branch function into six chained 4-branch ones | Function count, import edges, exports; caller's cognitive complexity barely drops |
| Cognitive      | Hoist conditions into a lookup keyed by an opaque string    | Pipeline-stage and type-kind counts; oracle tests still need the branches         |
| Import edges   | Barrel re-exports hiding fan-out behind one edge            | Type imports counted; exported symbols rise                                       |
| Cycles         | Break a cycle via a shared "utils" module both mutate       | Exported-symbol count; the new module's fan-in                                    |
| Escape hatches | Hide the cast in a helper; widen a type instead             | Type-kind counts; the `as` count is a floor                                       |
| knip           | Re-export dead code from an index to make it "used"         | Exported-symbol count rises                                                       |
| Tests          | Add assertion-free tests                                    | Mutation score (see below)                                                        |

Report-only extras the scorecard prints: the census pins, the functions over the
cyclomatic tail, the unread-published-field candidates, and the hotspot
diagnostic (churn × cognitive complexity per file — `src/print/printer.ts` is
the standing hotspot).

**Method notes that bite:**

- `as const` is not an escape hatch and is not counted — it can never widen a
  value into a lie the way `x as Foo` can.
- Import edges are unique file-to-file pairs, and type-only imports count —
  otherwise a refactor could "reduce coupling" by adding a keyword.
- Base and head are always linted with the same generated eslint config; the
  repository's own config disagrees slightly, so never mix them in one
  comparison.
- Never compare across a feature addition without saying so: aggregates measured
  against a revision that lacks the behavior are not a simplicity comparison.
- knip runs on every invocation and "knip could not run" is a failure, not a
  skipped row; jscpd is the one optional, report-only tool.

## Design-quality budgets

Three more families sit on the same table, measured by
`scripts/metrics/design.ts`:

> These are budgets we maintain, not numbers a tool discovers. The seam list,
> the interior-validation registry, and the harness list are each written by
> hand and reviewed. What the tooling does is hold them to a ratchet and refuse
> to let them rot.

Two caveats apply to all three: **absence is unmeasurable** (we cannot count the
defenses a better type made unnecessary — only the ones that remain), and **a
defense may only be deleted with its need** (deleting a guard without removing
the state it guarded moves the number and makes the code worse).

One structural consequence shapes every gate here: because these ratchets fire
on rise, the family can never detect an undercount — a deleted registry, a
wrapped marker, and a renamed seam all report less, and less reads as progress.
That is why a missing registry or seam is a hard failure rather than `n/a`, and
why a split marker has its own detector.

### Seams: contracts and vocabulary

Every named cross-module seam is one of two things:

- A **contract** is what an implementer satisfies, judged by **width**: it may
  not gain members, every conformer names it in an explicit `implements`, and it
  must be fakeable. There are currently no contract rows — `ListHost` and
  `ParagraphHost` both dissolved when the list and paragraph scans became pure
  functions. The rows are removed rather than held at zero; they come back when
  polymorphism does.
- **Vocabulary** is the concrete data used in definitions. Nobody implements it,
  so it is judged by **precision** — no unread published field, no
  valid-only-when field, one derivation of each fact — and its width is
  reported, never ratcheted. One row today: `ReaderContext`
  (`src/parse/line-shapes.ts`).

Members are counted from the compiler's AST — the declaration's own property and
method signatures — and a named seam must be **one flat declaration**: the
scanner refuses `extends` clauses and merged declarations, because both would
report fewer members than a human counting the surface. A seam absent at the
base is tolerated (it cannot have widened); a seam missing at head is the list
itself rotting, and fails.

The theory, in one line each: every contract member is information flow measured
where it was declared (Henry–Kafura), leakage counted at the point of the leak
(Parnas), and the denominator in Ousterhout's deep-module ratio.

### Layer rules

The layer DAG described in
[architecture.md](architecture.md#the-guard-test-and-layer-rules) is enforced by
dependency-cruiser's rule engine on the same cruise the cycle gate reads. Every
rule is a direction, not a symbol list, so it cannot be satisfied by moving a
name. eslint's `no-restricted-imports` is deliberately not used as a second
enforcer — that would be an agreement harness (below). Barrel files are refused
for the same family of reasons: they defeat the unused-export gate and erase the
module address a reader needs.

### Defense inventory

Counts of code that defends against states the types still permit — the
operational shadow of "make invalid states unrepresentable". Each category is a
ratchet:

| Category                   | What it counts                                                                 |
| -------------------------- | ------------------------------------------------------------------------------ |
| `unreachable()` sites      | Throwing can't-happen guards under `src` (currently zero)                      |
| `Caller contract:` markers | A precondition the caller carries, stated in JSDoc                             |
| `Total fallback:` markers  | A can't-happen branch that silently degrades instead of throwing               |
| `Valid only when` markers  | A field whose validity depends on a sibling discriminant                       |
| interior validation sites  | A validating conditional whose false branch can't happen, outside the boundary |

The registry (`defense-registry.json`) is disjoint from the marker counts: it is
for the sites no marker can catch — a plain `if` or `??` that reads as ordinary
code — which is why it is a list of judgements with a reason per site rather
than a text search. Its own hard gate: every entry must still name a function
that exists. Sanctioned validation boundary: `src/parse/line-shapes.ts`,
`src/parse/lines/classify.ts`, and `tests/`; everything else in `src` is
interior ("parse, don't validate").

Markers must stay on one comment line where written — the count is over comment
text, and a wrap that splits a marker hides the defense. A counter that is zero
at the base is skipped (a marker's introduction must not read as a regression);
the cost is that a category driven to zero loses its gate until something
re-enters it.

### Agreement harnesses

An absolute gate: **this must be 0.** An agreement harness is a resident test
whose assertion compares the outputs of two of our own components against each
other — the shape that makes two implementations of one rule permanently
affordable, with a test holding the duplication in place so it reads as covered
rather than as debt. Not harnesses, and fine: tests against pinned bytes, tests
against the oracle (an external authority), `parity` (this checkout against a
prior checkout), and property tests over one component's output. The gate is a
declared list (currently empty) that must stay empty; the fix for a would-be
harness is never to register it — it is to delete one of the two components and
check the survivor against bytes or the oracle.

## The `@internal` split

knip reports zero unused exports under `src`, and the number is true but coarse:
a test importing a symbol is a consumer to knip, so an export nothing in `src`
needs reads exactly like one the parser depends on.
`scripts/metrics/internal-surface.ts` measures the second half — `src` exports
with no `src` consumer — off the import statements the tree carries.

The rule is a taxonomy, not a budget: there is no ratchet, because a wide
test-only surface is not automatically worse than a narrow one — what is worse
is not knowing which exports are which. Every export with no `src` consumer must
carry the bare `@internal` JSDoc tag, with the consuming test named as a path in
the same block; both directions gate (an untagged export in that half fails, and
an `@internal` on an export `src` does consume fails as stale). `src/index.ts`
is exempt in both directions — it is the published API by definition.

Honest bound: consumption is read off import statements by a scanner, not a type
checker; a module reached by a namespace or default import is treated as
consumed wholesale (`src/parser.ts` is the live case — the package entry imports
its default).

## Mutation testing

Every row above measures `src`. None can tell a test that would fail if the code
broke from one that would not — and the suite is most of what we add. StrykerJS
answers exactly that: it introduces one small defect at a time (a `<` flipped to
`<=`, an `if` body removed) and re-runs the suite against each mutated copy. A
mutant that makes some test fail is killed; a mutant that leaves the suite green
survived, and the behavior it broke is behavior nothing asserts.

```bash
bun run mutate          # incremental: only mutants in files that changed
bun run mutate:full     # every mutant, rebuilding the incremental cache
bun run mutate -- -c 6  # fewer workers, to leave the machine usable
bunx stryker run --mutate 'src/parse/lines/split.ts'   # one file
```

Both `mutate` scripts end by running `bun scripts/score-minimums.ts --mutation`,
which compares the report against each file's recorded minimum (below) and exits
1 if any file lost ground.

**Cadence: batched, not per-commit.** Run `bun run mutate` before a push that
meaningfully changes `src/`, or when deliberately moving a recorded minimum. Run
`bun run mutate:full` at larger boundaries and whenever tests are added or
deleted — the incremental cache is keyed on source files, so a change confined
to `tests/` can leave it reporting yesterday's answer.

Operational notes, each learned the hard way:

- **A scoped run must start from a cleared `reports/mutation/incremental.json`**
  — otherwise it merges the last run's results and can report survivors that a
  hand-applied mutation proves the tests kill. `--force` does not prevent the
  reuse.
- **Concurrency:** Stryker's `-c N` forks N runners and stock vitest sizes its
  own pool from the CPU count, multiplying out to N × cores processes.
  `vitest.stryker.config.ts` (the repo config plus `fileParallelism: false`)
  makes `-c N` mean N processes; pick `-c` for the machine, not the core count —
  6 on a 14-core laptop you are still using.
- **`vitest.related: false` is deliberate:** vitest's related-test detection
  reads this repository's import graph badly (it once selected 64 of 7,429 tests
  for a `src/parse` mutant), and `coverageAnalysis: "perTest"` already gives
  Stryker a real per-mutant test filter.
- **No `buildCommand`, and the `mutate` scripts prefix `bun run build`:**
  `tests/format/identity.test.ts` loads the plugin from `dist/`, so it runs
  against the last build no matter what the sandbox contains and can never kill
  a mutant; building once keeps it meaningful for the unmutated code.
- **`ignoreStatic: false` is a deliberate cost:** every mutant in
  `src/parse/line-shapes.ts` — the single most important file in the parser —
  executes at import time and would be silently excused by `ignoreStatic`.

**Reading the report.** The `clear-text` reporter prints the score and every
survivor; for more, open `reports/mutation/html/index.html` and sort by
survivors, not score. A surviving mutant is a sentence of the code no test
constrains: write the test or delete the code. A mutant whose `killedBy` names a
single test is that test earning its keep. Score is the least interesting number
on the page — Stryker's global thresholds stay report-only (`"break": null`)
because one number over the whole tree is exactly the target nobody should aim
at; what fails a run is the per-file recorded minimum.

**The rule for a new test.** A new test must do one of three things: kill at
least one mutant the suite did not already kill; be a unit test at a module
interface (documenting the contract even when a broader test covers the same
mutants); or pin a formatting fixture. A test that does none of the three costs
maintenance and buys nothing — say so and drop it.

## Recorded minimums

Line coverage and mutation score are ratcheted per file against recorded
minimums — the lowest score each file is allowed to report — committed in
`scripts/metrics/score-minimums.json`. Both are **hard**: below the recorded
minimum is exit 1. (The design proposed soft warn-only ratchets; the
maintainer's ruling of 2026-08-24 upgraded them — a printout nobody has to
answer for drifts. What makes hardness affordable is the exceptions list: name
the untestable code, classify it, and say why, instead of slackening the minimum
for every other file.)

The exception taxonomy, one `class` per row:

| class   | means                             | what the `reason` field carries                       |
| ------- | --------------------------------- | ----------------------------------------------------- |
| `now`   | fixable now                       | what the missing test would assert                    |
| `when`  | fixable when some condition holds | the trigger, so the row can be re-read, not re-argued |
| `never` | not practical to fix              | why no test can distinguish the mutant                |

The rules that keep the file honest:

- **Minimums are measured-now values rounded down to a tenth**, never
  aspirations. Timing flap is real: a mutant that times out on a loaded machine
  counts as killed, and identical trees have measured a point apart. Raise a
  mutation minimum only when something in the diff explains the gain; the
  printed "raise the recorded minimum" line is a prompt to check, never an
  instruction.
- **Raising a minimum rides the commit that earns it** — that is the whole
  ratchet.
- **A minimum of 0 means the file has nothing to measure** (declaration-only
  files Stryker writes no row for). Only a zero tolerates an unmeasured file.
- **A recorded file the run did not measure is exit 2, never a pass** — that is
  the shape a scoped or crashed run takes. A file measured below its minimum
  outranks it: a definite regression is evidence about the code (1); a run that
  could not reach every file is evidence about the harness (2).
- **`bun run metrics` checks the file's completeness, not its numbers**: every
  `src` file must have a row, and no row or exception may name a file that is
  gone. That is the direction the file rots in, and it is cheap to check on
  every run.

## Pins

**The conformance pin.** `tests/conformance/quarantine.json` asserts exact
agreement between a case's actual failures and its entry, so the manifest
shrinks monotonically by convention — and convention is the hole, because
nothing stops `triage --write` from writing a longer manifest. So the count is
pinned in `scripts/metrics/conformance-pin.json` and checked by
`bun run metrics`. Growth means a case was quarantined, and moving the pin in
the same commit makes that a deliberate, reviewable act; a shrink moves the pin
down with it, because a ceiling left above the real number is slack a later
re-quarantine slips into unnoticed.

**Census pins are directionless.** The node-kind census
(`tests/parser/architecture.test.ts`) and the three realized grid sizes
(`scripts/metrics/shape-census.ts`) are equality pins, not budgets: 35 node
kinds is not better or worse than 30, and a grid of 3,000 shapes is not better
than one of 2,966. `bun run metrics` prints them with exactly two verdicts —
`pin holds` or `pin moved` — because printing is how a human notices a
deliberate move: the standing grid once shrank by 377 shapes with every gate
green, because the number appeared nowhere.

**Unread published fields (report-only).** After the table, `metrics` prints
every field of every type in the crossings registry that nothing reads — Parnas
leakage with no benefit. It is report-only by ruling, armed as a gate only once
observed quiet. References come from the TypeScript language service (a
hand-rolled scan gets destructuring wrong); a property assignment is a
construction, not a read; serialized types (`src/ast.ts`) are exempt as a class,
since their fields are read by `JSON.stringify` and Prettier's traversal, which
no scan can see.

## Where these come from

The literature behind the scorecard, in one line each: cognitive complexity
(Campbell, SonarSource) is the best available proxy for comprehension effort — a
moderate correlation, the strongest of the metrics tested (Muñoz Barón et al.,
ESEM 2020), while size remains the strongest single predictor of defects and the
confound that eats every other metric, which is why code lines always print next
to the metric claiming to beat them. The Maintainability Index is deliberately
absent
([van Deursen](https://avandeursen.com/2014/08/29/think-twice-before-using-the-maintainability-index/)).
Hotspots are Tornhill's churn × complexity (_Your Code as a Crime Scene_). Seam
width is Henry–Kafura information flow and Parnas leakage, counted where
declared; deep modules are Ousterhout's (_A Philosophy of Software Design_). The
defense inventory descends from Meyer's Design by Contract and Alexis King's
["Parse, don't validate"](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/);
agreement harnesses are Page-Jones's connascence of algorithm with a test
holding it in place.
