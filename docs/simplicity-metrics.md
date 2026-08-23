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
```

An unrecognised argument is an error, not a shrug: a silently dropped `--base`
would print a head-only table that looks like a passing comparison.

`scripts/metrics.ts` (with `scripts/metrics/`) measures `src` only — this is a
scorecard for the shipped code, not for the tests. Nothing in it counts by hand:
lines and escape hatches come from the TypeScript compiler's own parser,
complexity from eslint, coupling from `dependency-cruiser`, dead code from
`knip` and duplication from `jscpd`. Its own parts are tested in
`tests/scripts/metrics.test.ts`. The base revision is materialized with
`git archive | tar -x` into a temp directory, never `git worktree`: this
repository is jj-managed and often has a concurrent session, and a worktree
mutates `.git`. The base copy needs no install, because the eslint binary and
the metrics eslint config are referenced by absolute path into this checkout.

**Gates (non-zero exit), all in `scripts/metrics/gates.ts`.** Eight hold always:
an import cycle at head (a cyclic group has no reading order), a relative import
that resolves to nothing (a hole in that graph, which the cycle detection cannot
see through), an unused exported symbol under `src` (the residue of a
half-finished deletion), a resident agreement harness, a stale
interior-validation registry entry, an interior-validation registry that cannot
be READ at all, a defense marker split across two comment lines, and a named
seam that is missing or unmeasurable. Four more are RATCHETS that need a
`--base` to compare against: cognitive MAX per layer, each escape-hatch count,
each named seam's width, and each defense counter. None may rise. A layer that
did not exist at the base is skipped, since it cannot have regressed — and so is
a seam or a defense marker the base does not carry. The count of functions over
cyclomatic 10 is REPORT-ONLY — see "Why cyclomatic is report-only here" below.
The last three families are covered in "Design-quality budgets" below.

The last three of those absolute gates read registries that describe THIS
repository, so they hold against this repository only: an archived `--base`
revision and a `--root <dir>` checkout are measured by them and not judged
(`Snapshot.repository`). Without that, `--root` would fail on every foreign
checkout — including the throwaway ones that test the CLI's own exit codes.

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
table is the wrong metric** (Ruling 35).

So the row stays on the table, with base, head and delta, and the script prints
the offending functions by name and line underneath it. Reading the four
functions takes a minute; the number alone tells you nothing.

## The scorecard

Six numbers, printed per layer at the end of a task and diffed against the
task's base revision. The layers are `src/parse/lines`, `src/parse` (which
includes it), the printer — `src/print*.ts` plus `src/reflow.ts` and
`src/serialize-inline.ts`, seven files — and `src` overall.

| #   | Metric                      | Definition                                                                                                                      | Tool                                            | Better                              | Gate                                                                                       |
| --- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | **Cognitive complexity**    | SonarSource cognitive complexity per function: SUM, MAX, count over 15                                                          | eslint + `eslint-plugin-sonarjs` at threshold 0 | down                                | **Ratchet on MAX** with `--base`; SUM and tail reported                                    |
| 2   | **Code LoC + comment LoC**  | Lines carrying a real token, and lines carrying only comment trivia, counted separately                                         | the TypeScript parser                           | code down at a constant feature set | Report-only, ALWAYS printed as a pair                                                      |
| 3   | **Cyclomatic complexity**   | eslint's `complexity` per function: SUM, MAX, count over 10                                                                     | eslint at threshold 0                           | down                                | Report-only — see "Why cyclomatic is report-only here"                                     |
| 4   | **Coupling**                | Unique intra-`src` import edges (type-only imports included), files in a cycle, unresolved relative imports, exported names     | `dependency-cruiser`, the TypeScript parser     | edges and exports down              | **Hard gates: cycles = 0 and unresolved relative imports = 0**; edges and exports reported |
| 5   | **Escape hatches**          | `eslint-disable` comments, `as X` / `<X>` assertions (`as const` excluded), non-null `!`, `any` in type position                | the TypeScript parser                           | down                                | **Ratchet** with `--base`                                                                  |
| 6   | **Dead code + duplication** | Unused exports, types, enum and namespace members under `src` (and, reported only, under `scripts`); duplicated-line percentage | `knip` (always), `jscpd` (with `--duplication`) | zero unused; duplication under 1%   | **Hard gate: zero unused symbols under `src`**; jscpd report-only                          |

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
`git log --format=%H -N --name-only -- src`. `src/printer.ts` is the standing
hotspot — highest churn and the repository's worst cyclomatic function (33).

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

### Seam width

The member count of each NAMED cross-module interface, ratcheted per seam: a
seam may not gain members. v1 names four, and each one is what one module had to
publish for another: `ListHost` (`src/parse/lines/frames.ts`) — what
extent-first list reading needs from a reader; `ReaderContext`
(`src/parse/lines/classify.ts`) — the whole context the classifier reads, which
is the open paragraph shape, the open list styles and whether this is the
block's first line, and no terminator vocabulary at all; `ExtentBounds`
(`src/parse/lines/list-reader.ts`) — the single stream-end fact one extent scan
needs from its enclosing one; and `ParagraphHost`
(`src/parse/lines/paragraph-reader.ts`) — what paragraph reading needs from the
reader that owns the read position. The row COUNT is what the gate enforces;
this sentence only says what the rows are.

Every member is a fact one module had to publish about itself for another to
work, which is Henry–Kafura information flow measured where the flow was
declared, and Parnas's leakage counted at the point of the leak. It is also the
DENOMINATOR in Ousterhout's deep-module ratio: functionality over interface
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
`SEAMS` is a hand-maintained list exactly as the interior-validation registry
is, so it gets the same freshness gate.

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
add. StrykerJS answers exactly that question, and Ruling 38 makes it part of the
discipline rather than an occasional curiosity.

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
  moves, and it is the number a reviewer is tempted to target. Thresholds here
  are report-only (`"break": null`): the run never fails a build. Same rule as
  the ratchets above — a number that moves the wrong way is a question to answer
  in the task report, not a target.

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

**The rule for a new test (Ruling 38).** A new test must do one of three things:

1. kill at least one mutant the suite did not already kill,
2. be a unit test at a module interface (a named export, called the way its
   callers call it — these document the contract even when a broader test
   happens to cover the same mutants), or
3. pin a formatting fixture (input → expected output, the thing users actually
   observe).

A test that does none of the three is a test that costs maintenance and buys
nothing; say so and drop it.

## Method notes

- **Nothing is counted by hand.** Ruling 34: line classification and the
  escape-hatch counts come from the TypeScript compiler's own parser
  (`ts.createSourceFile`), coupling from `dependency-cruiser`, complexity from
  eslint, dead code from `knip`, duplication from `jscpd`. A regex line counter
  has blind spots by construction — a one-line block comment followed by code, a
  block comment opened mid-line, `//` inside a string — and a regex `as` count
  cannot tell `x as Foo` from `import * as T`. A raw `ts.createScanner` is not
  enough either: standalone it cannot tell `/` as division from a regular
  expression, and one wrong guess swallows the rest of the file.
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
- **knip is a devDependency and runs every time** (Ruling 36), because a hard
  gate that is silent by default is not a gate: "knip could not run" is a
  FAILURE, not a skipped row. It reports script entry points as "unused files"
  and the metrics-only `eslint-plugin-sonarjs` as an unused devDependency — both
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
