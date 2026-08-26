# Architecture

How the plugin is built, top-down: what Prettier requires of a plugin, why we
satisfy those requirements with a hand-written parser, and how each stage of the
pipeline works. [CONTRIBUTING.md](../CONTRIBUTING.md) covers workflow;
[harnesses.md](harnesses.md) covers how changes are verified.

## What Prettier asks of a plugin

A Prettier plugin registers three things, all wired up in `src/index.ts`:

- **a language** — file extensions and a name, so Prettier routes `.adoc` files
  to us;
- **a parser** — `parse(text)` returning a tree, plus `locStart(node)` and
  `locEnd(node)` returning character offsets from the start of the file;
- **a printer** — `print(path)` walking that tree and returning Prettier's Doc
  IR, which Prettier's layout engine renders to text.

Prettier is agnostic about the tree. It never inspects node types or structure;
it calls `parse`, uses the offsets for range formatting and cursor tracking, and
hands the tree to the printer. So the AST's only obligations are the ones our
own printer and offset helpers have — which is why it is designed for a
formatter, not for the AsciiDoc language spec's semantic model.

Those three calls still impose real requirements:

1. **Character offsets on every node.** Line numbers are not enough: Prettier's
   `--range` and cursor tracking read offsets directly.
2. **A source-faithful tree.** The tree must represent what was written, not
   what it means. Comments, include and conditional directives, attribute
   entries, block metadata lines, and delimiter spellings must all survive as
   data — everything a semantic model deliberately discards, a formatter must
   keep.
3. **Inline nodes with positions.** Bold, italic, links, and macros must be
   individually addressable nodes, each with offsets.

### Why not Asciidoctor.js

[Asciidoctor.js](https://github.com/asciidoctor/asciidoctor.js)
(`@asciidoctor/core`) is the official JavaScript processor, and it is built for
one-way conversion to HTML, not round-tripping. It fails every requirement
above: positions are line-only (`getSourceLocation()` has no column and no
offset, and the sourcemap explicitly does not cover inline elements or attribute
entries); a paragraph's inline content is opaque source text, with inline nodes
created only during HTML conversion; comments are discarded; include directives
are resolved into their content; conditionals are evaluated down to the
surviving branch; attribute entries are consumed into a map; block metadata is
merged into attributes with the original syntax lost; and nothing records where
a delimiter was or how long it was. Repairing all of that from the outside means
re-parsing most of the document anyway, while fighting the processor's model.

So Asciidoctor is not our parser — it is our **oracle**. Correctness is checked
differentially against it over a vendored corpus (see [Testing](#testing)
below): Asciidoctor is the de facto reference implementation, and "renders the
same under Asciidoctor" is the strongest correctness statement available for a
format with no finished spec.

### Why a hand-written parser

AsciiDoc is context-sensitive. The same characters mean different things
depending on where they appear: `*` can open bold, mark a list item, or be
literal text; `----` closes a listing block only if a matching opener is
pending; a `.Title`-shaped line is a block title at a block boundary and plain
text inside a paragraph. A grammar-based tool has to smuggle that context in
through lexer modes, gates, or custom token patterns — which means the context
ends up living in several places at once.

Our parser is a line reader plus a small inline tokenizer: no grammar, no CST,
no visitor, and **no runtime dependency** (`prettier` is a peer dependency and
the only external in the bundle). Block-level context lives in exactly one
place, the reader, and a guard test enforces that (see
[the guard test](#the-guard-test-and-layer-rules)).

History, briefly: the plugin used [Chevrotain](https://chevrotain.io/) from its
first commit and removed it on 2026-08-21. It earned its keep while the block
layer was lexed, but once the reader owned every block-level decision the
grammar had decayed into a table spelled as a parser — 17 alternatives, each
selected by one distinct token — and the CST carried nothing the reader did not
already have. The alternatives we did not move to: PEG generators (peggy, ohm)
backtrack automatically but do not roll back mutated context, and the official
AsciiDoc team's own
[Peggy grammar research](https://github.com/opendevise/asciidoc-parsing-lab)
remains experimental and partial after years; `moo` and parser combinators would
replace a 40-line loop with a dependency. What we gave up was Chevrotain's
construction-time grammar analysis and the parse-error signal for a mis-ordered
block flush; the replacements are `tests/parser/ast-invariants.ts` (source-slice
reconstruction, document order, and line coverage over the whole corpus plus
fuzzed documents) and `scripts/parity.ts` (byte- and AST-identical output
against any base revision).

## The pipeline

```
source → splitLines → BlockReader(classifyLine) → AST → printer → Doc
```

Three properties hold along the pipeline:

1. **Decisions are made once, at the line that forces them.** What a held style
   line means for the block that follows — a masquerade, an admonition, a
   verbatim role — is resolved at the block's opening line and recorded on the
   node. No later pass re-derives it.
2. **Every composite construct is read extent-first.** Its full extent is
   collected at the line where Asciidoctor decides it, so nesting is never
   reconstructed after the fact and there is no frame stack to keep in step.
3. **The printer prints from recorded facts.** The author's own bytes where the
   construct is content, the spellings the AST stores, and records derived at
   ask time — never a replay of residue it does not understand.

The parser mirrors Asciidoctor's own Ruby (`lib/asciidoctor/parser.rb`, `rx.rb`,
`reader.rb`, at 2.0.26) structurally, and the code cites the Ruby it ports. When
our reading of the Ruby and the oracle disagree, the oracle wins.

## Line classification

The block layer is line-oriented: every block-level decision is made by
classifying a whole line in the context where it appears.

- **`src/parse/line-shapes.ts`** is the single registry of line shapes. Every
  regex that recognizes a line lives here and nowhere else, each row citing the
  Ruby it mirrors. The registry is keyed by four paragraph contexts —
  `paragraph`, `listItem`, `listContinuation`, `dlistItem` — because
  Asciidoctor's paragraphs are greedy: once open, a paragraph swallows every
  following line until a blank line or a small interrupting set, and that set
  differs by context.
- **`src/parse/lines/classify.ts`** is a pure function over the registry: it
  turns one line plus a `ReaderContext` into a `LineKind`, and it is the only
  thing that does. The context is three fields — the open paragraph shape, the
  open list styles, and whether this is the block's first line — because with no
  frame stack there is nothing else for a line to be classified against. There
  is no terminator vocabulary in it: a delimited block's closing line is matched
  while its extent is collected, before classification ever runs on an interior
  line.
- **The registry is oracle-pinned.** `tests/conformance/interruption.test.ts`
  checks every pattern against Asciidoctor in all four contexts and in both line
  positions (the block's first line, where `next_block` still gets to choose a
  context, and a later line, where it does not). Read the Ruby and add a row
  before adding a pattern; the oracle wins on disagreement.
- **Reflow safety consumes the same registry.** The printer's word-wrapping asks
  `isBlockSyntaxAtLineStart` (`src/print/reflow.ts`) about every word it might
  place at a line start, unioned over every context — so the parser and the
  formatter can never disagree about what would re-parse as block syntax.

Lines are rstripped before classification, exactly as Asciidoctor's
`Helpers.prepare_source_string` does, and the registry's patterns assume that.
The strip set is the six ASCII whitespace characters and nothing else, which is
the pinned oracle's: a trailing NUL or no-break space survives into the line the
rules match.

## The block reader

Parsing runs in three phases.

**Phase 1 — line splitting** (`src/parse/lines/split.ts`): take a leading
byte-order mark off the head of the document, then cut the source into lines,
rstripping each one while keeping the author's bytes and document offsets
alongside. Both normalizations are `prepare_source`'s; the mark is skipped
rather than cut out, so an offset still indexes the original source. The mark is
recorded on the document node and re-emitted by the printer, so the head bytes
round-trip: reading through a mark is not licence to delete it.

**Phase 2 — the `BlockReader`** (`src/parse/lines/reader.ts`): walk the lines
once, classify each in the open context, and build the AST directly through the
pure `(lines, index) → Node` constructors in `src/parse/build/`. There is no
separate tree-building pass and no post-parse repair pass.

Every composite construct is read extent-first, and what is not a composite is a
leaf:

- A **delimited block**'s whole extent is collected at its opening line
  (`src/parse/lines/delimited-reader.ts`, the shape of Ruby's `build_block`):
  the terminator is an exact line match, and a block still open at end of input
  is closed there. A verbatim interior becomes a slice of the source; a compound
  interior gets a fresh _confined_ `BlockReader` over the interior's subarray.
  Confinement is physical: a confined reader's lines end at its boundary, and
  the two boundary facts it needs (tail safety, the forced-close offset) travel
  as data in its `Confinement` record, not as stack state.
- A **list** takes the same shape through `src/parse/lines/list-reader.ts`, a
  port of Asciidoctor's `parse_list` → `parse_list_item` →
  `read_lines_for_list_item`. `itemExtent` collects one item's lines into Ruby's
  buffer; the reader re-parses each buffer with a confined `BlockReader`, so
  nesting composes with no list frame, no per-item object, and no cross-item
  state — the only mutable state is `itemExtent`'s five members, Ruby's four
  locals plus the buffer. Each block an item holds carries its verbatim `gap`:
  the `""` and `"+"` lines the author wrote in front of it.
- **Headings are leaves.** Sections are not modeled — there is no `section` node
  — so the document is a flat sequence of blocks the reader appends to, and
  nothing closes on a later, unpredictable line.

What a held style or attribute line makes of the block that follows — a
`[verse]` masquerade that flips a compound block to verbatim, a `[NOTE]` that
builds an example wrapper as an admonition, a verbatim role — is resolved once,
at the opening line, by `src/parse/lines/open-style.ts`, and the builders build
from that recorded decision. The held `[…]` line itself has one parser,
`src/parse/attrlist.ts`. `src/parse/lines/frames.ts` holds the vocabulary the
list layer and the reader share (the leaf and held-metadata builder tables) so
the two stay a DAG rather than an import cycle.

**Phase 3 — the inline tokenizer** (`src/parse/inline/`), described below.

### The guard test and layer rules

**Block-level context comes from the reader and from nowhere else.**
`tests/parser/architecture.test.ts` enforces that mechanically: it reads the
source of every file under `src/parse` and fails on the patterns that would
smuggle context in another way — currently a function signature taking token
history as a parameter, and any backwards search over an emitted array
(`.findLast`/`.findLastIndex` are banned outright under `src/parse`). The rules
are textual and blunt and they read comments too: if one fires on a comment,
reword the comment. A new parser library would need a new row; add one rather
than assuming the existing rows catch it.

The same test asserts zero import cycles and zero layer-rule violations, through
the same dependency-cruiser call `bun run metrics` gates on. The layers are a
DAG of directions (`LAYER_RULES` in `scripts/metrics/graph.ts`): `ast` ←
`constants`/`positions` ← `line-shapes` ← `inline/` ← `build/` ← `lines/`, with
`print/` importing `parse/` at exactly one address (`line-shapes.ts`, for reflow
safety) and `parse/` never importing `print/`. Every cross-directory symbol is
additionally named and given a reason in
`scripts/metrics/crossings-registry.json`, gated in both directions.

## The inline tokenizer

Inline content — bold, links, macros — lives within paragraph text and is
character-oriented, so it gets a tokenizer; the block layer never does.

Some implementations run two separate parsers (blocks, then inline over the
extracted text) and pay for it in fragile position rebasing and two trees to
merge. We keep **one coordinate space** instead: for each run of paragraph text,
the paragraph reader calls `tokenizeInline(text, baseOffset)`
(`src/parse/inline/tokenize.ts`), and because the base offset is the run's
position in the source, every token comes back already carrying a document
offset. Nothing is rebased afterwards.

The tokenizer itself is a ~40-line first-match-wins loop over the ordered rule
table in `src/parse/inline/rules.ts` — the single source of truth for inline
shapes, the way `line-shapes.ts` is for line shapes, each rule citing the
Asciidoctor source it mirrors (`substitutors.rb`, `rx.rb`). Its last rule
consumes one character, so it is total and cannot stall.
`inline-node-builder.ts` then pairs formatting marks into nested inline nodes;
keeping the pairing out of the tokenizer is what lets an unclosed mark stay
literal text instead of becoming an error. Where a line/column is needed, one
`LocationIndex` (`src/parse/positions.ts`), built once per document, answers by
binary search.

The constrained/unconstrained distinction (`*` vs `**`, `_` vs `__`) is one
`match` function over an `isBoundary` predicate: try the double mark first,
accept the single one only next to a word boundary. The boundary is computed
against the fragment handed to the tokenizer, never the document — an index
outside the fragment counts as a boundary, which is what makes `* *bold*` bold.
Reading surrounding characters is inline context; reading block history would be
block context, and the guard test forbids it.

## The AST

`src/ast.ts` declares every node kind; the census is pinned at **35** kinds by
`tests/parser/architecture.test.ts` — an equality pin, not a budget, so a new
kind fails the pin until it is deliberately moved. The file is the reference;
the shape of the tree in one paragraph:

A `document` holds a flat sequence of blocks. Headings are leaves with a `level`
(sections are not modeled). Paragraphs hold inline children. Lists hold items;
each item holds its marker spelling, its text, and its blocks, each block behind
its recorded `gap`. Delimited blocks carry their variant (listing, literal,
pass, verse, example, sidebar, quote, table) and form (delimited, indented,
paragraph); parent blocks hold parsed children; admonitions unify the paragraph
and delimited forms. Beyond those, the formatter-specific nodes are the ones a
semantic model would discard: comments, preprocessor directives (`include::`,
`ifdef`/`ifndef`/`ifeval`/ `endif`, kept as verbatim lines), block attribute
lists, block titles, block anchors, and `rawLine` (a verbatim line inside a
paragraph, so a comment between two text lines survives reflow). Inline nodes
cover the formatting marks (constrained and unconstrained), attribute
references, anchors, links and xrefs, inline macros, and hard line breaks.

Two deliberate gaps, tracked as issues rather than modeled halfway: tables pass
through as an opaque delimited block whose delimiter lines are content (#10),
and description lists have no node — their source is carried as paragraph text
(#9).

## The printer

`src/print/printer.ts` walks the AST and produces Doc IR. The Doc is mostly
literal strings, hardlines, and joins: line breaking inside a block is decided
_before_ the Doc exists, so the printer hands Prettier finished lines rather
than break opportunities.

That is not how plugins usually work — the expected shape is to emit `group` and
`line` builders (or, for prose, `fill`, which Prettier's own Markdown printer
uses for `proseWrap`) and let Prettier's layout engine decide the breaks. We
decide them ourselves out of necessity, for two reasons. First, break legality
in AsciiDoc is not width-driven: whether a break before a word is allowed
depends on what the word would mean at the position it lands (block syntax at
column 0, the `term::` hazard on a first line only, literal vs hard breaks
opening at different indents), and the layout engine has no hook for vetoing a
break by its landing position. Second, later printing decisions ask what a
printed line will re-read as — the list-hazard and sibling-separator logic below
— and that answer has to exist while the printer is still running, not after
Prettier has rendered the Doc.

### Reflow: the atom engine

`src/print/reflow.ts` turns a block's inline content into `Atom`s — a
newline-free text unit plus the local break facts about the join in front of it:
`glueLeft` (fuse, no space), `noBreakBefore`, `noBreakAfter`, and a three-valued
`breakBefore` (`"none" | "hard" | "literal"`, because a literal break opens its
line at column 0 while a hard break opens at the block's continuation indent).
Break decisions live where atoms are built; breaks exist only between atoms,
never inside a fused run.

`blockBody(atoms, width, indent)` is the one greedy packer. The paragraph
printer, the paragraph-form admonition body, and a list item's text all go
through it, so those bodies are one engine by construction rather than by
review. It measures a fused run whole before deciding a break (an over-long run
overruns on its own line, because no split of it reads back as the same
construct) and measures in columns via Prettier's own `getStringWidth`, so a
full-width character costs two and a combining mark costs none. Reflow safety
(see [Line classification](#line-classification)) keeps the packer from placing
a word where it would re-parse as block syntax.

### Joins between blocks

Blank-line policy between siblings lives in `src/print/join.ts` as named rules,
each with its rationale — for example, a level-0 heading always takes a blank
line after it, and a pseudo-anchor line never stacks directly above a heading
(the stacked pair re-parses as one joined line and the heading is destroyed).
Both are pinned by `tests/format/heading-adjacency.test.ts` and by the
shape-diff `heading-adjacency` grid.

### List separators

Inside a list, the separators are the AST's, not the printer's invention. The
default in `src/print/list.ts` is to print each recorded `gap` line for line —
which is what makes list formatting idempotent by construction — normalizing
only a blank run down to one blank, up to the gap's first `+` (the same rule
`joinBlocks` holds between blocks; a blank run after a `+` is what erases the
`+`, so shortening that one would change attachment). Every `+` the printer
emits is a replay of one the author wrote; a `+` at an item's end is not
replayed, because Ruby pops it and it renders nothing.

Above that default the printer holds exactly four separator decisions of its
own, each a named arm whose function comment carries the reasoning and the Ruby
citation (`printedGap`, `hazard`, `slurpReaches`, `printList` in
`src/print/list.ts` and `src/print/list-hazard.ts`). All four exist for one
reason: verbatim replay would not re-parse to the same tree there — a reflow
that would pull leading metadata onto the marker line, a nested list sharing its
parent's marker spelling, an indented literal whose re-read would slurp the
following marker, a previous item's tail that would swallow the next marker
line.

## Formatting policy

**Uniformity is the job; meaning is the constraint.** A formatter exists to
impose one canonical spelling — that is its entire value. "The output renders
the same as the input" is the safety condition on that imposition, never the
mission; taken as a mission, its optimum is the identity function. The rule,
exactly:

> Normalize, in a way that always preserves meaning.

Syntax is derived from the structure the reader recorded — emitted where the
structure requires it, elided where it does not — never replayed from the
author's habits. The model is parentheses in a code formatter: nobody preserves
the author's parens; the printer computes the parens the expression needs. The
blank line between sibling list items is this codebase's own example: canonical
form prints siblings adjacent, and the printer emits a blank exactly where the
previous item's tail would otherwise swallow the next marker on re-read.

Preserving an authored spelling is legitimate in exactly two cases:

1. **The bytes are content, not formatting syntax** — verbatim block interiors,
   comment text, a rejected-anchor line the oracle reads as paragraph text.
   Rewriting those edits the document.
2. **The spelling is structure-bearing and no uniform respelling has yet been
   proven meaning-preserving.** Then the authored spelling is the canonical form
   for that context — as a fact about our current derivations, not a policy.
   List markers are the live case: `ListNode.marker` holds what the classifier
   parsed, because sibling-matching is by style and ordered dot-count selects
   numbering, so a naive respell changes nesting (issue #42 is the scar).
   Nesting depth is derived from the spelling and stored nowhere.

Every preservation site under case 2 is a normalization candidate. The question
per construct is never "may we normalize?" but "what derivation preserves the
meaning?" — decided per construct, landed with render-equality proofs.

## Error handling

There is no invalid AsciiDoc: any text file parses, and at worst an unrecognized
construct renders as a paragraph. Asciidoctor never rejects input, and neither
do we.

- **The reader is total.** Every input produces a `DocumentNode`. Any line no
  rule claims opens a paragraph, a delimited block still open at end of input is
  force-closed there, and a character no inline rule matches is one character of
  plain text by definition. There is no failure mode, no partial tree, and no
  recovery concept.
- **Nothing in `src` throws.** States that are impossible only because two
  places agree — an inline dispatch and its rule table, a scan and a re-parse —
  are made unrepresentable instead: one derivation, recorded where the fact is
  known, so there is no second place to drift. The `unreachable()` thrower that
  used to guard such states has no call sites left; the metrics defense
  inventory counts them, currently zero.
- **The policy:** on the parse path, malformed input never throws; a state two
  places must agree on is made unrepresentable where a design does it, and
  throws via a can't-happen guard where none does yet; and a deliberate silent
  degrade must state its blast radius in a `Total fallback:` comment — what is
  lost, bounded how — so a reader can weigh the degrade against the throw it
  replaces.

## Testing

Two halves, split by what a test may reach:

- **Unit tests** pair one-to-one with a module (`tests/parser/build/`,
  `tests/print/`) and may reach its `@internal` surface — exports that exist for
  the test, tagged and saying so. A unit test failing names the module that
  broke.
- **Integration tests** organize by behavior and go through public entry points
  only (`tests/format/` asserts on formatted bytes against fixtures;
  `tests/conformance/` does the same with an external authority). They never
  import an `@internal` export — if one is tempting, the behavior under test has
  no entry point, and that is the finding.

On top of the suite sits the differential net: `tests/conformance/` runs three
properties over 1,614 vendored corpus cases (no crash, idempotency, and render
fidelity against the `@asciidoctor/core` oracle, pinned at 2.0.26), with known
failures quarantined by issue in `quarantine.json`; the shape grids verify
constructs the corpus is blind to; and `scripts/parity.ts` proves a refactor
changed no output byte. [harnesses.md](harnesses.md) covers all of it — what
each harness proves and when to reach for which.

## Tech stack

- **No runtime dependencies** — `prettier` is a peer dependency and the only
  bundle external.
- TypeScript, strict, ES2024 target; ESM (`"type": "module"`).
- `Bun.build` via `scripts/build.ts` bundles into `dist/`.
- Vitest for tests (always through `bun run test`, never bare `bun test`).
- ESLint 10 with typescript-eslint strict, eslint-config-love,
  eslint-config-prettier, eslint-plugin-jsdoc, eslint-plugin-unicorn, and
  @vitest/eslint-plugin.
- `vendor/` holds the Asciidoctor conformance corpus, refreshed by
  `bun run vendor` at a pinned commit.

## References

- [Prettier plugin API](https://prettier.io/docs/plugins#developing-plugins)
- [AsciiDoc syntax quick reference](https://docs.asciidoctor.org/asciidoc/latest/syntax-quick-reference/)
  and the
  [AsciiDoc language project](https://gitlab.eclipse.org/eclipse/asciidoc-lang/asciidoc-lang)
- Asciidoctor's Ruby source (`lib/asciidoctor/parser.rb`, `rx.rb`, `reader.rb`)
  — the implementation the parser mirrors and cites
- [Prettier issue #5506](https://github.com/prettier/prettier/issues/5506) — the
  long-standing AsciiDoc plugin request
- [AsciiDoc parsing lab](https://github.com/opendevise/asciidoc-parsing-lab) —
  the official PEG grammar research that informed the no-parser-library decision
