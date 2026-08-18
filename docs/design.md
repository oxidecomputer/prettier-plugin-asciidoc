# Design

An opinionated Prettier plugin for formatting AsciiDoc files, analogous to what
Prettier does for Markdown. Enforces consistent style, reflows prose, normalizes
spacing, and produces clean diffs.

## Architecture

```
source text → Lexer → Parser → CST → AST Builder → AST → Printer → formatted output
                                                           ↓
                                                      toASG() → TCK validation (test-time only)
```

### Parser

A custom, source-preserving parser built with
[Chevrotain](https://chevrotain.io/) in TypeScript. See
[Why Chevrotain?](#why-chevrotain) and
[Why not Asciidoctor.js?](#why-not-asciidoctorjs) below.

Parsing happens in three phases:

1. **Lexer** (`src/parse/tokens.ts`): Tokenizes source text. Uses lexer modes
   for context-sensitive tokenization (e.g., verbatim block content vs. normal
   text) and custom token patterns for ambiguous characters (e.g., `*` as bold
   marker vs. list marker).

2. **Parser** (`src/parse/grammar.ts`): A `CstParser` subclass that defines
   grammar rules over the token stream. Uses gates for context-sensitive parsing
   decisions. Produces a Concrete Syntax Tree (CST).

3. **AST Builder** (`src/parse/ast-builder.ts`): A CST visitor that constructs
   our Prettier-friendly AST. Every node carries character offsets
   (`locStart`/`locEnd`), comments and directives are first-class nodes, and the
   tree is faithful to the source syntax.

### Printer

Walks the AST and produces Prettier Doc IR using `group`, `indent`, `line`,
`hardline`, `softline`, `fill`, `join`, etc.

### TCK validation (test-time only)

A `toASG()` function converts our AST to the official AsciiDoc ASG format. This
is a lossy projection — it strips comments, blank lines, attribute entries,
directives, and other formatter-specific nodes. The result is validated against
the ASG schema and compared to TCK expected outputs.

This validates that our parser interprets AsciiDoc structure correctly (section
nesting, list hierarchy, inline formatting, etc.) without constraining our AST
design.

`toASG()` and any TCK dependencies are dev-only — they don't ship with the
plugin.

## Three levels of tree representation

```
Chevrotain CST → AST (ours) → ASG (spec's)
   all syntax      source-preserving    semantic-only
```

**Chevrotain's CST** is produced automatically by the parser. Nodes correspond
1:1 to grammar rules and contain flat bags of tokens. You could reconstruct the
original text from it, but the uniform structure (`children.InlineText[0]`,
`children.InlineNewline[1]`, etc.) is awkward to work with.

**Our AST** (`src/ast.ts`) has typed, semantic nodes — `SectionNode` with a
`level` property, `ParagraphNode` with inline children, etc. The AST Builder
visitor transforms the CST into this shape. This is what we hand to Prettier.

**The ASG** is the official AsciiDoc Abstract Semantic Graph. It's a lossy
projection of our AST — comments, directives, attribute entries, and block
metadata are stripped. We produce it at test time via `toASG()` for TCK
conformance validation.

Prettier's plugin API is AST-agnostic: it calls `parse()` to get a tree,
`locStart(node)`/`locEnd(node)` to get character offsets, and `print(path)` to
walk the tree and emit Doc IR. It doesn't inspect node types or tree structure.
We could skip the AST Builder and write the printer against the raw CST, but the
typed AST is much cleaner to work with and lets us share the tree with
`toASG()`.

## AST

Our AST is designed for Prettier, not for the AsciiDoc ASG spec. It preserves
everything a formatter needs, including constructs the ASG intentionally
discards.

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

**Formatter-specific nodes (not in ASG):**

- `comment` — line (`//`) and block (`////`)
- `includeDirective` — `include::path[]`
- `conditionalDirective` — `ifdef`, `ifndef`, `ifeval`, `endif`
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

**TCK conformance** (`tests/tck/`): Runs `toASG()` against the vendored AsciiDoc
TCK fixtures (`vendor/asciidoc-tck/tests/`). The TCK has roughly a dozen
input/output pairs covering basic paragraphs, one section, one list, one listing
block, one sidebar, one header, and two inline cases. It's a conformance smoke
test — validates that our ASG output matches the spec's expected shape — but far
too thin for unit test coverage. We don't depend on it growing; our own tests
are the source of truth.

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

- **Lexer failures** produce unrecognized text spans that flow through as
  verbatim content, not exceptions.
- **Parser failures** use Chevrotain's built-in error recovery (token insertion,
  deletion, repetition re-sync, general re-sync) to produce a partial CST. The
  AST builder preserves recovered regions as raw text.
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

The block-level parser is line-oriented: tokens are identified by start-of-line
patterns (`^== `, `^* `, `^----$`, etc.) and the grammar describes how blocks
nest. Inline content — bold, italic, links, macros — lives _within_ paragraph
text and is character-oriented.

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

### Chosen approach: unified grammar with Chevrotain lexer modes

We already use Chevrotain's `MultiModeLexer` with modes for verbatim content
(`listing_verbatim`, `literal_verbatim`, `pass_verbatim`, `block_comment`). The
inline parser extends this pattern by adding an `inline` lexer mode.

The mode transitions:

- **`default_mode` → `inline`**: When the lexer encounters the start of
  paragraph text, a list item's text content, a block title, or any other
  context where inline markup is valid, it pushes into `inline` mode via
  `InlineModeStart`. In this mode, `*` produces a `BoldMark` token, plain text
  becomes `InlineText` tokens, and block-level tokens like `ListingBlockOpen`
  don't exist.
- **`inline` → `default_mode`**: When the lexer hits a blank line or structural
  boundary (block delimiter, heading marker, list marker at the start of a new
  item), it pops back to `default_mode`.
- **`inline` → verbatim modes**: Inline passthrough (`+text+`, `pass:[...]`)
  suppresses further inline tokenization within its content. This may use a
  dedicated mode or be handled by the custom token matchers.

The grammar is unified: block-level rules call inline rules naturally.

```
paragraph()    → MANY(inlineContent)
inlineContent() → boldSpan | italicSpan | monoSpan | link | text | ...
boldSpan()     → BoldOpen, MANY(inlineContent), BoldClose
```

This preserves position tracking (one lexer, one coordinate space), produces a
single CST, and lets the AST builder visitor handle both block and inline nodes
in one pass.

### Custom token patterns for context-sensitive marks

The constrained/unconstrained distinction for formatting marks (`*` vs `**`, `_`
vs `__`, etc.) requires Chevrotain custom token pattern matchers. A constrained
bold open (`*`) is only valid at a word boundary — preceded by whitespace,
punctuation, or start of text. The custom matcher function receives the full
text and current offset, allowing it to inspect surrounding characters.

These matchers are substantial enough to warrant their own file
(`src/parse/inline-mark-pattern.ts`) but they register as token definitions in
the `inline` lexer mode — they're not a separate lexer. The AST building logic
that pairs formatting marks into nested spans lives in
`src/parse/inline-node-builder.ts`.

### What stays in separate files

The custom inline mark patterns (`src/parse/inline-mark-pattern.ts`) and the
inline AST builder (`src/parse/inline-node-builder.ts`) live in their own files
because they are substantial. The inline grammar rules live in
`src/parse/grammar.ts` alongside the block-level rules — they're methods on the
same parser class. "Separate files" is about code organization, not separate
parser instances.

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

Chevrotain provides purpose-built machinery for context-sensitive parsing:

- **Custom token patterns**: Matcher functions that receive all previously
  matched tokens, enabling context-aware tokenization (e.g., distinguishing
  constrained vs. unconstrained bold based on the preceding token).
- **Lexer modes**: A mode stack for switching tokenization rules when
  entering/leaving verbatim blocks, passthroughs, etc.
- **Gates**: Predicate functions on parser alternatives that can check any
  parser state before attempting a branch.
- **Built-in error recovery**: Four strategies (token insertion, deletion,
  repetition re-sync, general re-sync) that produce partial CSTs with
  `recoveredNode` flags. Critical for a formatter that must handle malformed
  input gracefully.
- **Native TypeScript**: The grammar IS TypeScript code — full IDE support, type
  checking, refactoring.
- **CST + visitor pattern**: Clean separation between parsing and AST
  construction. We use one CST with two visitors: the AST builder (for Prettier)
  and `toASG()` (for TCK validation).

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
We validate correctness against the official AsciiDoc TCK, which provides
input/output test pairs in ASG format. The ASG is a lossy semantic
representation — our AST is a superset of it, and `toASG()` projects down.

## References

- [Prettier plugin API](https://prettier.io/docs/plugins#developing-plugins)
- [AsciiDoc syntax](https://docs.asciidoctor.org/asciidoc/latest/syntax-quick-reference/)
- [ASG schema](https://gitlab.eclipse.org/eclipse/asciidoc-lang/asciidoc-lang/-/tree/main/asg)
- [ASG spec discussion](https://gitlab.eclipse.org/eclipse/asciidoc-lang/asciidoc-lang/-/issues/7)
- [TCK repo](https://gitlab.eclipse.org/eclipse/asciidoc-lang/asciidoc-tck)
- [Prettier issue #5506 (AsciiDoc support)](https://github.com/prettier/prettier/issues/5506)
- [Chevrotain](https://chevrotain.io/) — parser toolkit used for our lexer and
  grammar
- [AsciiDoc parsing lab](https://github.com/opendevise/asciidoc-parsing-lab) —
  official PEG grammar research (informed our parser approach decision)
