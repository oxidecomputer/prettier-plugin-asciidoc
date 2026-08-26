/**
 * The BlockReader: Asciidoctor's line reader as ONE flat walk. Every
 * composite construct is read EXTENT-FIRST, where Asciidoctor reads
 * it: a delimited block's whole extent is collected at its opening
 * line (`build_block` → delimitedExtent) — verbatim interiors become
 * a slice, compound interiors a fresh CONFINED BlockReader over the
 * interior subarray — and a list item's buffer gets the same
 * treatment through list-reader.ts (`parse_list` → listShape,
 * `read_lines_for_list_item` → itemExtent), which decides every
 * item's extent and parses none of them — this reader owns every
 * recursion those extents call for. What is not a composite is a
 * LEAF, headings included: sections are not modeled, so the document is a flat
 * sequence this reader appends to, and nothing closes on a later,
 * unpredictable line. Confinement — what a scan can SEE — is
 * physical everywhere Ruby's is: a confined reader's lines END at its
 * boundary, and the Confinement record carries the two boundary facts
 * (tail safety, the forced-close offset) as data.
 *
 * What a node is MADE of is the builders' business (src/parse/build/);
 * this file only decides which one to call, in Ruby's order:
 * `parse_block_metadata_lines` (holdMetadata), `next_block`'s ladder
 * (blockLine), `read_paragraph_lines` (paragraph-reader.ts).
 */
import type { BlockNode, DocumentNode, ListItemNode } from "../../ast.js";
import {
  buildDelimitedAdmonition,
  buildParentBlock,
  buildVerbatimBlock,
} from "../build/delimited.js";
import { buildDiscreteHeading, buildHeading } from "../build/heading.js";
import { buildList } from "../build/list.js";
import {
  buildAttributeEntry,
  buildBlockMacro,
  buildRawBlockLine,
} from "../build/metadata.js";
import {
  buildAdmonitionParagraph,
  buildLiteralParagraph,
  buildParagraph,
  buildParagraphFormBlock,
  buildStyledParagraph,
} from "../build/paragraph.js";
import type { InlineToken } from "../inline/tokens.js";
import type { ParagraphContext, ReaderContext } from "../line-shapes.js";
import { makeLocationIndex, type LocationIndex } from "../positions.js";
import {
  classifyLine,
  classifyTrace,
  type DelimiterKind,
  type LineKind,
  type MarkerKind,
} from "./classify.js";
import { blockExtentOf, delimitedExtent } from "./delimited-reader.js";
import { fragmentOfLine, isLeafKind, leafBuilder } from "./frames.js";
import {
  documentHeader,
  headerSurvivesBlock,
  headerSurvivesHold,
  type HeaderScan,
} from "./header-reader.js";
import { HeldMetadata } from "./held-metadata.js";
import type { Confinement, ReaderScope } from "./scope.js";
import { listItemNode } from "./list-item-node.js";
import { listShape, type ListItemShape } from "./list-reader.js";
import {
  paragraphFormVariant,
  resolveDelimitedOpen,
  verbatimStyledVariant,
  withFenceLanguage,
} from "./open-style.js";
import {
  continuationFoldExtent,
  literalParagraphExtent,
  paragraphExtent,
  verbatimStyledExtent,
  type ParagraphScan,
} from "./paragraph-reader.js";
import { documentBom, splitLines, type SourceLine } from "./split.js";

// The one block-attribute style the reader itself acts on: it turns the
// heading that follows into a discreteHeading leaf instead of an
// ordinary one.
const DISCRETE_STYLE = "discrete";

// The heading level `= Title` spells - the only level a document
// header opens at (`is_next_line_doctitle?`, parser.rb).
const DOCUMENT_TITLE_LEVEL = 0;

/**
 * Reads one line array into blocks. One instance per document — plus
 * one confined instance per list item, over the item's buffer, and
 * one per compound-block interior, over the interior subarray; `run`
 * consumes it.
 *
 * It satisfies no seam and names none. Every sub-scan it calls is a
 * pure function over lines and an index, returning what it found and
 * where it ends; the read position, the block sequence and the
 * held-back metadata never leave this class, and the recursion — an
 * item's buffer, a compound block's interior — is this constructor
 * called on a narrower line array. Nothing is handed a reader, so
 * nothing can be mis-wired.
 */
class BlockReader {
  private readonly source: string;
  private readonly at: LocationIndex;
  /**
   * Every block this reader produces, appended in source order —
   * the document's blocks for the outermost reader, an interior's
   * for a confined one. Nothing nests them further: delimited blocks
   * are read whole at their opening line and headings are leaves —
   * no section container exists — so no construct closes on a later,
   * unpredictable line and nothing routes a finished node anywhere
   * but here.
   */
  private readonly blocks: BlockNode[] = [];
  /** Index of the next unread line. */
  private index = 0;
  /**
   * Blank lines seen since the last line the reader CONSUMED — Ruby's
   * `skipped` count in `next_block` (l.505): a confined reader picks
   * an in-item paragraph's interrupting set by it (see
   * {@link BlockReader.bodyContext}). An erased `+` in an item's
   * buffer reads as a blank here, exactly as it does to Ruby.
   */
  private blanks = 0;
  /**
   * Whether a DOCUMENT HEADER can still open at the next `= Title`
   * line. Reader state, and forward-only: it starts true and is
   * cleared by the first block or held line that is not one of the
   * lines Ruby's `parse_block_metadata_lines` eats ahead of
   * `parse_document_header` ({@link BEFORE_HEADER},
   * {@link BEFORE_HEADER_HELD}), including the header itself - there
   * is exactly one per document. A confined reader never reads it:
   * `sectionTitle` sends every title inside an item buffer or a
   * compound interior to the paragraph arm before the question is
   * asked.
   */
  private headerReachable = true;

  // The held-back metadata run — the nodes waiting for the block they
  // annotate and the parsed `[…]` view, owned by one small object
  // (held-metadata.ts) so the reader keeps only the read position and
  // the block sequence.
  private readonly held = new HeldMetadata();
  private readonly scope: ReaderScope;

  /**
   * @param scope - the document-wide facts every reader shares
   * @param lines - the lines THIS reader walks: the document's, or an
   *   item's buffer (absolute offsets either way)
   * @param confinement - present exactly when this reader parses a
   *   list item's buffer or a compound block's interior, absent for
   *   the document reader. Being confined is Ruby's
   *   `next_block(list_item_reader, …, list_type:)`: no sections,
   *   item-flavored paragraph contexts, a lone `+` kept as a raw
   *   line. Its `style` (the item's own marker style) feeds
   *   `context()`'s ancestry: the foreign-marker rule (a
   *   marker-shaped line inside a `+`-attached paragraph keeps its
   *   own output line, because its column decides
   *   `within_nested_list`) fires only while a list is open, and the
   *   buffer being PHYSICALLY confined means one style stands for the
   *   whole ancestry — a marker of any ENCLOSING list's style cannot
   *   survive into the buffer (the enclosing extent scans stopped at
   *   them), so every marker line the buffer holds is foreign. Its
   *   `tailSafe` is the confined stream's own tail-safety, which every
   *   extent scan run from this reader inherits as its stream-end
   *   boundary fact (see {@link BlockReader.tailSafe}). Its
   *   `closeOffset` is where a forced close at this reader's stream
   *   end falls — computed at the ONE place that knows the boundary
   *   (listItem() for an item buffer, the compound open for an
   *   interior) and consumed as data
   *   ({@link BlockReader.forcedCloseOffset}).
   */
  constructor(
    scope: ReaderScope,
    private readonly lines: readonly SourceLine[],
    private readonly confinement?: Confinement,
  ) {
    ({ source: this.source, at: this.at } = scope);
    this.scope = scope;
  }

  /**
   * Whether a `+` printed at the very end of this reader's lines
   * re-reads inert — the boundary fact every extent scan run from
   * this reader inherits. The document's end is EOF, always safe; an
   * item buffer's end is wherever the enclosing item ended, so the
   * answer is that item's own; a block child's is
   * `closed || enclosing`, decided at the compound open.
   * @returns the boundary fact the extent scans inherit
   */
  private get tailSafe(): boolean {
    return this.confinement?.tailSafe ?? true;
  }

  /**
   * Where a forced close at THIS reader's stream end falls: the
   * document length for the document reader (one past the final
   * newline — the spelling every unclosed-at-EOF position has always
   * had), the confinement's boundary for a confined one. One
   * derivation for the boundary every forced close shares, pinned by
   * tests/parser/delimited-end-convention.test.ts and the
   * confined-extent fixtures' position literals.
   * @returns the offset a forced close at stream end is stamped with
   */
  private get forcedCloseOffset(): number {
    return this.confinement?.closeOffset ?? this.source.length;
  }

  // ── context ────────────────────────────────────────────────────────

  /**
   * The reader's state as `classifyLine` consumes it AT A BLOCK
   * START — read, never derived. The other two positions belong to
   * the extent scans, which build their own context from the same
   * ancestry fact ({@link BlockReader.openListStyle}): nothing open,
   * and no line is "first after the block started" until a block has
   * started.
   * @returns the read-only context view
   */
  private get context(): ReaderContext {
    return {
      openParagraph: undefined,
      openListStyle: this.openListStyle,
      firstLineAfterStart: false,
    };
  }

  /**
   * The list ancestry the classifier reads here. Lists are read
   * extent-first and a confined buffer is already truncated at every
   * ancestor list's boundary, so ONE style — the confined item's own
   * — is the whole ancestry the classifier can ever need (the
   * foreign-marker verbatim rule keys on it). A block child reports
   * undefined: fresh-reader behavior is Ruby's (build_block →
   * Reader.new, no list_type).
   * @returns the open list's marker style, or undefined
   */
  private get openListStyle(): string | undefined {
    return this.confinement?.kind === "item"
      ? this.confinement.style
      : undefined;
  }

  /**
   * What a paragraph-shaped scan is given here — the stream and the
   * facts fixed over it, as DATA. Built fresh per call rather than
   * held as a field so it can never fall out of step with the lines
   * this reader walks.
   * @returns the scan value
   */
  private get scan(): ParagraphScan {
    return {
      source: this.source,
      lines: this.lines,
      openListStyle: this.openListStyle,
    };
  }

  /**
   * The next unread line.
   * @returns the line, or undefined at end of input
   */
  private peek(): SourceLine | undefined {
    return this.lines.at(this.index);
  }

  // ── where a finished block goes ────────────────────────────────────

  /**
   * Append a finished block to the document's children.
   *
   * The header-reachability bit is retired HERE, at the one place a
   * block joins the sequence, so no dispatch arm can forget to do it
   * - the header node itself retires it too, which is what makes a
   * second header per document unreachable.
   * @param node - the block just built
   */
  private push(node: BlockNode): void {
    this.headerReachable &&= headerSurvivesBlock(node.type);
    this.blocks.push(node);
  }

  /**
   * Push a one-line block, releasing any metadata it annotates first.
   * @param node - the block
   */
  private leaf(node: BlockNode): void {
    this.flushMetadata();
    this.push(node);
    this.advance();
  }

  /**
   * Push a one-line block WITHOUT resetting the blank run — for lines
   * Ruby's `skipped` count reads through: a document attribute is
   * processed inside parse_block_metadata_lines (next_block l.518),
   * and an unerased `+` kept as a raw line reads as a blank to Ruby's
   * prev_line. The transparency is stated here, where it is decided,
   * instead of being repaired around leaf() after the fact; pinned by
   * tests/parser/reader-lists.test.ts's attribute-entry and kept-`+`
   * rows.
   * @param node - the block
   */
  private transparentLeaf(node: BlockNode): void {
    const { blanks } = this;
    this.leaf(node);
    this.blanks = blanks;
  }

  // ── extent-first opens: flush, scan, resume ────────────────────────

  /**
   * Take an extent a scan just measured: move the read position past
   * it and forget the blank run before it. Every scan consumes at
   * least its own opening line, so the blank run is always over —
   * which is what the per-line `advance()` used to say one line at a
   * time.
   * @param end - the scan's resume index
   */
  private resume(end: number): void {
    this.index = end;
    this.blanks = 0;
  }

  /**
   * Read the paragraph-shaped extent OPENING at the read position and
   * take it. Releasing the held metadata first is the reader's own
   * bookkeeping — the scan knows nothing about it — so it happens
   * here, at the open, after every decision that reads the held style
   * has been made.
   * @param context - which interrupting set applies
   * @param from - raw column index where the text starts
   * @returns the body's tokens
   */
  private readText(context: ParagraphContext, from: number): InlineToken[] {
    this.flushMetadata();
    const { tokens, end } = paragraphExtent(
      this.scan,
      this.index,
      context,
      from,
    );
    this.resume(end);
    return tokens;
  }

  /**
   * Read a plain paragraph — the one opening at the read position —
   * and push it.
   * @param context - which interrupting set applies
   * @param from - raw column index where its text starts
   */
  private paragraph(context: ParagraphContext, from: number): void {
    // The non-verbatim paragraph-form fold: only a line
    // that opens a PARAGRAPH converts — today's observed shape,
    // reproduced exactly. The style is read before readText flushes
    // the run; the extent is the paragraph's own (unchanged context
    // threading).
    const formVariant = paragraphFormVariant(this.actionableStyle());
    const annotatedBy = this.annotation();
    const tokens = this.readText(context, from);
    const node =
      formVariant === undefined
        ? buildParagraph(tokens, this.at)
        : buildParagraphFormBlock(formVariant, tokens, this.source, this.at);
    if (node.type === "delimitedBlock" && annotatedBy !== undefined) {
      node.annotatedBy = annotatedBy;
    }
    this.push(node);
  }

  /**
   * Read a paragraph-form admonition (`NOTE: text`) and push it. The
   * label is the node's own span; the body is an ordinary paragraph
   * read from past it.
   * @param context - which interrupting set applies
   * @param line - the label line
   * @param labelEnd - raw column index where the text starts
   */
  private admonition(
    context: ParagraphContext,
    line: SourceLine,
    labelEnd: number,
  ): void {
    const tokens = this.readText(context, labelEnd);
    this.push(
      buildAdmonitionParagraph(
        fragmentOfLine(line, 0, labelEnd),
        tokens,
        this.at,
      ),
    );
  }

  /**
   * Read the indented literal paragraph at the read position and push
   * it.
   */
  private literalParagraph(): void {
    const annotatedBy = this.annotation();
    this.flushMetadata();
    const { lines, end } = literalParagraphExtent(this.scan, this.index);
    this.resume(end);
    const [firstLine, ...rest] = lines;
    const node = buildLiteralParagraph(
      fragmentOfLine(firstLine),
      rest.map((each) => fragmentOfLine(each)),
      this.at,
    );
    if (annotatedBy !== undefined) node.annotatedBy = annotatedBy;
    this.push(node);
  }

  // ── main loop ──────────────────────────────────────────────────────

  /**
   * Walk every line once and release whatever is still held at EOF.
   * @returns the blocks read, in source order
   */
  run(): BlockNode[] {
    for (;;) {
      const line = this.peek();
      if (line === undefined) {
        break;
      }
      const kind = classifyLine(line.text, this.context);
      classifyTrace.observer?.(line.offset, kind);
      if (kind.kind === "blank") {
        this.blanks += 1;
        this.index += 1;
        continue;
      }
      this.blockLine(line, kind);
    }
    this.closeAll();
    return this.blocks;
  }

  // ── lists: the one recursive construct ─────────────────────────────

  /**
   * Read the whole list opening at the read position and push it.
   * `listShape` decides every item's EXTENT from the lines alone; this
   * method owns the recursion those extents call for — one confined
   * reader per item — and hands the results back for assembly.
   *
   * Metadata read ahead of the first marker annotates the LIST, so it
   * flushes into this container BEFORE any item is read: the order is
   * decided here, at the one call site that owns the block sequence.
   * @param kind - the opening marker, as the classifier parsed it
   */
  private list(kind: MarkerKind): void {
    this.flushMetadata();
    const context = { tailSafe: this.tailSafe, gaps: this.scope.gaps };
    const shape = listShape(this.lines, this.index, kind, context);
    // The opening item is read into its own local, not inlined into
    // the call, so the items are read in SOURCE ORDER on the page as
    // well as at run time.
    const [opening, ...rest] = shape.items;
    const first = this.listItem(opening);
    this.push(
      buildList(
        kind.variant,
        kind.style,
        first,
        rest.map((item) => this.listItem(item)),
      ),
    );
    this.resume(shape.end);
  }

  /**
   * Read one item's interior and assemble its node — Ruby's
   * `Reader.new read_lines_for_list_item(…)` + the `next_block` loop of
   * parse_list_item (l.1359-1384). The marker line rides at the front
   * of the confined reader's lines so the text scan consumes it and the
   * text's continuation lines come from the buffer; the rest of the
   * buffer is then read by the ordinary block loop, whose blocks ARE
   * the item's blocks.
   * @param shape - what the extent scan decided about the item
   * @returns the item's node
   */
  private listItem(shape: ListItemShape): ListItemNode {
    // The buffer's last line — the marker line itself when the buffer
    // is empty — is where a forced close inside this item falls: its
    // raw end, the vii-b clamp as DATA. The marker line
    // rides at the front of every buffer, so the `??` arm is total
    // without a further guard.
    const last = shape.buffer.at(-1) ?? shape.markerLine;
    const inner = new BlockReader(
      this.scope,
      [shape.markerLine, ...shape.buffer],
      {
        kind: "item",
        style: shape.marker.style,
        tailSafe: shape.tailSafe,
        closeOffset: last.offset + last.raw.length,
      },
    );
    const text = inner.readText("listItem", shape.marker.markerEnd);
    const interior = { text, blocks: inner.run() };
    return listItemNode(shape, interior, {
      gaps: this.scope.gaps,
      at: this.at,
      // A `+` popped off an item read from ANOTHER item's buffer is
      // not provably the one Ruby pops — the enclosing scan reshaped
      // the lines first — so the byte is kept
      // (keptTrailingContinuation).
      nested: this.confinement?.kind === "item",
    });
  }

  /**
   * Whether the next block belongs to a list item's DIRECT interior.
   * `options[:list_type]` travels only through parse_list_item's own
   * next_block loop: a delimited block inside the item parses its
   * children from a fresh reader with no list flavor (`build_block` →
   * `Reader.new`), which is now literally what happens — the block
   * child carries `kind: "block"`, so the item's contexts stop at it
   * BY CONSTRUCTION (the confinement record's flavor bit; pinned by
   * the flavor-bit row in tests/format/confinement.test.ts).
   * @returns true in an item-confined reader
   */
  private directlyInItem(): boolean {
    return this.confinement?.kind === "item";
  }

  /**
   * Which interrupting set a paragraph-shaped block gets here. Ruby's
   * next_block reads an in-item paragraph with `read_paragraph_lines
   * reader, skipped == 0 && options[:list_type]` (parser.rb l.754/764):
   * adjacent to the previous content the list-item set applies; after
   * any blank line — an erased `+` included, which the buffer spells as
   * a blank — the plain set does (the registry's listContinuation).
   * @returns the context for the block about to be read
   */
  private bodyContext(): ParagraphContext {
    if (!this.directlyInItem()) return "paragraph";
    return this.blanks > 0 ? "listContinuation" : "listItem";
  }

  /**
   * The two leaf kinds that carry their parse: the builder takes the
   * classifier's fields, so no second pattern ever re-reads the line.
   * @param line - the source line
   * @param kind - what the classifier made of it
   * @returns whether the line was consumed
   */
  private parsedLeaf(line: SourceLine, kind: LineKind): boolean {
    if (kind.kind === "attributeEntry") {
      // Transparent to the blank run — see transparentLeaf.
      this.transparentLeaf(
        buildAttributeEntry(kind, fragmentOfLine(line), this.at),
      );
      return true;
    }
    if (kind.kind === "blockMacro") {
      this.leaf(buildBlockMacro(kind, fragmentOfLine(line), this.at));
      return true;
    }
    return false;
  }

  // ── block level: next_section / parse_block_metadata_line / next_block

  /**
   * Dispatch a line that starts a block.
   * @param line - the source line
   * @param kind - what the classifier made of it
   */
  private blockLine(line: SourceLine, kind: LineKind): void {
    if (this.holdMetadata(line, kind)) return;
    if (this.verbatimStyledOpen(line, kind)) return;
    if (this.parsedLeaf(line, kind)) return;
    if (isLeafKind(kind.kind)) {
      this.leaf(leafBuilder(kind.kind)(fragmentOfLine(line), this.at));
      return;
    }
    switch (kind.kind) {
      case "sectionTitle": {
        this.sectionTitle(line, kind);
        return;
      }
      case "delimiterOpen": {
        this.openDelimited(line, kind.block);
        return;
      }
      case "admonitionLabel": {
        this.admonition(this.bodyContext(), line, kind.labelEnd);
        return;
      }
      case "indented": {
        this.literalParagraph();
        return;
      }
      case "dlistTerm": {
        this.paragraph("dlistItem", kind.indent);
        return;
      }
      case "listMarker": {
        this.list(kind);
        return;
      }
      case "continuation": {
        this.continuationLine(line);
        return;
      }
      default: {
        this.paragraph(this.bodyContext(), 0);
      }
    }
  }

  /**
   * A lone `+` opening a block — three readings, decided here:
   *
   * - In an item's buffer, a `+` still carrying the scan's marker tag
   *   and standing after one or more skipped blanks (an erased `+`
   *   counts — it reads as a blank here, exactly as it does to the
   *   oracle's coercing skip) opens the non-content-adjacent FOLD
   *   (`skipped === 0 && options.list_type` is false at parser.js
   *   l.1065): a paragraph that runs THROUGH marker lines and stops at
   *   the plain-paragraph break set (continuationFoldExtent).
   * - Any other `+` directly in an item is Ruby's frozen adjacent
   *   continuation (parser.rb l.1443-48), kept as its own raw line
   *   rather than folded into the paragraph — the pinned oracle
   *   divergence: same bytes, same rendering, and a column-0 `+` may
   *   not be reflowed into text. Transparent to the blank run — see
   *   transparentLeaf: the erased `+` above it reads as a blank to
   *   Ruby, so the paragraph after this line keeps the
   *   listContinuation set.
   * - At block level a lone `+` opens a plain paragraph:
   *   read_lines_until breaks on a `+` only once a line has been read
   *   (`line_read`).
   * @param line - the `+` line
   */
  private continuationLine(line: SourceLine): void {
    if (!this.directlyInItem()) {
      this.paragraph("paragraph", 0);
      return;
    }
    if (this.blanks > 0 && line.continuationTag === "marker") {
      this.flushMetadata();
      const { tokens, end } = continuationFoldExtent(this.scan, this.index);
      this.resume(end);
      this.push(buildParagraph(tokens, this.at));
      return;
    }
    this.transparentLeaf(buildRawBlockLine(fragmentOfLine(line), this.at));
  }

  /** Consume the current line and forget the blank run before it. */
  private advance(): void {
    this.index += 1;
    this.blanks = 0;
  }

  /**
   * `parse_block_metadata_line`: an anchor, an attribute list or a
   * block title annotates the block that FOLLOWS, and comment and
   * preprocessor lines are consumed inside the same scan — all before
   * `next_section` asks whether the next line is a title. Holding them
   * back together is what keeps source order when a heading lands
   * between them: the run flushes ahead of the heading leaf, in the
   * order it was written.
   * @param line - the source line
   * @param kind - what the classifier made of it
   * @returns whether the line was held back
   */
  private holdMetadata(line: SourceLine, kind: LineKind): boolean {
    if (!this.held.hold(line, kind, this.at)) return false;
    this.headerReachable &&= headerSurvivesHold(
      kind,
      this.held.holdsStyleAttribute(),
    );
    this.index += 1;
    // The blank run is deliberately NOT reset: Ruby counts `skipped`
    // BEFORE parse_block_metadata_lines consumes these lines (next_block
    // l.505), so held metadata is transparent to the in-item paragraph
    // context. Nothing at document level reads `blanks`. One known
    // asymmetry, verified unobservable: blanks AFTER held metadata do
    // not update Ruby's `skipped` either (the metadata loop's own
    // skip_blank_lines at l.523 discards its count) while ours land in
    // `blanks` — but a metadata line keeps the continuation `:active`,
    // so the content after such a blank arrives with the buffer's first
    // line already an erased `+` (skipped ≥ 1 on both readings); no
    // buffer reaches bodyContext with the two disagreeing.
    return true;
  }

  /** Release every held-back node, in source order. */
  private flushMetadata(): void {
    for (const node of this.held.drain()) this.push(node);
  }

  /**
   * The held style, when the reader may ACT on it — see
   * {@link HeldMetadata.actionableStyle}.
   * @returns the style, or undefined when none is actionable
   */
  private actionableStyle(): string | undefined {
    return this.held.actionableStyle();
  }

  /**
   * The annotation the reader is about to act on — see
   * {@link HeldMetadata.annotation}.
   * @returns the sibling-to-be's value, or undefined
   */
  private annotation(): string | undefined {
    return this.held.annotation();
  }

  /**
   * A heading line — a LEAF at every level. The section
   * frame only routed finished nodes into a container, deciding
   * nothing about any line, which is why it left without a
   * reader-visible trace; the CONFINEMENT arm below is a different
   * thing entirely — the physical line boundary of an interior
   * (parse_list_item l.1373; parse_blocks, parser.rb:1091-1092,
   * pinned by oracle rows P4/P5).
   * @param line - the title line
   * @param kind - the classifier's parse of the title line
   * @param kind.level - the classifier's level; 0 is the document title
   * @param kind.title - the title text after the markers
   */
  private sectionTitle(
    line: SourceLine,
    kind: { level: number; title: string },
  ): void {
    if (this.confinement !== undefined) {
      // ONE arm for both flavors: bodyContext() already answers
      // "paragraph" for a block child, because directlyInItem() is
      // false there.
      this.paragraph(this.bodyContext(), 0);
      return;
    }
    if (this.held.heldStyle() === DISCRETE_STYLE) {
      this.leaf(
        buildDiscreteHeading(
          fragmentOfLine(line),
          kind.level,
          kind.title,
          this.at,
        ),
      );
      return;
    }
    if (kind.level === DOCUMENT_TITLE_LEVEL && this.headerReachable) {
      // The header is a COMPOSITE where the level-0 heading it
      // replaces was a leaf, and that is the whole change: its lines
      // belong to it, so the printer joins them with a plain newline
      // and never gets to insert the blank line that demotes the
      // author line to body content (issue #18). Flush first, for the
      // reason readText states.
      this.flushMetadata();
      const header = documentHeader(this.headerScan, this.index, kind.title);
      this.push(header.node);
      this.resume(header.end);
      return;
    }
    this.leaf(
      buildHeading(fragmentOfLine(line), kind.level, kind.title, this.at),
    );
  }

  /**
   * What the document-header scan is given: the stream and the facts
   * fixed over it, built fresh per call for the reason
   * {@link BlockReader.scan} states.
   * @returns the scan value
   */
  private get headerScan(): HeaderScan {
    return { source: this.source, lines: this.lines, at: this.at };
  }

  // ── delimited blocks: is_delimited_block? + build_block ────────────

  /**
   * Open a delimited block — the WHOLE read at the opening line:
   * capture the annotation, resolve the style (style and content
   * model are both decided HERE, at open), flush, collect the extent
   * (build_block's read_lines_until, parser.rb:1016-1086), then
   * either slice (verbatim — the collected lines ARE the content and
   * no reader ever holds them, :1037-1039) or parse the interior
   * with a fresh CONFINED child reader (compound, :1046; no sections
   * inside, :1091-1092), and resume past the extent. Held metadata
   * order is untouched by construction: the flush still happens
   * between the style resolution and the first interior line.
   * @param line - the opening delimiter line
   * @param block - which delimited block it opens
   */
  private openDelimited(line: SourceLine, block: DelimiterKind): void {
    const annotatedBy = this.annotation();
    const resolved = resolveDelimitedOpen(block, this.actionableStyle());
    this.flushMetadata();
    const extent = delimitedExtent(this.lines, this.index, block);
    const blockExtent = blockExtentOf(
      extent,
      this.source,
      this.forcedCloseOffset,
    );
    if (resolved.model === "verbatim") {
      const node = buildVerbatimBlock(
        blockExtent,
        withFenceLanguage(resolved.role, block, line.text),
        this.at,
      );
      // annotatedBy stays a POST-construction assignment: serialized
      // key order is a contract (tests/parser/heading.test.ts), and
      // stamping here keeps this key trailing `position`, which is
      // admissible only because the parity fold drops it before
      // digesting (scripts/parity.ts).
      if (node.type === "delimitedBlock" && annotatedBy !== undefined) {
        node.annotatedBy = annotatedBy;
      }
      this.push(node);
    } else {
      const child = new BlockReader(this.scope, extent.interior, {
        kind: "block",
        tailSafe: extent.close !== undefined || this.tailSafe,
        closeOffset: extent.close?.offset ?? this.forcedCloseOffset,
      });
      const children = child.run();
      this.push(
        resolved.admonition === undefined
          ? buildParentBlock(blockExtent, resolved.variant, children, this.at)
          : buildDelimitedAdmonition(
              blockExtent,
              { delimiter: resolved.variant, variant: resolved.admonition },
              children,
              this.at,
            ),
      );
    }
    this.index = extent.resume;
    this.blanks = 0; // the reset today's close-then-advance performed
  }

  /**
   * `next_block`'s verbatim-styled branch (parser.rb:561-567): with a
   * held VERBATIM_STYLES style actionable (the transparency guard in
   * {@link BlockReader.actionableStyle}), every line
   * except a section title, a delimiter and an attribute entry opens
   * the styled paragraph AT that line — list markers, macros, breaks,
   * admonition labels, dlist terms, indented lines, a lone `+`, plain
   * text alike (probed: `"[source]\n* item\n"` is one listing).
   * Section titles keep their own dispatch (next_section runs outside
   * next_block); a delimiter goes to openDelimited's masquerade
   * resolution; an attribute entry stays a leaf whose flush kills the
   * style (a recorded divergence from Ruby's drain, which runs
   * `process_attribute_entry` on an `AttributeEntryRx` line,
   * parser.rb:2083-2085 — unchanged here).
   * @param line - the line about to open a block
   * @param kind - what the classifier made of it
   * @returns whether a styled paragraph was read
   */
  private verbatimStyledOpen(line: SourceLine, kind: LineKind): boolean {
    if (
      kind.kind === "sectionTitle" ||
      kind.kind === "delimiterOpen" ||
      kind.kind === "attributeEntry"
    ) {
      return false;
    }
    const variant = verbatimStyledVariant(this.actionableStyle());
    if (variant === undefined) return false;
    const annotatedBy = this.annotation();
    this.flushMetadata();
    const { lines, end } = verbatimStyledExtent(this.scan, this.index);
    this.resume(end);
    const [firstLine, ...rest] = lines;
    const node = buildStyledParagraph(
      variant,
      fragmentOfLine(firstLine),
      rest.map((each) => fragmentOfLine(each)),
      this.at,
    );
    if (annotatedBy !== undefined) node.annotatedBy = annotatedBy;
    this.push(node);
    return true;
  }

  /**
   * End of input: release the held-back nodes — the flat reader has
   * nothing else to close.
   */
  private closeAll(): void {
    this.flushMetadata();
  }
}

/**
 * Read a whole document into its AST.
 *
 * The reader collects a flat block sequence; the document node that
 * wraps it is built here, where the whole source's extent is known.
 *
 * The end position is `at.at(source.length)`: one past the last
 * character, on the line a further character would land on — the
 * same answer for `"a\n"`, `"a"` and `""` that the old document-end
 * helper gave, pinned by tests/parser/positions.test.ts.
 * @param source - the whole document
 * @returns the root node
 */
export function readDocument(source: string): DocumentNode {
  const documentLines = splitLines(source);
  const at = makeLocationIndex(source);
  // One gap record per document — see ReaderScope.gaps.
  const scope: ReaderScope = { source, at, gaps: new Map() };
  const reader = new BlockReader(scope, documentLines);
  const children = reader.run();
  // The mark splitLines skipped, recorded so the printer can re-emit
  // it. Left OFF the node when there is none, rather than set to the
  // empty string: an unmarked document's serialized tree must look
  // exactly as it did before the field existed.
  const byteOrderMark = documentBom(source);
  return {
    type: "document",
    children,
    byteOrderMark: byteOrderMark === "" ? undefined : byteOrderMark,
    position: {
      start: at.at(0),
      end: at.at(source.length),
    },
  };
}
