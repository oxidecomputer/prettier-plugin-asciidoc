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

**Gates (non-zero exit), all in `scripts/metrics/gates.ts`.** Three hold always:
an import cycle at head (a cyclic group has no reading order), a relative import
that resolves to nothing (a hole in that graph, which the cycle detection cannot
see through), and an unused exported symbol under `src` (the residue of a
half-finished deletion). Two more are RATCHETS that need a `--base` to compare
against: cognitive MAX per layer, and each escape-hatch count. Neither may rise.
A layer that did not exist at the base is skipped, since it cannot have
regressed. The count of functions over cyclomatic 10 is REPORT-ONLY — see "Why
cyclomatic is report-only here" below.

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
  Today: source text → `SourceLine` → `LineKind` → `IToken` → CST → AST → Doc,
  which is six. Dropping Chevrotain would take it to four and delete the CST
  interfaces; if a refactor claims that and the count does not move, the claim
  is not supported.
- **Type-kind counts** — 33 block/line token types (`src/parse/lines/tokens.ts`)
  plus 15 inline ones (`src/parse/tokens.ts`), 13 CST interfaces
  (`src/parse/cst-types.ts`), 30 AST node types (`src/ast.ts`).

Diagnostic, not gated: **hotspot = churn × cognitive complexity** per file, from
`git log --format=%H -N --name-only -- src`. `src/printer.ts` is the standing
hotspot — highest churn and the repository's worst cyclomatic function (33).

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
| Test-to-code ratio | Add assertion-free tests                                                              | The conformance/oracle suite's pass count                                                       |

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

The honest summary of that literature: cognitive complexity is the best
available proxy for comprehension effort, and it is a proxy. Size is the
strongest single predictor of defects and the confound that eats every other
metric, which is why code lines are always printed next to the metric that
claims to be better than them.
