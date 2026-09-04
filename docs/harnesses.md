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
`migration-diff` refuses a comparison tree that measured nothing, `triage`
refuses a corpus with no groups, `block-structure` refuses a short corpus, a
short sweep product, an oracle refusal other than the one document it pins by
id, and ledgers whose header names an oracle other than the installed one,
`local-docs` refuses a directory with no documents in it, `citation-check`
refuses a tree with fewer than a hundred citations in it, `probe-domains`
refuses a generated domain that spelled a different number of documents than it
is pinned at and a base revision that threw on every document of one, and
`metrics` refuses a `src` too small to be this repository's. Without the split,
an empty `src` would score a perfect card — no files means no cycles, no unused
exports, and no escape hatches, all vacuously true.

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

The run is the WHOLE suite, deliberately: a minimum scored from a red suite
scores nothing. One row of `tests/scripts/parity-trailers.test.ts` shells out to
`git rev-list` over this repository, and in a checkout with no colocated
`.git` - a jj workspace with none, which is exactly where parallel implementer
lanes run - that command has no repository to read at all. The row detects the
absence with `git rev-parse --git-dir` and skips itself by name rather than
failing, so the whole-suite precondition still holds and coverage's floor
comparison runs there too.

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

**The blanket form, for a schema change.** A change that records a new fact on a
node kind moves the serialized AST of every case that has that node kind, and no
case's bytes. Per-id trailers there are a thousand lines carrying one fact, and
a thousand lines nobody can read is not a ledger. So a family may declare the
serialized-AST keys it OWNS (`blanketKeys` in `scripts/parity-ledger.ts`), and
then one line with **no id** declares it:

```
Parity-Diff: <family>
```

That line accepts exactly the cases where the formatted bytes are identical
**and** the two ASTs are deep-equal once the family's declared keys are ignored
on both sides, proved per case, not asserted. Both halves matter;
`blanketCoverage` in `scripts/parity-keys.ts` is the canonical statement of why
the byte half is not redundant. A case that moved bytes alone, or whose tree
moved anywhere but in the declared keys, still needs its own per-id trailer, and
the blanket is therefore a NARROWER claim than the per-id form, which excuses
whatever its case did.

Proving a bare trailer costs one extra corpus dump per side, memoized so it
happens once regardless of how many families a run's trailers name and bounded
like every other child process here by `CHILD_MAX_BUFFER`, so a schema-change
commit roughly doubles parity's format work.

The two forms may appear in one range, and they interact in one direction: a
per-id line for an id the bare trailer COVERS declares nothing and fails, naming
both, because the blanket form exists to delete such lines and silence would let
the ledger regrow them. Per-id lines for ids the blanket cannot prove are
untouched, which is the combination to write when a schema change also moves a
few cases for some other reason.

A bare line naming a family that declares no keys is a failed gate (exit 1), not
a cannot-run: the harness measured everything it needed and the declaration is
wrong, which is the same class as an unknown family on a per-id trailer. Exit 2
stays for the runs that measured nothing — an unknown revision, an empty trailer
range, a corpus that did not load.

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

### `bun run test:deeply-nested-lists` - the deep sweeps

Runs every `*.deep.test.ts` under its own vitest config. Four tests today, and
the runner's floor is exactly four, so one being renamed out of the glob or
skipped is exit 2 rather than a green tick.

`tests/format/list-shape-sweep.deep.test.ts`: every nested-list shape to depth
5, which is 111,121 documents, each formatted twice and rendered on both sides,
against the allowlist of known-failing shapes in
`tests/format/list-shape-allowlist.ts`, each entry tagged with its tracker
issue. That allowlist is EMPTY today, so the gate asserts the whole product is
clean. Exit 1 when the failing set does not match the allowlist in either
direction; exit 2 when vitest collected nothing.

The default suite runs the same product at depth 4, and that depth is
load-bearing: Stryker runs the default suite, so a shallower default would let
sweep-killed mutants survive.

Both entries carry a SECOND, parallel gate over the same product: the reflow
re-classification invariant, against `tests/format/reading-ledger.json`. See
[the reflow re-classification invariant](#the-reflow-re-classification-invariant).

`tests/conformance/registry-sweep.deep.test.ts` is the third: the registry
sweep's deep tier. See
[the registry sweep](#bun-run-registry-sweep-triage---the-generated-conformance-sweep)
for what it sweeps and why its manifest is written as clusters. It is the most
expensive of the four, which is the reason it is here and not in `bun run test`.

`tests/conformance/inline-sweep.deep.test.ts` is the fourth: the inline sweep's
deep tier, 474,908 documents in about two minutes. See
[the inline sweep](#bun-run-inline-sweep-triage---the-generated-inline-sweep).

Proves: no list shape regressed, no known-broken shape got quietly fixed without
its allowlist entry (and issue) being retired, and no generated coordinate
outside the default tier changed its verdict.

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

### `bun run migration-diff -- --domain <name>` - three trees, bytes and renders

Formats one document domain under up to three checkouts and compares them on
bytes and on oracle renders. The CANDIDATE is this checkout; `--reference <dir>`
names a materialized checkout holding another implementation of the same
formatter; `--baseline <ref>` names a revision of this repository, or a checkout
of one. Candidate-against-baseline says what the current work changed;
candidate-against-reference says how far this tree sits from the other
implementation. Those are different questions, so the tool reports both rather
than folding them into one number.

The domains are `directive` (6,384 documents wrapping a body in an
`ifdef::`/`endif::` pair, `scripts/lib/directive-product.ts`), `dlist` (54,000
documents putting a description-list term under four wrappers,
`scripts/lib/dlist-product.ts`) and `population` (the corpus, the depth-5 sweep
product and the divergence witnesses, `scripts/lib/population.ts`). The first
two are pinned at exact sizes and the run refuses to start when the generator
spells a different number - the bars are stated in those sets, so a product that
quietly shrank would move the bar instead of failing it. `population` prints the
count it walked, which is the one number every tool that says "the population"
means.

`--word-loss` adds the word-loss column: a document loses words when the
multiset of the source's words minus the multiset of `format(format(source))`'s
words is non-empty, split on the six ASCII whitespace characters
`ASCII_WHITESPACE` names, counted over every document of the domain with no
instability precondition. `--gate` turns a non-empty "another tree renders this
and we do not" bucket into exit 1; without it the run reports and exits 0. A
comparison tree that measured nothing exits 2 with or without `--gate`: a gate
verdict taken from data that proved nothing is not a verdict.

Each tree pair produces THREE buckets. Two are directional and about renders -
"the other tree renders this as its source and the candidate does not", and the
same question the other way round. The third is about BYTES: the documents the
two trees print differently, whatever either renders. It is symmetric, it
ignores the second pass (two trees that print the same pass-1 bytes and then
diverge differ in stability, which each tree reports for itself in the
`unstable` column), and it skips any document a tree threw on, since there is no
output to compare.

The byte bucket is reported, never gated: two trees printing a document
differently is what a migration does. It is also the only bucket that can see
its class at all. A document both trees render as their source and spell two
different ways produces no render row in either direction - on the `directive`
domain, 865 documents differ in bytes between the candidate and the reference
and only 32 of them appear in a render bucket. The summary table carries the
count as the `bytes-differ` column, dashed for the candidate, whose own column
would be zero by construction.

Every render happens in THIS process under one normalizer, from bytes the other
trees hand back (`scripts/lib/tree-format.ts`) - three checkouts normalizing
three ways would report differences belonging to the harnesses rather than to
the formatters. Divergences in every bucket are grouped into families by the
reading diff between the two outputs, up to five witnesses kept per family; an
empty signature means the two outputs READ alike and whatever separates them
sits below what the projection can see.

Running it with `--baseline` and no local edits is the tool's own self-check:
the same tree reached two different ways - in process here, through a child
process there - must report no divergence at all, in renders OR in bytes. The
byte half is the stronger one: renders can agree while bytes differ, so a
render-only self-check would pass even if the child process were re-encoding
output on its way back.

Exit 2 when the domain is unknown, the reference is not there, a tree answers
about a different number of documents than it was asked about, or a pinned
domain spells the wrong count.

### `bun run probe-domains` - four domains the sweep cannot spell

Sweeps four exhaustively generated document domains under this checkout and,
with `--base <rev>`, under a base revision, and reports the SET DIFFERENCE per
domain: fixed, regressed, unchanged. Without `--base` it prints head counts and
gates nothing.

The domains exist because the list-shape sweep's alphabet has no hard-break line
and no symbol that spans two source lines, so no depth of its product - and no
part of the population, which contains that product - holds a document where a
` +` decides whether a break survives, or where an inline construct opens on one
line and closes on the next. Those are the lines the printer's reflow hold rules
are decided by. A change to them can move thousands of documents while the
sweep, the reading ledger and the population all report zero.

The four, generated in `scripts/lib/probe-domains.ts`, each a depth-1-to-3
product over its own alphabet under two prefixes (an item, and the same item
with a second text line) and pinned at an exact size: `hard-break` (2,794
documents - the sweep's alphabet with a ` +` line in it), `inline-opening`
(3,626 - lines an inline construct opens), `two-line-construct` (3,628 -
constructs broken across two source lines) and `indented-two-line` (2,122 - the
same with both lines indented). Three of them also carry named witnesses: 16
documents whose lines are not all alphabet symbols, each pinning a shape its
domain's alphabet cannot spell. `--domain <name>` runs one; the default is all
four. `--base` takes a revision or a directory holding a checkout of one, the
way `migration-diff --baseline` does.

Counts are not the report, which is why the differential is a set difference: a
domain that fails the same number of documents on both trees can have fixed
eleven and broken eleven, and the two counts agree while the tree got worse.
Both measures are reported for the same reason - FAILING (the sweep's own
verdict: the formatter threw, its output is not a fixed point, or the oracle
renders it unlike its source) and RENDER-UNEQUAL alone, because a document can
trade one for the other and the render is the one that says the text stopped
meaning what it meant.

What a failure IS comes from `tests/format/list-shape-sweep.ts`, the same
definition the two sweep entries gate on. Only the formatting moves between
trees: the base's outputs come back from a child process running that revision's
own formatter (`scripts/lib/tree-format.ts`) and every render happens in this
process under one normalizer.

Exit 1 when a regressed set is non-empty. Exit 2 when the harness could not run:
a bad argument, an unknown domain, an unknown `--base`, or a base tree that
answered about a different number of documents than it was asked about. Two
measured-nothing floors exit 2 as well. A domain that spelled a different number
of documents than it is pinned at, since every count the tool prints is a count
out of a domain. And a base tree that THREW on every document of a domain: its
failing set is then the whole domain, so the set difference reports everything
as fixed and nothing as regressed - a green tick over a tree that could not
format at all, which is the one shape a differential's own success looks
identical to.

Running it with `--base` and no local edits is the tool's own self-check: the
same tree reached two ways, in process here and through a child process there,
must report every set unchanged.

Proves: a change to the reflow hold rules broke no document in the four shape
classes every other net is blind to.

### The divergence witnesses

`tests/format/divergence-witnesses.json` holds documents that once told two
readers apart, taken from the sealed line-reading revision `24240b2e` so they
outlive the export they came from, each with the family it witnesses and whether
the two readers differed in bytes, readings or both. It asserts nothing about
how this tree reads them - a claim of that kind belongs to whichever change
makes it, as its own fail-then-pass fixture. What it pins is that the documents
SURVIVE, so a later change cannot quietly lose the input that would have caught
it.

Corpus witnesses carry an id rather than bytes, resolved through
`vendor/asciidoctor-corpus` at load time; re-committing those bytes would be a
second copy free to disagree with the first. `tests/lib/divergence-witnesses.ts`
is the loader, and it throws rather than skipping when an id stops resolving.

### `bun run triage` — the conformance sweep

Assesses every corpus case against the four differential properties and groups
the failures by signature. `--write` regenerates
`tests/conformance/quarantine.json`: still-failing cases keep their issue tag,
new failures are tagged `UNTRIAGED`, and cases that now pass are dropped — which
is how a fix gets pinned, because the manifest asserts exact agreement and the
suite fails if a quarantined case starts passing.

Proves nothing by itself; it writes the report the quarantine manifest is
generated from, and the manifest is what the suite gates on.

### `bun run registry-sweep-triage` - the generated conformance sweep

The same three differential properties (crash, idempotency, fidelity) run over
the documents `scripts/shape-registry.ts` GENERATES rather than over the
vendored corpus. The corpus says how the formatter behaves on prose people
wrote; the grids reach coordinates no corpus contains, and shape-diff already
runs those coordinates but only for base-against-head byte equality, so it can
hold a whole grid stable while every row of it crashes. This is the missing
verdict. `tests/conformance/registry-sweep.ts` is the sweep itself; the two
gates over it are tiered by wall time:

- DEFAULT tier, in `bun run test` (`tests/conformance/registry-sweep.test.ts`):
  the standing grid crossed with every byte operator, 29,229 rows in about 8 s,
  which is roughly 2.5 s of added suite wall time because vitest runs it beside
  everything else. Pinned to `tests/conformance/registry-sweep-quarantine.json`,
  one entry per failing row.
- DEEP tier, in `bun run test:deeply-nested-lists`
  (`tests/conformance/registry-sweep.deep.test.ts`): both grids under every byte
  operator, 613,293 rows in two minutes on its own and a little over three
  sharing the runner. Pinned to
  `tests/conformance/registry-sweep-deep-manifest.json`, failing rows grouped
  into clusters.

`bun run registry-sweep-triage` (no `--write`) sweeps both tiers without
touching either file and prints the current totals on its first line - rows
swept, rows failing, clusters, and the default-tier slice of each - which is
where to read today's count for both manifests above; a number copied into this
prose would just go stale the next time either file regenerates.

Both pins are exact in both directions, so a coordinate that starts failing
fails the gate AND a pinned coordinate that gets fixed fails it too, until its
entry goes. The deep manifest is written as CLUSTERS only because a five-figure
row list is a file nobody reviews: a cluster is keyed by grid, byte operator and
failed properties, and records the row count, five example ids and the sha256 of
its full sorted id list, all three of which the gate recomputes. A row that
appears, vanishes or migrates between clusters therefore changes a hash. When
the deep gate disagrees it writes the whole failing list to
`reports/registry-sweep-deep-failures.json` (gitignored) and prints the path,
because the manifest names only five ids per cluster and triage needs the rest.

**The byte spellings the corpus cannot carry.** Asciidoctor normalizes at
ingest: `Helpers.prepare_source_string`, reached from `prepare_lines` in
`vendor/asciidoctor-ruby/reader.rb:584`, rstrips every line, strips a BOM and
rewrites CRLF before the first classification rule sees a line (helpers.rb
itself is not vendored, so the call site is where a reader checks this). Those
bytes therefore cannot change what a document renders as, and nothing pressures
a corpus file into carrying one: of the 1,614 vendored cases, four carry
trailing whitespace, one carries a BOM, and none carries a CRLF or a missing
final newline. Our formatter sits on the other side of that erasure, working on
the author's bytes, so a delimiter line with a trailing space is a line it has
to classify as a delimiter and print without the space. Minting the bytes is the
only way to test that, which is what the eight operators in
`scripts/shape-registry-byte-operators.ts` do: a trailing space, tab, vertical
tab or form feed on every non-empty line; a trailing space on the first line
alone, because an all-lines operator masks a position-dependent bug; CRLF; no
final newline; a BOM. Bare CR is out while #68 is open.

**The ratchet.** A bug in a shape these grids can reach is expressed as a sweep
row before it is fixed, whatever found it: a real document, a review reading, an
oracle disagreement someone hit by hand. The row comes first because a fix
pinned only by the case that exposed it holds one coordinate, where a row holds
every coordinate the grids reach around it, each under every byte operator that
changes its bytes. When the registry cannot spell the bug, that is the finding:
the same change extends whichever dimension is missing, the construct alphabet,
the container set or the byte operators, until it can. The census pins move with
the extension, and they are what makes this mechanical rather than a promise:
rule (iii) of `scripts/metrics/shape-census.ts` matches each roster against the
registry in both directions and rule (v) pins the realized grid sizes, so a new
container or operator fails `bun run metrics` until its numbers are moved
deliberately, and both manifests here are regenerated in the same commit. A
change that fixes a grid-reachable bug while the row counts and both manifests
stand still has not been ratcheted, and the next bug of its family arrives
unpinned.

`--write` regenerates both manifests from one sweep, on the terms
`bun run triage` uses: still-failing entries keep their issue tag, new ones are
tagged `UNTRIAGED`, and entries that now pass are dropped. Exit 0 the sweep ran,
2 it could not run (a registry that spelled no rows); there is no exit 1,
because the failing set is the report and the manifests are the gate.

Proves nothing by itself, the way `triage` does not; it writes the two files the
sweep's gates hold the tree to.

### `bun run inline-sweep-triage` - the generated inline sweep

The same three properties again, over documents built from the INLINE rule table
rather than from line shapes. The two generated sweeps do not overlap. The line
registry varies which LINES a document is made of and never varies the text
within one, so no row it mints reaches a mark boundary, an attrlist in front of
a span, an escape, or a reflow that moves a delimiter away from its content.
Those are where the inline reader's bugs have actually been found, and before
this sweep each was found by a generator written during the fix and thrown away
after it (issue #113).

`scripts/inline-registry.ts` is the enumeration. Three dimension classes:

- CONSTRUCTS, one per row of `src/parse/inline/rules.ts` plus the fallback kind
  the table has no row for, each carrying the valid spellings of its construct
  and the spellings that sit a character or so away from one. 146 alphabet
  members in all. Only the SPELLINGS carry an invariant - the census holds each
  to tokenizing as its own kind; a near miss is a neighbour in the alphabet, and
  40 of the 65 of them do still tokenize as the kind they are filed under.
- NEIGHBOURHOODS, what stands immediately around the construct inside one inline
  run: nothing at all, in a word, spaced, escaped, bracketed, behind a role
  attrlist, behind an open bracket, behind a bracket and a backslash, after a
  closing bracket, repeated, inside a bold span, inside a monospace span, in
  front of a trailing mark, and two reflow fillers. Fifteen of them, and this is
  the axis the line registry has no dimension for at all.
- CONTEXTS, which inline-bearing line the run belongs to: a paragraph's first
  and second line, a list item, a description, a section title, a block title,
  an admonition, a table cell. Eight.

The second reflow neighbourhood is measured rather than decorative: its filler
is 61 columns, so a body up to the eighteen-character budget still fits the
80-column first line and the unbreakable word behind it cannot, which puts the
LINE BOUNDARY immediately after the construct. The census pins both halves - the
arithmetic, and that no alphabet member exceeds the budget - because a filler
one column longer moves the boundary in FRONT of the longest bodies while
changing no count any other rule watches. The placement is exact in the contexts
that prefix nothing; a list marker or an admonition label shifts the run right,
and those rows break earlier.

Two gates over it, tiered by wall time:

- DEFAULT tier, in `bun run test` (`tests/conformance/inline-sweep.test.ts`):
  the standing grid clean, 17,349 rows in about three and a half seconds run on
  its own. Inside the suite vitest reports it at nearer six seconds under
  contention, while the suite's own wall time moves by under a second, because
  the line registry's default tier is the longer pole; both figures move with
  machine load. Pinned to `tests/conformance/inline-sweep-quarantine.json`, one
  entry per failing row.
- DEEP tier, in `bun run test:deeply-nested-lists`
  (`tests/conformance/inline-sweep.deep.test.ts`): that grid under every byte
  operator, plus the whole pair product - any two alphabet members standing in
  ONE inline run, joined adjacently, by a space, by a bracket pair, across a
  kept comment line or across a tabbed em-dash spelling. 474,908 rows in about
  two minutes. Pinned to `tests/conformance/inline-sweep-deep-manifest.json`,
  failing rows grouped into clusters.

`bun run inline-sweep-triage` (no `--write`) sweeps both tiers without touching
either file and prints the current totals on its first line, the same way
`registry-sweep-triage` does - see above for what each field means and where it
lands in these two manifests.

The byte operators are `scripts/shape-registry-byte-operators.ts`, not a second
set: the ingest bytes Asciidoctor erases are one vocabulary. They are a
deep-tier concern here because they multiply the row count by nine, and what the
always-on budget buys instead is the whole inline alphabet at every
neighbourhood and every context. The pair grid is not crossed with them at all;
that product is two million rows for a dimension the standing grid already
crosses with the same alphabet.

The deep manifest is written as clusters for the reason the registry sweep's is,
and its key differs for a measured reason. A registry-sweep cluster is keyed by
grid, byte operator and failed properties; an inline cluster is keyed by the
CONSTRUCT KINDS a row spells and the axis that placed them, with the operator
deliberately left out. Inline, the operator does not discriminate: the classes
span all nine uniformly, so keying on it turns 24 failure classes into 169
clusters, each finding spelled nine times over. Nothing is given up by dropping
it, because a cluster still records the count, five example ids and the sha256
of its full sorted id list, all three recomputed by the gate - a failure that
appeared under one operator only would move a count and a hash. The key is not
parsed back out of the row id either: the registry knows the kind and the axis
while it is building the shape, so `InlineShape.cluster` carries the answer
forward.

**What holds a new construct is the COMPILER.** The registry spells its
dimensions as a `Record<InlineKind, ...>`, so a kind added to the inline
vocabulary fails `bun run check` before any census rule runs. Saying that
plainly matters, because it is also the bound: a second `INLINE_RULES` row for a
kind that already has a dimension is invisible to everything here.

**The census.** `scripts/inline-census.ts`, gated by
`tests/conformance/inline-sweep-census.test.ts`, holds what a type cannot. Six
rules: every construct dimension is still a rule-table row (the other direction
is the compiler's, so there is no loop for it); every valid spelling TOKENIZES
to the kind it is filed under; every runtime export of `rules.ts` is the
enumeration source or carries a written exemption; the neighbourhood, context,
pair-context and pair-join rosters match a written roster in both directions;
every alphabet member reaches a realized row and fits the reflow-edge budget;
and the two realized grid sizes are pinned.

The tokenizing rule is what makes it more than a name comparison. A dimension
can name a kind and spell it wrongly - a body no rule reads as the construct it
claims to be still feeds the formatter a document, still passes every
set-difference rule, and exercises nothing. The same honest bounds as the
line-shape census apply otherwise: this is NAME coverage, not behavior coverage;
CONSTRUCT coverage, not INTERACTION coverage; and MODULE-scoped to `rules.ts`,
so a spelling the whole-fragment scans learn (`curved-quotes.ts`,
`doubled-marks.ts`, `super-sub.ts`, `replacements.ts`) reaches the grid only
when somebody writes it down.

**The pair grid takes the whole alphabet**, with no filter in front of it. There
is a standing temptation to add one, because a member whose verdict is decided
by something that is not the pairing fails beside all 145 others and can swamp
the manifest; the tabbed em-dash spelling did exactly that, at 2,189 of 2,199
pair failures, until the whitespace fold behind it was fixed. The cost of the
filter is that it hides every OTHER row the excluded member would have found,
which is what this grid exists for, so the answer is to fix the swamping
mechanism rather than to stop measuring it. Two rules hold that: rule (v) fails
when any member reaches no realized pair input, and the pair grid-size pin (rule
(vi)) fails when the realized count moves at all, so a filter added here cannot
pass silently.

**The ratchet** extends here unchanged: an inline bug found by any other means
is expressed as a row in this registry before it is fixed, and when the registry
cannot spell it, extending the alphabet or the neighbourhood set IS the finding.
The census's roster rules and size pins are what make that mechanical, and both
manifests are regenerated in the same change.

`--write` regenerates both manifests from one sweep, on the same terms
`registry-sweep-triage` uses: the deep tier CONTAINS the default tier, so one
sweep writes both. Exit 0 the sweep ran, 2 it could not run; there is no exit 1.

Proves nothing by itself; it writes the two files the sweep's gates hold the
tree to.

### `bun run block-structure` - block structure against the oracle

The three differential properties (issue #7) ask whether formatting crashes,
whether it settles, and whether it changes what Asciidoctor renders; all three
are properties of our OUTPUT. This comparison (issue #30) is a property of our
PARSE. It projects our `parse()` and `Asciidoctor.load()` onto one canonical
tree of KIND-ONLY nodes (`tests/conformance/structure.ts`) and requires the two
to be equal as trees of kinds - kind, child order, nesting, count - with
divergences enumerated per child list by an LCS alignment so one inserted node
does not cascade over every sibling after it.

It runs over BOTH corpora, because they are blind to different things: across
1,614 conformance-corpus documents just five divergences have a path inside a
list item, while the depth-4 list-shape sweep product has 932 diverging
documents built from nothing but list structure, of which the sweep's own
render-equality and idempotence allowlist knows one. Five real documents is far
too thin a sample to gate list modelling on, which is why the generated product
runs too. 225 corpus documents and 931 sweep documents round-trip byte-clean,
are idempotent and render identically while our AST models them differently from
Asciidoctor - that is the blind spot this harness exists for.

**What it does NOT prove.** Node identity is the KIND ALONE: no content, no
attributes, no positions, no levels. A document can pass this gate while its
titles, ids, roles, styles, options, verbatim text, table cells and every inline
span are wrong. That is the deliberate trade - kind-only is what keeps the
mapping a couple of hundred lines of statements about the two MODELS instead of
a canonicalization of every text-carrying field (measured: comparing verbatim
content adds two folds and returns only re-indentation and preprocessor-unescape
noise; heading levels add eight noise documents and no finding). Read a green
run as "the block skeleton agrees", never as "the parse is right". Three further
blind spots by construction: a no-op include processor means the oracle never
sees included content, verbatim/table content is opaque on both sides, and an
oracle `section` is spliced away into its heading plus its children, so which
section a block belongs to is not compared either (our model has no section node
to compare it against).

**And a large minority of the corpus carries almost no structure to compare.**
Of the 1,613 corpus documents the oracle loads, 637 canonicalize to two nodes or
fewer on BOTH sides; 12 of those are the document node alone, where the whole
comparison is `document == document`; and 298 are the document plus one OPAQUE
leaf - a lone `listing`, `table`, `pass`, `literal` or `verse` whose content
neither side descends into - so those assert only "there is exactly one block
and it is of this kind". The median canonical tree is three nodes. The floor is
a count of DOCUMENTS, and the honest reading of "1,614 conformance-corpus
documents" is that roughly 40% of them make a nearly vacuous comparison; the
structural weight of the corpus half sits in the rest.

**Two ledgers, because the two corpora have different id economics.**
`scripts/block-structure-corpus.json` is keyed by CASE ID and pins each
diverging case's signature, so a fix that turns one divergence into a different
one fails until the entry is rewritten or deleted. A signature is the sorted
multiset of the divergence's kind pairs with counts
(`-paragraph x2; paragraph=>dlist`) and the PATH is dropped, so it says what
moved and not where; the corpus ledger's per-id key is what carries the "where".
`scripts/block-structure-sweep.json` is keyed by SIGNATURE and pins a count plus
a canonical example, because per-id is not an option at sweep scale (12,645
diverging documents at depth 5); the example is checked too, so the common
"repaired five, broke five" way of gaming a count does not pass. Both are
generated by `bun run block-structure --write`, which keeps the family a human
already named and records anything new as `UNTRIAGED` - and `UNTRIAGED` is not
in the closed enum, so the gate stays red until somebody names it. The reviewer
then reads the ledger DIFF, which is the artifact that says what a change did to
our conformance.

Unlike the parity ledger these files are NOT reset to empty by the next change:
they describe an absolute standard (the oracle), not a diff against a base
revision, so they persist and shrink. They are measured, not authored -
regenerate both whenever the ORACLE PIN or the PARSER moves, and read the diff.

**Two family prefixes, and the split is not cosmetic.** `gap:*` means our model
is wrong or incomplete - a real conformance gap, mapped to an issue, which must
shrink. `oracle:*` means the oracle RESOLVED something a formatter must not
resolve - a conditional, an attribute value, a doctype's semantics - and is
permanent by design. Without the split the corpus ledger would read as one pile
of bugs when a real share of its rows are statements about what a formatter is,
not gaps to close. `oracle:*` rows are ledgered rather than excluded on purpose:
an exclusion rule is a silent filter that can grow, while a stated family is
reviewable. `bun run block-structure` prints both counts on its
`corpus families:` line every run; they are not repeated here because they move
whenever the ledger is regenerated and a written-down copy would just go stale,
the way one already had.

**Floors and exit codes.** Exit 1 when a ledger gate fails: an unknown family, a
stale entry, a case that no longer diverges, a signature that moved, a diverging
case with no entry, a sweep count that moved. Exit 1 too when the MAPPING is out
of date, reported under its own header so it is not read as a statement about
the parse. Exit 2 for the measured-nothing conditions - fewer than 1,614 corpus
cases loaded, fewer than 11,128 depth-4 sweep documents spelled, an oracle
refusal other than the single pinned case, or a ledger header naming an oracle
version other than the installed one.

The refused case is pinned BY ID (`ORACLE_REFUSES` in
`scripts/block-structure-ledger.ts`: an `attributes_test.rb` case setting
`:backend: docbook5`, for which the JavaScript build ships no converter) rather
than counted, because a count of one is satisfied by any one document - a corpus
re-fetch that dropped this case while another started failing to load would keep
the count and drop that other document from the comparison unremarked. The pin
cuts both ways: a run in which nothing is refused fails too, as a stale pin. The
version assertion exists for the same reason: the header is there to make the
oracle boundary auditable, and a header nothing compares audits nothing.

Flags: `--depth <n>` (4 or deeper; below 4 the sweep product is under its floor
and the run refuses it, and any depth other than the one the ledger records is
report-only), `--write`, `--limit <n>`, `--levels`, `--help`.

**The family census.** Every `type:` discriminant in `src/ast.ts` must be named
in the mapping's census, and every kind the mapping did not name renders as
`?<kind>` - a spelling nothing on the other side can match. Both are checked by
the run, so a construct either model learns fails loudly instead of quietly
comparing equal. Both are also checked BEFORE `--write` may write anything: a
node kind the census does not name would otherwise be baked into the regenerated
signatures as `?<kind>`, poisoning the very diff the reviewer is told to read.

**Expect a stderr dump on a passing run.** Asciidoctor's reader reports
`unterminated example block` for one corpus document through `console` before a
document is attached to the logger, so the configured `NullLogger` cannot
suppress it and roughly twenty lines of an inspected `Cursor` object land on
stderr. It is harmless, it predates this harness (the same dump appears in the
default suite), and it does not affect any exit code.

The CORPUS half also runs in the default suite
(`tests/conformance/structure.test.ts`, 0.3 s), so a regression fails
`bun run test` rather than waiting for a manual harness run. The sweep half runs
only here.

Proves: our AST models the same block skeleton the oracle does, everywhere the
ledgers do not say otherwise.

### `bun run citation-check` - the source citations in our comments

The comments here cite two authorities by file and line: Asciidoctor's Ruby (the
design spec, vendored at `vendor/asciidoctor-ruby/` at tag `v2.0.26`) and the
oracle the tests measure against (`@asciidoctor/core`'s `build/node/index.cjs`
and the `src/*.js` it is bundled from, read from `node_modules`). A citation is
the one part of a comment a reader cannot check by reading, and it rots two
ways: line numbers move under a pin bump, and names get mistyped or invented.
Three wrong citations turned up in one week of adversarial review, one of them
naming a method that does not exist in 2.0.26 at all.

The gate reads every comment in `src`, `tests` and `scripts` with the TypeScript
parser's own trivia (so a citation inside a string literal is not one, and a
citation wrapped across two comment lines is one), and applies two checks per
citation:

- **the range check** - the cited file exists and the cited line is inside it;
- **the identifier check** - the names in the citing comment
  (`read_lines_for_list_item`, `QUOTE_SUBS`, `ExtAtxSectionTitleRx`, and against
  a JavaScript citation `readParagraphLines` too) must include one that appears
  within five lines of the cited range, or anywhere between the range and the
  definition that encloses it. A comment naming nothing of that shape is
  reported as UNANCHORED and counted, not failed: nothing to look for is not the
  same as looking and not finding.

**Bare references.** The house style names the file once and then writes
`l.1439` for the rest of the comment, so a bare reference is resolved against
the one recognized file its comment names. A comment naming NO file, or naming
two (where picking the nearer one is how a citation ends up checked against the
wrong file and passing), leaves its bare references unresolved: they are counted
and reported per citing file, never failed and never dropped in silence. At the
time of writing the gate reads 292 line references, checks the 207 that name a
file, and reports 85 that do not.

A file name with no line after it is a MENTION, not a citation, and claims
nothing: `see parser.rb: it walks the buffer` is prose, not a gate failure. A
line spec the grammar can see but cannot read - a typographic dash, a hyphen a
line break split - is a failure rather than a truncation, because a citation
half-read is exactly the error this exists to catch. The grammar and both checks
are `scripts/citations.ts`, unit-tested in `tests/scripts/citations.test.ts`
against the spellings the tree really uses. Those two files and that test are
among the six the gate does not scan (`NOT_SCANNED`), with
`scripts/internal-citations.ts` and its test: those six are where
citation-shaped text is data rather than a claim.

Exit codes: 0 every citation held, 1 a citation FAILED, 2 could not run - a bad
argument, a missing vendored source (run `bun run vendor`), or a tree with fewer
than a hundred citations, which means the scan lost its roots rather than that
the comments lost their citations. With no `node_modules` present the oracle
half is skipped and said so, never failed; the Ruby half needs no install and no
network. `--list` prints every citation and every bare reference; `--window <n>`
widens or narrows the identifier check.

Proves: every cited file and line exists, and points at something the comment
names. It does NOT prove the comment's READING of the cited code is right, and
it does not reach a bare reference whose comment never says what file it is
about.

### `bun run internal-citations` - the citations we write about ourselves

The other direction from the gate above: a `<file>:<line>` naming a file in this
repository. Two places keep them by hand. A
`scripts/metrics/score-minimums.json` exception's `what` field names the
surviving mutant and quotes it, in the form "attrlist.ts:279
`index < raw.length` -> `index <= raw.length` in closingQuote", and the
coverage-deferral comments in `eslint.config.js` name the guard a brace would
uncover, quoted beside the path they defer. Both rot the moment an edit moves
the code, and three review rounds running found rotted ones; the manual remedy
was always the same mechanical thing, so it is a check.

One grammar covers both files. Inside a SCOPE - one exception's `what`, or one
line of `eslint.config.js` - a `.ts` name binds every `:<line>` and
`:<from>-<to>` after it, so `list-reader.ts:558, :572` is two citations of one
file. An exception's own `file` binds a reference that opens the scope. A bare
basename resolves against `src`, with the row's own file breaking the one tie
the tree has (`list.ts`). Two checks per citation:

- **the range check** - the cited file resolves to exactly one path and the
  cited line is inside it;
- **the quotation check** - the backtick-quoted runs between the citation and
  the next `->` must include one that is on the cited line, or somewhere inside
  the cited range. `->` is where the quoting stops because it is how both files
  spell "and the mutant put this in its place", and a replacement is by
  construction not in the source. The runs are held DISJUNCTIVELY: a citation of
  nine lines quotes the several things that sit on them (a `return "go"` and two
  `return "stop"`s), and no one line carries them all.

**Provenance.** Two rows deliberately name coordinates in a tree that no longer
exists, where a mutant sat BEFORE issue #56 moved it, and they say so in a
`formerly` field listing the exact citations they mean, beside the `what` that
writes them. Those are counted, not checked. Be exact about what that buys: it
is an UNCONDITIONAL suppression, and nothing mechanical tells a citation whose
tree is gone from one that simply rotted. Its three guarantees are that the
suppression is VISIBLE at the entry rather than hidden in the checker, that it
is per citation rather than per row (every other citation in the row is still
checked, and both of these rows carry one that is), and that it is DEAD-ENTRY
PROOF: a `formerly` naming a citation the row's `what` does not write is itself
a failure, which is also what makes a drift of an exempt citation fail, since
the array still names the undrifted spelling.

A third, weaker scan holds every `src/`, `tests/` or `scripts/` `.ts` path named
in a `src` file to a file that exists. No line, so no quotation check. It caught
three rotted paths across the two rounds that built it, two of them in the test
and harness trees a `src` comment names as freely as it names another module.

Exit codes: 0 every citation held, 1 a citation FAILED, 2 could not run - a bad
argument, a missing scanned file, or fewer than thirty citations, which means
the scan lost its roots. `--list` prints every citation with the file it
resolved to and the runs it will look for. `scripts/internal-citations.ts`, unit
tested in `tests/scripts/internal-citations.test.ts`.

A citation that quotes nothing is checkable for its line and no further, and a
row in that state is one a human has to correct unaided, which is where a wrong
hand correction went undetected once. Every scanned citation quotes source today
(56 of 56), so the class is empty rather than merely small; keep it that way by
quoting one identifier from the cited region whenever a row is written.

Proves: every repo-internal citation names a line that exists and still carries
what it quotes. It does NOT read the `reason` field (free prose, where the next
quoted run is as likely to be a function named three clauses later), it does not
resolve a citation outside `src` (the two scanned files cite nothing else, and
letting a bare basename reach the test tree would make half of them ambiguous),
and it does not check that the quoted line still MEANS what the row says about
it - which is the failure mode a re-cite has to be reviewed for, not gated on.

### `bun run local-docs <dir>` - the formatter against real documents

Issue #13. Walks a directory for `.adoc` files, recursively, and runs four
checks over each one: formatting must not throw, formatting our own output must
not throw either, `format(format(d))` must equal `format(d)`, and Asciidoctor
must render `format(d)` exactly the way it renders `d`. The render comparison is
the conformance suite's own (`tests/helpers.ts`), oracle and normalization
included, so a divergence here means the same thing it means there - the harness
grows no comparison of its own.

That shared normalization folds two things and only two: a line break outside
`<pre>`, and a whitespace RUN outside `<pre>` and `<code>`. Both are reflow,
which is what a formatter does; whitespace a reader can actually see is inside
`<pre>` or `<code>`, where nothing is touched, and that is where issue #32's
real failures are. The run rule was added when the first real-corpus sweep
reported 115 documents whose only divergence was a collapsed double space in a
sentence - a failure class that was never a failure.

The corpus is nobody's to commit. It is whatever documents the person running it
has: long, real, and written by people who were not thinking about our parser -
which is the point, because the vendored corpus is thousands of small cases
extracted from Asciidoctor's tests and both sweep products are generated
alphabets. A first sweep over a real corpus found a header shape neither of them
spells at all.

```bash
bun run local-docs ~/documents          # any directory
bun run local-docs                      # the "corpus" field of the config
bun run local-docs ~/documents --limit 300
```

The config file is `scripts/local-documents.config.json`, gitignored, with two
optional string fields: `corpus` (the directory to walk) and `repository` (the
git repository to collect from). Both are per-machine and both are overridable
on the command line; the file only saves typing an absolute path. It is read
STRICTLY - a file that exists and is not a config, a mistyped key included,
exits 2 rather than being read short and pointed somewhere else. Neither field
is the collector's OUTPUT directory, deliberately: see below.

Exit 1 when a document failed a check; exit 2 for the measured-nothing floor - a
directory with no `.adoc` file under it, which would otherwise report a perfect
run over nothing. A run in which the oracle refused every input is NOT that
floor and still exits 0: parsing, re-parsing and settling were all measured, and
only the render comparison was not. What such a run may not do is claim
otherwise, so the clean headline names the checks that actually ran and carries
the unassessed count beside them. There is no CI job, and there cannot be one:
the corpus does not exist on any machine but the runner's.

**`bun run collect-local-docs`** builds such a directory out of a
branch-per-document git repository - the layout where published documents live
on one base branch at `<tree>/<number>/README.adoc` and a document still under
discussion lives on a branch NAMED for its number (Oxide's RFD repository is the
motivating example). The layout is fixed and `--base` is the only knob; only
`refs/heads` is scanned, so a fresh clone with no local branches contributes the
base branch's documents and nothing else. It writes `<number>.adoc` per document
into the output directory, taking each numbered branch's own copy over the
base's. Every git command it runs is a read - `for-each-ref`, `ls-tree`,
`rev-parse`, `show` - so the source repository's working copy is never touched:
no checkout, no fetch, no worktree. Every ref is spelled `refs/heads/<name>`,
because git resolves a short name through `refs/tags/` first and a tag sharing a
branch's name would shadow it silently.

Two guards sit around the write, and both exist because the files involved are
private documents. The output directory must be `.local-docs/documents` (the
default) or a path `git check-ignore` reports as ignored, or the run exits 2 and
asks for `--force`; and the only files a rerun deletes are the `<digits>.adoc`
names the collector itself writes, so a hand-written document in the same
directory survives. That is also why the output directory is not read from the
config's `corpus`: `corpus` is what `local-docs` WALKS, frequently somebody's
own document directory, and a field that doubled as both would aim a delete at
it.

**Nothing a real document said may be committed.** Not its text, not its title,
not its file name. A finding leaves this harness as a MINIMAL SYNTHETIC REPRO -
the smallest document that shows the mechanism, written from scratch - which
then becomes a format test, a conformance row, or an issue. The report the
harness prints is for the person who ran it and goes no further; the detail
beside each id is there to be read while writing that repro, never to be pasted.
The committed half of the harness is `tests/integration/fixtures/`: a handful of
tiny synthetic documents that pin the walk and the shape of a result, and which
are expected to pass every check.

### `bun run vendor` and `bun run build`

`vendor` re-fetches both halves of `vendor/`: the Asciidoctor corpus at a pinned
commit, where the pin matters because extracted case ids are the quarantine
manifest's keys, and the six Ruby sources at tag `v2.0.26`, where it matters
because our comments cite their line numbers and `citation-check` holds them to
it. `build` bundles `src/index.ts` into `dist/`. Neither is a gate, so neither
ever exits 1.

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
from its four classification sites; outside a harness the hook is undefined and
each site is one undefined check. The hook is meant as a REPORT and never an
input, and a row of `tests/parser/architecture.test.ts` guards the four
spellings that would make it one: it fails any line that names
`classifyTrace.observer?.(` and is not the whole statement, so a call inside a
condition, an assignment, a return or a conjunct is caught. Its domain is
ONE-LINE spellings - an assignment Prettier wraps onto its own line, or a call
through a local alias, passes it - so the row is a guard against the accident,
not a proof that the reader never reads its own trace back; that stays a
reviewer's judgement. A test-owned context tracker was rejected: it would be a
second reader dialect that drifts, and the point is to assert against the
reader's own reading.

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

| rule                                                                       | licensed by                                                                |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| blank lines emit no token and end every fold                               | see "what it does not catch" below                                         |
| consecutive `text` tokens collapse to one                                  | `tests/format/reflow.test.ts`                                              |
| consecutive `indented` tokens collapse to one, within one block            | `tests/format/literal-paragraph.test.ts`                                   |
| a `text` run after a marker, dlist or admonition token is absorbed into it | `tests/format/unordered-list.test.ts`, `tests/format/admonition.test.ts`   |
| `raw:comment` is transparent to a fold                                     | `tests/format/comment.test.ts`                                             |
| an attribute entry lowercases its name                                     | `tests/format/attribute-entry.test.ts`                                     |
| a raw anchor folds onto the metadata anchor token                          | `tests/format/anchor-spelling.test.ts`                                     |
| `delim:fencedCode` canonicalizes to `attrline delim:listing`               | `tests/format/fenced-code.test.ts`                                         |
| every lone `+` projects to `cont`, whatever verdict the reader recorded    | `tests/lib/reading.test.ts` (three rows: consumed, erased, between blocks) |

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
byte (`tests/format/marker-spelling.test.ts`), so both readings carry the same
spelling. The style is Ruby's RESOLVED one, so an explicit ordered list's items
project alike (`5.` and `6.` are one list, style `1.`): that collapse is the
structure itself, not a transform the formatter could make. `textv` (the
verbatim-flagged foreign marker line) stays its own token, because its COLUMN
decides what the next `+` means and its disappearance must move the sequence.
And a line the reader consumed without classifying stays invisible, except for
TWO synthesized shapes: a marker-shaped one, so the absorption rule can see the
absorber, and a lone `+`. Inside a verbatim interior the same synthesis happens
on both sides and cancels.

The `+` is the stronger of the two and works differently. Marker synthesis fills
a GAP - it runs only where the trace recorded nothing. The `+` is projected
BEFORE the trace is consulted, so it overrides a recorded verdict: a `+` the
reader ERASED comes back from `classifyLine` as a blank, and taking that verdict
at face value is the second half of the same blindness that hid the ones the
extent scan consumes. Under either, a formatter that deleted a `+` moved no
token and the invariant held vacuously. The line is still a `+` in the source
and whether the output keeps it is exactly the question, so it always has a
token. This is the one projection rule that is not a licence to IGNORE a
transform but a refusal to ignore one, which is why its licensing test asserts
that the token appears rather than that a difference is allowed.

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

| family               | mechanism                                                          | issue |
| -------------------- | ------------------------------------------------------------------ | ----- |
| lone-plus-join       | a lone `+` leaves the reading, dissolving the continuation         | #43   |
| continuation-dropped | the `+` lines go and the list structure beside them does not       | #17   |
| tail-reading-flip    | a prose join flips the reading of the line after it                | #65   |
| admonition-colon-run | an admonition label split re-reads as a description-list delimiter | #45   |

`#43` on the first row is PROVENANCE, not an open bug. What #43 tracked was the
corrupting variant - a JOIN landing on a dlist-shaped line and manufacturing a
description list - and that is fixed and closed. What the family holds now is
not joins at all: measured over a systematic sample of the rows, no output holds
a `+` joined into a text line. Every remaining row DELETES the byte, by one of
three routes. Classified by shape, each of the 2,893 rows counted once in the
first class it matches:

- **253** carry a run of three or more `+`, whose third and later lines
  `read_lines_for_list_item` reads and drops without buffering (parser.rb
  l.1443-44).
- **2,540** of the rest carry a `+` the scan ERASES - the first of an adjacent
  pair (l.1439) or one standing under a blank line (l.1576). Erasure alone does
  not lose the byte: where such a `+` ATTACHED a block it comes back as that
  block's gap, which is why `"* a\n+\npara\n"` keeps its byte. In every row of
  this class it attached nothing, and there its one route back is the shield
  `ListItemNode.detachedTail` writes, which needs a trailing `+`-paragraph to
  shield; an item with nothing to shield loses the byte. This is the plurality,
  and the pair that isolates it has the same inert tail and opposite outcomes:
  `"* a\n+\n"` keeps the byte, `"* a\n\n+\n"` drops it.
- the remaining **100** carry a `+` above a blank line. The pop takes it, but a
  `+` printed there ERASES and arms on re-read instead of popping, so the byte
  is dropped rather than made to mean something the source did not.

All three are render-equal.

The enumeration lives in `tests/lib/reading-ledger.ts`, and the loader
cross-checks both directions: a family the enum does not declare fails, and so
does a row whose signature classifies as a different mechanism than it claims. A
signature matching none of them cannot be written at all - the generator exits 2
and asks for the family to be named and its issue filed.

Each test asks for the MECHANISM, not for its arithmetic. `lone-plus-join` needs
a lost `cont` and nothing on the losing side but the prose the `+` stood beside;
a `cont` lost beside an admonition, a marker or a delimiter got there by some
other path, and it falls through to another family or to UNCLASSIFIED rather
than inflating #43's row count with rows #43's fix will not remove.

The measured breakdown, as of the ledger checked in beside this file: **2,897
rows** over the depth-5 product - 2,893 lone-plus-join, 4 continuation-dropped,
0 tail-reading-flip - all on pass 1.

It was 2,945 one change earlier, and 48 rows went for one reason: the post-loop
pop now recognises the `+` lines Ruby's own marker test recognises. A `+` an
armed continuation attached as CONTENT (parser.rb l.1502-11) is the tagged
String the swap at l.1432 made of it, so an activation that later blanks it
(l.1439) leaves a Placeholder the pop takes at l.1580-82 - where a test on cell
identity saw a line the loop had not marked, let the blank strip have it, and
lost the byte. 6 of the 48 came from the erased-`+` route below and 42 from the
`+`-above-a-blank route.

Before that it was 10,508 rows - 10,190 / 312 / 6 - and three things took the
difference. A `+` the item scan popped is now written back wherever the tail it
lands in re-reads inert, which is most of the 7,249 lone-plus-join rows that
went and all but four of continuation-dropped. tail-reading-flip emptied for a
different reason: its six rows were an anchor in an item's SECOND block being
read as that block's own metadata, and the anchor now ends any block after the
item's first.

Before either, the number was 6 rows, until every lone `+` gained a token in the
projection. That old number was mostly BLINDNESS rather than health: a `+` the
extent scan consumes never reaches `classifyLine`, and a `+` the reader erases
comes back from it as a blank, so under either a formatter that deleted a `+`
moved no token and the invariant held vacuously. `lone-plus-join` sat in this
enumeration as a declared mechanism with zero rows while the sweep was spelling
ten thousand of them.

Every row is render-EQUAL and idempotent today, so the sweep beside them passes
every one: that is the population issue #58 was filed to enumerate, and no other
gate can see it. Read the size as a measurement of the instrument's reach, not
as a regression - and note that "no growth" is now a bar over 2,897 rows rather
than over 6. The numbers live here rather than in the two sweep files, so they
go stale in one place.

A family with no rows STAYS in the enumeration. It is what the classifier
reaches for when the mechanism comes back, so deleting it would turn a
regression into an unnamed signature the generator refuses to write rather than
a row that names the issue. admonition-colon-run and tail-reading-flip are empty
today.

To refresh after a fix: `bun run reading-ledger --write`, then say in the commit
which family shrank and why. Expect large generated diffs tied to one-line
mechanism claims: fixing lone-plus-join once emptied that family in one move,
taking the depth-5 ledger from 716 rows to 6 and the depth-4 derivation from 25
to 0. A change that empties either continuation family now will produce a diff
of tens of thousands of lines for the same reason. That is the progress metric.

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
  render-equality misses (family tail-reading-flip, issue #65) - though that
  family is empty today, its six rows having gone with the anchor fix.
- **Intra-line changes (#32).** Whitespace collapsed inside a code span never
  changes any line's classification. Out of scope by construction; #32 keeps its
  render-equality coverage.
- **Blank-line placement (#46 shape 2, and #54 while it was open).** Blank runs
  emit no token, so blank insertion and collapse are invisible. That is
  deliberate - see the rejected variant below.

### Rejected: the gap-sensitive variant

A projection that emitted a `gap` token for each blank run was built and
measured. It pulls #54 and #46 shape 2 into the net, and it floods: 308 corpus
and 645 depth-4 sweep diffs, dominated by families like `[] -> [gap]`,
`[gap] -> []` and `[delim:example gap] -> [gap delim:example]`, every one of
them deliberate gap normalization. A net whose report is mostly its own
formatting policy is a net nobody reads, so blank placement stays with the
harnesses that own it: #54's shapes were pinned by the sweep allowlist while
they failed (render-divergent, tokens identical - measured) and are committed
rows now that they do not, and #46 shape 2 is an idempotence wobble that needs
the dedicated regression test its issue calls for.

## CI

`.github/workflows/ci.yml`, two jobs, split by question rather than by command.

**`gates`** — blocking, needs no other revision: `check`, `lint`, `fmt:check`,
`build`, `coverage` (the suite runs under it), `metrics`,
`test:deeply-nested-lists`, `block-structure`, `citation-check`,
`internal-citations`. Every step carries `if: ${{ !cancelled() }}`, so one
failing gate never hides the others. The reflow re-classification invariant
needs no step of its own: its three gates ride the suite and the deep sweep that
are already there, and `reading-ledger` is a generator, not a gate.

**`differential`** — needs a base, and is `continue-on-error` for its first
iteration; flipping it to blocking is a one-line change once it has proved
stable. It runs `parity --expected-diffs-trailers HEAD`, the three `shape-diff`
grids, `probe-domains --base`, and `metrics --base`, serially in one job,
because each step materializes the base into `$TMPDIR` and parallel steps would
pay that concurrently.

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
bun run probe-domains -- --base <rev>
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
  (good — `src/parse/line-shapes.ts` is mostly comments, each naming the Ruby
  that decides the same shape) or documentation papering over an unclear
  mechanism. Tell them apart by where: comments in a registry citing `parser.rb`
  are good; comments inside a long function explaining its own control flow are
  not.
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
- **A `what` field's `<file>:<line>` is checked**, by
  `bun run internal-citations`, against the line it names: the code quoted
  beside the citation has to still be there. A row whose citation deliberately
  names a tree that no longer exists, where a mutant sat before a move, lists
  that exact citation in an optional `formerly` array beside its `what`. It is
  the only key an exception row may carry on top of the four above, and it is an
  UNCONDITIONAL suppression of the citations it names: nothing mechanical tells
  "the tree is gone" from "it rotted and I did not fix it", because both are
  citations that no longer hold. What it does guarantee is that the suppression
  is visible at the entry rather than in the checker, that it is per citation
  rather than per row, and that it fails if it names a citation the row's `what`
  does not write, so it cannot outlive or outgrow that citation. Reviewing one
  is reviewing a claim, not a checkbox.
- **A minimum of 0 means the file has not been measured**, for one of two
  reasons, and the file's `exceptions` row says which. Either Stryker writes no
  row for it at all (a declaration-only file), or it is a NEW file whose
  placeholder is waiting on the next batched mutation run — mutation runs at
  batched integration points, not per change, so a file can land before any run
  has seen it. Only a zero tolerates an unmeasured file, and a placeholder zero
  disengages the ratchet for that file until it is reseeded, so it is a debt the
  next run pays, not a resting state. Every zero row carries an `exceptions`
  entry naming its reason.
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
(`scripts/metrics/shape-census.ts`) are equality pins, not budgets: one more
node kind is not better or worse than one fewer, and a grid of 3,000 shapes is
not better than one of 2,966. `bun run metrics` prints them with exactly two
verdicts — `pin holds` or `pin moved` — because printing is how a human notices
a deliberate move: the standing grid once shrank by 377 shapes with every gate
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
