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
  IR, which Prettier's layout engine renders to text, plus
  `getVisitorKeys(node)` naming the properties that hold children.

Prettier is agnostic about the tree's vocabulary: it knows no AsciiDoc node
type. It calls `parse`, hands the tree to the printer, and for cursor tracking
walks the tree itself, following `getVisitorKeys` and reading the offsets at
each step. So the AST's only obligations are the ones our own printer, offset
helpers and key table have — which is why it is designed for a formatter, not
for the AsciiDoc language spec's semantic model.

Those calls still impose real requirements:

1. **Character offsets on every node.** Line numbers are not enough: Prettier's
   `--range` and cursor tracking read offsets directly.
2. **A source-faithful tree.** The tree must represent what was written, not
   what it means. Comments, include and conditional directives, attribute
   entries, block metadata lines, and delimiter spellings must all survive as
   data — everything a semantic model deliberately discards, a formatter must
   keep.
3. **Inline nodes with positions.** Bold, italic, links, and macros must be
   individually addressable nodes, each with offsets.
4. **A declared key table.** `src/print/visitor-keys.ts` names, per node kind,
   the properties Prettier's own walk may follow. Undeclared, the walk descends
   into every enumerable property, and `position` is the first one it meets:
   Prettier calls `locStart` on the `{start, end}` object itself, reads that
   object's own `position` as `undefined`, and throws dereferencing
   `undefined.start` -- it never gets as far as the `{offset, line, column}`
   points inside. That is `formatWithCursor` throwing on every document (issue
   #37). The table is derived from the AST types at compile time and
   cross-checked against real parse trees in `tests/print/visitor-keys.test.ts`.

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

Wherever the parser makes a decision about what a document means, the code cites
Asciidoctor's Ruby (`lib/asciidoctor/parser.rb`, `rx.rb`, `reader.rb`, at
2.0.26) as specifically as it can - the exact lines that decide the same
question there. That Ruby is vendored at `vendor/asciidoctor-ruby/`, so a cited
line is one `Read` away. `bun run citation-check` reads every line reference in
those comments and holds the ones that name a file (207 of the 292 it reads) to
that file and line; the other 85 are bare references in comments that name none,
and it reports them unchecked rather than guessing which file they meant.

The oracle is not that Ruby. `@asciidoctor/core` 4.0.11 is, its own README says,
"a native JavaScript implementation of Asciidoctor" whose "code was generated
from the Ruby source using Claude Code (claude-sonnet-4-6) and reviewed by a
human", and Ruby 2.0.26 is the reference its behaviour tracks. Where the two
programs agree, that result binds. Where they disagree, neither binds and the
simplest behaviour is ours to choose, recorded in a comment that names both
readings and says which reading the code follows, or that it follows neither,
and why: `5. five` / `6. six` is one such place, because the JavaScript program
resolves an ordered list's `start` attribute and Ruby 2.0.26 sets none. "The two
authorities" in `docs/coding-standards.md` says what that comment has to say. A
harness renders the corpus through both programs and pins the disagreements it
finds.

Citing the Ruby is not mirroring it: only the semantics bind, and the code's own
structure, data, and policy are decided here. The tree models no sections,
because a formatter reprints headings where a converter needs a hierarchy; the
block-structure ledger's `oracle:*` family records constructs the oracle
resolves (conditionals, attribute values) that a formatter must keep; and the
printer's canonical spellings come from the formatting policy below, not from
anything the reference implementation does. Where a design choice differs from
the reference's, render-equality is what proves the difference safe.

## Line classification

The block layer is line-oriented: every block-level decision is made by
classifying a whole line in the context where it appears.

- **`src/parse/line-shapes.ts`** is the registry of line shapes, together with
  its named `line-shapes-*.ts` siblings: a row family moves into one of those
  whole when the main table nears its `max-lines` ceiling. Every regex that
  recognizes a line lives in one of those modules and nowhere else, each row
  citing the Ruby that decides the same shape. Which files those are is derived
  in one place (`scripts/metrics/registry-modules.ts`) and read by both the
  rules that hold the boundary: the completeness census and the pattern-import
  rule in `tests/parser/architecture.test.ts`. The registry is keyed by four
  paragraph contexts (`paragraph`, `listItem`, `listContinuation`, `dlistItem`)
  because Asciidoctor's paragraphs are greedy: once open, a paragraph swallows
  every following line until a blank line or a small interrupting set, and that
  set differs by context.
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
  before adding a pattern; a row whose probe disagrees with the Ruby says so and
  says which of the two readings it follows.
- **Reflow safety consumes the same registry, and the packer asks it of whole
  LINES.** `accepts(line, next, position)` (`src/line-verdict.ts`, a shared
  module both halves import) is the reader's own verdict on one line at one
  position in a block, and the packer asks it of every continuation line it
  composes before it commits the layout. The position carries the block's
  recorded reading (`BlockReading`, `src/reader-context.ts`) and the line's
  ordinal, saturated at two, which is what a per-word question could not carry:
  a word probe unions every context's patterns, cannot see a shape anchored at
  both ends (a block attribute line needs its `]`), and answers for a line one
  word longer than the caller would write. Where no line of the layout reads
  back as the block's own text the block is written back from its own source
  lines, never retreated to one of the author's breaks. The block's FIRST output
  line is a different question, asked at a block start: where the packer owns
  the column (a paragraph at document level) it asks whether that line opens the
  block the reader recorded, and where a marker, a label or a term line holds
  the column the older per-word nets answer instead (`isBlockSyntaxAtLineStart`,
  `src/print/reflow.ts`, over the registry's `startsBlockAtLineStart`,
  `src/parse/line-shapes.ts`, plus one printer-side exemption for a lone `+`).

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
- A **list** takes the same shape through `src/parse/lines/list-reader.ts`,
  which reads items the way Asciidoctor's `parse_list` → `parse_list_item` →
  `read_lines_for_list_item` does, citing them throughout. `itemExtent` collects
  one item's lines into Ruby's buffer; the reader re-parses each buffer with a
  confined `BlockReader`, so nesting composes with no list frame, no per-item
  object, and no cross-item state — the only mutable state is `itemExtent`'s
  members, Ruby's four locals plus the buffer, the armed-tail state and the
  record of what each separator line turned out to be. The LOOP is that file and
  the POST-LOOP is its sibling `src/parse/lines/item-tail.ts` (Ruby's own: the
  detached erase, the tail walk, and the three tail facts), one Ruby range each;
  `finishItem` is handed the scan's final state once, as one value, and reads no
  line a second time. Each block an item holds carries its verbatim `gap`: the
  `""` and `"+"` lines the author wrote in front of it, spelled from the role
  the arm that consumed each line recorded and applied to the document-wide
  record by the reader that owns it. Verbatim has exactly one exception: a `+`
  the post-loop's pop took off a NESTED item's tail is printed back from that
  item's own `trailingContinuation` (or deliberately dropped when the tail is
  withheld; the argument sits with the deletion in
  `src/parse/lines/item-tail.ts`), so the enclosing gap that spans the line does
  not spell it as well — two spellings of one line write an adjacent `+` pair,
  which freezes the continuation on re-read and moves the block under it out of
  the nested item. Invariant (vii) in `tests/parser/ast-invariants.ts` states
  the exception and holds it to exactly the tail facts standing under the block
  above each gap.
- The **document header** is read extent-first too, at the title line
  (`src/parse/lines/header-reader.ts`, reading the lines `parse_document_header`
  -> `parse_header_metadata` reads). Whether a `= Title` opens one is reader
  state: a forward-only bit that the first block or held line Ruby's
  `parse_block_metadata_lines` does not eat clears, so a level-0 title deeper in
  the file is an ordinary heading leaf.
- **Headings are leaves.** Sections are not modeled — there is no `section` node
  — so the document is a flat sequence of blocks the reader appends to, and
  nothing closes on a later, unpredictable line.

What a held style or attribute line makes of the block that follows — a
`[verse]` masquerade that flips a compound block to verbatim, a `[NOTE]` that
builds an example wrapper as an admonition, a verbatim role — is resolved once,
at the opening line, by `src/parse/lines/open-style.ts`, and the builders build
from that recorded decision. The held `[…]` line itself has one parser,
`src/parse/attrlist.ts`. `src/parse/lines/frames.ts` holds what is left of the
vocabulary the readers share (the leaf builder table the reader dispatches
through), so the layer stays a DAG rather than an import cycle; the
held-metadata table sits in `src/parse/lines/held-metadata.ts` beside the run it
is about, and `fragmentOfLine` in `src/parse/lines/split.ts` beside the
`SourceLine` it measures.

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

A few modules sit at the ROOT of `src/` and belong to neither side:
`block-metadata.ts` (the metadata vocabulary) and the three whitespace modules
below. They are not a fifth address into the parser: nothing about the reader's
interior leaks through them. They are one answer both halves need and neither
may spell twice, which is exactly what a shared home is for, and each of their
symbols carries a registry row like any other crossing.

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
Asciidoctor source that decides it (`substitutors.rb`, `rx.rb`). Its last rule
consumes one character, so it is total and cannot stall. `span-pairing.ts` then
decides which marks pair, and `inline-node-builder.ts` turns each resolved pair
into a node; keeping the pairing out of the tokenizer is what lets an unclosed
mark stay literal text instead of becoming an error. That pairing is not a
left-to-right walk. Asciidoctor runs each row of its `QUOTE_SUBS` table as a
gsub over the whole text, one row after the next, so where two different marks
overlap the earlier row wins whatever the source order is — `_a *b_ c*` is a
strong span holding `b_ c`, and the underscores stay literal. A candidate that
crosses an already-resolved span is dropped: the oracle emits genuinely
overlapping elements there, and no tree holds them. Where a line/column is
needed, one `LocationIndex` (`src/parse/positions.ts`), built once per document,
answers by binary search.

The constrained/unconstrained distinction (`*` vs `**`, `_` vs `__`) is one
`match` function over two facts: a doubled mark stands where the unconstrained
row's own gsub put a delimiter (`doubled-marks.ts`, scanned once per fragment
because `**a**` pairs and `**a*` does not), and the single mark is a token only
next to a word boundary. The boundary is computed against the fragment handed to
the tokenizer, never the document — an index outside the fragment counts as a
boundary, which is what makes `* *bold*` bold. Reading surrounding characters is
inline context; reading block history would be block context, and the guard test
forbids it.

## The AST

`src/ast.ts` declares every node kind; the census is pinned at **39** kinds by
`tests/parser/architecture.test.ts` — an equality pin, not a budget, so a new
kind fails the pin until it is deliberately moved. The file is the reference;
the shape of the tree in one paragraph:

A `document` holds a flat sequence of blocks. Headings are leaves with a `level`
(sections are not modeled), with one exception: a `= Title` at the top of the
document opens a `documentHeader`, which OWNS the lines Asciidoctor reads with
it - attribute entries, comments and preprocessor lines, then an `authorLine`
and a `revisionLine`, up to the first blank line. Owning them is the point: the
header prints as one run of lines, so no separator rule can insert the blank
line that would end the header early and demote its lines to body content (issue
#18). Paragraphs hold inline children. Lists hold items; each item holds its
marker spelling, the whitespace on either side of it (both load-bearing: an
indent decides whether the line under an item is its child, and the gap is half
of the line a thematic break would be spelled on), its text, and its blocks,
each block behind its recorded `gap`. Delimited blocks carry their variant
(listing, literal, pass, verse, example, sidebar, quote) and form (delimited,
indented, paragraph); parent blocks hold parsed children; admonitions unify the
paragraph and delimited forms. A table is a node of its own rather than a
delimited block, because its delimiter lines frame recorded structure instead of
bracketing one slice of content: it holds its opening and closing lines, how its
cells are cut, and its rows, each row holding the cells the cut produced. Those
records PARTITION the table's extent - opening line, leading runs, every cell's
opening and runs, closing line - which is what lets the printer replay it byte
for byte while the tree carries the structure a later normalization will act on.
Beyond those, the formatter-specific nodes are the ones a semantic model would
discard: comments, preprocessor directives (`include::`,
`ifdef`/`ifndef`/`ifeval`/ `endif`, kept as verbatim lines), block attribute
lists, block titles, block anchors, and `rawLine` (a verbatim line inside a
paragraph, so a comment between two text lines survives reflow). Inline nodes
cover the formatting marks (constrained and unconstrained), attribute
references, anchors, links and xrefs, inline macros, and hard line breaks.

One deliberate gap, tracked as an issue rather than modeled halfway: description
lists have no node, and their source is carried as paragraph text (#9). A table
is modeled but not yet NORMALIZED: the printer writes its recorded bytes back
unchanged, so cell spacing and column alignment are still the author's (#10).

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
The whitespace record below is what SETS those facts for a run of source
whitespace: `verbatim` bytes ride inside the atom beside them, `bound` to a
space is `noBreakBefore`, `bound` to a newline is a hard break, and `free`
leaves the packer its choice. Break decisions live where atoms are built; breaks
exist only between atoms, never inside a fused run.

`blockBody(atoms, width, indent, layout)` is the one greedy packer. The
paragraph printer, the paragraph-form admonition body, and a list item's text
all go through it, so those bodies are one engine by construction rather than by
review. It measures a fused run whole before deciding a break (an over-long run
overruns on its own line, because no split of it reads back as the same
construct) and measures in columns via Prettier's own `getStringWidth`, so a
full-width character costs two and a combining mark costs none. Reflow safety
(see [Line classification](#line-classification)) keeps the packer from placing
a word where it would re-parse as block syntax, and the layout it produces is
then asked, line by line, whether the reader reads it back as the block it came
from; a layout that fails is dropped for the block's own source lines, which the
`layout` argument carries. The first line is asked the block-start question and
only where `opensItsOwnLine` says the packer holds that column. A line the
packer REPLAYED rather than composed (a comment or a preprocessor directive
standing inside the block) is not asked, because the reader consumes such a line
before block structure exists rather than reading it as the block's text.

### The whitespace record

Whether one run of a block's whitespace may be respelled is decided ONCE, by the
reader, and recorded on the block: `paragraph.whitespace`, and the same field on
a list item's, a description item's and a paragraph-form admonition's text
(`BlockWhitespace`, `src/whitespace-record.ts`). The printer READS it and may
not re-derive it.

Why the reader. A whitespace run is syntax wherever a rule of Asciidoctor spells
its boundary as the literal space or the literal newline: the em-dash
replacement, the hard line break, an `image:` target, an anchor's reftext.
Asking that of the printed words means re-deriving, one predicate per rule, what
the reader already knew when it tokenized the line, and the predicates then
drift from the reader about what a construct even is. The record is the reader's
answer, and it is a fact about the SOURCE, so two records that agree describe
blocks Asciidoctor reads alike.

Three modules, split by what each answers:

- `src/whitespace-record.ts`, the record's TYPE and nothing else. A leaf,
  because `src/ast.ts` names it on four node types and the two modules below
  name the AST's node types back; declaring it in either would be the cross-file
  cycle the metrics graph gate refuses even for type-only imports.
- `src/whitespace-runs.ts`, WHERE the runs are: the cut of a value into its
  words and the runs around them, the walk that puts a block's runs in one
  order, and the index that hands each fact back to the printer. That order is
  the one thing the two halves must agree on, so there is one walk and both call
  it.
- `src/whitespace-fact.ts`, WHAT each run means: one function with an ordered
  walk of the rows, first match assigning.

The arms are `free` (no rule reads it; the packer writes a space or a break),
`bound` to the run's own spelling (a rule reads whether it was a space or a
newline, but not its width), and `verbatim` (a rule reads its bytes, so they are
written back). `free` carries no bytes at all, which is what makes the packer's
access to a free run checkable: two records differing only at free runs are
indistinguishable to it. A whole block can also be `replayed`, for the rows
whose reading is about which LINE a byte is on.

### The mark record

The same shape, one construct along. Whether a span's mark stands FLUSH against
the content it delimits, or with whitespace between, is decided once by the
reader at pairing time and recorded on the span: `bold.marks`, and the same
field on the italic, monospace and highlight nodes (`SpanMarks`,
`src/mark-record.ts`, a leaf for the reason `src/whitespace-record.ts` is one).
Its one construction site is `spanMarkFacts` (`src/parse/inline/mark-facts.ts`),
which reads the same token slice the span's children are built from.

Why the reader, again by the same argument. Every constrained row of
`QUOTE_SUBS` spells its content `(\S|\S#{CC_ALL}*?\S)` (asciidoctor.rb
l.448-464), non-whitespace at both ends, so the question decides whether a
doubled span has a shorter spelling at all and whether the printer may put a
break beside its opening mark. The printer holds atoms rather than source, and
there the same whitespace is in one of two places depending on how it folded (a
JOIN when it became one, the atom's own BYTES when it rode inside one), so no
single atom read answers the rows' question.

The arms are `entangled` (flush) and `isolated` (whitespace stands there), and
neither carries a payload. Not recording WHICH whitespace is the record's own
version of the free arm's no-bytes property: a run's spelling does not survive
the packer's fold, so a fact keyed to it would be one the printer destroys,
while "at least one whitespace byte is written there" survives every layout. Not
naming the construct a mark is entangled WITH is a deviation from the shape the
record was asked for, and the reason is at `EntangledMark`: nothing reads it,
because the fusion writes mark and content adjacent unconditionally and every
remaining refusal is read over other bytes.

Only the four MARK spans carry the record. The curved, superscript and subscript
rows spell their own content `(\S|\S#{CC_ALL}*?\S)` and `(\S+?)` (asciidoctor.rb
l.449-452, l.465-468), which refuses whitespace at either edge, so neither of
those marks can be isolated and there is no state to record; `marksOf`
(`src/print/span-edges.ts`) answers for them, and
`tests/parser/inline-marks.test.ts` pins the reader building no span at all for
the shapes that would need it.

**Attributes supplied from outside the document are out of scope.**
`-a hardbreaks` on a command line, an editor's own defaults, an include's
caller: none of them is the formatter's concern. The formatter reads the
document's own text and nothing else, so a block is a hardbreaks block here only
when the document itself says so, and a reference resolves only against entries
the document itself sets. That is a CONTRACT, not a limitation to fix: a
formatter whose output depended on a flag it cannot see would have no fixed
point.

### The head-drain record

The same shape, one construct along. `parse_list_item` peeks past a run of
`//`-headed lines before it reads a list item's first block and puts them back
only when a line FOLLOWS the run (`parser.rb` l.1362-71, over
`Reader#skip_line_comments`, `reader.rb` l.332-345, whose spelling is the bare
`//` prefix and so wider than `CommentLineRx`). What that peek did is recorded
on the item (`headDrain`, `HeadDrainFact` in `src/head-drain-record.ts`, a leaf
for the reason the whitespace record is one), constructed at the one site where
the drain runs (`src/parse/lines/list-read.ts`), and READ by the printer's
separator rule (`printsDrainShield`, `src/print/join.ts`).

Why the reader, again. An item whose whole body is such a run keeps that body
only while a `+` stands under it: without the byte the next read's drain reaches
the buffer's end, the run is lost and its paragraph leaves the render. Asking
the PRINTED WORDS whether the drain would take them is a different question and
gives a different answer - a run whose paragraph carries a second word or an
inline node (`///c x`, `/// +`, `///*b*`) is one the drain takes by its line's
head and the words say it does not - so two printer predicates that asked it
withheld the shield from every such run.

Two arms, not the peek's three, and the merge is what makes the record a fixed
point. `dropped` (the run reached the buffer's end and the reference lost it)
protects no rendering the printer can act on, and one corpus document moves
between it and `kept` when the item's own text reflows over a `// c` line, with
no byte and no rendering changing; a record that told them apart would be a fact
the printed bytes do not carry. So both are `none`, and the surviving `detached`
arm is held still by the item's own reflow guard (`nextLineNeedsItsPosition`),
which keeps the item's opening line exactly as the source spelled it wherever a
run was detached: move the text down over the run and the next read's peek stops
on the moved line instead, so the arm the shield was written from would be gone
by the pass after.

The arm carries NO payload, and the two questions one might have carried are
both answered without it. Whether a `+` stood under the run is implied: for the
drain to have left a detached run as an item's WHOLE body, a blank had to follow
the run inside the item's own buffer, and a trailing blank survives Ruby's
`last_line.empty?` strip only where the marker pop broke the walk one line under
it (`parser.rb` l.1580-82 against l.1584-85). Whether the run RENDERS is not
asked at all: a line the next read's drain loses is a line lost whatever it
renders, so the shield is written over a run of true `//` comments too. Asking
it cost 41 documents of the reading-invariant sweep their `cont` token and 7
more one of two, for a rendering both programs agree is unchanged.

### Joins between blocks

Blank-line policy between siblings lives in `src/print/join.ts` as named rules,
each with its rationale — for example, a level-0 heading always takes a blank
line after it, and a pseudo-anchor line never stacks directly above a heading
(the stacked pair re-parses as one joined line and the heading is destroyed).
Both are pinned by `tests/format/heading-adjacency.test.ts` and by the
shape-diff `heading-adjacency` grid.

### List separators

Inside a list, the separators are the AST's, not the printer's invention. The
default in `src/print/list.ts` is to print each recorded gap line for line,
which is what makes list formatting idempotent by construction, normalizing only
a blank run down to one blank, up to the gap's first `+` (the same rule
`joinBlocks` holds between blocks; a blank run after a `+` is what erases the
`+`, so shortening that one would change attachment). Every `+` the printer
emits is a replay of one the author wrote; a `+` at an item's end is not
replayed, because Ruby pops it and it renders nothing.

There are two recorded gaps, and the reader's own partition decides which one a
line lands in: an `ItemBlock.gap` in front of each block an item holds, and a
`ListItemNode.leadingGap` in front of each item after a list's first. One
document-wide record feeds both, cut at block boundaries and item boundaries
alike (`gapsOf`, `src/parse/lines/list-item-node.ts`), so a `+` between two
ITEMS of one list has a home rather than being destroyed for want of one (issue
#184).

Above that default the printer holds separator decisions of its own, each a
named arm whose function comment carries the reasoning and the Ruby citation:
`hazard`, `tailSwallowsMarker` and `separatorBefore` in `src/print/list.ts` and
`src/print/list-hazard.ts`, and `printsDrainShield` in `src/print/join.ts`. They
are named rather than counted because the set grows with the shapes that need
one, and every member is there for the same reason: verbatim replay would not
re-parse to the same tree. `hazard` answers a reflow that would move the item's
first rest line up (the line Ruby reads three ways: the metadata drain, the
blank count, and the indent strip); `tailSwallowsMarker` answers a previous
item's tail whose literal slurp would swallow the next marker line;
`printsDrainShield` answers a list-like item whose whole body is a run the head
drain would take again (`skip_line_comments`, reader.rb l.329-346), which
deletes that body - a description and its `<dd>`, or the paragraph a marker
item's run renders - unless the `+` the author wrote under it comes back where
the pop can absorb it; and `separatorBefore` answers the gap in front of a
sibling item, replaying the `+` it holds unless the item above already prints
that byte through its own tail. `separatorBefore` also makes the one erasure a
gap replay is allowed: a LEADING gap prints through its last `+` and drops the
blank lines behind it, because a marker line follows rather than a block, so
those blanks decide nothing that survives.

`printsDrainShield` places a byte whose MEANING is decided under it, so it does
not own the decision alone: one blank line under a live `+` arms it and attaches
the next block (`parser.rb` l.1483), two detach it (l.1549), and the blank count
between a list and the block after it belongs to `joinBlocks`. An item the arm
closes is reported as an armed tail instead, through the same
`listTailContinuationActive` that reads `ListItemNode.activeTail`, so the writer
and the separator rule ask one predicate rather than two. It is a replay rather
than an invention: the only way such a description reaches a node, or such a
body reaches a BLOCK, is a source that already carried that `+`, because a run
reaching the buffer's end is one Ruby drains at parse time (issue #171, issue
#212, issues #262 and #259). It is also ONE arm rather than two, because it
reads a recorded fact (`ItemBody.headDrain`, see
[the head-drain record](#the-head-drain-record)) instead of asking the printed
words what the drain would make of them - the question two earlier arms asked,
and the reason a run carrying a second word or an inline node lost its paragraph
(issue #267). What the drained run would have RENDERED does not enter on either
side: the byte is the author's, and a line the re-read loses is lost whether it
was a `///` paragraph or a `// c` comment.

`tailSwallowsMarker` is the one decision that cannot be made from the AST at
all, and it is the printer's only reader of its own output: what a re-read makes
of a marker line depends on the LINES standing above it, so the item's finished
Doc is rendered back to those lines (Prettier's own `printDocToString`) and the
line-shape registry is asked about them. Answering from the recorded blocks
instead is what issue #54 was: a slurp that runs inside an item is harmless —
the item's buffer is re-parsed from the item's own lines — and a blank invented
up there ends the item early instead of stopping the slurp where it runs past
the item's end.

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

Outside those two cases there is exactly one licensed byte-preserving path, and
it is the AUTHOR's to open, never the formatter's: the `// prettier-ignore`
pragma (issue #175). A line comment spelling exactly that, written above a
block, tells the printer to write that block's own source bytes back instead of
formatting it: the block plus everything nested inside it, and the block
metadata lines standing between the pragma and the block:

```asciidoc
// prettier-ignore
[cols="1, 2"]
| a |   b
```

The pragma is recorded where the block joins its sibling sequence
(`carryIgnorePragma`, `src/parse/lines/ignore-pragma.ts`) and spelled at the
printer's one entry point, as a slice of the parsed source over the extent the
node already carries. It is a spelling choice, not an analysis, which is why
nesting needs no case of its own. The formatter's own behavior stays total and
maximal: this is user intent recorded in the document, not a fallback the
printer reaches for, and nothing in this repository may write the pragma to
sidestep a formatting defect. Both properties above still hold across it: the
pragma line renders nothing, and it survives into the output, so a second pass
re-derives the mark from the same comment and finds the same normal form.

### The formal model: an abstract rewriting system

The policy above has an exact formalization in abstract rewriting theory (Baader
& Nipkow, _Term Rewriting and All That_). Write `render(a)` for what the pinned
oracle makes of input `a`, and `a ≈ b` for `render(a) = render(b)`. The
rewriting system is `(A, →)`: documents, where `a → b` when ONE formatting rule
respells ONE site (one attrlist value unquoted, one anchor form folded, one
blank elided). `format` itself is not the relation: the relation is the
_small-step_ semantics (one rule, one site — the form that induction and
critical-pair analysis can grip), and `format` is the _big-step_ implementation
(one call normalizes the whole document; nobody runs a million micro-rewrites).
One bridging obligation connects them, _adequacy_: `format(a)` is the `→`-normal
form of `a` — well-posed once termination and confluence make that normal form
unique, and checked per axis when a conversion lands. Proofs live small-step,
the implementation (`print ∘ parse`) lives big-step, and every small-step
theorem transfers through adequacy: the standard split between structural
operational semantics and natural semantics (Plotkin; Kahn).

The obligations, each with its name in the literature:

1. **Meaning preservation** — `→ ⊆ ≈`: every rule, at every site, stays inside
   the render-equivalence class; plus _strategy soundness_, `a →* format(a)`.
   Per-rule render-equality proofs at every conversion landing are the rule
   obligation; the sweeps call the composed per-document instance _fidelity_
   (`tests/conformance/properties.ts`), and the standing render-equality gate
   (`tests/conformance/list-item-composition.ts`) holds a bounded family of
   compositions to it. This is the verified-compiler literature's semantic
   preservation, stated rule by rule.

2. **Termination (SN)** — no infinite rewrite chains. Structural in a one-pass
   design, but it is a real obligation, not a free one: any rule pair that can
   re-enable each other is a loop. The idempotency batteries surface a loop as a
   pass-2 change, and only when its two rules disagree about the bytes; the
   reduction order below names the obligation directly, and its non-increase
   check catches a non-decreasing PASS, comparing whole-document weights, so a
   rise at one site and an equal fall at another still cancel.

3. **Normalization** — `format(a)` is a `→`-normal form: no rule applies to the
   output. With soundness this IS idempotence (`f(f(a)) = f(a)`, the
   universal-algebra term): a second pass finds no rule to apply. Informally:
   every input arrives at a normal form in one step. Enforced by the idempotency
   property in the sweeps and corpus battery; the per-fact lemma program
   (`read(print(A)) = A` restricted to each recorded fact, mutation-verified) is
   its modular proof strategy.

4. **Confluence (CR)** — where two rules apply to overlapping sites, the results
   rejoin: by Newman's lemma, SN plus local confluence, and local confluence is
   checked at _critical pairs_ — the overlaps. Every review question of the form
   "these two mechanisms touch the same line; do they commute?" is a
   critical-pair analysis; the literature's version is systematic where ours is
   per-review. SN + CR yield **unique normal forms** per convertibility class:
   `a ↔* b` implies `format(a) = format(b)`. This half of canonicity is internal
   and provable.

5. **Completeness** — `≈ ⊆ ↔*`: any two render-equal documents are connected by
   the rules, so unique-normal-forms upgrades to full _canonicity_
   (`a ≈ b ⇒ format(a) = format(b)`; `format` is a canonizer for `≈`, and
   comparing normal forms decides render-equality). This is the empirical
   frontier, and the program that pursues it has a name: **completion**
   (Knuth–Bendix). The confluence gate's exception table
   (`tests/conformance/confluence-exceptions.ts`) is the set of unoriented
   equations pending completion — each row a measured render-equal pair the
   rules do not yet join; landing a conversion orients the equation into a rule;
   the review's interaction checks are its critical pairs. The table shrinking
   to empty is completion finishing.

### The spelling reduction order

Completion, run deliberately, wants one artifact: a _reduction order_, a
well-founded order on spellings that every rule strictly decreases. With one,
orientation stops being taste ("native beats markdown") and termination stops
being structural luck: a pair of rules that can undo each other is exactly a
non-decreasing step, caught by checking the order instead of by a second format
pass happening to differ.

The order is five counts read left to right, so a count may rise only if one to
its left fell (`tests/conformance/reduction-order.ts`, which is where the
derivation, the domain and the limits are written in full):

1. **Compatibility forms**: a construct spelled for compatibility with another
   markup or with an older AsciiDoc, where the language's own syntax spells the
   same thing. A Markdown fence formats to `[source,ruby]` over `----` (six
   syntax bytes in, seventeen out, counting the syntax on both sides and the
   `ruby` hint on neither), `---` to `'''` and `# T` to `= T` (both
   byte-for-byte ties), and `Tit` over `^^^` to `==== Tit` (a byte longer). No
   byte count orients those, and the fence it orients backwards.
2. **General-purpose forms**: a construct said through a slot that says many
   things, where the language gives that construct a spelling that says only it.
   `[#id]` over a paragraph formats to `[[id]]` plus a blank line, and `[NOTE]`
   over a paragraph to the `NOTE: ` label; the dedicated spelling wins although
   the anchor's costs a byte and a newline.
3. **Redundant syntax**: syntax past the shortest spelling of the same
   construct. A delimiter run past its minimum, a heading's repeated closing
   run, a page break past `<<<`, an unconstrained inline mark where the
   constrained one suffices, the quotes around a positional attribute value.
4. **Padding**: the same fact in whitespace. `[source, ruby]`, an attribute
   entry's value run, a psv cell's leading pad, a blank run past one blank.
5. **Non-preferred forms**: the losing member of an axis whose two spellings
   cost the same in every count above. `:name!:` formats to `:!name:`: one
   construct, two spellings, no cost between them.

A component is added only for a LANDED conversion, without exception: an axis
whose conversion is parked gets none, however settled its orientation looks.
Landed evidence forces each component's existence; it does not force its RANK,
because no landed conversion moves two components in opposite directions. The
sequence is therefore a recorded choice, argued from the conversions that cost
bytes at every lower component, and it stands until a conversion lands that
moves two components apart. A constructed pair in
`tests/conformance/reduction-order.test.ts` is what makes the sequence testable
meanwhile: it is the only thing in the tree that fails if the comparison is read
pointwise, as a sum, or reversed.

Every component is a count floored at zero, so the lexicographic product is
well-founded and a strictly decreasing chain is finite, which is termination
(obligation 2) as something a test reads. **What the order deliberately does not
rank** is layout: where lines break, how blocks are separated, and the syntax
the reader supplies for the author. The printer joins short lines and splits
long ones, and its normal form adds a blank line between adjacent blocks and a
closing delimiter to an unterminated one; 169 of the 1,614 corpus cases format
to more bytes than they were written with. No well-founded order can be
decreased by a rewrite that runs in both directions, so no component counts
bytes outright: each counts occurrences of a spelling some rule replaces, and
supplying missing syntax mints no occurrence.

The check has two halves, each with its domain. Non-increase is the `reduction`
property in the corpus battery (`tests/conformance/properties.ts`), over all
1,614 vendored cases. Strict decrease is measured over the confluence roster in
`tests/conformance/reduction-order.test.ts`: every row the formatter converges
is a landed conversion whose losing spelling must descend the order, and the
rows the order does not separate are pinned there, today the six list-marker
axes plus the parked bare-URL axis. The same file carries the perturbation
proof: one rewrite per component, built in the test, that runs a landed
conversion backwards, raises that component and no other, and must be caught.

Two limits belong with the claim. The order is blind where no recognizer names a
spelling, and it can be WRONG where its line scan misreads a line's role,
because that scan is a delimiter stack and not the reader. And the check
compares whole-document weights, so it catches a non-decreasing PASS rather than
a non-decreasing step: a rise at one site and an equal fall at another cancel.

**Every conversion states its orientation against this order**: one line in its
issue and in its landing report, naming the component it strictly decreases, in
place of a per-case argument that the target spelling is nicer.

Implication structure: preservation + normalization give idempotence; SN + CR
give uniqueness within `↔*`; completeness extends uniqueness to all of `≈`.
Obligations 1 and 5 face the oracle and are enforced by measurement; 2-4 are
internal. "Confluence" in this codebase's gate names is, strictly, obligations
4 + 5 together — the gate measures canonicity over enumerated axes, and this
section is the exact accounting for that shorthand.

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
  only (`tests/format/` asserts on formatted bytes against fixtures, and on the
  tree `parse()` builds for a document whose structure is pinned too;
  `tests/conformance/` does the same with an external authority). They never
  import an `@internal` export — if one is tempting, the behavior under test has
  no entry point, and that is the finding.

On top of the suite sits the differential net: `tests/conformance/` runs three
properties over 1,614 vendored corpus cases (no crash, idempotency, and render
fidelity against the `@asciidoctor/core` oracle, pinned at 4.0.11), with known
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
  — the reference the parser cites, vendored at `vendor/asciidoctor-ruby/`
- [Prettier issue #5506](https://github.com/prettier/prettier/issues/5506) — the
  long-standing AsciiDoc plugin request
- [AsciiDoc parsing lab](https://github.com/opendevise/asciidoc-parsing-lab) —
  the official PEG grammar research that informed the no-parser-library decision
