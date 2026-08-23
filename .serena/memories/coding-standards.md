# Coding Standards

## Lint Rules

ESLint is strict. Rules that affect how you write code:

- No `any` — use proper types
- No `null` — use `undefined` (relaxed in test files)
- `strict-boolean-expressions` — no truthy/falsy checks, be explicit
- No magic numbers (relaxed in test files)
- `require-unicode-regexp` — **every** regex in `src` carries the `v` flag, with
  no exception. The two file-level exemptions that existed
  (`src/parse/tokens.ts`, `src/parse/inline-link-tokens.ts`) were there only
  because Chevrotain's `regexp-to-ast` could not compile `v`; both files and the
  exemption went with the dependency on 2026-08-21
- No `console.log`
- Unused vars must be prefixed with `_`
- Unicorn recommended rules (modern JS conventions)
- JSDoc required on all exported functions, with `@param` and `@returns`
  (eslint-plugin-jsdoc)
- `max-lines: 450` (from eslint-config-love) — blank lines and comments are
  excluded from the count. **Never condense or remove comments to fit the
  limit.** Instead, split the file into smaller modules. Comments are critical
  for understanding the code. One ruled, file-scoped exception:
  `src/parse/lines/reader.ts` is capped at `max-lines: 500` instead
  (`eslint.config.js`), ruled during plan α because the file had absorbed a
  whole module's responsibility; plan β retires the override by restructuring
  the file.

## Code Comments

All non-trivial code should have comments that explain _why_ it exists, not just
what it does. Restate the code's purpose only when the intent isn't obvious from
reading it. AsciiDoc is a deceptively complex format — even "obvious" helper
functions often exist to handle subtle edge cases. Comments should distinguish
inherent, necessary complexity from accidental complexity so future readers (and
AI agents) can tell the difference.

**Style convention:**

- `/** */` JSDoc — all exported functions, classes, interfaces, and types. VS
  Code shows these on hover.
- `//` — internal implementation notes (helper functions, line-shape and inline
  rule table rows, "why" explanations).

**JSDoc discipline (enforced by eslint-plugin-jsdoc):**

- Every exported function must have a JSDoc comment (`require-jsdoc`). Even if
  _what_ the function does is obvious, explain _why_ it exists — what problem or
  edge case motivated it, and the context in which it's used.
- Every `@param` must be documented (`require-param`). Don't just restate the
  type; describe what the parameter means in context. For example,
  `@param sourceText` should explain whether it's the full document source or a
  substring, and why the function needs it.
- Every non-void return must be documented (`require-returns`). Describe what
  the caller should expect and any invariants the return value guarantees.
- No JSDoc type annotations (`no-types`) — TypeScript handles types. JSDoc
  describes meaning, not types.

**Line width:** Keep comments within 80 columns. Prettier doesn't reflow
comments, so wrap them manually.

## Line-Shaped Constructs

A new construct that can appear as a whole line (a delimiter, a marker, a
block-attribute-looking line, …) is added in three steps, in this order:

1. **A registry row in `src/parse/line-shapes.ts`**, citing the Ruby it mirrors
   (`lib/asciidoctor/parser.rb`, `rx.rb`, `reader.rb` in Asciidoctor 2.0.20).
   The regex lives here and nowhere else.
2. **A table entry in `src/parse/lines/classify.ts`**, so the BlockReader learns
   the new `LineKind`. The classifier is a pure function over the registry; it
   is the only thing that turns a line into a kind.
3. **An oracle row in `tests/conformance/interruption.test.ts`**, pinning the
   shape against `@asciidoctor/core` in every `ParagraphContext`. The oracle
   wins if it disagrees with your reading of the Ruby.

A new INLINE construct is added the same way: a rule in
`src/parse/inline/rules.ts` citing the Asciidoctor source it mirrors
(`substitutors.rb`, `rx.rb`), in the right place in the ORDER (first match
wins), and a row in `tests/parser/inline-tokens.test.ts`. The rule table is the
single source of truth for inline shapes, as `line-shapes.ts` is for line
shapes.

**Never a token pattern.** Block-level context comes from the BlockReader's
frame stack and from nowhere else, and `tests/parser/architecture.test.ts` is
the mechanical guard: it reads the source of every file under `src/parse` and
fails on a custom token pattern that takes the token history, a lexer-mode
switch, a parser-state gate, `BACKTRACK`, a raw `LA` lookahead, a backwards
search over a token array, an `import … from "chevrotain"` (a literal regex — a
different parser library would need its own row), an import cycle, or a lint
suppression beyond the current ceiling. The rules are textual and blunt and they
read comments too: if one fires on a comment, reword the comment — do not weaken
the rule or exempt a file.

Reflow safety (`src/reflow.ts`) consumes the same registry, so the parser and
the formatter's word-wrapping can never disagree about what would re-parse as
block syntax. See "Line classification is contextual" in `docs/design.md`.

## Writing Style

- Never use the phrase "key insight"
- "upfront" is two words ("up front"), not one
