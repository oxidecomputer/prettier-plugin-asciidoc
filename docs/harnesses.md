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
differences and gates on the AST alone, printing the ids that differ as
pasteable `Parity-Diff:` trailer lines; those trailers go in the message of the
commit that moves them, and `--expected-diffs-trailers <rev>` gates on the
declaration being exactly right: every declared id must still differ (a stale
declaration fails) and every differing id must be declared (an undeclared diff
fails).

**The ledger's lifecycle.** A declaration is one line, anywhere in a commit
message:

```
Parity-Diff: <family> <id>
```

`<family>` is a single token from the closed enum in `scripts/parity-ledger.ts`
(each family is declared once, with a doc comment saying what moved and why),
and `<id>` is the rest of the line: a corpus or fixture id, spaces and all
(`lists_test.rb#consecutive list continuation lines are folded#0`).

The key is exact and case-sensitive: `Parity-Diff:`. `parity-diff:` and
`Parity-diff:` are prose, and the run then reports the id as undeclared while
the author looks at what they believe is a trailer. In the other direction, ANY
line of a gated commit message that starts with the key counts as a
declaration - indentation, a quoted block and a fenced example included - so do
not paste the literal syntax into a commit message. Pasting
`Parity-Diff: <family> <id>` (or `--formatted-ledger` output with its `<family>`
placeholder still in it) fails as an unknown family, and the cure there is
removing the pasted line, not declaring a family.

There is exactly one rule: **a commit that intentionally moves formatted output
declares each moved id with a `Parity-Diff:` trailer in its OWN message.**
Nothing has to be reset afterwards. CI resolves a base (the merge base on a pull
request, the pushed commit's parent on a push to `main`), unions the trailers of
every commit in `base..HEAD`, and gates the head against that union. A
declaration therefore stops being read the moment the base advances past the
commit carrying it, which is the same moment its diff stops being a diff. (The
file this replaced, `scripts/parity-expected-diffs.json`, had to be reset to
`[]` by the next commit, whatever that commit was about; CI run 32916094459
failed on exactly that.)

**A declaration goes stale the moment its diff is gone, including mid-range.**
Inside one pull request, a later commit that reverts or supersedes an earlier
one leaves the earlier commit's trailer in the scanned range with nothing left
to excuse, and the run fails as a stale entry. The same trap in its other
flavor: an id declared under a formatted-only family by one commit, whose AST a
later commit in the same range also moves, fails the cross-check. Nothing in the
working tree is the cure in either case - the fix is editing the DECLARING
commit's message (`jj describe -r <that change>`; a git contributor amends or
rebases that commit), not adding a trailer to the tip.

Before describing a commit, verify with CI's own gate:

```bash
bun run parity -- --base $(jj log -r @- --no-graph -T commit_id) \
  --expected-diffs-trailers $(jj log -r @ --no-graph -T commit_id)
```

Both arguments are git revisions, not revsets (`--base` feeds `git archive` and
the trailer range feeds `git log`), which is why the shas come out of `jj log`.
The working-copy commit works as the head: jj stores it in the colocated git
store, so `git log` can read it even though no git ref points at it. The run
takes a few seconds. To get the ids in the first place, run
`bun run parity -- --base <parent sha> --formatted-ledger`, paste its
`Parity-Diff:` lines into the message and replace each `<family>` (adding to the
enum in `parity-ledger.ts` first if no existing family names the change); prove
the change meaning-preserving with `bun run shape-diff` or a render check.

**A jj-squash note.** `jj squash --use-destination-message` discards the source
commit's message, and with it any trailers that message carried. Re-add them
when you re-describe the squashed commit. A forgotten one is not silent: the
local gate run above reports the id as an undeclared diff.

The gate is exact in both directions, and each failure message names its cure:
"stale entry - delete it" (the id vanished or no longer differs) means the
declaration outlived its diff - drop the trailer, there is no phantom diff to
chase; "differs ... and is not declared by a Parity-Diff trailer" is an
undeclared behavior change - unintended means fix the code, intended means
declare it; "malformed trailer" means a line starts with `Parity-Diff:` and does
not parse - it declares nothing, so it fails rather than being read as prose;
"is declared as both X and Y" means two trailers name one id under different
families, and one of them is wrong; "unknown family" means declare the family in
`parity-ledger.ts` first; "differs in the AST but <family> is a formatted-only
family" means the change moved the tree, not just bytes - the family is wrong or
the change does more than believed.

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

Both entries carry a SECOND, parallel gate over the same product: the reflow
re-classification invariant, against `tests/format/reading-ledger.json`. See
[the reflow re-classification invariant](#the-reflow-re-classification-invariant).

Proves: no list shape regressed, and no known-broken shape got quietly fixed
without its allowlist entry (and issue) being retired.

### `bun run reading-ledger` - the reading-violation inventory

Sweeps the depth-5 list-shape product for reflow re-classification violations
and reports them grouped by mechanism family; `--write` regenerates
`tests/format/reading-ledger.json`, which both sweep entries gate against. Exit
2 when the product spelled nothing, when a swept line left no verdict (the
trace-fidelity self-check), or when a violation's signature matches no declared
mechanism. There is no exit 1: the violating set is the report, and the ledger
is the gate over it.

Proves nothing by itself, exactly as `triage` does not; it writes the file the
two sweep entries hold the tree to.

### `bun run triage` — the conformance sweep

Assesses every corpus case against the four differential properties and groups
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

## The reflow re-classification invariant

Issue #58. Formatting may move where a line breaks; it may never move what a
line IS. The net that says so needs no oracle at all, which is what makes it
affordable over 111,121 documents.

### The invariant

A document's READING is the sequence of verdicts the production classifier hands
the reader while `parse` runs, projected to tokens that legitimate reflow cannot
change. For every document the suite formats:

```
readingOf(format(d))   == readingOf(d)
readingOf(format^2(d)) == readingOf(format(d))    when format^2(d) != format(d)
```

token-for-token sequence equality. The second clause is what catches corruption
that only appears on the second pass, and it is free: every consumer already
formats twice for its idempotence check. It is skipped when the second pass
changed no bytes, because byte-equal implies reading-equal.

The oracle is OUR OWN reader, traced rather than re-derived. `classifyLine`
reports every verdict it hands back through a module-level hook
(`setClassifyObserver`, `src/parse/lines/classify.ts`) that the reader calls
from its three classification sites; outside a harness the hook is undefined and
each site is one undefined check. A test-owned context tracker was rejected: it
would be a second reader dialect that drifts, and the point is to assert against
the reader's own reading.

Sequence equality rather than per-line provenance, because the printer does not
track which source line an output line came from and plumbing that through
reflow would be a behaviour-adjacent change. Any join or split that manufactures
a structural reading, destroys one, or re-kinds one moves the sequence; joins
and splits inside prose do not. Not an AST comparison either: that needs its own
normalization and converges on "semantic AST equality", which is render-equality
without the oracle's authority, and it points at a subtree rather than a line.
The AST-level net (`tests/parser/ast-invariants.ts`) stays orthogonal - it
constrains one parse's output, this constrains the relation between two parses.

### The projection rules

`tests/lib/reading.ts` implements them, and each one names the format test that
declares its transform deliberate. A rule with no such licence would be a hazard
the net has been told to ignore.

| rule                                                                       | licensed by                                                              |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| blank lines emit no token and end every fold                               | see "what it does not catch" below                                       |
| consecutive `text` tokens collapse to one                                  | `tests/format/reflow.test.ts`                                            |
| consecutive `indented` tokens collapse to one, within one block            | `tests/format/literal-paragraph.test.ts`                                 |
| a `text` run after a marker, dlist or admonition token is absorbed into it | `tests/format/unordered-list.test.ts`, `tests/format/admonition.test.ts` |
| `raw:comment` is transparent to a fold                                     | `tests/format/comment.test.ts`                                           |
| an attribute entry lowercases its name                                     | `tests/format/attribute-entry.test.ts`                                   |
| a raw anchor folds onto the metadata anchor token                          | `tests/format/anchor-spelling.test.ts`                                   |
| `delim:fencedCode` canonicalizes to `attrline delim:listing`               | `tests/format/fenced-code.test.ts`                                       |

Both collapse rules are gated on the FOLD MODE rather than on the trailing
token, and a blank line resets the mode. That is what keeps them block-scoped:
two literal paragraphs with a blank between them are two blocks and read as two
tokens, so deleting one of them moves the sequence.

The fence's `attrline` is the fence's OWN and is emitted unconditionally. The
printer emits a `[source,...]` line whatever precedes the fence, so a `[role]`
above one is a second attrline on both sides; a projection that deduped by
position instead reported that entirely ordinary document as a violation.

Three shapes deliberately do NOT fold. A list marker projects its variant AND
its style, because the style is what tells `*` from `**` - that is, what tells
an item from the nested item under it, and a flatten is exactly the corruption
class the sweep alphabet spells `* a` and `** b` to catch (issue #42). Nothing
is licensed away there: marker spellings are data the printer replays byte for
byte (`tests/format/marker-spelling.test.ts`). `textv` (the verbatim-flagged
foreign marker line) stays its own token, because its COLUMN decides what the
next `+` means and its disappearance must move the sequence. And a line the
reader consumed without classifying stays invisible, except that a marker-shaped
one synthesizes its token so the absorption rule can see the absorber; inside a
verbatim interior the same synthesis happens on both sides and cancels.

`tests/lib/reading.test.ts` pins every rule, plus the known-issue table in both
directions: the clean spelling reads the way it should, and the corrupted
spelling produces the signature the net is supposed to report.

### Where it is gated

Three consumers, three pinning mechanisms:

- **the conformance corpus** - `reading` is the fourth `ConformanceProperty`
  (`tests/conformance/properties.ts`), so a violation lands in
  `tests/conformance/quarantine.json` beside its case's other failures and gets
  the manifest's exact-agreement treatment in both directions. Its detail names
  the pass, the LINE the two readings part company on and the tokens that
  moved - `p1 line 412 [cont] -> []` - because a signature alone is enough to
  read a six-line sweep document and not enough to find the spot in a corpus
  document of several hundred lines. The line stays out of the ledger's
  `signature`, so ledger rows stay stable;
- **both list-shape sweeps** - a parallel gate against
  `tests/format/reading-ledger.json`: the deep entry against the WHOLE file, the
  depth-4 entry against the rows its shallower product spells (the
  `allowlistFor` derivation, so one ledger serves both depths). The deep entry
  does not filter, for the reason the deep allowlist gate does not: it sweeps
  the product the ledger was generated from, so a row whose document the product
  no longer spells fails there rather than sitting in the file unreported at
  both depths;
- **the named rows** - `tests/format/reading-invariant.test.ts` holds the shapes
  no corpus case and no sweep alphabet spells, including the ones that do NOT
  reproduce today (issues #27 and #46 shape 1), asserted clean with their issue
  numbers in the test names, plus a loop over `tests/format/fixtures`.

The sweep gate stays PARALLEL and is deliberately not folded into `sweepFails`.
The allowlist's families are render/idempotence mechanism claims and the
ledger's are reading mechanisms; the handful of documents in both are there for
two different reasons, and mixing the verdicts would blur what each entry
asserts.

### The ledger workflow

`tests/format/reading-ledger.json` is generated, checked in, and shrinks. Each
row is `{ document, pass, signature, family }`, sorted by document, and the
family is a mechanism with an issue behind it, not "known to fail":

| family               | mechanism                                                                  | issue |
| -------------------- | -------------------------------------------------------------------------- | ----- |
| lone-plus-join       | a lone `+` is joined into the prose beside it, dissolving the continuation | #43   |
| tail-reading-flip    | a prose join flips the reading of the line after it                        | #65   |
| admonition-colon-run | an admonition label split re-reads as a description-list delimiter         | #45   |

The enumeration lives in `tests/lib/reading-ledger.ts`, and the loader
cross-checks both directions: a family the enum does not declare fails, and so
does a row whose signature classifies as a different mechanism than it claims. A
signature matching none of them cannot be written at all - the generator exits 2
and asks for the family to be named and its issue filed.

Each test asks for the MECHANISM, not for its arithmetic. `lone-plus-join` needs
a lost `cont` and nothing on the losing side but the prose the `+` was joined
into; a `cont` lost beside an admonition, a marker or a delimiter got there by
some other path, and it falls through to another family or to UNCLASSIFIED
rather than inflating #43's row count with rows #43's fix will not remove.

The measured breakdown, as of the ledger checked in beside this file: 716 rows
over the depth-5 product - 710 lone-plus-join, all `[cont] -> []`, and 6
tail-reading-flip, three `[indented] -> [text]` and three `[title] -> [text]` -
of which the depth-4 product spells 25, all lone-plus-join. All but a handful
are render-EQUAL and idempotent today, so the sweep beside them passes every
one: that is the population issue #58 was filed to enumerate, and no other gate
can see it. The numbers live here rather than in the two sweep files, so they go
stale in one place.

To refresh after a fix: `bun run reading-ledger --write`, then say in the commit
which family shrank and why. Expect large generated diffs tied to one-line
mechanism claims; the lone-plus-join fix deletes 710 rows at once, and that is
the progress metric.

A TRACE-FIDELITY self-check rides along, in the generator, in the fixture loop
and over the whole conformance corpus
(`tests/format/reading-invariant.test.ts`). Last-wins-per-offset assumes every
line the reader acts on leaves a verdict, and silent under-tracing would make
the net quietly weaker rather than red. It runs under a stated bound: a
delimited interior and a literal body are legitimately unclassified, and telling
them apart from an under-traced line needs a second reader dialect this module
refuses to grow, so documents containing either report nothing. Everywhere else,
every non-blank line must carry a verdict, be marker-shaped, or be a lone `+`
(the two shapes the list extent scan takes directly). Zero exceptions across the
corpus and both sweep products, and the corpus half is now a gate rather than a
claim: it was pointed only at the sweep products, whose alphabet spells no
byte-order mark, and the one corpus document that opens with one had its whole
first line falling through to `opaque` - an empty reading on both sides, passing
vacuously, in exactly the shape this check exists to notice.

### What it does not catch

Measured, not assumed.

- **Divergence visible only to Asciidoctor's reading (#57).** The net is closed
  under our own parse, so a join that is legitimate reflow to us and a fold
  change to the oracle is invisible here. #57's five instances stay pinned by
  the deep sweep's render-equality allowlist. The consolation is concrete: at
  depth 5 the net catches six sibling instances of the same thesis that
  render-equality misses (family tail-reading-flip, issue #65).
- **Intra-line changes (#32).** Whitespace collapsed inside a code span never
  changes any line's classification. Out of scope by construction; #32 keeps its
  render-equality coverage.
- **Blank-line placement (#54, #46 shape 2).** Blank runs emit no token, so
  blank insertion and collapse are invisible. That is deliberate - see the
  rejected variant below.

### Rejected: the gap-sensitive variant

A projection that emitted a `gap` token for each blank run was built and
measured. It pulls #54 and #46 shape 2 into the net, and it floods: 308 corpus
and 645 depth-4 sweep diffs, dominated by families like `[] -> [gap]`,
`[gap] -> []` and `[delim:example gap] -> [gap delim:example]`, every one of
them deliberate gap normalization. A net whose report is mostly its own
formatting policy is a net nobody reads, so blank placement stays with the
harnesses that own it: #54 is already pinned by the sweep allowlist
(render-divergent, tokens identical - measured), and #46 shape 2 is an
idempotence wobble that needs the dedicated regression test its issue calls for.

## CI

`.github/workflows/ci.yml`, two jobs, split by question rather than by command.

**`gates`** — blocking, needs no other revision: `check`, `lint`, `fmt:check`,
`build`, `coverage` (the suite runs under it), `metrics`,
`test:deeply-nested-lists`. Every step carries `if: ${{ !cancelled() }}`, so one
failing gate never hides the others. The reflow re-classification invariant
needs no step of its own: its three gates ride the suite and the deep sweep that
are already there, and `reading-ledger` is a generator, not a gate.

**`differential`** — needs a base, and is `continue-on-error` for its first
iteration; flipping it to blocking is a one-line change once it has proved
stable. It runs `parity --expected-diffs-trailers HEAD`, the three `shape-diff`
grids, and `metrics --base`, serially in one job, because each step materializes
the base into `$TMPDIR` and parallel steps would pay that concurrently.

The base is a SHA the workflow computes: `git merge-base` against the PR's base
ref, or `HEAD^` on a push to `main`. Never a branch name — the repo is routinely
on no branch — and never `github.event.pull_request.base.sha`, which is the base
branch's tip, not the merge base. `fetch-depth: 0`, because a shallow clone has
no base revision to archive.

`HEAD` there is CI's spelling, not a local one: a GitHub checkout's `HEAD` is
the tree being tested, while in this jj-managed repo `HEAD` resolves to the
working copy's PARENT. Copying `--expected-diffs-trailers HEAD` into a local run
whose `--base` is `@-` names one commit twice; the gate refuses the empty range
and exits 2 rather than measuring nothing. Locally, pass the working-copy commit
id (`jj log -r @ --no-graph -T commit_id`), as the recipe above does.

### Running a differential harness locally

```bash
bun run metrics -- --base <rev>
bun run parity -- --base <rev> --expected-diffs-trailers <head-rev>
bun run shape-diff -- --base <rev> --grid standing
```

`<rev>` is anything `git archive` accepts. Each run materializes that revision
into `$TMPDIR` and deletes it on every path out, including failure. `<head-rev>`
is a git revision too, and it is NOT `HEAD` locally: `HEAD` is CI's spelling and
resolves to the working copy's parent under jj, so pass
`$(jj log -r @ --no-graph -T commit_id)` and give `--base` the parent.

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
