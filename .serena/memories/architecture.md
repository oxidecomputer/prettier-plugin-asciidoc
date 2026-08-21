# Architecture

A Prettier plugin for formatting AsciiDoc (.adoc) files. Custom
source-preserving parser produces an AST with character offsets, printer
converts it to Prettier Doc IR.

## Pipeline

```
source → splitLines → BlockReader(classifyLine) → IToken[] → CstParser → CST → AST Builder → AST → Printer
```

## Components

- **Parser** (`src/parser.ts`, `src/parse/`): four phases — line splitting
  (`src/parse/lines/split.ts`, rstripping each line as
  `Helpers.prepare_source_string` does), the **BlockReader**
  (`src/parse/lines/reader.ts`), a mechanical Chevrotain `CstParser`
  (`src/parse/grammar.ts`), and the AST-builder visitor
  (`src/parse/ast-builder.ts`). NOT Asciidoctor.js — see "Why not
  Asciidoctor.js?" and "Why Chevrotain?" in `docs/design.md`.

  **The rule: block-level context comes from the reader's frame stack and from
  nowhere else, and `tests/parser/architecture.test.ts` enforces it.** The
  BlockReader walks the lines ONCE with an explicit stack that mirrors
  Asciidoctor's reader (`Parser.next_section`, `next_block`,
  `read_paragraph_lines`, `read_lines_for_list_item`, `Reader.read_lines_until`)
  and emits one pre-classified token per line plus zero-length boundary tokens
  (`ParagraphStart`/`ParagraphEnd`, `ItemEnd`, `ListEnd`, `SectionEnd`,
  `UnclosedEnd`) that spell out every nesting decision. So the grammar is LL(1)
  on distinct first tokens: no parser-state gates, no backtracking, no custom
  token pattern reading the token history, no lexer modes, and no post-hoc AST
  repair pass — the guard test asserts all of that textually over every file in
  `src/parse`, plus zero import cycles (from `dependency-cruiser`, through the
  same `cruiseImports` helper `bun run metrics` gates on) and a ceiling on lint
  suppressions.

  Line SHAPES live in one registry, `src/parse/line-shapes.ts`, oracle-pinned by
  `tests/conformance/interruption.test.ts` and cited to the Asciidoctor Ruby
  source, keyed by four `ParagraphContext`s (`paragraph`, `listItem`,
  `listContinuation`, `dlistItem`). `src/parse/lines/classify.ts` is the pure
  function over that registry; the reader is its only parse-side consumer, and
  reflow safety (`src/reflow.ts`) is its only print-side consumer, so the parser
  and the formatter's word-wrapping can never disagree about what would re-parse
  as block syntax. Lists are `read_lines_for_list_item` in
  `src/parse/lines/list-reader.ts` with `list-frames.ts`/`list-item.ts`;
  `frames.ts` holds the types those share with `reader.ts` so the three stay a
  DAG. Paragraph text is the one thing still lexed: the reader runs the
  single-mode inline lexer (`src/parse/tokens.ts`) over each run of paragraph
  lines and splices the rebased tokens between the paragraph's boundaries. See
  "Line classification is contextual" in `docs/design.md`, and
  `docs/simplicity-metrics.md` for how the change was measured.

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

- Chevrotain, for the tree-assembly layer only: a `CstParser` fed the
  BlockReader's `IToken[]` directly, the CST + visitor, and the single-mode
  inline lexer. Its lexer modes, parser-state gates and token-history custom
  patterns are deliberately unused — the reader owns block context
- TypeScript (strict, ES2024 target)
- ESM modules (`"type": "module"`)
- `Bun.build` via `scripts/build.ts` (ESM into `dist/`, external prettier and
  chevrotain)
- Vitest for testing
- ESLint 10 with typescript-eslint strict, eslint-config-love,
  eslint-config-prettier, eslint-plugin-jsdoc, eslint-plugin-unicorn,
  @vitest/eslint-plugin
- prettier as peer dependency
