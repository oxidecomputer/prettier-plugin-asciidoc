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
  `docs/design.md`.
- **AST** (`src/ast.ts`): Designed for Prettier, not the AsciiDoc ASG. Preserves
  comments, directives, attribute entries, and other constructs the ASG
  intentionally discards.
- **Printer** (`src/printer.ts`): Walks AST, produces Prettier Doc IR.
- **TCK validation** (`tests/tck/`): `toASG()` converts our AST to official ASG
  format for test-time conformance checks. Dev-only, not shipped.
- **Vendored deps** (`vendor/`): ASG schema and TCK test fixtures from the
  asciidoc-lang project. Updated via `bun run vendor`.

## Key References

- Design doc: `docs/design.md`
- Implementation plan: `docs/plans/`
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
