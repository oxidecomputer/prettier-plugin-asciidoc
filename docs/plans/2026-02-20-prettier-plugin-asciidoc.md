# prettier-plugin-asciidoc Implementation Plan

> **For Claude:** Required sub-skills are listed below. Invoke each at the
> specified point — do not skip them.

### Required Sub-Skills

| Skill                                        | When to invoke                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `superpowers:subagent-driven-development`    | At session start — governs overall plan execution (dispatch fresh subagent per task, two-stage review) |
| `superpowers:test-driven-development`        | At the start of every implementation task (Tasks 1-29)                                                 |
| `superpowers:verification-before-completion` | Before every commit step — run checks, confirm output                                                  |
| `superpowers:systematic-debugging`           | When any test fails unexpectedly — do not guess at fixes                                               |
| `superpowers:requesting-code-review`         | After completing milestone groups (see below)                                                          |

### Milestones (request code review after each)

1. **Setup** — after Task 1 (vendor + skeleton)
2. **Core block parsing** — after Task 7 (paragraphs, sections, comments,
   attributes, document header)
3. **Lists** — after Task 9c (unordered, ordered, checklists, callouts)
4. **TCK baseline** — after Task 25 (conformance harness wired up, expected
   failures catalogued)
5. **Delimited blocks** — after Task 11b (leaf blocks, literal paragraphs,
   parent blocks, block attributes/titles, paragraph-form blocks, discrete
   headings, breaks, indented list continuation fix, admonitions, fenced code
   blocks, delimiter length matching, block masquerading)
6. **Inline parsing** — after Task 16
7. **Remaining block types** — after Task 18, the last of the group in the
   current pending order (bibliography anchors, description lists, tables;
   macros, includes, and conditionals landed earlier)
8. **Polish** — after Task 29 (list continuation, charrefs, index terms,
   integration tests, options, underline headings, explicit ordered markers,
   header author/revision lines)

### Parallelizable task groups

No tasks can run in parallel unless we're certain they will not touch the same
files or logical areas.

**Goal:** Build a Prettier plugin that formats AsciiDoc files with opinionated,
consistent style.

**Architecture:** Chevrotain-based lexer/parser produces a CST, which a visitor
converts to our Prettier-friendly AST with character offsets. Printer walks AST
to produce Prettier Doc IR. A test-time `toASG()` function validates parser
correctness against the official AsciiDoc TCK.

**Tech Stack:** TypeScript, Prettier 3, Chevrotain, tsup, Vitest, ESLint 9

---

## How to execute each task

1. **Invoke `superpowers:test-driven-development`** — write failing test first,
   always
2. Follow the steps listed in the task
3. **Invoke `superpowers:verification-before-completion`** before the commit
   step — run `npm run check && npm run lint && npm test && npm run build`,
   confirm all pass
4. Commit with `jj describe -m "message"` then `jj new`
5. If a test fails unexpectedly, **invoke `superpowers:systematic-debugging`** —
   do not guess

At each milestone boundary (see table above), **invoke
`superpowers:requesting-code-review`**.

After every code quality review, address all of the reviewer's suggestions. Do
not defer or drop any reviewer feedback. If there is any feedback that can't
reasonably be addressed at the point when it's found (e.g. "consider doing X
when Y..."), update this plan with a note in the appropriate task to address
that feedback so it's not forgotten.

---

## Progress Checklist

- [x] Task 0: Vendor ASG schema and TCK test fixtures
- [x] Task 1: Plugin skeleton — language registration + identity parse/print
- [x] Task 2: Chevrotain lexer + parser infrastructure
- [x] Task 3: Parse paragraphs and blank lines
- [x] Task 4: Parse sections (headings)
- [x] Task 5: Parse line comments and block comments
- [x] Task 5b: Paragraph reflow (moved up from Task 22 — core formatting
      behavior)
- [x] Task 6: Parse attribute entries
- [x] Task 7: Parse document title and header
- [x] Task 8: Parse unordered lists
- [x] Task 9: Parse ordered lists
- [x] Task 9b: Parse checklist syntax
- [x] Task 9c: Parse callout lists
- [x] Task 10: Parse delimited leaf blocks
- [x] Task 10b: Parse literal paragraphs (indented)
- [x] Task 11: Parse delimited parent blocks
- [x] Task 12: Parse block attribute lists, anchors, and block titles
- [x] Task 12b: Parse paragraph-form blocks (verse, quote, source on paragraphs)
- [x] Task 12c: Parse discrete headings
- [x] Task 12d: Fix indented continuation lines in list items
- [x] Task 13: Parse thematic breaks and page breaks
- [x] Task 13b: Parse admonitions (paragraph-form and block-form)
- [x] Task 13d: Graceful error recovery — use Chevrotain's recovery instead of
      throwing
- [x] Task 25: TCK conformance test harness (moved up — TDD baseline)
- [x] Task 10c: Backtick-fenced code blocks
- [x] Task 11c: Parent block delimiter length matching
- [x] Task 11b: Block masquerading (style-driven content model)
- [x] Task 14: Inline parser — bold, italic, monospace, highlight, attribute
      references
- [x] Task 14b: Inline parser hardening — test gaps, architectural improvements,
      token dispatch cleanup
- [x] Task 15: Inline parser — links and cross-references
- [x] Task 16: Inline parser — macros, passthroughs, line breaks
- [x] Task 19: Parse block macros
- [x] Task 20: Parse include directives
- [x] Task 21: Parse conditional directives
- [ ] Task 15b: Parse bibliography anchors
- [ ] Task 17: Parse description lists
- [ ] Task 18: Parse tables
- [ ] Task 27: Plugin options
- [ ] Task 29: Parse explicit ordered list markers
- [ ] Task 26: End-to-end integration tests
- [ ] Task 24: Superscript, subscript, and character references
- [ ] Task 24b: Index terms
- [ ] Task 28: Parse underline-style section titles
- [ ] Task 23: List continuation and complex list items
- [ ] Task 30: Preserve document header author and revision lines

Details of completed tasks have been removed from this plan.

---

## Task 17: Parse description lists

Description lists: `Term:: Description` or `Term::\nDescription`.

**Files:**

- Modify: `src/ast.ts` — add `DescriptionListNode`, `DescriptionListItemNode`
- Modify: `src/parse/tokens.ts` — add `DescriptionListMarker` token
- Modify: `src/parse/grammar.ts` — add description list rules
- Modify: `src/parse/ast-builder.ts`
- Modify: `src/printer.ts`
- Create: `tests/parser/description-list.test.ts`
- Create: `tests/format/description-list.test.ts`

**Key test cases:**

- Compact form (no blank line between term and definition) preserved as-is
- Paragraph form (blank line between term and definition) preserved as-is
- Multi-line definitions
- Nested description lists
- Multiple marker depths (`::`, `:::`, `::::`)

**Commit:**

```
jj describe -m "feat: parse and format description lists"
jj new
```

---

## Task 18: Parse tables

Tables are `|===` delimited with `|` cell separators.

**Files:**

- Modify: `src/ast.ts` — add `TableNode`, `TableRowNode`, `TableCellNode`
- Modify: `src/parse/tokens.ts` — add `TableDelimiter`, `CellSeparator` tokens;
  consider a `table` lexer mode
- Modify: `src/parse/grammar.ts` — add table rules
- Modify: `src/parse/ast-builder.ts`
- Modify: `src/printer.ts`
- Create: `tests/parser/table.test.ts`
- Create: `tests/format/table.test.ts`

**Key test cases:**

- Simple 2x2 table
- Table with header row (`[%header]` or first row followed by blank line)
- Column specs (`[cols="1,2,3"]`)
- Cell alignment
- Table with title
- Multi-line cell content
- Footer rows: `[options="header,footer"]` (gap 11)
- CSV table: `,===` delimiter with comma-separated cells (gap 9)
- DSV table: `:===` delimiter with colon-separated cells (gap 9)
- `[format="csv"]` attribute on `|===` table (gap 9)
- Nested tables: `!===`/`!` separator inside `a`-style cells (gap 10) — stretch
  goal, may defer
- Full combinatorial cell prefix grammar: row span + col span + h-align +
  v-align + content style on a single cell (e.g., `.2+^.^h|`). Real-world RFDs
  freely combine all prefix components. (gap from RFD corpus audit)

**Commit:**

```
jj describe -m "feat: parse and format tables"
jj new
```

---

## ~~Task 22: Paragraph reflow~~ (moved to Task 5b; inline/hardbreak extensions folded into Tasks 14 and 16)

---

## Task 23: List continuation and complex list items

List items can contain multiple blocks via the `+` continuation marker.

**Files:**

- Modify: `src/parse/tokens.ts` — add `ListContinuation` token (`+` on its own
  line)
- Modify: `src/parse/grammar.ts` — extend list item rules to accept
  continuation + nested blocks
- Modify: `src/parse/ast-builder.ts`
- Modify: `src/printer.ts`
- Create: `tests/parser/list-continuation.test.ts`
- Create: `tests/format/list-continuation.test.ts`

**Key test cases:**

- List item with `+` followed by a paragraph
- List item with `+` followed by a listing block
- Nested list with continuation

**Commit:**

```
jj describe -m "feat: parse and format list continuation"
jj new
```

---

## Task 30: Preserve document header author and revision lines

The implicit author line (`Jane Doe; John Roe <john@example.com>`) and revision
line (`v1.0, 2024-01-15: Remark`) directly under `= Title` are part of the
document header. Today they parse as body paragraphs: the printer inserts a
blank line after the title (detaching them, so the document loses its metadata)
and reflow merges author + revision into one paragraph. See the gap analysis
(Tier 1).

**Files:**

- Modify: `src/parse/grammar.ts` — recognize header lines following the document
  title (no blank line between)
- Modify: `src/ast.ts` — header node(s) for author and revision lines (or fields
  on the document header)
- Modify: `src/parse/ast-builder.ts`
- Modify: `src/printer.ts` / `src/print-join.ts` — keep title, author, revision,
  and attribute entries contiguous (update the `DocumentTitleNode` doc comment,
  which documents the current gap)
- Create: `tests/parser/document-header-lines.test.ts`
- Create: `tests/format/document-header-lines.test.ts`

**Key test cases:**

- `= Title` + author line round-trips with no inserted blank line
- Author + revision lines both present stay on separate lines
- Revision line requires an author line above it (spec rule)
- Title + author + attribute entries: all contiguous
- A paragraph after a blank line below the title is still a body paragraph (no
  false positives)

**Commit:**

```
jj describe -m "feat: preserve document header author and revision lines"
jj new
```

---

## Task 24: Superscript, subscript, and character references

`^super^`, `~sub~`, `(C)`, `(R)`, `(TM)`, `--` (em dash), `...` (ellipsis),
`->`, `=>`, and smart quote replacements (directional apostrophes/quotes) (gap
21).

**Files:**

- Modify: `src/parse/tokens.ts` — add superscript/subscript/charref tokens
  (token definitions live there, not in `inline-tokens.ts`; also add them to
  `INLINE_TOKEN_KEYS` in `src/parse/inline-tokens.ts`)
- Modify: `src/parse/grammar.ts`
- Modify: `src/ast.ts`
- Modify: `src/parse/ast-builder.ts`
- Modify: `src/printer.ts`
- Create: `tests/parser/inline-misc.test.ts`

**Commit:**

```
jj describe -m "feat: parse and format superscript, subscript, charrefs"
jj new
```

---

## Task 24b: Index terms

Index terms mark text for inclusion in a generated index. Two inline syntaxes
plus two macro forms.

**Syntax:**

```
((visible index term))          ← visible in output, added to index
(((primary,secondary,tertiary)))  ← hidden, added to index only
indexterm:[primary,secondary]   ← macro form, hidden
indexterm2:[visible term]       ← macro form, visible
```

**Files:**

- Modify: `src/parse/tokens.ts` — add index term tokens (`((`, `))`, `(((`,
  `)))`) (token definitions live there, not in `inline-tokens.ts`; also add them
  to `INLINE_TOKEN_KEYS` in `src/parse/inline-tokens.ts`)
- Modify: `src/parse/grammar.ts` — add index term rules
- Modify: `src/ast.ts` — add `IndexTermNode` with `visible` flag and `terms`
  array
- Modify: `src/parse/ast-builder.ts`
- Modify: `src/printer.ts`
- Create: `tests/parser/index-terms.test.ts`
- Create: `tests/format/index-terms.test.ts`

**Key test cases:**

- `((visible term))` — visible index term with single entry
- `(((primary,secondary,tertiary)))` — hidden index term with up to 3 levels
- `indexterm:[primary,secondary]` — macro form (hidden)
- `indexterm2:[visible term]` — macro form (visible)
- Index terms preserved through formatting
- Index term mid-sentence

**Commit:**

```
jj describe -m "feat: parse and format index terms"
jj new
```

---

## Task 13d: Graceful error recovery

Stop throwing on lexer/parser errors. Use Chevrotain's built-in error recovery
to produce partial results and preserve unrecognized input verbatim. See "Error
handling" in `docs/design.md` for the principle.

**Current state:** `src/parser.ts` throws on the first lexer error (line 48) and
the first parser error (line 57). This means any input our grammar doesn't
understand crashes the formatter instead of degrading gracefully. We chose
Chevrotain partly for its error recovery but aren't using it.

**What to change:**

1. **Remove the lexer-error throw.** Chevrotain's lexer produces an `errors`
   array but still returns a token stream. Unrecognized characters appear as
   error entries. Convert these into a fallback token (e.g., `UnrecognizedText`)
   that the parser treats as verbatim text content.

2. **Remove the parser-error throw.** Chevrotain's parser uses four recovery
   strategies (token insertion, deletion, repetition re-sync, general re-sync)
   to produce a partial CST even when rules fail. The CST will contain
   `recoveredNode` flags. Let the AST builder handle these — recovered regions
   should pass through as raw text nodes preserving the original source.

3. **Keep AST builder assertions.** The `throw new Error(...)` calls inside
   `ast-builder.ts` and `block-helpers.ts` guard against "impossible" states
   (grammar matched a rule but expected tokens are missing). These indicate bugs
   in our grammar, not bad input. They should stay as-is.

4. **Add tests for graceful degradation.** Feed the parser input it can't handle
   and verify it produces output (even if imperfect) rather than throwing. Key
   cases:
   - Unknown block delimiter characters
   - Unclosed delimited blocks (EOF before close delimiter)
   - Malformed attribute entries
   - Input that is just plain prose (no AsciiDoc constructs)
   - Mixed recognized and unrecognized constructs in one document

**Files:**

- Modify: `src/parser.ts` — remove throws on lexer/parser errors, wire up
  fallback behavior
- Modify: `src/parse/tokens.ts` — add `UnrecognizedText` fallback token if
  needed
- Modify: `src/parse/grammar.ts` — ensure parser recovery settings are
  configured (Chevrotain's `recoveryEnabled` flag)
- Modify: `src/parse/ast-builder.ts` — handle recovered CST regions
- Create: `tests/parser/error-recovery.test.ts`
- Create: `tests/format/error-recovery.test.ts`

**Commit:**

```
jj describe -m "feat: graceful error recovery — never throw on valid AsciiDoc input"
jj new
```

---

## Task 26: Integration tests on local documents

Run the formatter against any `.adoc` files the developer drops into a
git-ignored local directory. Assert two properties on each document:

1. **Semantic preservation**: `asciidoctor(doc) === asciidoctor(prettier(doc))`
2. **Idempotency**: `prettier(doc) === prettier(prettier(doc))`

Uses `@asciidoctor/core` (JS port) as a dev dependency for in-process HTML
rendering. Exact string match on HTML output; add normalization only if we hit
false failures. Tests skip gracefully when the fixtures directory is empty.

No checked-in fixtures, no snapshots, no references to any specific document
source.

**Files:**

- Add: `@asciidoctor/core` as dev dependency
- Create: `tests/integration/fixtures/.gitkeep` (directory tracked, contents
  ignored)
- Add: `tests/integration/fixtures/` to `.gitignore`
- Create: `tests/integration/local-docs.test.ts`

**Key test cases:**

- Semantic preservation: HTML output unchanged after formatting
- Idempotency: formatting twice produces same output
- Empty fixtures directory: tests skip, no failures

**Commit:**

```
jj describe -m "feat: integration tests for local documents"
jj new
```

---

## Task 27: Plugin options

Add plugin-specific options: `asciidocBlockDelimiterLength` (default 4),
`asciidocProseWrap` (always/preserve/never).

**Files:**

- Create: `src/options.ts`
- Modify: `src/index.ts`
- Modify: `src/printer.ts`
- Create: `tests/format/options.test.ts`

**Commit:**

```
jj describe -m "feat: plugin-specific formatting options"
jj new
```

---

## Task 28: Parse underline-style section titles

Legacy two-line heading syntax where the title is on one line and underlined on
the next. The formatter normalizes these to ATX-style (`== Title`).

**Syntax:**

```
Title         Level 0: =========
-----         Level 1: ---------
              Level 2: ~~~~~~~~~
              Level 3: ^^^^^^^^^
              Level 4: +++++++++
```

The underline must be within ±2 characters of the title length.

**Disambiguation with delimited blocks:**

Level-1 (`-`) and level-4 (`+`) underlines use the same characters as listing
and passthrough block delimiters. A line of `----` could be either a listing
block opener or a legacy heading underline. The rules that disambiguate:

1. **Blank line before the line of dashes/plusses → block delimiter.** Legacy
   headings require the title and underline to be contiguous (no intervening
   blank line). Our formatter always emits blank lines between blocks, so
   formatted output is never ambiguous.
2. **±2 length rule.** The underline must be within ±2 characters of the
   preceding line's length. A `----` (4 chars) after a 30-character paragraph
   line cannot be a heading underline — it's a block delimiter.
3. **No preceding text line → block delimiter.** At start-of-document or after a
   blank line, there is no title to underline.

Asciidoctor gives legacy headings priority over block delimiters when the ±2
rule is satisfied and no blank line intervenes. We should match that behavior:
the `UnderlineHeading` token's custom pattern matcher should check the preceding
(non-blank, non-newline) token's text, and only match when the length is within
±2. When it doesn't match, the line falls through to
`ListingBlockOpen`/`PassBlockOpen` as normal.

**Smart minimization interaction:** The printer's smart delimiter minimization
(choosing delimiter length to avoid conflicts with content) does not create
ambiguity here. The formatter always separates blocks with blank lines, which
rules out legacy heading interpretation. However, we should include an explicit
round-trip test to verify this.

**Files:**

- Modify: `src/parse/tokens.ts` — add `UnderlineHeading` token pattern (two
  consecutive lines where the second is all `=`, `-`, `~`, `^`, or `+` and
  length matches ±2)
- Modify: `src/parse/grammar.ts` — add alternative heading rule
- Modify: `src/parse/ast-builder.ts` — produce the same `SectionNode` as ATX
  headings
- Modify: `src/printer.ts` — always output ATX style (normalization)
- Create: `tests/parser/underline-heading.test.ts`
- Create: `tests/format/underline-heading.test.ts`

**Key test cases:**

_Basic parsing:_

- Each underline character level (`=`, `-`, `~`, `^`, `+`) maps to the correct
  section level
- Underline length within ±2 of title length
- Underline too short or too long → not a heading (treated as paragraph +
  possibly a block delimiter)
- Formatter normalizes to ATX style in output
- Underline heading with block attributes

_Disambiguation with delimited blocks (`-` and `+` underlines):_

- `----` after text of 4 chars → legacy heading (not a listing block)
- `----` after text of 30 chars → listing block delimiter (length mismatch)
- `----` after a blank line, then text → listing block (blank line breaks
  contiguity)
- Same cases for `++++` vs passthrough blocks
- `~~~~` and `^^^^` underlines have no block delimiter conflicts — always
  unambiguous

_Round-trip / idempotency with smart minimization:_

- A listing block whose content contains `----` formats with smart-minimized
  `-----` delimiters, and re-parsing that output doesn't misinterpret the
  delimiter as a legacy heading (because the formatter emits a blank line before
  the block)
- Same for passthrough blocks with `++++` content

**Commit:**

```
jj describe -m "feat: parse underline-style headings, normalize to ATX"
jj new
```

---

## Task 29: Parse explicit ordered list markers

Explicit numbering styles for ordered lists beyond the implicit `.`/`..`/`...`
markers. The formatter normalizes these to implicit style.

**Syntax:**

```
1. Explicit arabic
a. Lowercase alpha
A. Uppercase alpha
i) Lowercase roman
I) Uppercase roman
```

**Files:**

- Modify: `src/parse/tokens.ts` — extend `OrderedListMarker` to match explicit
  patterns (`\d+.`, `[a-z].`, `[A-Z].`, `[ivxlc]+)`, `[IVXLC]+)`)
- Modify: `src/parse/ast-builder.ts` — store marker style but produce the same
  `ListNode`
- Modify: `src/printer.ts` — normalize to implicit `.` style in output
- Create: `tests/parser/explicit-ordered-list.test.ts`
- Create: `tests/format/explicit-ordered-list.test.ts`

**Key test cases:**

- `1. Item` parsed as ordered list
- `a. Item` parsed as ordered list
- `i) Item` parsed as ordered list (note `)` instead of `.`)
- Mixed explicit and implicit markers in nested lists
- Formatter normalizes all explicit markers to implicit `.` style
- `1.` at start of a sentence in a paragraph is NOT a list marker (context
  sensitivity)

**Commit:**

```
jj describe -m "feat: parse explicit ordered list markers, normalize to implicit"
jj new
```

---

## Task 15b: Parse bibliography anchors

Bibliography anchors use triple brackets inside `[bibliography]` section list
items: `[[[id]]]` or `[[[id, reftext]]]`. They function like `[[id]]` anchors
but with distinct syntax.

**Files:**

- Modify: `src/parse/inline-link-tokens.ts` — add a bibliography anchor token
  (`[[[id]]]` / `[[[id, reftext]]]`); token definitions live there and in
  `src/parse/tokens.ts`, not `inline-tokens.ts` (which is CST-flattening — only
  its `INLINE_TOKEN_KEYS` list needs the new token added)
- Modify: `src/parse/grammar.ts` — add bibliography anchor rule in inline
  parsing
- Modify: `src/ast.ts` — add `BibliographyAnchorNode` (or extend existing anchor
  node with a `form` field)
- Modify: `src/parse/ast-builder.ts`
- Modify: `src/printer.ts`
- Create: `tests/parser/bibliography-anchor.test.ts`
- Create: `tests/format/bibliography-anchor.test.ts`

**Key test cases:**

- `[[[id]]]` — simple bibliography anchor preserved verbatim
- `[[[id, reftext]]]` — two-argument form preserved
- `<<id>>` xref resolving to a bibliography anchor (already works — just verify)
- Bibliography anchor inside a list item (the typical usage context)
- Triple brackets not at start of list item treated as text (no false positives)
- Round-trip: formatted output re-parses identically

**Commit:**

```
jj describe -m "feat: parse and format bibliography anchors"
jj new
```
