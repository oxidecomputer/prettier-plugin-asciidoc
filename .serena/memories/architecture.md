# Architecture

A Prettier plugin for formatting AsciiDoc (.adoc) files. Custom
source-preserving parser produces an AST with character offsets, printer
converts it to Prettier Doc IR.

## Pipeline

```
source → splitLines → BlockReader(classifyLine) → AST → Printer
```

Three properties hold along that pipeline, and each is what the next stage stops
having to guess. The reader UNDERSTANDS what it holds: a held style line's
consequences — a masquerade, an admonition rename, a verbatim role — are decided
once at the block's opening line and recorded, so no later pass re-derives them.
Every composite construct is read EXTENT-FIRST, at the line Asciidoctor decides
it, so nesting is never reconstructed after the fact and there is no frame stack
to keep in step. And the printer REPLAYS recorded facts — the author's own
bytes, the spellings the AST stores, and one record derived at ask time
(`anchorLineShape`) — inventing nothing of its own.

## Components

- **Parser** (`src/parser.ts`, `src/parse/`): three phases. (1) line splitting
  (`src/parse/lines/split.ts`, rstripping each line as
  `Helpers.prepare_source_string` does); (2) the **BlockReader**
  (`src/parse/lines/reader.ts`), which builds the AST as it reads — EXTENT-FIRST
  everywhere, and with NO frame stack. Every composite construct is read where
  Asciidoctor reads it, at its OPENING line: a delimited block's whole extent is
  collected there by `src/parse/lines/delimited-reader.ts` (`build_block` →
  `delimitedExtent`, exact-terminator line match, the bare tip for a fence, the
  lines' end when it never closes), a verbatim interior becoming a SLICE and a
  compound interior a fresh CONFINED `BlockReader` over the interior subarray; a
  list item's buffer gets the same treatment through
  `src/parse/lines/list-reader.ts`. What is not a composite is a LEAF — headings
  included: sections are NOT modeled (there is no `section` node), so the
  document is a flat sequence the reader appends to and nothing closes on a
  later, unpredictable line. Nodes are built through the pure
  `(lines, index) → Node` constructors in `src/parse/build/` (headings by
  `build/heading.ts`, from the CLASSIFIER's level — the one derivation).
  Confinement — what a scan can SEE — is physical everywhere Ruby's is: a
  confined reader's lines END at its boundary, and the reader's `Confinement`
  record carries the two boundary facts (tail safety, the forced-close offset)
  as DATA rather than as stack state. What a held style/attribute line makes of
  the block that follows (a masquerade, an admonition rename, a verbatim role)
  is resolved once, at OPEN, by `src/parse/lines/open-style.ts`; the builders
  build from that recorded decision and re-derive nothing. The held `[…]` line
  itself has one parser, `src/parse/attrlist.ts`. There is no separate
  post-parse conversion pass over the finished tree — that mechanism and its
  module are deleted; (3) the **inline tokenizer** (`src/parse/inline/`) —
  `tokenize.ts`'s ~40-line first-match-wins loop over the ordered rule table in
  `rules.ts`, run per paragraph run, with `inline-node-builder.ts` pairing marks
  into nested nodes and `src/parse/positions.ts`'s one `LocationIndex` answering
  every offset → line/column. No parser library, no grammar, no CST, no visitor.
  NOT Asciidoctor.js — see "Why not Asciidoctor.js?" and "Why no parser library"
  in `docs/design.md`.

  **The rule: block-level context comes from the reader and from nowhere else,
  and `tests/parser/architecture.test.ts` enforces it.** Its forbidden-pattern
  list is down to the two shapes that still have a temptation window: a function
  signature taking the token history as its third parameter, and a backwards
  search over an emitted array (`.findLast`/`.findLastIndex`, a TOTAL ban under
  `src/parse` — the old exemption for a receiver named `stack`/`frames` retired
  with the stack itself). The toolkit-era rows are gone: their window closed
  with the toolkit, and knip plus `bun run check` already fail on a resurrected
  dependency. A different parser library would need a NEW row, so add one rather
  than assuming it is caught. The BlockReader walks its lines ONCE, mirroring
  Asciidoctor's reader (`Parser.next_block`, `build_block`,
  `read_paragraph_lines`, `read_lines_for_list_item`, `Reader.read_lines_until`)
  and building each block's node at the line where Asciidoctor decides it, so no
  later stage re-derives nesting: no parser-state gates, no backtracking, no
  custom token pattern reading the token history, no lexer modes, and no
  post-hoc AST repair pass — the guard test asserts all of that textually over
  every file in `src/parse`, plus zero import cycles and zero LAYER-RULE
  violations (both from `dependency-cruiser`, through the same `cruiseImports`
  helper `bun run metrics` gates on) and a ceiling on lint suppressions. The
  layer rules are directions, in `LAYER_RULES` (`scripts/metrics/graph.ts`):
  `ast` <- `constants`/`positions` <- `line-shapes` <- `inline/` <- `build/` <-
  `lines/`, `print/` reaching `parse/` only at `line-shapes.ts`, `parse/` never
  reaching `print/`. Every cross-DIRECTORY symbol is additionally named,
  classified vocabulary-or-contract and given a reason in
  `scripts/metrics/crossings-registry.json`, gated in both directions
  (unregistered crossing, stale row) by `scripts/metrics/crossings.ts`.

  Line SHAPES live in one registry, `src/parse/line-shapes.ts`, oracle-pinned by
  `tests/conformance/interruption.test.ts` and cited to the Asciidoctor Ruby
  source, keyed by four `ParagraphContext`s (`paragraph`, `listItem`,
  `listContinuation`, `dlistItem`). `src/parse/lines/classify.ts` is the pure
  function over that registry; the reader is its only parse-side consumer, and
  reflow safety (`src/print/reflow.ts`) is its only print-side consumer, so the
  parser and the formatter's word-wrapping can never disagree about what would
  re-parse as block syntax. The classifier's whole context is three fields —
  `ReaderContext = { openParagraph, openListStyles, firstLineAfterStart }`
  (`classify.ts`) — because with no frame stack there is nothing else for a line
  to be classified against. Lists are read EXTENT-FIRST in
  `src/parse/lines/list-reader.ts` — `parse_list`/`parse_list_item`/
  `read_lines_for_list_item` ported as `readList`/`readListItem`/`itemExtent`:
  the extent scan collects one item's lines into Ruby's buffer, then a confined
  `BlockReader` re-parses that buffer, so nesting composes with no list frame,
  no per-item object and no cross-item state (only `itemExtent`'s five mutable
  members — Ruby's four locals plus the buffer). `frames.ts` keeps its
  historical name but holds no frame: it is the shared vocabulary the list layer
  and `reader.ts` both need (`ListHost`, `fragmentOfLine`, the
  leaf/held-metadata builder tables) so the two stay a DAG. Each block an item
  holds carries its verbatim `gap` (the `""`/`"+"` lines before it), and
  replaying that gap line for line is `src/print/print-list.ts`'s DEFAULT —
  which is what makes list formatting idempotent. The list's marker spelling is
  data too: `ListNode.marker` holds what the classifier parsed and the printer
  replays it, with nesting depth derived from the spelling and stored nowhere.
  On top of that default the printer has four named separator decisions, no
  more: `hazard(item)` (`src/print/print-list-hazard.ts`) — a pure predicate
  over the finished node answering `"none" | "keepBreak"`, keyed on the leading
  metadata run over one derived record (`anchorLineShape`); `printedGap`'s
  same-marker arm (a nested list that shares its parent item's marker prints
  ADJACENT — a blank-only gap there would read back as a sibling boundary —
  unless the gap carries a live `+`); `printedGap`'s slurp arm (invent a blank
  that is in no gap, where a literal's re-read slurp would swallow the next
  marker); and `printList`'s two-hardline sibling separator after an item ending
  on an indented literal. Each adjustment exists because verbatim replay would
  not re-parse to the same tree there. Paragraph text is tokenized by the
  hand-rolled tokenizer (`src/parse/inline/tokenize.ts`) over each run of
  paragraph lines, and the paragraph node is built from those tokens
  (`src/parse/build/paragraph.ts`). See "Line classification is contextual" in
  `docs/design.md`, and `docs/simplicity-metrics.md` for how the change was
  measured.

- **AST** (`src/ast.ts`): Designed for Prettier, not the AsciiDoc language
  spec's semantic model. Preserves comments, directives, attribute entries, and
  other constructs a semantic model intentionally discards. A `[[id]]` /
  `[[id,reftext]]` line alone is a first-class `blockAnchor` node, not folded
  into a paragraph. Tables (`|===` and friends) pass through as an opaque
  `delimitedBlock` (`variant: "table"`) — the delimiter lines are content; full
  modeling (`cols`/cellspec/`a|`) is still open (#10). There is no `section`
  node: a heading is a leaf `heading` (level 0–5) or a `discreteHeading`, and
  the document is flat. The node-kind census is a GATE at **30**
  (`tests/parser/architecture.test.ts`, counting the `type: "…"` discriminant
  literals in `src/ast.ts`); a 31st kind fails that row until it is deliberately
  updated.
- **Printer** (`src/print/printer.ts`): Walks AST, produces Prettier Doc IR.
  Line breaking inside a block happens BEFORE the Doc exists:
  `src/print/reflow.ts` turns a block's inline content into `Atom`s — text plus
  the local break facts about the join in front of it (`glueLeft`,
  `noBreakBefore`, `noBreakAfter`, and a three-valued `breakBefore`) — and
  `blockBody(atoms, width, indent)` is the ONE greedy packer the paragraph
  printer, the paragraph-form admonition body and a list item's text all go
  through, so those bodies are one engine by construction. The two containment
  facts the deleted `section` container used to enforce invisibly are now NAMED
  rules in `src/print/print-join.ts`, each with its rationale: a level-0
  (document-title) heading always takes a blank line after it (the byte the old
  section printer forced, frozen), and a pseudo-anchor line never stacks
  directly above a level ≥ 1 heading (the stacked pair re-parses as one joined
  line and the heading is destroyed). Both are pinned by
  `tests/format/heading-adjacency.test.ts` and by the shape-diff
  `heading-adjacency` grid.
- **Vendored deps** (`vendor/`): the Asciidoctor conformance corpus. Updated via
  `bun run vendor`.
- **Conformance suite** (`tests/conformance/`): differential testing against
  Asciidoctor's own test corpus (see #7). `vendor/asciidoctor-corpus/` holds
  1,614 cases as JSONL, pinned to an Asciidoctor commit — Ruby test-suite
  heredocs, Asciidoctor's own docs pages, and test fixtures. Any `.adoc` dropped
  into `tests/conformance/corpus/` joins at load time as the `local` group.
  `properties.ts`'s `assessCase` runs three properties per case (no crash,
  idempotency, `renderedHtml(format(x)) === renderedHtml(x)` fidelity via the
  `@asciidoctor/core` oracle). Known-failing cases are pinned in
  `quarantine.json`, tagged by gap issue; `scripts/conformance-triage.ts`
  (`bun run triage`) diffs a run against that manifest, and `--write` updates
  it. Runs as part of the default `bun run test`. Workflow: a new failure gets
  mapped to an issue (or a new one filed) and pinned with
  `bun run triage --write`; a fixed gap has its now-passing entries removed the
  same way, so the quarantine list shrinks monotonically.
- **Shape-level standing nets** (`scripts/shape-registry.ts`,
  `scripts/shape-registry-list-run.ts`, `scripts/shape-diff.ts`,
  `scripts/metrics/shape-census.ts`): the corpus can be BLIND to a construct
  (the #44 corruption had zero corpus instances — the quarantine list did not
  move in either direction), so shapes are also verified directly.
  `shape-registry.ts` is the shared input vocabulary: containers × constructs ×
  perturbations, each a named deterministic string generator;
  `shape-registry-list-run.ts` holds the list-run grid in its own module because
  the registry is at its `max-lines` ceiling, and the dependency runs ONE way
  (it imports the registry, never the reverse). There are THREE named sub-grids,
  selected with `--grid`: `standing` (the default, the whole container ×
  construct product), `heading-adjacency` (the pairs where a line above a
  heading can destroy it), and `list-run` (a list item's leading metadata run —
  marker spellings, anchor spellings, gap shapes). `shape-diff.ts` takes a
  deterministic exhaustive product over a named sub-grid, formats it under a
  base revision and under this checkout, and reports per-diff proofs (render
  fidelity, neutrality, idempotence) plus a REQUIRED family annotation from a
  closed enum — a differing shape with no family FAILS the run, so an
  unexplained behavior change cannot pass quietly. The completeness gate is
  `shape-census.ts`, wired into `bun run metrics`: every `DELIMITER_KINDS` entry
  needs a delimiter dimension and every `line-shapes.ts` runtime export needs a
  dimension that `covers` it (or a written-down exemption), so a parser that
  learns a new construct must teach these generators in the same commit.

## Key References

- Design doc: `docs/design.md`
- Simplicity metrics: `docs/simplicity-metrics.md` — the scorecard
  `bun run metrics` prints (code/comment LoC, cyclomatic and cognitive
  complexity, coupling and cycles, escape hatches, dead code), and the rule that
  metrics are instrumentation, not the objective
- Roadmap: GitHub issues (tier-1/tier-2 severity labels) and the org project
  board https://github.com/orgs/oxidecomputer/projects/228 — there is no in-repo
  plan document
- AsciiDoc syntax reference: `docs/asciidoc-format.md` — covers all constructs
  the parser handles, the language spec's node types, and what that semantic
  model does NOT represent (which our AST must).
- AsciiDoc language project:
  https://gitlab.eclipse.org/eclipse/asciidoc-lang/asciidoc-lang
- Prettier plugin API: https://prettier.io/docs/plugins#developing-plugins

## Tech Stack

- **No runtime dependencies.** The parse layer is a line reader plus a 40-line
  inline tokenizer; `prettier` is a peer dependency. (History: Chevrotain's
  `CstParser`, visitor and lexer were removed on 2026-08-21 and the dependency
  with them — see "Why no parser library" in `docs/design.md`.)
- TypeScript (strict, ES2024 target)
- ESM modules (`"type": "module"`)
- `Bun.build` via `scripts/build.ts` (ESM into `dist/`, external prettier — the
  only external)
- Vitest for testing
- ESLint 10 with typescript-eslint strict, eslint-config-love,
  eslint-config-prettier, eslint-plugin-jsdoc, eslint-plugin-unicorn,
  @vitest/eslint-plugin
- prettier as peer dependency
