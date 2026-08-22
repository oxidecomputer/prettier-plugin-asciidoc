# Architecture

A Prettier plugin for formatting AsciiDoc (.adoc) files. Custom
source-preserving parser produces an AST with character offsets, printer
converts it to Prettier Doc IR.

## Pipeline

```
source → splitLines → BlockReader(classifyLine) → AST → Printer
```

## Components

- **Parser** (`src/parser.ts`, `src/parse/`): three phases. (1) line splitting
  (`src/parse/lines/split.ts`, rstripping each line as
  `Helpers.prepare_source_string` does); (2) the **BlockReader**
  (`src/parse/lines/reader.ts`), which builds the AST as it reads — a frame IS
  the node under construction, and closing it builds the node through the pure
  `(lines, index) → Node` constructors in `src/parse/build/` and pushes it onto
  the parent frame's children; (3) the **inline tokenizer**
  (`src/parse/inline/`) — `tokenize.ts`'s ~40-line first-match-wins loop over
  the ordered rule table in `rules.ts`, run per paragraph run, with
  `inline-node-builder.ts` pairing marks into nested nodes and
  `src/parse/positions.ts`'s one `LocationIndex` answering every offset →
  line/column. No parser library, no grammar, no CST, no visitor. NOT
  Asciidoctor.js — see "Why not Asciidoctor.js?" and "Why no parser library" in
  `docs/design.md`.

  **The rule: block-level context comes from the reader's frame stack and from
  nowhere else, and `tests/parser/architecture.test.ts` enforces it — including
  a `from "chevrotain"` row, so no module under `src/parse` can import the old
  parser toolkit back. That row and the custom-pattern / lexer-mode /
  parser-gate rows are literal Chevrotain spellings; a DIFFERENT parser library
  would need a new row, so add one rather than assuming it is caught.** The
  BlockReader walks the lines ONCE with an explicit stack that mirrors
  Asciidoctor's reader (`Parser.next_section`, `next_block`,
  `read_paragraph_lines`, `read_lines_for_list_item`, `Reader.read_lines_until`)
  and builds each block's node where Asciidoctor would have closed it, so no
  later stage re-derives nesting: no parser-state gates, no backtracking, no
  custom token pattern reading the token history, no lexer modes, and no
  post-hoc AST repair pass — the guard test asserts all of that textually over
  every file in `src/parse`, plus zero import cycles (from `dependency-cruiser`,
  through the same `cruiseImports` helper `bun run metrics` gates on) and a
  ceiling on lint suppressions.

  Line SHAPES live in one registry, `src/parse/line-shapes.ts`, oracle-pinned by
  `tests/conformance/interruption.test.ts` and cited to the Asciidoctor Ruby
  source, keyed by four `ParagraphContext`s (`paragraph`, `listItem`,
  `listContinuation`, `dlistItem`). `src/parse/lines/classify.ts` is the pure
  function over that registry; the reader is its only parse-side consumer, and
  reflow safety (`src/reflow.ts`) is its only print-side consumer, so the parser
  and the formatter's word-wrapping can never disagree about what would re-parse
  as block syntax. Lists are read EXTENT-FIRST in
  `src/parse/lines/list-reader.ts` — `parse_list`/`parse_list_item`/
  `read_lines_for_list_item` ported as `readList`/`readListItem`/`itemExtent`:
  the extent scan collects one item's lines into Ruby's buffer, then a confined
  `BlockReader` re-parses that buffer, so nesting composes with no list frame,
  no per-item object and no cross-item state (only `itemExtent`'s five mutable
  members — Ruby's four locals plus the buffer). `frames.ts` holds the types the
  list layer shares with `reader.ts` so the two stay a DAG. Each block an item
  holds carries its verbatim `gap` (the `""`/`"+"` lines before it), and
  replaying that gap line for line is `src/print-list.ts`'s DEFAULT — which is
  what makes list formatting idempotent. On top of it the printer has four named
  separator decisions, no more: `hazard(item)` (`src/print-list-hazard.ts`,
  Rulings 26–30 — a pure predicate over the node), `printedGap`'s
  collided-marker arm (drop a blank-only gap when marker normalization made
  parent and child markers identical, #16), `printedGap`'s slurp arm (invent a
  blank that is in no gap, where a literal's re-read slurp would swallow the
  next marker), and `printList`'s two-hardline sibling separator after an item
  ending on an indented literal. Each adjustment exists because verbatim replay
  would not re-parse to the same tree there. Paragraph text is tokenized by the
  hand-rolled tokenizer (`src/parse/inline/tokenize.ts`) over each run of
  paragraph lines, and the paragraph node is built from those tokens
  (`src/parse/build/paragraph.ts`). See "Line classification is contextual" in
  `docs/design.md`, and `docs/simplicity-metrics.md` for how the change was
  measured.

- **AST** (`src/ast.ts`): Designed for Prettier, not the AsciiDoc language
  spec's semantic model. Preserves comments, directives, attribute entries, and
  other constructs a semantic model intentionally discards.
- **Printer** (`src/printer.ts`): Walks AST, produces Prettier Doc IR.
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
