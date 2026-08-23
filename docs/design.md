# Design

An opinionated Prettier plugin for formatting AsciiDoc files, analogous to what
Prettier does for Markdown. Enforces consistent style, reflows prose, normalizes
spacing, and produces clean diffs.

## Architecture

```
source → splitLines → BlockReader(classifyLine) → AST → Printer
```

### Parser

A custom, source-preserving parser, hand-written in TypeScript with no parser
library and no runtime dependency of any kind. See
[Why no parser library](#why-no-parser-library) and
[Why not Asciidoctor.js?](#why-not-asciidoctorjs) below.

Parsing happens in three phases:

1. **Line splitting** (`src/parse/lines/split.ts`): Cuts the source into lines,
   rstripping each one exactly as `Helpers.prepare_source_string` does while
   keeping the author's bytes and the document offsets alongside.

2. **BlockReader** (`src/parse/lines/reader.ts`): Walks those lines ONCE with an
   explicit frame stack that mirrors Asciidoctor's reader (`Parser.next_block`,
   `read_paragraph_lines`, `read_lines_for_list_item`, `read_lines_until`),
   classifying each line against the registry in `src/parse/line-shapes.ts` with
   the open context in hand. It builds the AST directly: a frame IS the node
   under construction, and closing a frame builds its node with the pure
   `(lines, index) → Node` constructors in `src/parse/build/` and pushes it onto
   the parent frame's children. There is no separate tree-building pass — no
   grammar, no CST, no visitor. Lists are read EXTENT-FIRST in
   `src/parse/lines/list-reader.ts`, a port of Asciidoctor's own structure:
   `parse_list` → `parse_list_item` → `read_lines_for_list_item` becomes
   `readList` → `readListItem` → `itemExtent`. `itemExtent` collects one item's
   lines into Ruby's buffer; `readListItem` then re-parses that buffer with a
   confined `BlockReader` (Ruby's `Reader.new buffer`), so nesting composes
   because an inner item's scan runs over the outer item's buffer. There is no
   list frame and no per-item object: the only mutable per-item state is
   `itemExtent`'s five members (Ruby's four locals plus the buffer being built),
   and nothing points across an item boundary. `src/parse/lines/frames.ts` holds
   the frame and reader types the list layer shares with `reader.ts`, plus the
   held-metadata table both consult, so those modules stay a DAG rather than an
   import cycle. Every node carries character offsets (`locStart`/`locEnd`),
   comments and directives are first-class nodes, and the tree is faithful to
   the source syntax. `tests/parser/architecture.test.ts` is the mechanical
   guard that block context is decided in the reader and nowhere else.

3. **Inline tokenizer** (`src/parse/inline/`): the paragraph reader
   (`src/parse/lines/paragraph-reader.ts`) hands each run of paragraph text to
   `tokenizeInline` (`tokenize.ts`), a ~40-line loop over the ordered rule table
   in `rules.ts` — first match wins, one character of `InlineChar` if nothing
   matches, so it is total. The flat `{ type, image, offset }` tokens carry
   DOCUMENT offsets; `inline-node-builder.ts` pairs the formatting marks into
   nested inline nodes, and `src/parse/positions.ts`'s `LocationIndex` turns any
   offset into a `{ offset, line, column }`.

### Printer

Walks the AST and produces Prettier Doc IR using `group`, `indent`, `line`,
`hardline`, `softline`, `fill`, `join`, etc.

Inside a list, the separators are the AST's, not the printer's invention:
`src/print-list.ts`'s DEFAULT is to replay each `ItemBlock.gap` — the verbatim
`""`/`"+"` lines the author wrote between an item's pieces — line for line,
which is what makes list formatting idempotent by construction. The printer then
has exactly four separator decisions of its own, and they are enumerable because
each one is a named arm rather than a judgement:

1. `hazard(item)` (`src/print-list-hazard.ts`) — a pure predicate over the
   finished node returning `"none" | "plus" | "keepBreak"`: whether reflowing
   the item's text would push leading metadata onto the first line after the
   marker and so change the reading, and what to print against that (Rulings
   26–30).
2. `printedGap`'s collided-marker arm — marker normalization can make a nested
   list's marker identical to its parent item's, and then a blank-only gap would
   read back as a SIBLING boundary; the pair prints adjacent instead, so the
   flattening at least stays idempotent (issue #16).
3. `printedGap`'s slurp arm — a blank line that is in no gap, invented where an
   indented literal's re-read slurp (or the hazard's introduced `+`) would
   otherwise swallow the nested marker that follows it.
4. `printList`'s sibling separator — two hardlines instead of one when the
   previous item ends on an indented literal paragraph, which reads on to the
   next blank line and would otherwise eat the sibling's marker.

Each of the three ADJUSTMENTS (2–4) exists for the same reason: verbatim replay
would NOT re-parse to the same tree there. The code's comments — the
`printedGap`, `slurpReaches`, and `printList` function comments in
`print-list.ts` — carry the reasoning and the Ruby citation for each, and each
is pinned by a byte test in `tests/format/list-item-blocks.test.ts` — the plan's
mutation pass found all three under-tested, which is exactly what an
undocumented decision looks like from the outside.

## One tree

There is exactly one tree representation: our AST (`src/ast.ts`), built by the
reader as it reads. It has typed, semantic nodes — `SectionNode` with a `level`
property, `ParagraphNode` with inline children, etc. — and it is what we hand to
Prettier.

Prettier's plugin API is AST-agnostic: it calls `parse()` to get a tree,
`locStart(node)`/`locEnd(node)` to get character offsets, and `print(path)` to
walk the tree and emit Doc IR. It doesn't inspect node types or tree structure.
So the AST's only obligations are the ones the printer and the position helpers
have, which is why it is designed for a formatter rather than for the language
spec's semantic model.

## AST

Our AST is designed for Prettier, not for the AsciiDoc language spec's semantic
model. It preserves everything a formatter needs, including constructs a
semantic model intentionally discards.

The list below is the 31 `type` discriminants declared in `src/ast.ts`, and
nothing else — a node kind not named here does not exist. Tables pass through as
an opaque `delimitedBlock` variant (spec D1) rather than being modeled; where
AsciiDoc has a construct we do not model at all yet (description lists), there
is no node for it and the source is carried as paragraph text; those gaps are
tracked as GitHub issues, not as node names here.

**Block nodes:**

- `document` — root, contains header blocks + body blocks
- `documentTitle` — the `= Title` line
- `section` — heading + child blocks
- `discreteHeading` — a `[discrete]`-styled heading, which opens no section
- `attributeEntry` — `:key: value` lines
- `paragraph` — text content containing inline nodes
- `list` — `variant: "unordered" | "ordered" | "callout"`
- `listItem` — marker + `text` + `blocks` (each block behind the verbatim `gap`
  lines that led into it, in source order — a nested list is a block like any
  other) + `trailingContinuation`
- `delimitedBlock` — every leaf block, under one node with two axes:
  `variant: "listing" | "literal" | "pass" | "verse" | "example" | "sidebar" | "quote" | "table"`
  and `form: "delimited" | "indented" | "paragraph"`. Backtick-fenced code
  (` ``` `) is a `listing` and is normalized to `----` on output; a masqueraded
  parent block (`[verse]` on `____`) keeps its original delimiter in
  `sourceDelimiter`. `table` is an opaque passthrough; delimiters are content —
  spec D1.
- `parentBlock` — `variant: "example" | "sidebar" | "open" | "quote"`; children
  are parsed as AsciiDoc
- `admonition` — `form: "paragraph" | ParentBlockNode["variant"]`; `variant` is
  a `string`, so the 5 standard types and arbitrary custom styles (`[EXERCISE]`)
  are one node. The paragraph form's body is `text` (inline children, like a
  paragraph); the delimited form's body is `children`, and the wrapper delimiter
  is `form` — the spelling and the wrapper are one fact (spec D7)
- `blockMacro` — image, video, audio, toc
- `thematicBreak`, `pageBreak`

**Formatter-specific nodes (no semantic-model equivalent):**

- `comment` — line (`//`) and block (`////`)
- `preprocessorDirective` — one verbatim line the reader eats:
  `include::path[]`, `ifdef`, `ifndef`, `ifeval`, `endif`
- `blockAttributeList` — `[source,ruby]`, `[#id.role%option]`
- `blockTitle` — a `.Title` line
- `blockAnchor` — a `[[id]]` or `[[id,reftext]]` line alone, metadata for the
  block that follows
- `rawLine` — one source line kept verbatim inside a paragraph's inline content,
  so a comment or directive between two text lines survives reflow

**Inline nodes:**

- `text` — plain text
- `bold`, `italic`, `monospace`, `highlight` — constrained and unconstrained
  forms
- `attributeReference` — `{name}`, `{counter:name}`
- `inlineAnchor` — `[[id]]` or `[[id, reftext]]` (standalone on a line acts as
  block metadata)
- `link`, `xref` — references
- `inlineMacro` — `image:`, `kbd:`, `btn:`, `menu:`, `footnote:`, etc.
- `hardLineBreak` — ` +` at the end of a line

**Block masquerading:** A style attribute on a delimited block can change its
effective content model. For example, `[verse]` on a `____` block switches it
from compound (parsed as AsciiDoc) to verbatim (line breaks preserved). `[stem]`
on `++++` switches from raw passthrough to math notation. `[NOTE]` on `====`
decides at frame open that the block builds as an admonition rather than an
example, with the wrapper delimiter recorded as the node's `form` (spec D7). The
parser must check the preceding `blockAttributeList` before opening a block to
determine its effective content model — otherwise it risks reflowing verbatim
content or failing to parse compound content. See the full masquerade table in
`docs/asciidoc-format.md`.

## Testing strategy

Two separate layers with different purposes:

**Unit tests** (`tests/parser/`, `tests/format/`): Written per feature, test our
AST and formatted output directly. These provide real coverage — every
construct, edge cases, position tracking, formatting normalization. Fixtures
live alongside the tests in `tests/format/fixtures/`.

**Differential conformance** (`tests/conformance/`, `scripts/parity.ts`): Run
over the vendored Asciidoctor corpus rather than per feature, and check the
things a hand-written expectation cannot — that formatting preserves the
rendering Asciidoctor produces, that a second pass changes nothing, and (in
`parity.ts`) that a refactor changed no byte of output on any of the 1,620
corpus documents. See "Our approach instead" below for why Asciidoctor is the
reference.

## Formatting opinions

These are starting points; we'll refine as we implement and test on real
documents.

| Element                    | Rule                                                   |
| -------------------------- | ------------------------------------------------------ | ----------------- |
| Print width                | 80 (configurable via Prettier's `printWidth`)          |
| Paragraph reflow           | Yes, to `printWidth`                                   |
| Heading style              | `== Title` (ATX, space after markers)                  |
| Heading blank lines        | One blank line before and after                        |
| List markers               | `*` for unordered, `.` for ordered                     |
| Block delimiters           | 4 characters (`----`, `====`, etc.)                    |
| Blank lines between blocks | Exactly one                                            |
| Trailing blank lines       | None                                                   |
| Trailing whitespace        | Removed                                                |
| Attribute entries          | `:key: value` (single space after colon)               |
| Verbatim block content     | Preserved exactly (no reformatting)                    |
| Table alignment            | Align `                                                | ` where practical |
| Inline formatting          | Normalize spacing; prefer constrained form where valid |

## Error handling

There is no such thing as invalid AsciiDoc. Any text file is valid AsciiDoc — at
worst, unrecognized constructs render as paragraphs. Asciidoctor never rejects
input, and neither should we.

**Principle: format what you understand, preserve what you don't.** The plugin
should never throw an error on any `.adoc` input. Constructs we haven't
implemented yet, ambiguous markup, or unconventional syntax should all pass
through verbatim rather than crashing the formatter.

This means:

- **Classification failures** produce unrecognized text spans that flow through
  as verbatim content, not exceptions: the reader's fall-through arm opens a
  paragraph for any line no rule claims.
- **There is no parser failure mode, and no recovery concept.** The reader is
  total: every input produces a `DocumentNode`. Any line no rule claims opens a
  paragraph, any delimited block still open at EOF is force-closed there, and
  the inline tokenizer's last rule consumes one character, so it cannot stall.
  There is no partial tree and no "recovered" flag to check, because there is no
  state in which the parser has failed.
- **Internal invariant violations** throw, via `unreachable()` in
  `src/unreachable.ts`. These are not input handling: each one guards a state
  that is impossible only because two places agree — the classifier's line-shape
  pattern and a builder's own regex for the same shape, or the reader's frame
  push/pop order and the list layer's entry conditions. If one fires, those two
  drifted apart and there is a bug to fix. Nothing else on the parse path
  throws.

The only other legitimate throw is if a file is not AsciiDoc at all (e.g.,
binary content), and even then Prettier's own infrastructure handles that before
we're called.

## Inline parser architecture

The block layer is line-oriented: the BlockReader classifies each line by its
start-of-line shape (`^== `, `^* `, `^----$`, etc.) in the context its frame
stack is in, and decides there where every block begins and ends — it opens and
closes a frame, and the frame becomes the node. Inline content — bold, italic,
links, macros — lives _within_ paragraph text and is character-oriented, so it
gets a tokenizer; the block layer never does.

### Why not a separate parser?

Some AsciiDoc implementations (notably tree-sitter-asciidoc) use two separate
grammars: one for blocks, one for inline content within blocks. The block parser
emits raw text, and a second parser tokenizes and parses that text
independently. This works but has real downsides:

- **Position tracking gets fragile.** The inline parser receives strings with
  offsets relative to the paragraph start, not the document start. We'd need to
  translate positions back, and every off-by-one is a bug in Prettier's
  `locStart`/`locEnd`.
- **Two trees to merge.** Something would have to combine the output of two
  parsers into a single tree — awkward and error-prone.
- **Wasted tokenization.** A two-parser approach would tokenize paragraph
  content once at the block level, then re-tokenize it from scratch for inline
  markup.

### Chosen approach: one coordinate space

The inline layer is tokenized, the block layer is not. For each run of paragraph
text, the paragraph reader calls `tokenizeInline(text, baseOffset)`
(`src/parse/inline/tokenize.ts`) over that run alone; the `baseOffset` is the
run's position in the source, so every token that comes back already carries a
DOCUMENT offset. Nothing is rebased afterwards and there is no second coordinate
system to translate between. Where a `{ offset, line, column }` is needed, one
`LocationIndex` (`src/parse/positions.ts`), built once per document from the
source alongside the reader's own `splitLines`, answers it by binary search over
its own table of line starts.

Marks are paired into nested spans afterwards, by
`src/parse/inline/inline-node-builder.ts`, which walks the flat token array.
Keeping the pairing out of the tokenizer is what lets a mark that never closes
stay literal text rather than becoming an error.

### Constrained marks

The constrained/unconstrained distinction for formatting marks (`*` vs `**`, `_`
vs `__`, etc.) is context-sensitive: a constrained bold open (`*`) is only valid
at a word boundary — next to whitespace, punctuation, or the edge of the text.

That is one `match` function in `src/parse/inline/rules.ts` (`markMatcher`, over
the `isBoundary` predicate): it tries the double mark first, and accepts the
single one only next to a boundary. There is no token pattern, no lexer and no
library involved — it is an ordinary function returning the length of the match,
or 0.

The boundary is computed against the FRAGMENT handed to the tokenizer, never the
document. An index outside the fragment IS a boundary, which is what makes
`* *bold*` bold: after the list marker the fragment starts at the `*`, so
position 0 sees a boundary. Reading the surrounding CHARACTERS is inline
context; reading the block history would be block context, and
`tests/parser/architecture.test.ts` forbids it.

### What stays in separate files

The inline rule table (`src/parse/inline/rules.ts`) and the inline AST builder
(`src/parse/inline/inline-node-builder.ts`) live in their own files because they
are substantial and because the rule table is a single source of truth for
inline shapes, the way `src/parse/line-shapes.ts` is for line shapes.
`tokenize.ts` — the loop that drives the table — is ~40 lines and has no reason
to live anywhere else.

## Line classification is contextual

Asciidoctor's paragraphs (and list items, and dlist descriptions) are greedy:
once open, they swallow every following line until a blank line or a tiny
interrupting set. Five rules keep the reader and reflow honest about that:

1. Paragraph extent is decided by the BlockReader
   (`src/parse/lines/paragraph-reader.ts`), which asks
   `src/parse/line-shapes.ts` about each line WITH the open context in hand. Its
   `read()` loop peeks the next line, classifies it in the paragraph's own
   context, and stops at the first line that is neither `text` nor `raw` —
   leaving that line unread, which is `read_lines_until` with
   `preserve_last_line: true`. The frame closes there. The stop is never decided
   by re-running the top-level line classifier.
2. The registry is oracle-pinned: `tests/conformance/interruption.test.ts`
   checks every pattern against Asciidoctor for each of four `ParagraphContext`s
   _and_ in both line positions (directly after the block started, where
   `next_block` still gets to choose a block context, and on a later line, where
   it does not), and each row cites the Ruby it mirrors. Read the Ruby and add a
   row before adding a pattern; the oracle wins if they disagree. The four
   contexts, one sentence each: `paragraph` (a plain paragraph, ended only by a
   delimited block, a block attribute line — the `[[anchor]]` form included — or
   a lone `+`), `listItem` (a list item's text, additionally ended by a
   sibling/nested marker or a dlist term), `listContinuation` (a `+`-attached
   paragraph, which takes the plain set plus only the open list's own marker
   style), and `dlistItem` (a dlist description, the widest set, ended by
   anything that would become a non-paragraph block).
3. Reflow safety consumes the same registry: `isBlockSyntaxAtLineStart`
   (`src/reflow.ts`) asks it about a word alone on a line and a word starting
   one, unioned over every context, so fill() never places a word where it would
   be re-parsed as block syntax. The first-line dlist hazard (`term::`-shaped
   words) is a separate, word-based guard — `DLIST_HAZARD_BREAK`, resolved in
   `flattenForFill` so the break always lands on the separator before a fused
   inline run, never inside it.
4. Normalizations ship with a render-equivalence test
   (`renderedHtml(out) === renderedHtml(input)`) and an idempotency test, not
   just a snapshot.
5. Every line-shape regex is a single source. There is no second dialect to keep
   in step any more: the registry's patterns are plain `v`-flag regexes, the
   BlockReader is their only consumer on the parse side, and reflow is their
   only consumer on the print side. The reader also rstrips every line before
   classification (`Helpers.prepare_source_string`), which the registry mirrors
   (see `line-shapes.ts`'s `rstrip`).

**Why (history).** Until the line-classifier work landed, a lexer re-classified
every line as if it stood at the top of a block, so a `.Title`-shaped or
`* item`-shaped line mid-paragraph became a block title or a list, and an
`InlineNewline` simply popped back to the block mode to do it again on the next
line. That inversion is the root of gap issues #26, #27, and #29 (line comments,
block-title-looking lines, and indented continuations each splitting one
paragraph or list into several). The differential conformance suite (#7) is the
evidence: the quarantine manifest went from 519 cases on the release before this
work, to 383 after the paragraph-mode fix, to **354** once the BlockReader owned
every block-level decision — with #26 42 → 1, #27 18 → 1, #28 13 → 0, #29 7 → 0
and #4 10 → 0, and not one new case id in the manifest. The whole move is
measured in `docs/simplicity-metrics.md`, with
`bun run metrics -- --base 0298a2ba` — the commit this work started from. Two
rows, each with its scope, because the scorecard reports per layer and the two
are not the same layer: **`src/parse`'s peak cognitive complexity** fell 25 → 14
(and 25 is also what it measures at `main`, so the whole fall is this work's);
**`eslint-disable` comments over all of `src`** fell 47 → 25, of which
`src/parse` is 43 → 21.

Dropping Chevrotain (`bun run metrics -- --base 8c42f624`) is the follow-on
move, and it is measured the same way. `src/parse` code lines 3,957 → 3,259;
cognitive complexity SUM in `src/parse` 359 → 312, with the MAX flat at 14;
`eslint-disable` over `src` 25 → 10, of which `src/parse` is 21 → 6, and `as`
assertions 17 → 6; exported symbols 257 → 200; runtime dependencies 1 → 0, which
shows up as `dist/index.js` 113,986 → 96,864 bytes. The honest half of that
scorecard: the target for `src/parse` code lines was ≤ 2,900 and it was missed
by ~360 — see `docs/simplicity-metrics.md` on why a missed target is reported
rather than adjusted.

## Why no parser library

AsciiDoc is context-sensitive: the same character sequence means different
things depending on surrounding context. For example, `*` can be a bold marker
(constrained or unconstrained, depending on word boundaries), a list marker (at
line start), or literal text. The `----` delimiter starts a listing block, but
only if it matches a preceding opening delimiter. That is the problem a parser
library was supposed to help with.

### History: we used Chevrotain, and removed it

We used [Chevrotain](https://chevrotain.io/) for two years and removed it on
2026-08-21. It was the right call while the block layer was lexed: `CstParser`
accepts an externally built `IToken[]`, its custom token patterns could see
surrounding characters, and its error recovery produced a partial CST. Once the
BlockReader owned every block-level decision (the line-classifier work), none of
that was load-bearing any more. The grammar had 17 alternatives in its `block`
rule, each selected by one distinct token, no gates and one token of lookahead —
a table, spelled as a parser. The visitor copied fields. The CST was a
representation carrying nothing the frame stack did not already have.

What it cost, concretely: a `null`-returning `CustomPatternMatcherFunc`, a ban
on the `v` regex flag in any file defining token patterns, an inclusive
`endOffset` that every position helper had to correct, `IToken` leaking into the
inline builders, and a ~160 KB runtime dependency in a plugin that now has none.

### The alternatives we did NOT move to

- **A PEG generator (peggy / ohm).** PEG's automatic backtracking does not roll
  back mutable context — if a rule mutates state and then backtracks, the state
  stays mutated. And the official AsciiDoc team's
  [Peggy grammar research](https://github.com/opendevise/asciidoc-parsing-lab)
  has been in progress for years, covers roughly half the language, and remains
  "highly experimental."
- **`moo`, or parser combinators.** They would replace ~40 lines of loop with a
  dependency and the same impedance.
- **Keeping Chevrotain's lexer for inline only.** That keeps exactly the parts
  that fought us: the custom pattern matchers and the `v`-flag ban.

### What we gave up, deliberately

Two static checks, both real:

- `performSelfAnalysis()`'s construction-time LL(1) proof. Replacement: none. By
  the end there was nothing left to prove — every alternative was selected by
  one distinct token.
- The grammar acting as an independent check that the reader emitted its blocks
  in a well-formed order: a mis-ordered flush used to be a parse error, and now
  yields a different tree. Replacement: `tests/parser/ast-invariants.ts` —
  source-slice reconstruction, document order and line coverage, over the whole
  conformance corpus and 3,000 fuzzed documents — plus `scripts/parity.ts`,
  which compares formatted output and positioned ASTs against any revision.

Lexer modes, gates on parser alternatives, and patterns that read token history
are all ways to rebuild block context the BlockReader already has; having them
in four places at once is the mess the reader replaced.
`tests/parser/architecture.test.ts` still forbids each of them, under its
Chevrotain names — `push_mode`/`pop_mode`, `GATE:`, `BACKTRACK(`, `this.LA(`,
`CustomPatternMatcher`, `from "chevrotain"`. Two of its rows are
library-agnostic (a function taking the token history as its third parameter,
and a backwards search over a token array); the rest would need new rows to
catch the same shape under a different library's spelling.

## Why not Asciidoctor.js?

[Asciidoctor.js](https://github.com/asciidoctor/asciidoctor.js)
(`@asciidoctor/core` on npm) is the official JavaScript AsciiDoc processor. It's
designed for **one-way conversion** (AsciiDoc to HTML/PDF), not round-trip
formatting.

### What Prettier requires

1. **`locStart(node)` / `locEnd(node)`** returning character offsets from the
   start of the file for every node
2. **Source-faithful AST** — the tree must represent what was written, not what
   it means
3. **Comments as first-class data** — Prettier handles comment placement via
   position info
4. **Inline nodes with positions** — bold, italic, links, etc. must be
   individually addressable nodes with offsets

### What Asciidoctor.js cannot provide

- **Positions are line-only, no character offsets.** `getSourceLocation()`
  returns `{ lineno, file, dir, path }`. No column, no character offset.
  [Docs.](https://docs.asciidoctor.org/asciidoctor/latest/api/sourcemap/)
- **Inline content is opaque.** A paragraph gives `getSource()` as raw text.
  Inline nodes are only created during conversion to HTML, not during parsing.
- **Comments are discarded** during parsing. They don't appear in the document
  model.
- **Include directives are resolved.** The directive is replaced by included
  content.
- **Conditional directives are evaluated.** Only the surviving branch remains.
- **Attribute entries are consumed** into a document attributes map. Original
  lines are gone.
- **Block metadata is merged.** `[source,ruby]` and `[[anchor-id]]` become block
  attributes/id. Original syntax is lost.
- **No delimiter tracking.** A listing block gives `context: 'listing'`,
  `source: '...'` but no info on where `----` delimiters were or how long they
  were.
- **Sourcemap is explicitly limited.** "Does not track the source location for
  inline elements... or for attribute entries." "The sourcemap is not perfect."

### What we'd have to build on top

If we used Asciidoctor.js, we'd still need to:

1. Pre-process source to extract comments, includes, and conditionals
2. Post-process the model to compute character offsets by correlating back to
   source lines
3. Write our own inline parser
4. Track delimiters and block metadata by scanning source around each block
5. Work around lossy parsing of attribute entries

At that point, Asciidoctor.js handles maybe 30-40% of the work and we're
fighting it for the rest.

### Our approach instead

A custom source-preserving parser that directly produces the AST Prettier needs.
Correctness is checked differentially against Asciidoctor itself, over the
vendored corpus in `tests/conformance/` — Asciidoctor is the de facto reference
implementation, and the corpus is thousands of real documents rather than a
handful of hand-written pairs.

## References

- [Simplicity metrics](simplicity-metrics.md) — the scorecard `bun run metrics`
  prints, what each row means, and how each one is gamed
- [Prettier plugin API](https://prettier.io/docs/plugins#developing-plugins)
- [AsciiDoc syntax](https://docs.asciidoctor.org/asciidoc/latest/syntax-quick-reference/)
- [Prettier issue #5506 (AsciiDoc support)](https://github.com/prettier/prettier/issues/5506)
- [Chevrotain](https://chevrotain.io/) — the parser toolkit this plugin used
  until 2026-08-21; kept here for the history in
  [Why no parser library](#why-no-parser-library)
- [AsciiDoc parsing lab](https://github.com/opendevise/asciidoc-parsing-lab) —
  official PEG grammar research (informed our parser approach decision)
