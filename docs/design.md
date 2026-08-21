# Design

An opinionated Prettier plugin for formatting AsciiDoc files, analogous to what
Prettier does for Markdown. Enforces consistent style, reflows prose, normalizes
spacing, and produces clean diffs.

## Architecture

```
source → splitLines → BlockReader(classifyLine) → IToken[] → CstParser → CST → AST Builder → AST → Printer
```

### Parser

A custom, source-preserving parser built with
[Chevrotain](https://chevrotain.io/) in TypeScript. See
[Why Chevrotain?](#why-chevrotain) and
[Why not Asciidoctor.js?](#why-not-asciidoctorjs) below.

Parsing happens in four phases:

1. **Line splitting** (`src/parse/lines/split.ts`): Cuts the source into lines,
   rstripping each one exactly as `Helpers.prepare_source_string` does while
   keeping the author's bytes and the document offsets alongside.

2. **BlockReader** (`src/parse/lines/reader.ts`): Walks those lines ONCE with an
   explicit frame stack that mirrors Asciidoctor's reader (`Parser.next_block`,
   `read_paragraph_lines`, `read_lines_for_list_item`, `read_lines_until`),
   classifying each line against the registry in `src/parse/line-shapes.ts` with
   the open context in hand. It emits one pre-classified token per line, plus
   zero-length boundary tokens (`ParagraphStart`/`ParagraphEnd`, `ItemEnd`,
   `ListEnd`, `SectionEnd`, `UnclosedEnd`) that spell out every nesting
   decision. Paragraph text is the one thing still lexed: the reader runs the
   single-mode inline lexer (`src/parse/tokens.ts`) over each run of paragraph
   lines and splices the rebased inline tokens between the paragraph's
   boundaries. Lists are read by `src/parse/lines/list-reader.ts` and
   `list-frames.ts`, over per-item state (`Item`) from `list-item.ts`.
   `src/parse/lines/frames.ts` holds the frame and reader types they share with
   `reader.ts`, plus the held-metadata predicate both the reader and the list
   layer consult, so those three modules stay a DAG rather than an import cycle.

3. **Parser** (`src/parse/grammar.ts`): A `CstParser` subclass whose input is
   that token array rather than a lexer's output. Because the reader has already
   decided where everything ends, each rule is LL(1) on a distinct first token:
   no gates, no re-absorbing options, nothing that derives block context.
   `tests/parser/architecture.test.ts` is the mechanical guard on that.

4. **AST Builder** (`src/parse/ast-builder.ts`): A CST visitor that constructs
   our Prettier-friendly AST. Every node carries character offsets
   (`locStart`/`locEnd`), comments and directives are first-class nodes, and the
   tree is faithful to the source syntax.

### Printer

Walks the AST and produces Prettier Doc IR using `group`, `indent`, `line`,
`hardline`, `softline`, `fill`, `join`, etc.

## Two levels of tree representation

```
Chevrotain CST → AST (ours)
   all syntax      source-preserving
```

**Chevrotain's CST** is produced automatically by the parser. Nodes correspond
1:1 to grammar rules and contain flat bags of tokens. You could reconstruct the
original text from it, but the uniform structure (`children.InlineText[0]`,
`children.InlineNewline[1]`, etc.) is awkward to work with.

**Our AST** (`src/ast.ts`) has typed, semantic nodes — `SectionNode` with a
`level` property, `ParagraphNode` with inline children, etc. The AST Builder
visitor transforms the CST into this shape. This is what we hand to Prettier.

Prettier's plugin API is AST-agnostic: it calls `parse()` to get a tree,
`locStart(node)`/`locEnd(node)` to get character offsets, and `print(path)` to
walk the tree and emit Doc IR. It doesn't inspect node types or tree structure.
We could skip the AST Builder and write the printer against the raw CST, but the
typed AST is much cleaner to work with.

## AST

Our AST is designed for Prettier, not for the AsciiDoc language spec's semantic
model. It preserves everything a formatter needs, including constructs a
semantic model intentionally discards.

**Block nodes:**

- `document` — root, contains header blocks + body blocks
- `documentTitle` — the `= Title` line
- `attributeEntry` — `:key: value` lines
- `section` — heading + child blocks
- `paragraph` — text content containing inline nodes
- `list` — ordered, unordered, callout, description
- `listItem` — marker + text + optional nested blocks
- `dlistItem` — term + description
- `listingBlock`, `literalBlock`, `passBlock`, `stemBlock`, `verseBlock` — leaf
  blocks (delimited, indented, or paragraph form). Backtick-fenced code blocks
  (` ``` `) are parsed as `listingBlock` and normalized to `----` in output.
- `admonitionBlock`, `exampleBlock`, `sidebarBlock`, `openBlock`, `quoteBlock` —
  parent blocks. Admonitions include both the 5 standard types and arbitrary
  custom styles (e.g., `[EXERCISE]`).
- `blockMacro` — image, video, audio, toc
- `table` — rows, cells, column specs
- `thematicBreak`, `pageBreak`

**Formatter-specific nodes (no semantic-model equivalent):**

- `comment` — line (`//`) and block (`////`)
- `preprocessorDirective` — one verbatim line the reader eats:
  `include::path[]`, `ifdef`, `ifndef`, `ifeval`, `endif`
- `blockAttributeList` — `[source,ruby]`, `[#id.role%option]`

**Inline nodes:**

- `text` — plain text
- `bold`, `italic`, `monospace`, `highlight` — constrained and unconstrained
  forms
- `superscript`, `subscript`
- `inlineAnchor` — `[[id]]` or `[[id, reftext]]` (standalone on a line acts as
  block metadata)
- `link`, `xref` — references
- `inlineMacro` — `image:`, `kbd:`, `btn:`, `menu:`, `footnote:`, etc.
- `inlinePassthrough` — `+text+`, `pass:[]`
- `charRef` — character references and replacements
- `lineBreak` — hard line break (`+` at end of line)

**Block masquerading:** A style attribute on a delimited block can change its
effective content model. For example, `[verse]` on a `____` block switches it
from compound (parsed as AsciiDoc) to verbatim (line breaks preserved). `[stem]`
on `++++` switches from raw passthrough to math notation. `[NOTE]` on `====`
turns an example block into an admonition container. The parser must check the
preceding `blockAttributeList` to determine each block's effective content model
— otherwise it risks reflowing verbatim content or failing to parse compound
content. See the full masquerade table in `docs/asciidoc-format.md`.

## Testing strategy

Two separate layers with different purposes:

**Unit tests** (`tests/parser/`, `tests/format/`): Written per feature, test our
AST and formatted output directly. These provide real coverage — every
construct, edge cases, position tracking, formatting normalization. Fixtures
live alongside the tests in `tests/format/fixtures/`.

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
- **Parser failures** use Chevrotain's built-in error recovery (token insertion,
  deletion, repetition re-sync, general re-sync) to produce a partial CST. Where
  recovery leaves an empty block node behind, the AST builder emits an empty
  placeholder paragraph whose position spans the whole document
  (`src/parse/ast-builder.ts`) — the parse finishes instead of crashing, but the
  text of that region is not preserved.
- **AST builder assertions** for "impossible" states (e.g., a grammar rule
  matched but its expected token is missing) are genuine bugs in our parser —
  these can throw, since they indicate a logic error we need to fix, not bad
  input.

The only legitimate throw is if a file is not AsciiDoc at all (e.g., binary
content), and even then Prettier's own infrastructure handles that before we're
called.

Chevrotain has four built-in recovery strategies (disabled by default, enabled
via `recoveryEnabled: true` in the parser constructor):

1. **Single token insertion** — if token Y is expected but token X is found, and
   X would be valid after Y, the parser inserts a virtual Y and continues.
2. **Single token deletion** — if an unexpected token X appears but the expected
   token Y immediately follows it, the parser skips X.
3. **Repetition re-sync** — inside `MANY`/`AT_LEAST_ONE`, the parser skips
   tokens until it finds the start of the next iteration or the token expected
   after the repetition. This lets later items in a sequence parse correctly
   even if an earlier item is corrupted.
4. **General re-sync** — when the above strategies fail, the parser skips tokens
   until it reaches a synchronization point higher in the rule stack. This is
   the most lossy strategy but prevents a single bad construct from aborting the
   entire parse.

When recovery fires, the resulting CST node is marked with `recoveredNode: true`
and may have incomplete children (only the content parsed before the error). The
AST builder must handle these defensively — it cannot assume all expected tokens
are present on a recovered node.

## Inline parser architecture

The block layer is line-oriented: the BlockReader classifies each line by its
start-of-line shape (`^== `, `^* `, `^----$`, etc.) in the context its frame
stack is in, and decides there where every block begins and ends, emitting
zero-length boundary tokens to say so. The grammar is mechanical — it consumes
those boundaries, it does not decide nesting. Inline content — bold, italic,
links, macros — lives _within_ paragraph text and is character-oriented.

### Why not a separate parser?

Some AsciiDoc implementations (notably tree-sitter-asciidoc) use two separate
grammars: one for blocks, one for inline content within blocks. The block parser
emits raw text, and a second parser tokenizes and parses that text
independently. This works but has real downsides:

- **Position tracking gets fragile.** The inline parser receives strings with
  offsets relative to the paragraph start, not the document start. We'd need to
  translate positions back, and every off-by-one is a bug in Prettier's
  `locStart`/`locEnd`.
- **Two CSTs to merge.** The AST builder would need to combine output from two
  parsers into a single tree — awkward and error-prone.
- **Wasted tokenization.** A two-parser approach would tokenize paragraph
  content once at the block level, then re-tokenize it from scratch for inline
  markup.

### Chosen approach: one grammar, one coordinate space

The inline layer is lexed, the block layer is not. The BlockReader hands the
parser a token array in which every block-level line is already classified, and
for each run of paragraph text it runs the single-mode inline lexer
(`inlineLexer` in `src/parse/tokens.ts`) over that run alone and rebases the
resulting tokens to document coordinates before splicing them in. So there is
one vocabulary, one coordinate space and one CST, and the inline tokens live
between the paragraph's `ParagraphStart`/`ParagraphEnd` boundaries.

This replaced a `MultiModeLexer` whose `default_mode` classified block lines and
whose `inline` mode was entered by an `InlineModeStart` token. Two modes meant
two classification systems that had to be kept in agreement, and the block half
kept having to reconstruct context it could not see — see "Line classification
is contextual" below.

The grammar does not describe inline structure at all. There are no span rules:
one flat `inlineToken` rule (`src/parse/grammar.ts`) matches any single token of
the inline vocabulary, and the paragraph rules repeat it.

```
paragraph()     → ParagraphStart, paragraphBody, ParagraphEnd
paragraphBody() → MANY(inlineToken | InlineNewline | RawLine)
inlineToken()   → BoldMark | ItalicMark | MonoMark | InlineMacro | InlineText | ...
```

Marks are paired into nested spans afterwards, by `inline-node-builder.ts`,
which walks the flat token run the AST builder hands it. Keeping the pairing out
of the grammar is what lets a mark that never closes stay literal text without a
parse error. What the single grammar buys is position tracking (one coordinate
space, into which the inline tokens are rebased) and a single CST that the AST
builder visitor walks in one pass.

### Custom token patterns for context-sensitive marks

The constrained/unconstrained distinction for formatting marks (`*` vs `**`, `_`
vs `__`, etc.) requires Chevrotain custom token pattern matchers. A constrained
bold open (`*`) is only valid at a word boundary — preceded by whitespace,
punctuation, or start of text. The custom matcher function receives the full
text and current offset, allowing it to inspect surrounding characters.

These matchers are substantial enough to warrant their own file
(`src/parse/inline-mark-pattern.ts`) but they register as token definitions in
the inline vocabulary — they're not a separate lexer. They read the surrounding
CHARACTERS, which is inline context; reading the token history would be block
context, and `tests/parser/architecture.test.ts` forbids it. The AST building
logic that pairs formatting marks into nested spans lives in
`src/parse/inline-node-builder.ts`.

### What stays in separate files

The custom inline mark patterns (`src/parse/inline-mark-pattern.ts`) and the
inline AST builder (`src/parse/inline-node-builder.ts`) live in their own files
because they are substantial. The inline grammar rules live in
`src/parse/grammar.ts` alongside the block-level rules — they're methods on the
same parser class. "Separate files" is about code organization, not separate
parser instances.

## Line classification is contextual

Asciidoctor's paragraphs (and list items, and dlist descriptions) are greedy:
once open, they swallow every following line until a blank line or a tiny
interrupting set. Five rules keep the reader and reflow honest about that:

1. Paragraph extent is decided by the BlockReader
   (`src/parse/lines/paragraph-reader.ts`), which asks
   `src/parse/line-shapes.ts` about each line WITH the open context in hand and
   closes the paragraph with an explicit `ParagraphEnd` — never by re-running
   the top-level line classifier.
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

**Why.** The lexer used to re-classify every line as if it stood at the top of a
block, so a `.Title`-shaped or `* item`-shaped line mid-paragraph became a block
title or a list, and `InlineNewline` simply popped back to the block mode to do
it again on the next line. That inversion is the root of gap issues #26, #27,
and #29 (line comments, block-title-looking lines, and indented continuations
each splitting one paragraph or list into several). The differential conformance
suite (#7) is the evidence: the quarantine manifest went from 519 cases on the
release before this work, to 383 after the paragraph-mode fix, to **354** once
the BlockReader owned every block-level decision — with #26 42 → 1, #27 18 → 1,
#28 13 → 0, #29 7 → 0 and #4 10 → 0, and not one new case id in the manifest.
The whole move is measured in `docs/simplicity-metrics.md`, with
`bun run metrics -- --base 0298a2ba` — the commit this work started from. Two
rows, each with its scope, because the scorecard reports per layer and the two
are not the same layer: **`src/parse`'s peak cognitive complexity** fell 25 → 14
(and 25 is also what it measures at `main`, so the whole fall is this work's);
**`eslint-disable` comments over all of `src`** fell 47 → 25, of which
`src/parse` is 43 → 21.

## Why Chevrotain?

AsciiDoc is context-sensitive: the same character sequence means different
things depending on surrounding context. For example, `*` can be a bold marker
(constrained or unconstrained, depending on word boundaries), a list marker (at
line start), or literal text. The `----` delimiter starts a listing block, but
only if it matches a preceding opening delimiter.

We evaluated three approaches:

### Hand-written recursive descent

Full control, but requires building tokenization, error recovery, and position
tracking from scratch. No leverage from existing parser infrastructure.

### Peggy (PEG parser generator)

Has escape hatches (semantic predicates, actions), but PEG's automatic
backtracking conflicts with mutable state — if a rule mutates context and then
backtracks, the state is not rolled back. The official AsciiDoc team's
[Peggy grammar research](https://github.com/opendevise/asciidoc-parsing-lab) has
been in progress for years, covers roughly half the language, and remains
"highly experimental." No built-in error recovery.

### Chevrotain (parser toolkit) — chosen

Chevrotain is what we build the tree-assembly layer on:

- **A parser you can feed directly**: `CstParser` takes an `IToken[]` — it does
  not insist on being driven by its own lexer — which is what lets the
  BlockReader own every block-level decision and leaves the grammar mechanical.
- **Custom token patterns**: Matcher functions that receive the text and the
  current offset, enough to distinguish constrained from unconstrained bold by
  the surrounding characters.
- **Built-in error recovery**: Four strategies (token insertion, deletion,
  repetition re-sync, general re-sync) that produce partial CSTs with
  `recoveredNode` flags. Critical for a formatter that must handle malformed
  input gracefully.
- **Native TypeScript**: The grammar IS TypeScript code — full IDE support, type
  checking, refactoring.
- **CST + visitor pattern**: Clean separation between parsing and AST
  construction. One CST, one visitor — the AST builder. Nothing downstream of
  the builder sees the CST (see "Two levels of tree representation").

Chevrotain also offers lexer modes, gates on parser alternatives, and custom
patterns that receive the token history. We deliberately use NONE of the three:
each is a way to rebuild block context that the BlockReader already has, and
having them in four places at once is the mess the reader replaced. See
`tests/parser/architecture.test.ts`.

The trade-off is bundle size (~160 KB runtime dependency), which is irrelevant
for a Node.js Prettier plugin.

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
- [Chevrotain](https://chevrotain.io/) — parser toolkit used for our grammar and
  inline lexer
- [AsciiDoc parsing lab](https://github.com/opendevise/asciidoc-parsing-lab) —
  official PEG grammar research (informed our parser approach decision)
