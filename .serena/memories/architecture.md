# Architecture

A Prettier plugin for formatting AsciiDoc (.adoc) files. Custom
source-preserving parser produces an AST with character offsets, printer
converts it to Prettier Doc IR.

## Pipeline

```
source text → Lexer → Parser → CST → AST Builder → AST → Printer → formatted output
                                                           ↓
                                                      toASG() → TCK validation (test-time only)
```

## Components

- **Parser** (`src/parser.ts`, `src/parse/`): Built with Chevrotain. Three
  phases: lexer (tokens), parser (CST), AST builder (visitor). NOT
  Asciidoctor.js — see "Why not Asciidoctor.js?" and "Why Chevrotain?" in
  `docs/design.md`. List-item continuation lines (lexed as raw IndentedLine
  tokens in default mode) are re-lexed by a dedicated inline sub-lexer
  (`src/parse/inline-fragment-lexer.ts`) so inline constructs parse the same on
  any line of an item. Once a paragraph/item/description opens, the lexer's
  `paragraph` mode (`src/parse/paragraph-tokens.ts`) decides where it ends by
  consulting `src/parse/line-shapes.ts` — a single registry of interrupting line
  shapes, oracle-pinned by `tests/conformance/interruption.test.ts` and cited to
  the Asciidoctor Ruby source, keyed by four `ParagraphContext`s (`paragraph`,
  `listItem`, `listContinuation`, `dlistItem`). Reflow safety (`src/reflow.ts`)
  consumes the same registry so the lexer and the formatter's word-wrapping can
  never disagree about what would re-parse as block syntax. See "Line
  classification is contextual" in `docs/design.md`.
- **AST** (`src/ast.ts`): Designed for Prettier, not the AsciiDoc ASG. Preserves
  comments, directives, attribute entries, and other constructs the ASG
  intentionally discards.
- **Printer** (`src/printer.ts`): Walks AST, produces Prettier Doc IR.
- **TCK validation** (`tests/tck/`): `toASG()` converts our AST to official ASG
  format for test-time conformance checks. Dev-only, not shipped.
- **Vendored deps** (`vendor/`): ASG schema and TCK test fixtures from the
  asciidoc-lang project. Updated via `bun run vendor`.
- **Conformance suite** (`tests/conformance/`): differential testing against
  Asciidoctor's own test corpus (see #7). `vendor/asciidoctor-corpus/` holds
  1,614 cases as JSONL, pinned to an Asciidoctor commit — Ruby test-suite
  heredocs, Asciidoctor's own docs pages, and test fixtures. The 13 TCK inputs
  live in `vendor/asciidoc-tck/` and join at load time for 1,627 total.
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
- Roadmap: GitHub issues (tier-1/tier-2 severity labels) and the org project
  board https://github.com/orgs/oxidecomputer/projects/228 — there is no in-repo
  plan document
- AsciiDoc syntax reference: `docs/asciidoc-format.md` — covers all constructs
  the parser handles, ASG node types, and what the ASG does NOT represent (which
  our AST must).
- ASG schema:
  https://gitlab.eclipse.org/eclipse/asciidoc-lang/asciidoc-lang/-/tree/main/asg
- TCK tests: https://gitlab.eclipse.org/eclipse/asciidoc-lang/asciidoc-tck
- Prettier plugin API: https://prettier.io/docs/plugins#developing-plugins

## Tech Stack

- Chevrotain (parser toolkit — lexer + LL(k) parser + CST)
- TypeScript (strict, ES2024 target)
- ESM modules (`"type": "module"`)
- tsup (esbuild-based build, outputs ESM + DTS)
- Vitest for testing
- ESLint 10 with typescript-eslint strict, eslint-config-love,
  eslint-config-prettier, eslint-plugin-jsdoc, eslint-plugin-unicorn,
  @vitest/eslint-plugin
- prettier as peer dependency
