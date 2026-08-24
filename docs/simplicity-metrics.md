# Simplicity metrics

How this repository measures whether a refactor made the code easier to
understand, and why it measures it that way.

> Metrics are instrumentation, not the objective — if our metrics didn't tell us
> to do the simplest thing, they were the wrong metrics.

That sentence governs everything below. A row that moves the wrong way is a
question to answer in the task report; it is never a target to adjust, and never
a reason to make the code worse in the direction the number likes.

## Running it

```bash
bun run metrics                          # head only
bun run metrics -- --base 0298a2ba       # base | head | delta
bun run metrics -- --base=0298a2ba       # the same
bun run metrics -- --json                # the raw snapshots
bun run metrics -- --duplication         # also jscpd, fetched with bunx
bun run metrics -- --root <dir>          # measure another checkout
bun run metrics -- --help                # the usage string
```

An unrecognised argument is an error, not a shrug: a silently dropped `--base`
would print a head-only table that looks like a passing comparison.

It obeys the exit-code contract every script in `scripts/` obeys
(`scripts/lib/cli.ts`, and `docs/harnesses.md` for the family): **0** the gates
held, **1** a gate or a ratchet FAILED, **2** the scorecard could not run — a
bad argument, an unknown `--base`, or a `src` below the measured-nothing floor.
The 1/2 split is the load-bearing one. Without it an empty `src` scores a
perfect card: no files means no cycles, no unused exports and no escape hatches,
all of them vacuously true.

`scripts/metrics.ts` (with `scripts/metrics/`) measures `src` only — this is a
scorecard for the shipped code, not for the tests. Nothing in it counts by hand:
lines and escape hatches come from the TypeScript compiler's own parser,
complexity from eslint, coupling from `dependency-cruiser`, dead code from
`knip` and duplication from `jscpd`. Its own parts are tested in
`tests/scripts/metrics.test.ts` (the measuring), `metrics-cli.test.ts` (the
process exit codes) and `metrics-internal.test.ts` (the `@internal` split). The
base revision is materialized by `scripts/lib/checkout.ts`, shared with every
other differential harness, with `git archive | tar -x` into a temp directory,
never `git worktree`: this repository is jj-managed and often has a concurrent
session, and a worktree mutates `.git`. The base copy needs no install, because
the eslint binary and the metrics eslint config are referenced by absolute path
into this checkout.

**Gates (non-zero exit), all in `scripts/metrics/gates.ts`.** Thirteen hold
always: an import cycle at head (a cyclic group has no reading order), a
relative import that resolves to nothing (a hole in that graph, which the cycle
detection cannot see through), an edge a LAYER RULE forbids (see "Layer rules"
below), an unused exported symbol under `src` OR under `scripts` (the residue of
a half-finished deletion), a `src` export with no `src` consumer that does not
carry `@internal` (see "The `@internal` split" below), a resident agreement
harness, a stale interior-validation registry entry, an interior-validation
registry that cannot be READ at all, a defense marker split across two comment
lines, a named seam that is missing or unmeasurable, an unregistered or stale
cross-directory crossing, a quarantine manifest that has left its conformance
pin, and a minimums file that no longer describes the source tree (see "Recorded
minimums" and "The conformance pin" below). Four more are RATCHETS that need a
`--base` to compare against: cognitive MAX per layer, each escape-hatch count,
each named CONTRACT's width, and each defense counter. None may rise. A layer
that did not exist at the base is skipped, since it cannot have regressed — and
so is a contract or a defense marker the base does not carry. A VOCABULARY
seam's width is reported and never ratcheted. The count of functions over
cyclomatic 10 is REPORT-ONLY — see "Why cyclomatic is report-only here" below.
The last three families are covered in "Design-quality budgets" below.

The last five of those absolute gates, and the `@internal` one, read conventions
and registries that describe THIS repository, so they hold against this
repository only: an archived `--base` revision and a `--root <dir>` checkout are
measured by them and not judged (`Snapshot.repository`). Without that, `--root`
would fail on every foreign checkout — including the throwaway ones that test
the CLI's own exit codes.

knip is a devDependency and runs on EVERY invocation, because a hard gate that
is silent by default is not a gate: if knip cannot run at all, the run FAILS
rather than quietly skipping the row. jscpd is the one optional tool — it is
report-only, it is fetched with `bunx`, and it only runs behind `--duplication`.
`tests/parser/architecture.test.ts` asserts the cycle rule in the suite too,
through the same `cruiseImports` call, so the suite and the scorecard cannot
disagree about what the graph is.

A ratchet that fires is a question to answer in the task report — either the
change is justified and the report says why, or the code goes back.

## Why cyclomatic is report-only here

Cyclomatic complexity counts decision points and is blind to nesting, so a flat
twelve-arm `switch` scores the same as three nested loops with labelled breaks.
The research this scorecard is built on says so directly: "for a parser, this
matters a lot — dispatch tables score badly and read fine". Cognitive complexity
exists precisely to fix that, and it is the one that is ratcheted.

The concrete case, decided when the ratchet fired on the branch that introduced
this file rather than in the abstract: `itemContent`
(`src/parse/lines/list-reader.ts`) is a flat `switch` over the `LineKind`
discriminated union, one arm per branch of Asciidoctor's
`read_lines_for_list_item`. Cyclomatic 11, cognitive below 11. Gating on the
cyclomatic tail would have asked for that `switch` to become a handler table
keyed by a string — better score, worse code, and a metric that no longer means
what it says. **A metric that tells us to turn a flat dispatch into a handler
table is the wrong metric.**

So the row stays on the table, with base, head and delta, and the script prints
the offending functions by name and line underneath it. Reading the four
functions takes a minute; the number alone tells you nothing.

## The scorecard

Six numbers, printed per layer at the end of a task and diffed against the
task's base revision. The layers are `src/parse/lines`, `src/parse` (which
includes it), the printer — the eight modules of `src/print/` — and `src`
overall.

| #   | Metric                      | Definition                                                                                                                                          | Tool                                                                   | Better                              | Gate                                                                                                                           |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Cognitive complexity**    | SonarSource cognitive complexity per function: SUM, MAX, count over 15                                                                              | eslint + `eslint-plugin-sonarjs` at threshold 0                        | down                                | **Ratchet on MAX** with `--base`; SUM and tail reported                                                                        |
| 2   | **Code LoC + comment LoC**  | Lines carrying a real token, and lines carrying only comment trivia, counted separately                                                             | the TypeScript parser                                                  | code down at a constant feature set | Report-only, ALWAYS printed as a pair                                                                                          |
| 3   | **Cyclomatic complexity**   | eslint's `complexity` per function: SUM, MAX, count over 10                                                                                         | eslint at threshold 0                                                  | down                                | Report-only — see "Why cyclomatic is report-only here"                                                                         |
| 4   | **Coupling**                | Unique intra-`src` import edges (type-only imports included), files in a cycle, unresolved relative imports, exported names                         | `dependency-cruiser`, the TypeScript parser                            | edges and exports down              | **Hard gates: cycles = 0 and unresolved relative imports = 0**; edges and exports reported                                     |
| 5   | **Escape hatches**          | `eslint-disable` comments, `as X` / `<X>` assertions (`as const` excluded), non-null `!`, `any` in type position                                    | the TypeScript parser                                                  | down                                | **Ratchet** with `--base`                                                                                                      |
| 6   | **Dead code + duplication** | Unused exports, types, enum and namespace members under `src` and under `scripts`; `src` exports with no `src` consumer; duplicated-line percentage | `knip` (always), the TypeScript parser, `jscpd` (with `--duplication`) | zero unused; duplication under 1%   | **Hard gates: zero unused symbols under `src` or `scripts`, and every test-only export tagged `@internal`**; jscpd report-only |

Two things no tool computes, stated in prose in each task report:

- **Pipeline stage count** — how many representations one line passes through.
  Before 2026-08-21: source text → `SourceLine` → `LineKind` → `IToken` → CST →
  AST → Doc, which is six. Dropping Chevrotain took it to four — source text →
  `SourceLine` → `LineKind` → AST → Doc — and deleted the CST interfaces; if a
  refactor claims a stage and the count does not move, the claim is not
  supported.
- **Type-kind counts** — before the same change, 33 block/line token types, 15
  inline ones and 13 CST interfaces; after it, the 16 `InlineTokenType` string
  kinds (`src/parse/inline/tokens.ts`) and 30 AST node types (`src/ast.ts`), and
  nothing else.

Diagnostic, not gated: **hotspot = churn × cognitive complexity** per file, from
`git log --format=%H -N --name-only -- src`. `src/print/printer.ts` is the
standing hotspot — highest churn and the repository's worst cyclomatic function
(33).

## Design-quality budgets

Three more families sit on the same table, measured by
`scripts/metrics/design.ts` and gated in `gates.ts` alongside the rows above.
They differ from everything else on the scorecard in one important way, and it
is worth saying before the definitions:

> **These are budgets we maintain, not numbers a tool discovers.** The seam
> list, the interior-validation registry and the harness list are each written
> by hand and reviewed. What the tooling does is hold them to a ratchet and
> refuse to let them rot.

**Two honest caveats apply to all three, verbatim:**

- **Absence is unmeasurable.** We cannot count the defenses a better type would
  have made unnecessary, because they are not there to count. We count the
  defenses that remain.
- **A defense may only be deleted WITH its need.** Deleting a guard without
  removing the state it guarded against moves the number and makes the code
  worse. A plan report names which defenses became unnecessary and why.

And one structural consequence that shapes every gate below: **because every
ratchet in this family fires on RISE, the family can never detect an
undercount.** A deleted registry, a wrapped marker and a renamed seam all report
LESS, and less reads as progress. That is why the wrapped-marker detector exists
rather than being a documented risk, why a missing registry and a missing seam
are hard failures rather than `n/a`, and why the `Total fallback:` baseline had
to be completed in the commit that introduced it — an audit left half-done
freezes a too-low floor, and finishing it later fails the gate.

### Seam width, split into contracts and vocabulary

Every crossing is one of two things, and the scoreboard now says which.

A **contract** is what an implementer satisfies. It is judged by **width**: a
contract may not gain members, every conformer names it in an explicit
`implements`, and it must be fakeable. **There are no rows.** `ListHost` and
`ParagraphHost` were the two, and both dissolved when the list and paragraph
scans became pure functions over (lines, index, a context value) returning what
they found and where they end. Nothing in `src/` declares `implements` any more,
so there is no implementer to judge and nothing to fake — a contract with no
implementer is not a narrow contract, it is not a contract. The rows are removed
rather than held at zero: a seam that does not exist has no width to budget.
They come back when polymorphism does.

**Vocabulary** is the concrete data used IN those definitions. Nobody implements
it, so width is not its metric: it is judged by **precision** — no unread
published field, no valid-only-when field, one derivation of each fact. A wide
vocabulary is fine; an imprecise one is not. One row: `ReaderContext`
(`src/parse/line-shapes.ts`) — the whole context the classifier reads, which is
the open paragraph shape, the open list style and whether this is the block's
first line, and no terminator vocabulary at all. It is declared beside the
interrupting-set registry rather than beside the classifier because both
consumers sit at or below the classifier; `InterruptionOptions`, which used to
respell its last two fields under other names, is gone. Its width is REPORTED
and not ratcheted. `LineKind` and the AST are vocabulary too and carry no row,
because the scanner matches interface declarations only and both are unions;
whether it should widen to unions is open.

`ExtentBounds` was a fourth row and is not one any more: both sides live in
`list-reader.ts`, no module imports it, and its one member renames a boolean. A
crossing between two functions in the same file is not a crossing. Removing a
row is exactly the invisible undercount the gates in this family worry about, so
it was a deliberate, argued removal in the commit that did it — the budget does
not get _better_, it gets _honest_.

Every contract member is a fact one module had to publish about itself for
another to work, which is Henry–Kafura information flow measured where the flow
was declared, and Parnas's leakage counted at the point of the leak. It is also
the DENOMINATOR in Ousterhout's deep-module ratio: functionality over interface
size, where a module gets deeper by shrinking the interface, not by growing the
body. The pattern is `api-extractor`'s — a reviewed, checked-in report of a
published surface — turned inward, at the seams between our own modules rather
than at the package boundary.

Counted from the compiler's AST: the declaration's own property and method
signatures. A nested type literal's fields and the fields of a member's
parameter object do not count — they are reached through a member that already
counts — and an index signature is not a named member at all. The list is a
LOWER BOUND by construction: an unnamed structural type shared between two
modules is a seam nobody decided to have, and it is not on the list.

**A named seam must be ONE FLAT DECLARATION**, and the scanner refuses to
measure anything else. Two shapes are refused, both reachable by an ordinary
refactor and both of which would report FEWER members than a human counting the
surface:

- `interface S extends B` — factoring nine members into a base and leaving
  `interface S extends B {}` would take the seam to 0 with a green ratchet.
  Resolving `extends` properly means resolving imported bases, which is a
  type-checker's job and not a scanner's;
- two declarations of one name, which TypeScript MERGES — counting the first
  silently drops the rest.

That is a real constraint on the code, accepted deliberately: it is the only
honest way to hold a budget whose single failure direction is invisible.

**Absent at the BASE is tolerated; absent at HEAD is a failure.** A seam the
base revision does not declare cannot have widened, so the ratchet skips it —
the same tolerance `dead-code.ts` gives a tool that could not run. A seam
missing at HEAD is the seam list itself rotting: renaming or deleting a named
interface would otherwise drop it out of the budget with no ratchet firing.
`CONTRACTS` + `VOCABULARY` is a hand-maintained list exactly as the
interior-validation registry is, so it gets the same freshness gate.

### Layer rules

The layers are a DAG, and the DAG is enforced. `ast` ← `constants`/`positions` ←
`line-shapes` ← `inline/` ← `build/` ← `lines/`, with `print/` importing
`parse/` at exactly one deliberate, documented address
(`src/parse/line-shapes.ts`, so the formatter and the parser cannot disagree
about what a re-parsed line means) and `parse/` importing `print/` never. The
rules live in `LAYER_RULES` (`scripts/metrics/graph.ts`) and are checked by
dependency-cruiser's own rule engine, on the same cruise the cycle gate reads.

Every rule is a **direction**, not a symbol list, so it costs nothing to
maintain and cannot be satisfied by moving a name. `eslint`'s
`no-restricted-imports` is deliberately NOT used as a second enforcer: it would
duplicate these rules with a weaker vocabulary, which is the shape this
repository calls an agreement harness. Barrel files are refused for the same
family of reasons — they defeat the unused-export gate and erase the module
address a reader needs.

### Defense inventory

Counts of code that defends against states the types still permit. Each category
is a ratchet: it may not rise.

| Category                   | What it counts                                                                            | How                              |
| -------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------- |
| `unreachable()` sites      | Throwing can't-happen guards under `src` (its own module apart)                           | AST call expressions             |
| `Caller contract:` markers | A precondition the caller carries, stated in JSDoc                                        | Occurrences in comment trivia    |
| `Total fallback:` markers  | A can't-happen branch that silently DEGRADES instead of throwing                          | Occurrences in comment trivia    |
| `Valid only when` markers  | A field whose validity depends on a SIBLING discriminant, not mere optionality            | Occurrences in comment trivia    |
| interior validation sites  | A validating conditional whose false branch can't happen, outside the sanctioned boundary | `defense-registry.json`'s length |

This family is the operational shadow of "make invalid states unrepresentable."
Type precision — how much of the invalid space the types have made
unrepresentable — is the formal notion, and it is not computable here. So we
measure the residual defense burden instead: what the types did NOT rule out and
a human had to write code about. `Caller contract:` is Design by Contract with
the contract in prose because the type could not carry it. The registry is
"parse, don't validate" (Alexis King) with the sanctioned boundary named
explicitly: `src/parse/line-shapes.ts`, `src/parse/lines/classify.ts` and
`tests/` are where validation BELONGS, and everything else in `src` is interior.

Two rules keep the categories from double-counting each other. The registry is
DISJOINT from the marker counts: a site that throws is counted as an
`unreachable()` site, one that degrades behind a `Total fallback:` comment is
counted there, and the registry is for the ones no marker can catch — a plain
`if` or `??` that reads as ordinary code and is only recognisable by reading the
caller. That is why v1 is a list of judgements with a reason per site rather
than a text search.

The registry has its own hard gate: **every entry must still name a function
that exists.** A stale entry fails the run, so the registry cannot rot into
folklore. That check catches the rot that happens — the site deleted, the file
split, the function renamed — and does not catch a guard removed from inside a
function that kept its name; the `reason` field is what a re-audit reads.

Two things to know about the marker counts. Each marker must stay on ONE line
where it is written: the count is over comment text, and an 80-column wrap that
splits a marker in two hides the defense. And a counter that is ZERO at the base
revision is skipped, because a zero cannot be told apart from "this marker was
not a convention yet" and introducing a marker must not read as a regression.
The cost of that tolerance is real: a category driven all the way to zero loses
its gate until something re-enters it.

### Agreement harnesses

An **absolute gate: this must be 0.** An agreement harness is a resident test
whose ASSERTION compares the outputs of two of OUR OWN components against each
other. It is the shape that makes two implementations of one rule permanently
affordable — connascence of algorithm (Page-Jones) with a test holding it in
place, so neither copy can be deleted and the duplication reads as covered
rather than as debt.

What is NOT a harness, and belongs in the suite: a test against PINNED BYTES; a
test against the ORACLE (`tests/conformance/` is a differential net against
`@asciidoctor/core`, an external authority, not against ourselves);
`scripts/parity.ts`, which compares this checkout against a PRIOR CHECKOUT of
the same component and is a regression net over time; and a property test
asserting an invariant of one component's output, which names no second
component.

The audited value today is 0 — the historical hazard-vs-reader instrument was
scratchpad-only and never became a resident test. It is implemented as a
declared list (empty) with the gate that it stays empty, so adding a harness
means registering it, and registering it fails the build. The fix is never to
hold the count steady: it is to delete one of the two components and check the
survivor against bytes or the oracle.

Nothing scans `tests/`, which is why the scorecard row is labelled **agreement
harnesses (declared)**: it is the length of a hand-written list, and a row that
reads as measured when it is not is the one thing this table must never print.

## The `@internal` split

`knip` reports zero unused exports under `src`, and the number is true but
coarse: a test importing a symbol is a consumer to knip. So an export nothing in
`src` has needed since some refactor reads exactly like an export the parser
depends on, and the two are worth telling apart. **src exports with no src
consumer** is that second half, measured by
`scripts/metrics/internal-surface.ts` off the import statements the tree
actually carries.

The rule is a TAXONOMY, not a budget: there is no ratchet, because a wide
`@internal` surface is not automatically worse than a narrow one. What is worse
is not knowing which exports are which. So every export in the second half must
carry the bare `@internal` JSDoc tag, and the same block must NAME the unit that
consumes it, as a path that exists:

```ts
/**
 * …
 * Exported for its unit test (tests/print/reflow.test.ts); no src
 * consumer.
 * @internal
 */
export function wrap(…)
```

Both directions gate, for the reason every registry here checks both ways: an
untagged export in the second half fails, and an `@internal` on an export `src`
DOES consume fails as a stale tag. `src/index.ts` is exempt in both directions —
it is the package entry, its exports are the published API by definition, and
nothing inside `src` is supposed to import it.

It sits with the UNDERCOUNT gates because the transition it catches is
invisible. An export loses its last `src` consumer during an ordinary refactor —
no line is deleted, no count moves, knip still sees the test importing it — and
quietly becomes surface that exists for a test alone. Nothing else on this
scorecard can see that happen.

**Honest bound:** consumption is read off import statements, matched by name
against relative specifiers resolved back to a file. That is what this tree uses
— there is no dynamic import and no `export *` under `src` — but it is a
scanner, not a type checker, and a module reached by a namespace or default
import is treated as consumed WHOLESALE, so its exports drop out of the split.
`src/parser.ts` is the live case: the package entry imports its default.

## What disagreement between the rows tells you

Running several metrics is only useful because the PATTERN of disagreement is
the diagnosis:

- **LoC down, cognitive complexity flat or up** → compression, not
  simplification: three readable branches collapsed into one dense expression.
- **Cyclomatic down, function count and import edges up** → the decision did not
  disappear, it was spread across call sites.
- **Per-file complexity down, files in cycles up** → the problem moved across a
  module boundary and now needs two files open to read.
- **Comment lines up, code lines down** → either a genuine spec citation being
  recorded (good, and this repository's discipline actively wants it:
  `src/parse/line-shapes.ts` is 70% comments, each row naming the Ruby it
  mirrors) or documentation papering over an unclear mechanism. Tell them apart
  by WHERE: comments in a registry citing `parser.rb` are good; comments inside
  a long function explaining its own control flow are not.
- **Everything down, escape hatches up** → simplicity bought with `as` casts and
  `eslint-disable`.

## Anti-gaming

Every reported metric is paired with one that moves the opposite way when it is
gamed, and the pairs print on the same table so a reviewer sees both at once.

| Metric             | How it is gamed                                                                       | What catches it                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Code LoC           | Delete comments; one-line dense expressions; move logic into data or generated files  | Comment LoC printed alongside; cognitive complexity (density shows up); LoC over all `src`      |
| Cyclomatic         | Split one 20-branch function into six 4-branch functions only ever called in sequence | Function count, import edges, exported symbols; the caller's cognitive complexity barely drops  |
| Cognitive          | Hoist conditions into a lookup table keyed by an opaque string                        | Pipeline-stage and type-kind counts; oracle-pinned tests still needing the same branches        |
| Import edges       | Barrel/index re-exports that hide fan-out behind one edge; `import type` splitting    | Type imports are counted too; exported symbols rise when a barrel appears                       |
| Cycles             | Break a cycle by moving shared state into a third "utils" module both mutate          | Exported-symbol count and the new module's fan-in — a `utils.ts` with rising fan-in is the tell |
| Escape hatches     | Move the cast behind a helper; widen a type instead of casting                        | Type-kind counts; the `as` count is a floor, not a ceiling                                      |
| knip / jscpd       | Re-export dead code from an index to make it "used"; parameterise a clone             | Exported-symbol count rises; jscpd at a lower `--min-tokens`                                    |
| Test-to-code ratio | Add assertion-free tests                                                              | The conformance/oracle suite's pass count; mutation score (see below)                           |

## Is this test load-bearing? (mutation testing)

Every row above measures `src`. None of them can tell a test that would fail if
the code broke from one that would not — and the test suite is most of what we
add. StrykerJS answers exactly that question, and it is part of the discipline
rather than an occasional curiosity.

**What it does.** Stryker takes the shipped code, introduces one small defect at
a time — a `<` flipped to `<=`, a `&&` to `||`, a returned string literal
emptied, the body of an `if` removed, a `.slice(1)` deleted — and re-runs the
suite against each mutated copy. A mutant that makes some test fail is KILLED. A
mutant that leaves the whole suite green SURVIVED: the behaviour it broke is
behaviour nothing asserts. The mutation score is killed ÷ (killed + survived),
ignoring mutants no test even reaches (those are reported separately as
`NoCoverage`, which is a coverage hole, not a weak assertion).

```bash
bun run mutate          # incremental: only mutants in files that changed
bun run mutate:full     # every mutant, rebuilding the incremental cache
bun run mutate -- -c 6  # fewer workers, to leave the machine usable
bunx stryker run --mutate 'src/parse/lines/split.ts'   # one file
```

Both `mutate` scripts end by running `bun scripts/score-minimums.ts --mutation`,
which compares the report just written against each file's RECORDED MINIMUM (see
"Recorded minimums" below) and exits 1 if any file lost ground. A SCOPED run —
the fourth line above — writes a report for those files only, so run the check
by hand after one, and expect the other files to come back as "not measured"
(exit 2) rather than as passes.

**A scoped run must start from a cleared `reports/mutation/incremental.json`.**
Otherwise it merges the last run's results for every other file into the report,
and — measured on 2026-08-24 — can report survivors for the scoped file itself
that a hand-applied mutation proves the tests kill. `--force` does not prevent
the reuse.

Configuration lives in `stryker.config.json`; it points the vitest runner at
`vitest.stryker.config.ts`, which is this repository's own `vitest.config.ts`
plus `fileParallelism: false`, so Stryker discovers exactly the tests
`bun run test` does. Output goes to `reports/` (gitignored, including the
incremental cache — it is a machine-local record of the last run, not a fact
about the code).

**Concurrency: under Stryker, vitest runs single-process per worker, so `-c N`
means N processes.** That is what the separate config buys. Stryker's `-c N`
forks N test runners, and vitest in turn sizes its OWN worker pool from the CPU
count, so the stock config multiplies out to N × cores processes — measured on a
14-core machine at `-c 8`, a load average of 200 and thermal throttling that
made the run slower than a smaller `-c` would have been. Pick `-c` for the
machine, not for the core count: 6 on a 14-core laptop you are still using.

**Two settings that look like oversights and are not.**

- `vitest.related: false` turns OFF Stryker's "run only the tests related to the
  mutated file" optimisation. Vitest's related-test detection reads this
  repository's import graph badly: on one run it selected 64 of 7,429 tests for
  a mutant in `src/parse`, and on another it failed outright.
  `coverageAnalysis: "perTest"` already gives Stryker a per-mutant test filter
  that is derived from a real coverage run, so the vitest-side optimisation buys
  nothing and costs correctness.
- There is no `buildCommand`, and the `mutate` scripts prefix `bun run build`
  instead. `tests/format/identity.test.ts` is the one suite that loads the
  plugin from `dist/`, so it runs against the LAST build no matter what the
  sandbox contains and can never kill a mutant. Building once before the run
  keeps that suite meaningful for the unmutated code; a `buildCommand` would
  rebuild inside every sandbox and still not make those tests mutation-aware.

**How to read the report.** The `clear-text` reporter prints the score and every
survivor to the terminal as the run finishes — enough for a task report. For
anything more, open `reports/mutation/html/index.html` and sort by survivors,
not by score. Three readings, in order of what they are worth:

- **A surviving mutant is a sentence of the code that no test constrains.**
  Either write the test or delete the code — a survivor in a branch that cannot
  actually be reached is a branch to remove, not a mutant to ignore.
- **A mutant killed only by one hand-written test is that test earning its
  keep.** With `coverageAnalysis: "perTest"` the json report records `killedBy`
  — the test ids that killed each mutant. A test that appears as the sole
  `killedBy` for some mutant is load-bearing by construction. A test that never
  appears there kills nothing the rest of the suite did not already kill.
- **Score is the least interesting number on the page.** It moves when the code
  moves, and it is the number a reviewer is tempted to target. Stryker's own
  GLOBAL thresholds stay report-only (`"break": null`) for that reason: one
  number over the whole tree is exactly the target nobody should aim at. What
  fails a run is the PER-FILE RECORDED MINIMUM (see below), which is a different
  question — not "is the tree's score high enough?" but "did this file lose
  something it had?".

**Static mutants are NOT ignored** (`ignoreStatic: false`), which is a
deliberate cost. `src/parse/line-shapes.ts` is a registry of module-level
regular expressions pinned against Asciidoctor's `rx.rb`; every mutant in it
executes at import time and is therefore "static". Turning on `ignoreStatic`
would buy a much faster run by silently excusing the single most important file
in the parser from the question this whole section asks.

**Cadence.** Run `bun run mutate` at the end of every task — incremental, so it
re-tests only the mutants in files the task touched. Run `bun run mutate:full`
at plan boundaries, and whenever tests are added or deleted: the incremental
cache is keyed on source files, so a change confined to `tests/` can leave it
reporting yesterday's answer. A full run is minutes, not seconds — the
conformance suite is the slow part, which is why `timeoutMS` is 60s and the
dry-run timeout is generous.

**The rule for a new test.** A new test must do one of three things:

1. kill at least one mutant the suite did not already kill,
2. be a unit test at a module interface (a named export, called the way its
   callers call it — these document the contract even when a broader test
   happens to cover the same mutants), or
3. pin a formatting fixture (input → expected output, the thing users actually
   observe).

A test that does none of the three is a test that costs maintenance and buys
nothing; say so and drop it.

## Recorded minimums: what a file may not lose

Line coverage and mutation score are ratcheted per file against RECORDED
MINIMUMS — the lowest score each file is allowed to report — committed in
`scripts/metrics/score-minimums.json`. One file, one model, two metrics, because
they fail the same way; and both are HARD: below the recorded minimum is exit 1.

```bash
bun run coverage        # the suite with v8 line coverage, then the minimums
bun run mutate          # ~11 minutes, then the mutation minimums
```

The design doc proposed SOFT ratchets that warn. The maintainer's ruling
(2026-08-24) upgraded them, and the argument is the one the rest of this file
rests on: a soft ratchet is a printout, and a printout nobody has to answer for
drifts. What makes hardness affordable is not a lower number, it is the
EXCEPTIONS list. The honest answer to "some code cannot be tested without
contortions" is to name that code, classify it, and say why — not to slacken the
minimum for every other file at the same time.

**The taxonomy**, in the maintainer's words, one `class` per exception row:

| class   | means                             | what the `reason` field carries                       |
| ------- | --------------------------------- | ----------------------------------------------------- |
| `now`   | fixable now                       | what the missing test would assert                    |
| `when`  | fixable when some condition holds | the TRIGGER, so the row can be re-read, not re-argued |
| `never` | not practical to fix              | why NO test can distinguish the mutant                |

**Minimums are measured-now values rounded DOWN to a tenth**, never aspirations.
A minimum above the measured score fails on the commit that records it; a
minimum set to the exact measurement fails on timing flap alone, because a
mutant that times out on a loaded machine is killed on an idle one. **Raising a
recorded minimum rides the commit that earns it** — that is the whole ratchet,
and it is why the runs print
`… against a recorded minimum of X — raise the recorded minimum to Y on the commit that earned it`
for every file that has drifted a point above its number.

That suggestion is a prompt to check, never an instruction. Two full mutation
runs of one unchanged tree reported `src/parse/lines/open-style.ts` at 82.08 and
at 83.2, because a loaded machine turns SURVIVED mutants into TIMEOUTs and a
timeout counts as beaten. Raise a mutation minimum only when something in the
diff explains the gain. The recorded minimum of 82.0 held on both runs, which is
what rounding down conservatively buys.

A minimum of **0** means the file has nothing to measure: `src/ast.ts`,
`src/constants.ts` and `src/parse/inline/tokens.ts` are declarations only, so
Stryker writes no row for them at all. Only a zero tolerates an unmeasured file.

**A recorded file the run did not measure is exit 2, never a pass.** "The report
did not mention that file" is the shape a scoped or crashed run takes, and a
gate that goes quiet when its input disappears is not a gate. A file measured
BELOW its minimum outranks it: a definite regression is evidence about the code
(1); a run that could not reach every file is evidence about the harness (2).

**`bun run metrics` checks the file's COMPLETENESS, not its numbers** — it never
runs the suite. Every `src` file must have a recorded minimum (a file with none
has a minimum of zero), no row may name a file that is gone, and no exception
may name one either. That is the direction this file rots in, and it is cheap
enough to check on every run.

## The conformance pin

`tests/conformance/quarantine.json` asserts EXACT agreement between a case's
actual failures and its entry, so a fix turns quarantined cases red and the
entry has to be deleted: the manifest shrinks monotonically **by convention**.
Convention is the hole — nothing stops `bun run triage --write` from writing a
LONGER manifest, and a longer manifest is a suite that goes green on strictly
less.

So the count is pinned in `scripts/metrics/conformance-pin.json` and checked by
`bun run metrics`. The pin is EXACT, and the two directions carry different
messages: growth means a case was quarantined, and moving the pin in the same
commit is what makes that a deliberate, reviewable act; a shrink means a case
was fixed, and the pin moves down with it, because a ceiling left above the real
number is slack a later re-quarantine slips into unnoticed.

## Census pins are directionless

The node-kind census (`tests/parser/architecture.test.ts`) and the three
realized grid sizes (`scripts/metrics/shape-census.ts`) are **equality pins, not
budgets**. "As simple as possible, but not simpler": 35 node kinds instead of 30
is fine, and a grid of 3,000 shapes is not better or worse than one of 2,966.
Nothing about them is reported as a win or a loss, and `bun run metrics` prints
them under `census pins` with exactly two verdicts — `pin holds` or `pin moved`.

They are printed rather than merely gated because printing is how a human
notices a DELIBERATE move: the standing grid once shrank from 2,810 to 2,433
with `metrics`, `lint` and `test` all green, because the number appeared
nowhere.

## Unread published fields (report-only)

`bun run metrics` prints, after the table, every field of every type named in
the crossings registry that NOTHING reads. A field published across a boundary
that no consumer reads is Parnas leakage with no benefit; `ListHost.source` and
`LineKind`'s `raw`-arm `form` were the two live instances that motivated it,
both since fixed.

It is REPORT-ONLY by ruling, and is armed as a gate only once it has been
observed quiet — a precision check that fires on the tree it was written against
teaches reviewers to ignore it. References come from the TypeScript LANGUAGE
SERVICE, the same machinery "find all references" runs in an editor, because a
hand-rolled scan gets destructuring wrong. A property ASSIGNMENT in an object
literal is a construction, not a read, and does not count. WHERE the read is
does not matter: a record one module fills and its own declarer takes apart is
the design here, not leakage. Serialized types are exempt as a CLASS
(`src/ast.ts` — every field is read by `JSON.stringify` in the parity dumper and
by Prettier's traversal, none of it a property access a scan can see).
`scripts/metrics/unread-fields.ts` states the honest bounds.

## Suite size (report-only)

`bun run coverage` prints tests, test files and suite wall time. It is
report-only and always will be: a ratchet on suite size penalizes adding a
spec-citation pin, which is the opposite of what this repository wants. The
right signal is "8,472 → 12,000 in one change, explain that in the task report".
It is not on the scorecard table because the scorecard does not run the suite,
and a number cached from the last run that did would print stale.

## Method notes

- **Nothing is counted by hand.** Line classification and the escape-hatch
  counts come from the TypeScript compiler's own parser (`ts.createSourceFile`),
  coupling from `dependency-cruiser`, complexity from eslint, dead code from
  `knip`, duplication from `jscpd`. A regex line counter has blind spots by
  construction — a one-line block comment followed by code, a block comment
  opened mid-line, `//` inside a string — and a regex `as` count cannot tell
  `x as Foo` from `import * as T`. A raw `ts.createScanner` is not enough
  either: standalone it cannot tell `/` as division from a regular expression,
  and one wrong guess swallows the rest of the file.
- **A line is CODE if any real token starts on or spans it**, COMMENT if its
  only tokens are comment trivia, BLANK otherwise. Code wins over comment, so a
  line carrying both counts once, as code. Totals match `wc -l`.
- **Exported symbols are NAMES, not statements.** `export { a, b, c }` is three;
  `export const a = 1, b = 2` is two; `export default` is one; `export * from`
  is one, counted separately as well since how many names it re-exports is not
  knowable from the file.
- **Same eslint config for base and head.** Both revisions are linted with the
  generated metrics config, not the repository's own: the two disagree slightly
  (816 vs 805 on `src/parse` in one measurement) because of differing ignores
  and rule merging. Never mix them in one comparison.
- **Never compare across a feature addition without saying so.** Aggregates
  measured against a revision that lacks the behaviour are not a simplicity
  comparison. Say which revision has the same feature set, and read that column.
- **Comment density is reported, never gated.** Rising comment lines are a good
  sign when they record where a rule came from and a bad sign when they explain
  control flow the reader could not follow.
- **Import edges are unique file-to-file pairs.** Two statements reaching the
  same module (an import and a re-export, say) are one file a reader has to
  open. Type-only imports count, or a refactor could "reduce coupling" by adding
  a keyword.
- **`max-depth` carries no signal here** — it is already saturated at 4 by
  `eslint-config-love`, so it is not on the scorecard.
- **`as const` is not an escape hatch and is not counted.** It narrows a literal
  to its own type and adds `readonly`; it can never widen a value into a lie the
  way `x as Foo` can, and counting it would punish the safest spelling of a
  lookup table. `x as Foo` and `<Foo>x` are counted.
- **knip is a devDependency and runs every time**, because a hard gate that is
  silent by default is not a gate: "knip could not run" is a FAILURE, not a
  skipped row. It reports script entry points as "unused files" and the
  metrics-only `eslint-plugin-sonarjs` as an unused devDependency — both
  expected, which is why the gate is specifically on unused SYMBOLS under `src`,
  with `scripts/` printed beside it and never gated.
- **jscpd is the one optional tool.** It is report-only, needs `--duplication`,
  and is fetched with `bunx`; without it that row prints `n/a` and the rest of
  the table still stands.
- **`--root <dir>` measures another checkout** with this repository's tools —
  which is how the CLI's own exit codes are tested.

## Where these come from

- Maintainability Index, and why it is not here:
  <https://avandeursen.com/2014/08/29/think-twice-before-using-the-maintainability-index/>
- Cognitive complexity (Campbell, SonarSource):
  <https://www.sonarsource.com/resources/cognitive-complexity/>
- Muñoz Barón, Wyrich & Wagner, ESEM 2020 — a moderate correlation between
  cognitive complexity and time to understand, the strongest of the metrics
  tested: <https://arxiv.org/pdf/2007.12520>
- Peitek et al., ICSE 2021 — an fMRI study of 41 metrics; complexity metrics
  explain comprehension only to a limited degree, while textual size and
  vocabulary dominate:
  <https://conf.researchr.org/details/icse-2021/icse-2021-papers/10/Program-Comprehension-and-Code-Complexity-Metrics-An-fMRI-Study>
- Tornhill, _Your Code as a Crime Scene_ — hotspots as complexity × churn.
- Buse & Weimer (TSE 2010) and Scalabrino et al. (JSEP 2018) — readability
  models; background for why vocabulary and line length matter, with no
  maintained TypeScript implementation to run.
- Henry & Kafura (TSE 1981) — information-flow complexity: a module's cost is
  the fan-in × fan-out of the information passing through it, which is what seam
  width counts at the point the flow is declared.
- Parnas, "On the Criteria To Be Used in Decomposing Systems into Modules"
  (CACM 1972) — a module's interface should reveal as little as possible about
  its implementation; every seam member is a revealed fact.
- Ousterhout, _A Philosophy of Software Design_ — deep modules: functionality
  over interface size, where the interface is the denominator.
- Alexis King, "Parse, don't validate" (2019) — validate once at the boundary
  and return a type that makes the property structurally true; anything
  downstream that re-checks is the boundary's failure showing through:
  <https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/>
- Meyer, _Object-Oriented Software Construction_ — Design by Contract, the
  source of the `Caller contract:` marker's shape (a precondition stated where
  the caller can read it, because the type could not carry it).
- Page-Jones, _Fundamentals of Object-Oriented Design in UML_ — connascence, and
  connascence of algorithm in particular: two components that must agree on HOW,
  which is what an agreement harness pins in place.

The honest summary of that literature: cognitive complexity is the best
available proxy for comprehension effort, and it is a proxy. Size is the
strongest single predictor of defects and the confound that eats every other
metric, which is why code lines are always printed next to the metric that
claims to be better than them.
