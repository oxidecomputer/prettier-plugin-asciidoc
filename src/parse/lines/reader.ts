/**
 * The BlockReader: Asciidoctor's line reader as ONE explicit state
 * machine. It walks the lines once with a frame stack and decides where
 * blocks END where Asciidoctor does — `Parser.next_section` (section
 * boundaries and the block-metadata lookahead),
 * `parse_block_metadata_lines`, `next_block` (what a block's first line
 * opens), `is_delimited_block?` / `build_block` (terminators), and
 * `read_paragraph_lines` / `Reader.read_lines_until` (paragraph extent,
 * in paragraph-reader.ts) — and builds the AST as it goes. A frame IS
 * the node under construction: every container frame owns the blocks
 * pushed into it, and closing a frame builds its node and gives it to
 * the parent. There is no event stream between reading and the tree.
 *
 * Nothing downstream ever re-derives block context: this stack is the
 * only place it exists. Lists are the one construct read RECURSIVELY
 * (spec D3): list-reader.ts's `readList` bounds each item with the
 * `read_lines_for_list_item` port and parses its interior from a fresh
 * CONFINED BlockReader over the item's buffer — Ruby's
 * `next_block(list_item_reader, …, list_type:)` — reached through the
 * {@link ListHost} seam this class implements. What a node is MADE of
 * is the builders' business (src/parse/build/); this file only decides
 * which one to call and where its result goes.
 */
import type { BlockNode, DocumentNode, ParentBlockNode } from "../../ast.js";
import {
  EMPTY,
  FIRST,
  LAST_ELEMENT,
  NEXT,
  NOT_FOUND,
} from "../../constants.js";
import {
  buildParentBlock,
  buildVerbatimBlock,
  type BlockExtent,
} from "../build/delimited.js";
import { buildRawBlockLine } from "../build/metadata.js";
import {
  buildAdmonitionParagraph,
  buildLiteralParagraph,
  buildParagraph,
} from "../build/paragraph.js";
import {
  buildDiscreteHeading,
  buildDocumentTitle,
  buildSection,
} from "../build/section.js";
import type { InlineToken } from "../inline/tokens.js";
import { textLines } from "../inline/text-lines.js";
import type { ParagraphContext } from "../line-shapes.js";
import { convertParagraphFormBlocks } from "../paragraph-form.js";
import { makeLocationIndex, type LocationIndex } from "../positions.js";
import {
  classifyLine,
  type DelimiterKind,
  type LineKind,
  type ReaderContext,
} from "./classify.js";
import {
  fragmentOfLine,
  heldMetadataNode,
  isLeafKind,
  leafBuilder,
  type Frame,
  type ListHost,
} from "./frames.js";
import { FENCE_TIP, readList } from "./list-reader.js";
import { readLiteralParagraph, readParagraph } from "./paragraph-reader.js";
import { splitLines, type SourceLine } from "./split.js";

// Delimited blocks whose content is parsed as BLOCKS rather than kept
// verbatim — `DELIMITED_BLOCKS`' content model, minus the masquerades
// (`[source]` on a `--` block and friends), which stay a post-hoc
// re-slice in paragraph-form.ts exactly as today — and the parent-block
// variant each one opens. Any other delimiter opens a verbatim frame.
const COMPOUND_VARIANTS = new Map<DelimiterKind, ParentBlockNode["variant"]>([
  ["example", "example"],
  ["sidebar", "sidebar"],
  ["openBlock", "open"],
  ["quote", "quote"],
]);

// The one block-attribute style the reader itself acts on: it turns the
// heading that follows into a leaf instead of a section frame.
const DISCRETE_STYLE = "discrete";

// How a delimited block ended: on its own terminator (`close`), or
// forced shut by an outer terminator or EOF (`unclosed`, zero-length,
// at the start of the terminator line or at the document length).
type BlockClose = Pick<BlockExtent, "close" | "unclosed">;

// The bottom frame's shape: the one frame that owns the document's
// children and never closes on a line.
type DocumentFrame = Extract<Frame, Record<"kind", "document">>;

/** What every reader over this document shares, however confined. */
interface ReaderScope {
  /** The whole document. */
  readonly source: string;
  /** The document's offset→Location index, built once. */
  readonly at: LocationIndex;
  /** Every document line, unerased — see ListHost.documentLines. */
  readonly documentLines: readonly SourceLine[];
}

/**
 * Reads one line array into blocks. One instance per document — plus
 * one confined instance per list item, over the item's buffer; `run`
 * consumes it.
 */
class BlockReader implements ListHost {
  readonly source: string;
  readonly at: LocationIndex;
  readonly documentLines: readonly SourceLine[];
  /** The bottom frame, and the total fallback for a pop that cannot fail. */
  private readonly root: DocumentFrame = { kind: "document", children: [] };
  /** The open frames, outermost first; the ONLY block-context store. */
  readonly stack: Frame[] = [this.root];
  /** Index of the next unread line. */
  index = FIRST;
  /**
   * Blank lines seen since the last line the reader CONSUMED — Ruby's
   * `skipped` count in `next_block` (l.499): a confined reader picks
   * an in-item paragraph's interrupting set by it (see
   * {@link BlockReader.bodyContext}). An erased `+` in an item's
   * buffer reads as a blank here, exactly as it does to Ruby.
   */
  blanks = EMPTY;

  // Metadata NODES held back until we know what they annotate.
  // Comment and preprocessor lines ride along so their SOURCE ORDER
  // relative to the metadata survives a section boundary landing
  // between them (see the `raw` case in blockLine).
  private pending: BlockNode[] = [];
  // First positional attribute of the held-back `[…]` line, if any.
  private pendingStyle: string | undefined = undefined;
  private readonly scope: ReaderScope;

  /**
   * @param scope - the document-wide facts every reader shares
   * @param lines - the lines THIS reader walks: the document's, or an
   *   item's buffer (absolute offsets either way)
   * @param confinement - present exactly when this reader parses a
   *   list item's buffer, absent for the document reader. Being
   *   confined is Ruby's `next_block(list_item_reader, …,
   *   list_type:)`: no sections, item-flavored paragraph contexts, a
   *   lone `+` kept as a raw line. Its `style` (the item's own marker
   *   style) feeds `context()`'s ancestry: the foreign-marker rule (a
   *   marker-shaped line inside a `+`-attached paragraph keeps its
   *   own output line, because its column decides
   *   `within_nested_list`) fires only while a list is open, and the
   *   buffer being PHYSICALLY confined means one style stands for the
   *   whole ancestry — a marker of any ENCLOSING list's style cannot
   *   survive into the buffer (the enclosing extent scans stopped at
   *   them), so every marker line the buffer holds is foreign. Its
   *   `tailSafe` is the confined item's own tail-safety, which every
   *   extent scan run from this reader inherits as its stream-end
   *   boundary fact (see {@link BlockReader.tailSafe}).
   * @param confinement.style - the confined item's marker style
   * @param confinement.tailSafe - the confined item's tail-safety
   */
  constructor(
    scope: ReaderScope,
    readonly lines: readonly SourceLine[],
    private readonly confinement?: {
      /** The confined item's marker style. */
      readonly style: string;
      /** The confined item's tail-safety (`ItemExtent.tailSafe`). */
      readonly tailSafe: boolean;
    },
  ) {
    ({
      source: this.source,
      at: this.at,
      documentLines: this.documentLines,
    } = scope);
    this.scope = scope;
    this.confined = confinement !== undefined;
  }
  /** Whether this reader parses a list item's buffer. */
  private readonly confined: boolean;

  /**
   * Whether a `+` printed at the very end of this reader's lines
   * re-reads inert — see ListHost.tailSafe. The document's end is
   * EOF, always safe; a buffer's end is wherever the enclosing item
   * ended, so the answer is that item's own.
   * @returns the boundary fact the extent scans inherit
   */
  get tailSafe(): boolean {
    return this.confinement?.tailSafe ?? true;
  }

  // ── context ────────────────────────────────────────────────────────

  /**
   * The stack as `classifyLine` consumes it — read, never derived.
   * @param openParagraph - which paragraph shape is open, if any
   * @param firstLineAfterStart - whether the line being classified is
   *   the first one after the block started
   * @returns the read-only context view
   */
  context(
    openParagraph?: ParagraphContext,
    firstLineAfterStart = false,
  ): ReaderContext {
    // No list frames exist: lists are read recursively (readList), and
    // a confined reader's buffer is already truncated at every
    // ancestor list's boundary — the physical confinement the styles
    // used to approximate online. What remains of the ancestry is the
    // ONE style the confined reader carries (see the constructor): it
    // tells the classifier a list is open at all, which is what the
    // foreign-marker verbatim rule keys on.
    const openListStyles: string[] =
      this.confinement === undefined ? [] : [this.confinement.style];
    const verbatimTerminators: string[] = [];
    for (const frame of this.stack) {
      if (frame.kind === "verbatim") {
        verbatimTerminators.push(frame.terminator);
      }
    }
    // At most one verbatim frame can ever be open — inside one, every
    // line is content or its terminator — but taking the innermost
    // keeps that an observation rather than an assumption.
    const close = verbatimTerminators.at(LAST_ELEMENT);
    return {
      openParagraph,
      openListStyles,
      openTerminators: this.compoundTerminators(),
      inVerbatim: close === undefined ? undefined : { close },
      firstLineAfterStart,
    };
  }

  /**
   * Terminators of every open COMPOUND block on this reader's stack —
   * what `classifyLine`'s outermost-terminator rule reads.
   * @returns the terminators, outermost first
   */
  private compoundTerminators(): string[] {
    return this.stack.flatMap((frame) =>
      frame.kind === "compound" ? [frame.terminator] : [],
    );
  }

  /**
   * Terminators of every open delimited block on this reader's stack —
   * see ListHost.openTerminators. A confined reader reports its OWN
   * stack only: the enclosing document reader's delimited frames are
   * unreachable from a buffer by construction (the enclosing extent
   * scan already stopped at them). Read off the stack the same way
   * `context()` reads it, so the two can never disagree about which
   * blocks are open.
   * @returns the open terminators, outermost first
   */
  get openTerminators(): readonly string[] {
    return this.stack.flatMap((frame) =>
      frame.kind === "compound" || frame.kind === "verbatim"
        ? [frame.terminator]
        : [],
    );
  }

  /**
   * The innermost open frame.
   * @returns the top of the stack
   */
  topFrame(): Frame {
    // Total fallback: the root frame is pushed at construction and
    // never popped, so the stack is never empty — `at` types the miss
    // whether or not it can happen.
    return this.stack.at(LAST_ELEMENT) ?? this.root;
  }

  /**
   * The next unread line.
   * @returns the line, or undefined at end of input
   */
  peek(): SourceLine | undefined {
    return this.lines.at(this.index);
  }

  // ── where a finished block goes ────────────────────────────────────

  /**
   * Put a finished block where the innermost frame wants it: into the
   * frame's children.
   * @param node - the block just built
   */
  push(node: BlockNode): void {
    const frame = this.topFrame();
    if (frame.kind === "verbatim") {
      // Total fallback: inside a verbatim frame every line is content
      // or the terminator, and content is sliced from the source at
      // close, so nothing is ever pushed here. Returning keeps the
      // function total rather than throwing.
      return;
    }
    frame.children.push(node);
  }

  /**
   * Push a one-line block, releasing any metadata it annotates first.
   * @param node - the block
   */
  leaf(node: BlockNode): void {
    this.flushMetadata();
    this.push(node);
    this.advance();
  }

  /**
   * Read a plain paragraph and push it.
   * @param context - which interrupting set applies
   * @param line - the paragraph's first line
   * @param from - raw column index where its text starts
   */
  paragraph(context: ParagraphContext, line: SourceLine, from: number): void {
    const tokens = readParagraph(this, context, line, from);
    this.push(buildParagraph(tokens, this.at));
  }

  /**
   * Read a paragraph-form admonition (`NOTE: text`) and push it. The
   * label is the node's own span; the body is an ordinary paragraph
   * read from past it (Ruling 21).
   * @param context - which interrupting set applies
   * @param line - the label line
   * @param labelEnd - raw column index where the text starts
   */
  admonition(
    context: ParagraphContext,
    line: SourceLine,
    labelEnd: number,
  ): void {
    const tokens = readParagraph(this, context, line, labelEnd);
    this.push(
      buildAdmonitionParagraph(
        fragmentOfLine(line, FIRST, labelEnd),
        textLines(tokens),
        this.at,
      ),
    );
  }

  /**
   * Read an indented literal paragraph and push it.
   * @param line - its first (indented) line
   */
  literalParagraph(line: SourceLine): void {
    const lines = readLiteralParagraph(this, line);
    this.push(
      buildLiteralParagraph(
        lines.map((each) => fragmentOfLine(each)),
        this.at,
      ),
    );
  }

  // ── main loop ──────────────────────────────────────────────────────

  /**
   * Walk every line once and close whatever is still open at EOF.
   * @returns the blocks read, nested as the frames nested
   */
  run(): BlockNode[] {
    for (;;) {
      const line = this.peek();
      if (line === undefined) {
        break;
      }
      const kind = classifyLine(line.text, this.context());
      if (kind.kind === "blank") {
        this.blanks += NEXT;
        this.index += NEXT;
        continue;
      }
      if (kind.kind === "delimiterClose") {
        this.closeDelimited(line);
        continue;
      }
      if (kind.kind === "verbatim") {
        // Content of the open verbatim block: sliced from the source
        // when the block closes, so the line needs no node of its own.
        this.index += NEXT;
        continue;
      }
      this.blockLine(line, kind);
    }
    this.closeAll();
    return this.root.children;
  }

  // ── the ListHost seam ──────────────────────────────────────────────

  /**
   * Parse one list item's interior from its buffer — Ruby's
   * `Reader.new read_lines_for_list_item(…)` + the `next_block` loop of
   * parse_list_item (l.1350-1375). The marker line rides at the front so
   * `readParagraph`'s advance consumes it and the text's continuation
   * lines come from the buffer; the rest of the buffer is then read by
   * the ordinary block loop, whose root children ARE the item's blocks.
   * @param markerLine - the item's marker line
   * @param marker - the marker as the classifier parsed it
   * @param marker.style - the item's style, the confined ancestry
   * @param marker.markerEnd - raw column where the item's text starts
   * @param buffer - the item's lines, erasures applied (itemExtent)
   * @param tailSafe - the item's own tail-safety (ItemExtent.tailSafe)
   * @returns the principal text's tokens and the item's blocks
   */
  confine(
    markerLine: SourceLine,
    marker: { readonly style: string; readonly markerEnd: number },
    buffer: readonly SourceLine[],
    tailSafe: boolean,
  ): { text: InlineToken[]; blocks: BlockNode[] } {
    const inner = new BlockReader(this.scope, [markerLine, ...buffer], {
      style: marker.style,
      tailSafe,
    });
    const text = readParagraph(inner, "listItem", markerLine, marker.markerEnd);
    return { text, blocks: inner.run() };
  }

  /**
   * Whether the next block belongs to the item's DIRECT interior.
   * `options[:list_type]` travels only through parse_list_item's own
   * next_block loop: a delimited block inside the item parses its
   * children from a fresh reader with no list flavor (`build_block` →
   * `Reader.new`), so once any frame is open the item's contexts no
   * longer apply.
   * @returns true in a confined reader with no open frame
   */
  private directlyInItem(): boolean {
    return this.confined && this.stack.length === NEXT;
  }

  /**
   * Which interrupting set a paragraph-shaped block gets here. Ruby's
   * next_block reads an in-item paragraph with `read_paragraph_lines
   * reader, skipped == 0 && options[:list_type]` (parser.rb l.747/757):
   * adjacent to the previous content the list-item set applies; after
   * any blank line — an erased `+` included, which the buffer spells as
   * a blank — the plain set does (the registry's listContinuation).
   * @returns the context for the block about to be read
   */
  private bodyContext(): ParagraphContext {
    if (!this.directlyInItem()) return "paragraph";
    return this.blanks > EMPTY ? "listContinuation" : "listItem";
  }

  // ── block level: next_section / parse_block_metadata_line / next_block

  /**
   * Dispatch a line that starts a block.
   * @param line - the source line
   * @param kind - what the classifier made of it
   */
  blockLine(line: SourceLine, kind: LineKind): void {
    if (this.holdMetadata(line, kind)) return;
    if (isLeafKind(kind.kind)) {
      // A document attribute is processed inside
      // parse_block_metadata_lines (next_block l.512), so it is
      // transparent to `skipped`: the blank run before it still belongs
      // to the block that follows. The other leaves are blocks of their
      // own and reset the run as any block does.
      const { blanks } = this;
      this.leaf(leafBuilder(kind.kind)(fragmentOfLine(line), this.at));
      if (kind.kind === "attributeEntry") this.blanks = blanks;
      return;
    }
    switch (kind.kind) {
      case "sectionTitle": {
        this.sectionTitle(line, kind.level);
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
        this.literalParagraph(line);
        return;
      }
      case "dlistTerm": {
        this.paragraph("dlistItem", line, kind.indent);
        return;
      }
      case "listMarker": {
        // Lists are the one construct read recursively (spec D3): the
        // extent scan bounds every item, a confined reader parses it,
        // and this loop resumes past the whole list.
        this.index = readList(this, this.index, kind);
        this.blanks = EMPTY;
        return;
      }
      case "continuation": {
        if (this.directlyInItem()) {
          // An unerased `+` in an item's buffer is Ruby's frozen
          // adjacent continuation (parser.rb l.1433-38), kept as its own
          // raw line rather than folded into the paragraph — the pinned
          // oracle divergence (D5): same bytes, same rendering, and a
          // column-0 `+` may not be reflowed into text. The blank run is
          // NOT reset: the erased `+` above it reads as a blank to Ruby,
          // so the paragraph after this line keeps the listContinuation
          // set.
          const { blanks } = this;
          this.leaf(buildRawBlockLine(fragmentOfLine(line), this.at));
          this.blanks = blanks;
          return;
        }
        // At block level a lone `+` opens a plain paragraph:
        // read_lines_until breaks on a `+` only once a line has been
        // read (`line_read`).
        this.paragraph("paragraph", line, FIRST);
        return;
      }
      default: {
        this.paragraph(this.bodyContext(), line, FIRST);
      }
    }
  }

  /** Consume the current line and forget the blank run before it. */
  advance(): void {
    this.index += NEXT;
    this.blanks = EMPTY;
  }

  /**
   * `parse_block_metadata_line`: an anchor, an attribute list or a
   * block title annotates the block that FOLLOWS, and comment and
   * preprocessor lines are consumed inside the same scan — all before
   * `next_section` asks whether the next line is a title. Holding them
   * back together is what keeps source order when a heading closes
   * sections between them: the sections close first, then the whole
   * held-back run lands in the parent in the order it was written.
   * @param line - the source line
   * @param kind - what the classifier made of it
   * @returns whether the line was held back
   */
  holdMetadata(line: SourceLine, kind: LineKind): boolean {
    const node = heldMetadataNode(kind, line, this.at);
    if (node === undefined) return false;
    if (kind.kind === "attributeLine") {
      this.pendingStyle = firstPositional(line.text);
    }
    this.pending.push(node);
    this.index += NEXT;
    // The blank run is deliberately NOT reset: Ruby counts `skipped`
    // BEFORE parse_block_metadata_lines consumes these lines (next_block
    // l.499), so held metadata is transparent to the in-item paragraph
    // context. Nothing at document level reads `blanks`. One known
    // asymmetry, verified unobservable: blanks AFTER held metadata do
    // not update Ruby's `skipped` either (the metadata loop's own
    // skip_blank_lines at l.517 discards its count) while ours land in
    // `blanks` — but a metadata line keeps the continuation `:active`,
    // so the content after such a blank arrives with the buffer's first
    // line already an erased `+` (skipped ≥ 1 on both readings); no
    // buffer reaches bodyContext with the two disagreeing.
    return true;
  }

  /** Release every held-back node, in source order. */
  flushMetadata(): void {
    for (const node of this.pending) this.push(node);
    this.pending = [];
    this.pendingStyle = undefined;
  }

  /**
   * An ATX title: `next_section` closes every open section of level
   * `level` or deeper before opening the new one, and the metadata read
   * ahead of the title belongs to the section the title opens — which
   * is why the enclosing sections close BEFORE the held-back run is
   * released, so the run lands in the parent.
   * @param line - the title line
   * @param level - the title's level; 0 is the document title
   */
  sectionTitle(line: SourceLine, level: number): void {
    if (this.confined) {
      // "reader is confined to boundaries of list, which means only
      // blocks will be found (no sections)" — parse_list_item l.1364.
      this.paragraph(this.bodyContext(), line, FIRST);
      return;
    }
    const enclosing = this.topFrame();
    if (enclosing.kind !== "document" && enclosing.kind !== "section") {
      // Inside a compound block the confined reader never calls
      // next_section: a heading is paragraph text.
      this.paragraph("paragraph", line, FIRST);
      return;
    }
    if (this.pendingStyle === DISCRETE_STYLE) {
      this.leaf(buildDiscreteHeading(fragmentOfLine(line), this.at));
      return;
    }
    if (level === EMPTY) {
      this.leaf(buildDocumentTitle(fragmentOfLine(line), this.at));
      return;
    }
    // A section closes on its title line; the close is inert for it (a
    // section is positioned from its own title) and exists only because
    // closeFrame is one function for every frame kind.
    const close = this.forcedClose(line);
    for (
      let top = this.topFrame();
      top.kind === "section" && top.level >= level;
      top = this.topFrame()
    ) {
      this.stack.pop();
      this.closeFrame(top, close);
    }
    this.flushMetadata();
    this.stack.push({ kind: "section", level, title: line, children: [] });
    this.advance();
  }

  // ── delimited blocks: is_delimited_block? + build_block ────────────

  /**
   * Open a delimited block.
   * @param line - the opening delimiter line
   * @param block - which delimited block it opens
   */
  openDelimited(line: SourceLine, block: DelimiterKind): void {
    this.flushMetadata();
    // read_lines_until compares whole rstripped lines against the
    // terminator; for a fence that terminator is the bare tip.
    const terminator = block === "fencedCode" ? FENCE_TIP : line.text;
    const variant = COMPOUND_VARIANTS.get(block);
    this.stack.push(
      variant === undefined
        ? { kind: "verbatim", terminator, open: line }
        : { kind: "compound", terminator, open: line, variant, children: [] },
    );
    this.advance();
  }

  /**
   * Close the OUTERMOST open block this line terminates.
   *
   * `read_lines_until` breaks only on the ONE terminator it was given;
   * what makes the outermost one win is that `build_block` read the
   * parent's whole extent up front, so a child that never closed simply
   * ran out of lines at the parent's delimiter. Read line by line, as
   * here, that is indistinguishable from the outermost terminator
   * claiming the line — which is why one flat stack suffices.
   * @param line - the delimiter line
   */
  closeDelimited(line: SourceLine): void {
    const target = this.stack.findIndex(
      (frame) =>
        (frame.kind === "compound" || frame.kind === "verbatim") &&
        frame.terminator === line.text,
    );
    if (target === NOT_FOUND) {
      // Total fallback: classifyLine reports delimiterClose only for a
      // terminator this stack holds. Reading the line as a paragraph
      // instead keeps block level unable to fail, which is the
      // reader's contract.
      this.paragraph("paragraph", line, FIRST);
      return;
    }
    // Metadata held back inside the block belongs to the block: release
    // it before the block ends, or it would surface after the close.
    this.flushMetadata();
    this.closeDownTo(target + NEXT, line);
    // Total fallback: closeDownTo left the target frame on top of the
    // stack, so this pop cannot miss.
    const frame = this.stack.pop() ?? this.root;
    this.closeFrame(frame, {
      close: fragmentOfLine(line),
      unclosed: undefined,
    });
    this.advance();
  }

  /**
   * The close of a block that never met its own terminator: an outer
   * terminator took the line, or EOF came first. Zero-length, at the
   * start of that line or one past the last character THIS reader can
   * see — the document's, or the item buffer's. The clamp matters: a
   * confined reader's EOF is the end of its buffer, and stamping the
   * document length instead would let an unclosed block inside an
   * item span bytes the extent scan never gave it — including a
   * trailing `+` the scan popped, which the printer would then emit
   * twice (found by the vii-b invariant on a marker line, a `+`, an
   * unterminated fence and a second `+`).
   * @param line - the line the close falls on, or undefined at EOF
   * @returns the close, for the builders
   */
  private forcedClose(line: SourceLine | undefined): BlockClose {
    return {
      close: undefined,
      unclosed: { image: "", offset: line?.offset ?? this.endOffset() },
    };
  }

  /**
   * One past the last character this reader reads: the document
   * length for the document reader (one past the final newline, the
   * spelling every unclosed-at-EOF position has always had), the last
   * buffer line's end for a confined one.
   * @returns the offset a zero-length EOF close falls at
   */
  private endOffset(): number {
    const last = this.lines.at(LAST_ELEMENT);
    return this.confined && last !== undefined
      ? last.offset + last.raw.length
      : this.source.length;
  }

  /**
   * Pop frames until the stack is `depth` deep, closing each one.
   * @param depth - the stack length to stop at
   * @param line - the line the closes fall on, or undefined at EOF
   */
  closeDownTo(depth: number, line?: SourceLine): void {
    const close = this.forcedClose(line);
    while (this.stack.length > depth) {
      // Total fallback: the loop condition is the non-empty proof this
      // pop needs; `pop` types the miss whether or not it can happen.
      this.closeFrame(this.stack.pop() ?? this.root, close);
    }
  }

  /**
   * Build one closing frame's node and give it to its parent.
   *
   * The style-driven conversions run HERE, on the container's own
   * children: every container — the document (in {@link readDocument}),
   * a section, a compound block, a list item (`readListItem` in
   * list-reader.ts) — goes through `convertParagraphFormBlocks`, so a
   * `[source]` paragraph inside an example block is converted as one at
   * the top level is. It is a post-parse transform over a flat block
   * array, not part of construction (spec Decision 4); folding it into
   * frame OPEN is the next plan, not this one.
   * @param frame - the frame being popped
   * @param close - how a delimited block ended; sections close on
   *   their own terms and ignore it
   */
  closeFrame(frame: Frame, close: BlockClose): void {
    switch (frame.kind) {
      case "section": {
        const node = buildSection(fragmentOfLine(frame.title), this.at);
        node.children = convertParagraphFormBlocks(frame.children, this.source);
        this.push(node);
        break;
      }
      case "compound": {
        this.push(
          buildParentBlock(
            { open: fragmentOfLine(frame.open), ...close, source: this.source },
            frame.variant,
            convertParagraphFormBlocks(frame.children, this.source),
            this.at,
          ),
        );
        break;
      }
      case "verbatim": {
        this.push(
          buildVerbatimBlock(
            { open: fragmentOfLine(frame.open), ...close, source: this.source },
            this.at,
          ),
        );
        break;
      }
      default: {
        // Total fallback: the document frame never closes — readDocument
        // reads it off the reader once the run is over — so this arm is
        // never taken. Breaking rather than throwing keeps closeFrame
        // total over the whole Frame union.
        break;
      }
    }
  }

  /** End of input: release held-back nodes, then close every frame. */
  closeAll(): void {
    this.flushMetadata();
    this.closeDownTo(NEXT);
  }
}

/**
 * The first positional attribute of a `[style,…]` line — the value
 * `[discrete]` is recognised by.
 * @param line - one rstripped block-attribute line, brackets included
 * @returns the first positional attribute, trimmed
 */
function firstPositional(line: string): string {
  return line.slice(NEXT, LAST_ELEMENT).split(",")[FIRST].trim();
}

/**
 * Read a whole document into its AST.
 *
 * The document is the outermost frame and never closes on a line, so
 * its node is built here rather than in `closeFrame` — including the
 * style-driven conversion its own children need, which every other
 * container gets at its close.
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
  const reader = new BlockReader({ source, at, documentLines }, documentLines);
  const children = reader.run();
  return {
    type: "document",
    children: convertParagraphFormBlocks(children, source),
    position: {
      start: at.at(FIRST),
      end: at.at(source.length),
    },
  };
}
