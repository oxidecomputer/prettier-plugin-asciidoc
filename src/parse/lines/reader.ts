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
import type { BlockNode, DocumentNode } from "../../ast.js";
import {
  buildDelimitedAdmonition,
  buildParentBlock,
  buildVerbatimBlock,
} from "../build/delimited.js";
import { buildDiscreteHeading, buildHeading } from "../build/heading.js";
import {
  buildAttributeEntry,
  buildBlockMacro,
  buildRawBlockLine,
} from "../build/metadata.js";
import {
  buildAdmonitionParagraph,
  buildLiteralParagraph,
  buildParagraph,
  buildParagraphNode,
  buildStyledParagraph,
} from "../build/paragraph.js";
import { buildTable } from "../build/table.js";
import type { InlineToken } from "../inline/tokens.js";
import type { OpenList, ParagraphContext } from "../line-shapes.js";
import { makeLocationIndex, type LocationIndex } from "../positions.js";
import { readAttributeEntry } from "./attribute-entry.js";
import {
  classifyLine,
  classifyTrace,
  type DelimiterKind,
  type DlistTermKind,
  type LineKind,
  type MarkerKind,
  type SectionTitleKind,
} from "./classify.js";
import { blockExtentOf, delimitedExtent } from "./delimited-reader.js";
import { readFrontMatter } from "./front-matter.js";
import { isLeafKind, leafBuilder } from "./frames.js";
import {
  documentHeader,
  headerSurvivesBlock,
  headerSurvivesHold,
  type HeaderScan,
} from "./header-reader.js";
import { HeldMetadata } from "./held-metadata.js";
import {
  blockStartContextIn,
  bodyContextIn,
  closeOffsetIn,
  directiveDepthAfter,
  directlyInItem,
  openListIn,
  tailSafeIn,
  type Confinement,
  type ReaderScope,
} from "./scope.js";
import type { ItemInterior } from "./item-body.js";
import {
  readDescriptionList,
  readMarkerList,
  type ListHost,
} from "./list-read.js";
import {
  admonitionLabelOpensABlock,
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
  type TextOpen,
} from "./paragraph-reader.js";
import {
  documentBom,
  fragmentOfLine,
  fragmentOfLines,
  splitLines,
  type SourceLine,
} from "./split.js";
import { readTable } from "./table-open.js";

// Text starting at `from` whose `//` lines are the comments they look
// like, which is every paragraph but one: `read_paragraph_lines`
// passes `skip_line_comments` on every path except the literal branch
// of an item whose `text_only` is unset, and a dlist item carrying its
// own text is the only item that leaves it unset (parser.rb l.754,
// l.1367-74).
const textAt = (from: number): TextOpen => ({ from, comments: "skipped" });

// The one block-attribute style the reader itself acts on: it turns the
// heading that follows into a discreteHeading leaf instead of an
// ordinary one.
const DISCRETE_STYLE = "discrete";

// The heading level `= Title` spells - the only level a document
// header opens at (`is_next_line_doctitle?`, parser.rb).
const DOCUMENT_TITLE_LEVEL = 0;

// The title extent an UNDERLINED title spells; the ATX one spells 1.
// Owned by the classifier's `extent` field (lines/classify.ts).
const UNDERLINED_TITLE = 2;

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
   * `skipped` count in `next_block` (parser.rb l.505): a confined
   * reader picks an in-item paragraph's interrupting set by it (see
   * {@link BlockReader.bodyContext}). An erased `+` in an item's buffer
   * reads as a blank here, exactly as it does to Ruby.
   */
  private blanks = 0;
  /**
   * How many conditional pairs stand open over the read position -
   * the depth of Ruby's own `@conditional_stack`, which an `endif`
   * pops (reader.rb l.919) and a region form pushes (l.1005) -
   * counted rather than evaluated: the formatter never resolves a
   * condition, so what this holds is the nesting the AUTHOR wrote.
   * Reader state beside {@link BlockReader.blanks}, folded forward
   * over the lines this reader walks and handed on as data - to every
   * reader it confines ({@link Confinement.directiveDepth}) and to
   * every extent scan it starts, which then counts its own. THE ONE
   * PRODUCER: no other module writes it.
   *
   * A reader resumes past a whole list or delimited block in one
   * step, so a pair a construct's own lines opened and did not close
   * is not counted here; the scan that read those lines counted them
   * for itself, which is where the question is asked.
   */
  private directiveDepth: number;
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
   *   boundary fact (`tailSafeIn`, scope.ts). Its `closeOffset` is
   *   where a forced close at this reader's stream end falls:
   *   computed at the ONE place that knows the boundary (listItem()
   *   for an item buffer, the compound open for an interior) and
   *   consumed as data (`closeOffsetIn`, scope.ts).
   */
  constructor(
    scope: ReaderScope,
    private readonly lines: readonly SourceLine[],
    private readonly confinement?: Confinement,
  ) {
    ({ source: this.source, at: this.at } = scope);
    this.scope = scope;
    this.directiveDepth = confinement?.directiveDepth ?? 0;
  }

  // ── context ────────────────────────────────────────────────────────

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
      openList: openListIn(this.confinement),
    };
  }

  /**
   * Which interrupting set a paragraph-shaped block gets here - the
   * reading, over this reader's own two inputs ({@link bodyContextIn},
   * scope.ts).
   * @returns the context for the block about to be read
   */
  private get body(): ParagraphContext {
    return bodyContextIn(this.confinement, this.blanks);
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
   * second header per document unreachable. The metadata run ends
   * here for the same reason (`blockJoined`, lines/held-metadata.ts):
   * an attribute entry and a comment block are pushed as blocks of
   * their own and Ruby's own metadata loop reads through both, so the
   * question cannot be answered from what is still held.
   * @param node - the block just built
   */
  private push(node: BlockNode): void {
    this.headerReachable &&= headerSurvivesBlock(node.type);
    this.held.blockJoined(node);
    this.blocks.push(node);
  }

  /**
   * Push a block that occupies WHOLE LINES, releasing any metadata it
   * annotates first. One line unless the caller says otherwise: an
   * attribute entry whose value is continued onto the lines below it
   * (attribute-entry.ts) is the one leaf that reaches past its own
   * line, and it passes the resume index its own read measured.
   * @param node - the block
   * @param end - the read's resume index; the next line by default
   */
  private leaf(node: BlockNode, end = this.index + 1): void {
    this.flushMetadata();
    this.push(node);
    this.resume(end);
  }

  /**
   * Push a one-line block WITHOUT resetting the blank run — for lines
   * Ruby's `skipped` count reads through: a document attribute is
   * processed inside parse_block_metadata_lines (next_block parser.rb
   * l.518), and an unerased `+` kept as a raw line reads as a blank to
   * Ruby's prev_line. The transparency is stated here, where it is
   * decided, instead of being repaired around leaf() after the fact;
   * pinned by tests/parser/reader-lists.test.ts's attribute-entry and
   * kept-`+` rows.
   * @param node - the block
   * @param end - the read's resume index; the next line by default
   */
  private transparentLeaf(node: BlockNode, end = this.index + 1): void {
    const { blanks } = this;
    this.leaf(node, end);
    this.blanks = blanks;
  }

  // ── extent-first opens: flush, scan, resume ────────────────────────

  /**
   * Take an extent a scan just measured: move the read position past
   * it and forget the blank run before it. Every scan consumes at
   * least its own opening line, so the blank run is always over by
   * the time the position moves.
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
   * @param text - where the text starts and how its `//` lines read
   *   (see {@link TextOpen})
   * @returns the body's tokens
   */
  private readText(context: ParagraphContext, text: TextOpen): InlineToken[] {
    this.flushMetadata();
    const body = paragraphExtent(this.scan, this.index, context, text);
    this.resume(body.end);
    return body.tokens;
  }

  /**
   * Read a plain paragraph — the one opening at the read position —
   * and push it.
   * @param context - which interrupting set applies
   * @param text - where its text starts and how its `//` lines read
   *   (see {@link TextOpen})
   */
  private paragraph(context: ParagraphContext, text: TextOpen): void {
    // The held run is asked BEFORE readText flushes it, because the
    // flush is what releases its nodes and the admonition arm takes
    // one of them; the extent is the paragraph's own either way
    // (unchanged context threading).
    const opening = this.held.paragraphOpening(
      admonitionLabelOpensABlock(context, this.blocks.at(-1)),
    );
    const tokens = this.readText(context, text);
    this.push(buildParagraphNode(opening, tokens, this.source, this.at));
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
    const tokens = this.readText(context, textAt(labelEnd));
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
    const annotatedBy = this.held.annotation();
    this.flushMetadata();
    const { lines, end } = literalParagraphExtent(this.scan, this.index);
    this.resume(end);
    const [firstLine, ...rest] = lines;
    const node = buildLiteralParagraph(
      fragmentOfLine(firstLine),
      rest.map((each) => fragmentOfLine(each)),
      this.at,
      annotatedBy,
    );
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
      const kind = classifyLine(
        line.text,
        blockStartContextIn(
          this.confinement,
          this.lines.at(this.index + 1)?.text,
        ),
      );
      classifyTrace.observer?.(line.offset, kind);
      this.directiveDepth = directiveDepthAfter(this.directiveDepth, line.text);
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
   * `listShape` decides every item's EXTENT from the lines alone
   * (list-read.ts assembles what it found); this method owns the
   * recursion those extents call for, one confined reader per item.
   *
   * Metadata read ahead of the first marker annotates the LIST, so it
   * flushes into this container BEFORE any item is read: the order is
   * decided here, at the one call site that owns the block sequence.
   * @param kind - the opening marker, as the classifier parsed it
   */
  private list(kind: MarkerKind): void {
    this.flushMetadata();
    this.takeList(readMarkerList(this.listHost, kind));
  }

  /**
   * The same for a list a TERM line opens. A description list is read
   * by the list machinery, not by a reader of its own: the item scan,
   * the sibling loop and the confined re-read are all shared, and
   * what a description spells differently is its assembly
   * (list-read.ts).
   * @param kind - the opening term line, as the classifier parsed it
   */
  private descriptionList(kind: DlistTermKind): void {
    this.flushMetadata();
    this.takeList(readDescriptionList(this.listHost, kind));
  }

  /**
   * Take a finished list: push it and move the read position past it.
   * @param read - what one of the two list reads produced
   * @param read.node - the list node it built
   * @param read.end - the index the reader resumes at
   */
  private takeList(read: { node: BlockNode; end: number }): void {
    this.push(read.node);
    this.resume(read.end);
  }

  /**
   * What a list read is given here - the stream, the facts fixed over
   * it, and the one operation only a reader can perform. Built fresh
   * per call for the reason {@link BlockReader.scan} states.
   * @returns the host value
   */
  private get listHost(): ListHost {
    return {
      scope: this.scope,
      lines: this.lines,
      at: this.index,
      tailSafe: tailSafeIn(this.confinement),
      directiveDepth: this.directiveDepth,
      interiorOf: (markerLine, buffer, item, open) =>
        this.itemInterior(markerLine, buffer, item, open),
    };
  }

  /**
   * Read one item's interior - Ruby's `Reader.new
   * read_lines_for_list_item(...)` + the `next_block` loop of
   * parse_list_item (parser.rb l.1359-1384). The item's own line
   * rides at the front of the confined reader's lines so the text
   * scan consumes it and the text's continuation lines come from the
   * buffer; the rest of the buffer is then read by the ordinary block
   * loop, whose blocks ARE the item's blocks.
   * @param markerLine - the item's marker or term line
   * @param buffer - the item's lines, as its own read left them
   * @param item - the item's ancestry list and its tail safety
   * @param item.list - the one-list ancestry a confined reader sees
   * @param item.tailSafe - the item's own tail safety
   * @param open - where the item's text starts and under which
   *   interrupting set it is read
   * @param open.context - which interrupting set applies
   * @param open.text - where the text starts and how its `//` lines
   *   read
   * @returns the item's text and blocks
   */
  private itemInterior(
    markerLine: SourceLine,
    buffer: readonly SourceLine[],
    item: { list: OpenList; tailSafe: boolean },
    open: { context: ParagraphContext; text: TextOpen },
  ): ItemInterior {
    // The buffer's last line - the item's own line when the buffer is
    // empty - is where a forced close inside this item falls: its raw
    // end, the vii-b clamp as DATA.
    const last = buffer.at(-1) ?? markerLine;
    const inner = new BlockReader(this.scope, [markerLine, ...buffer], {
      kind: "item",
      list: item.list,
      tailSafe: item.tailSafe,
      directiveDepth: this.directiveDepth,
      closeOffset: last.offset + last.raw.length,
    });
    const text = inner.readText(open.context, open.text);
    return { text, blocks: inner.run() };
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
      // An entry reaches past its own line when its value is
      // continued (attribute-entry.ts), so the read owns the resume
      // index.
      const entry = readAttributeEntry(this.scan, this.index, kind);
      // Transparent to the blank run — see transparentLeaf.
      this.transparentLeaf(
        buildAttributeEntry(entry.fields, entry.span, this.at),
        entry.resume,
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
        this.admonition(this.body, line, kind.labelEnd);
        return;
      }
      case "indented": {
        this.literalParagraph();
        return;
      }
      case "dlistTerm": {
        this.descriptionList(kind);
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
        this.paragraph(this.body, textAt(0));
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
    if (!directlyInItem(this.confinement)) {
      this.paragraph("paragraph", textAt(0));
      return;
    }
    if (this.blanks > 0 && line.continuationTag === "marker") {
      this.flushMetadata();
      const { tokens, end } = continuationFoldExtent(this.scan, this.index);
      this.resume(end);
      this.push(buildParagraph(tokens, this.source, this.at));
      return;
    }
    this.transparentLeaf(buildRawBlockLine(fragmentOfLine(line), this.at));
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
    // BEFORE parse_block_metadata_lines consumes these lines
    // (next_block, parser.rb l.505), so held metadata is transparent
    // to the in-item paragraph context. Nothing at document level
    // reads `blanks`. One known asymmetry, verified unobservable:
    // blanks AFTER held metadata do not update Ruby's `skipped`
    // either (the metadata loop's own skip_blank_lines at l.523
    // discards its count) while ours land in
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
   * A heading line — a LEAF at every level. The section
   * frame only routed finished nodes into a container, deciding
   * nothing about any line, which is why it left without a
   * reader-visible trace; the CONFINEMENT arm below is a different
   * thing entirely — the physical line boundary of an interior
   * (parse_list_item l.1373; parse_blocks, parser.rb:1091-1092,
   * pinned by oracle rows P4/P5).
   * A title takes ONE line in the ATX spelling and TWO in the
   * underlined one, and the classifier carries which; every arm below
   * spans the node over that many lines and resumes past them, so the
   * two spellings differ nowhere else and the printer sees one kind
   * of heading.
   * @param line - the title line
   * @param kind - the classifier's parse of the title line
   */
  private sectionTitle(line: SourceLine, kind: SectionTitleKind): void {
    if (this.confinement !== undefined) {
      // ONE arm for both flavors: bodyContext() already answers
      // "paragraph" for a block child, because directlyInItem() is
      // false there.
      this.paragraph(this.body, textAt(0));
      return;
    }
    const end = this.index + kind.extent;
    const span = fragmentOfLines(this.source, line, this.lines[end - 1]);
    // What an ATX-PRINTED heading can carry. An underlined title's
    // text is the whole line, indent included (the classifier keeps
    // Ruby's group), and the marker run this printer writes puts the
    // title after `[ \t]+`, which the reader eats coming back: so
    // `==   lit` re-reads as `lit` whatever was recorded, and keeping
    // the indent only makes pass 1 emit a line pass 2 rewrites. The
    // heading text loses a leading space, where refusing the line
    // would lose the whole heading to the literal-paragraph branch.
    // The HEADER arm below takes `kind.title` instead, because it
    // replays the two source lines rather than respelling them and
    // the width rule that admitted the pair was applied to the line
    // as written.
    const atxTitle = kind.title.trimStart();
    if (this.held.heldStyle() === DISCRETE_STYLE) {
      this.leaf(buildDiscreteHeading(span, kind.level, atxTitle, this.at), end);
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
      // The underline rides into the header and nowhere else: it is
      // the ONE spelling this AST may not normalize away, because a
      // setext DOCTITLE turns compat mode on for the whole document
      // (see DocumentHeaderNode.underline, src/ast.ts). Read off the
      // classifier's extent, the same fact that spanned the node.
      const underlined = kind.extent === UNDERLINED_TITLE;
      const header = documentHeader(this.headerScan, end, {
        text: kind.title,
        span,
        underline: underlined ? this.lines[end - 1].text : undefined,
      });
      this.push(header.node);
      this.resume(header.end);
      return;
    }
    this.leaf(buildHeading(span, kind.level, atxTitle, this.at), end);
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
    const annotatedBy = this.held.annotation();
    // Read BEFORE the flush, like the annotation beside it: both are
    // questions about the run the flush is about to empty. Only a
    // table acts on the second - every other block reads the held
    // annotation for its style, and a style is what actionableStyle
    // already answers under its own transparency rule.
    const held = { annotatedBy, attrlistUnread: this.held.unreadAttrlist() };
    const resolved = resolveDelimitedOpen(block, this.held.actionableStyle());
    this.flushMetadata();
    const extent = delimitedExtent(this.lines, this.index, block);
    // THIS reader's forced-close boundary, read once because both
    // uses below want it: the extent is stamped with it when the
    // block never closed, and the child inherits it for the same
    // reason one line further down.
    const closeAt = closeOffsetIn(this.confinement, this.source);
    const blockExtent = blockExtentOf(extent, this.source, closeAt);
    if (resolved.model === "table") {
      // The confined-reader branch below is not reachable for a table:
      // its interior is cells, never blocks.
      const scan = readTable(extent.interior, resolved.hint, annotatedBy);
      this.push(buildTable(blockExtent, scan, this.at, held));
    } else if (resolved.model === "verbatim") {
      const node = buildVerbatimBlock(
        blockExtent,
        withFenceLanguage(resolved.role, line.text),
        this.at,
        annotatedBy,
      );
      this.push(node);
    } else {
      const children = new BlockReader(this.scope, extent.interior, {
        kind: "block",
        tailSafe: extent.close !== undefined || tailSafeIn(this.confinement),
        directiveDepth: this.directiveDepth,
        closeOffset: extent.close?.offset ?? closeAt,
      }).run();
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
    const variant = verbatimStyledVariant(this.held.actionableStyle());
    if (variant === undefined) return false;
    const held = { variant, annotatedBy: this.held.annotation() };
    this.flushMetadata();
    const { lines, end } = verbatimStyledExtent(this.scan, this.index);
    this.resume(end);
    const [firstLine, ...rest] = lines;
    const node = buildStyledParagraph(
      held,
      fragmentOfLine(firstLine),
      rest.map((each) => fragmentOfLine(each)),
      this.at,
    );
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
  // Front matter comes OFF the stream before the reader walks it, as
  // it does for Asciidoctor's own reader (front-matter.ts): it is a
  // question about the document's first lines, and the BlockReader
  // reads an item's buffer and a block's interior with the same code
  // that reads the document.
  const front = readFrontMatter(source, documentLines, at);
  const body =
    front === undefined ? documentLines : documentLines.slice(front.resume);
  const read = new BlockReader(scope, body).run();
  const children = front === undefined ? read : [front.node, ...read];
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
