/**
 * The BlockReader: Asciidoctor's line reader as ONE flat walk. Every
 * composite construct is read EXTENT-FIRST, where Asciidoctor reads
 * it: a delimited block's whole extent is collected at its opening
 * line (`build_block` → delimitedExtent) — verbatim interiors become
 * a slice, compound interiors a fresh CONFINED BlockReader over the
 * interior subarray — and a list item's buffer gets the same
 * treatment through list-reader.ts (`read_lines_for_list_item` →
 * itemExtent → confine). What is not a composite is a LEAF, headings
 * included (spec D10): sections are not modeled, so the document is a
 * flat sequence this reader appends to, and nothing closes on a
 * later, unpredictable line. Confinement — what a scan can SEE — is
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
import { isReaderConsumedLine } from "../../block-metadata.js";
import { parseAttrlist, type Attrlist } from "../attrlist.js";
import {
  buildDelimitedAdmonition,
  buildParentBlock,
  buildVerbatimBlock,
  type BlockExtent,
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
  buildParagraphFormBlock,
  buildStyledParagraph,
} from "../build/paragraph.js";
import type { InlineToken } from "../inline/tokens.js";
import type { ParagraphContext } from "../line-shapes.js";
import { makeLocationIndex, type LocationIndex } from "../positions.js";
import {
  classifyLine,
  type DelimiterKind,
  type LineKind,
  type ReaderContext,
} from "./classify.js";
import { delimitedExtent } from "./delimited-reader.js";
import {
  fragmentOfLine,
  heldMetadataNode,
  isLeafKind,
  leafBuilder,
  type ListHost,
  type VerbatimRole,
} from "./frames.js";
import { readList } from "./list-reader.js";
import {
  paragraphFormVariant,
  resolveDelimitedOpen,
  verbatimStyledVariant,
} from "./open-style.js";
import {
  readLiteralParagraph,
  readParagraph,
  readVerbatimStyledLines,
} from "./paragraph-reader.js";
import { splitLines, type SourceLine } from "./split.js";

// The one block-attribute style the reader itself acts on: it turns the
// heading that follows into a discreteHeading leaf instead of an
// ordinary one.
const DISCRETE_STYLE = "discrete";

// A fenced opener is three backticks then the optional language hint.
const BACKTICK_COUNT = 3;

/**
 * Complete a fence's role with the language hint parsed from its
 * opening line — the resolver is pure over (kind x style) and cannot
 * see the line (`is_delimited_block?` rewrites a fence line to its
 * tip and keeps the rest as the hint, parser.rb:983-993).
 * @param role - the resolved role
 * @param block - which delimiter opened the block
 * @param text - the opening line, rstripped
 * @returns the role, with `language` set for a hinted fence
 */
function withFenceLanguage(
  role: VerbatimRole,
  block: DelimiterKind,
  text: string,
): VerbatimRole {
  if (block !== "fencedCode" || role.builds !== "delimitedBlock") return role;
  const language = text.slice(BACKTICK_COUNT).trim();
  return language.length === 0 ? role : { ...role, language };
}

/**
 * How this reader is confined, when it is not the document reader.
 * Declared here, not exported: every consumer is a BlockReader
 * member, and knip's types bucket gates dead exported types at 0.
 */
type Confinement =
  | {
      /** A list item's buffer (Ruby: parse_list_item's Reader, :1350). */
      readonly kind: "item";
      /** The item's marker style — the one-style ancestry. */
      readonly style: string;
      /** The item's own tail-safety (ItemExtent.tailSafe). */
      readonly tailSafe: boolean;
      /**
       * Where a forced close at this buffer's end falls: the last
       * buffer line's raw end — the vii-b clamp, computed at the one
       * place that knows the buffer (confine()) and carried as data.
       */
      readonly closeOffset: number;
    }
  | {
      /**
       * A compound block's interior (Ruby: build_block's Reader,
       * parser.rb:1037; parse_blocks "does not consider sections",
       * :1082-1083).
       */
      readonly kind: "block";
      /**
       * Whether a trailing `+` at this interior's end re-reads
       * inert — true when the block closed (the printed terminator
       * follows on the very next line and pops it), the enclosing
       * reader's own tail-safety when it did not (the interior's
       * end IS the enclosing end).
       */
      readonly tailSafe: boolean;
      /**
       * Where a forced close at this interior's end falls: the
       * terminator line's start when the block closed, the
       * enclosing reader's own forced-close offset when it did not.
       */
      readonly closeOffset: number;
    };

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
 * one confined instance per list item, over the item's buffer, and
 * one per compound-block interior, over the interior subarray (spec
 * D1/D2); `run` consumes it.
 */
class BlockReader implements ListHost {
  readonly source: string;
  readonly at: LocationIndex;
  readonly documentLines: readonly SourceLine[];
  /**
   * Every block this reader produces, appended in source order —
   * the document's blocks for the outermost reader, an interior's
   * for a confined one. Nothing nests them further: delimited blocks
   * are read whole at their opening line and headings are leaves
   * (spec D10), so no construct closes on a later, unpredictable
   * line and nothing routes a finished node anywhere but here.
   */
  private readonly blocks: BlockNode[] = [];
  /** Index of the next unread line. */
  index = 0;
  /**
   * Blank lines seen since the last line the reader CONSUMED — Ruby's
   * `skipped` count in `next_block` (l.499): a confined reader picks
   * an in-item paragraph's interrupting set by it (see
   * {@link BlockReader.bodyContext}). An erased `+` in an item's
   * buffer reads as a blank here, exactly as it does to Ruby.
   */
  blanks = 0;

  // Metadata NODES held back until we know what they annotate.
  // Comment and preprocessor lines ride along so their SOURCE ORDER
  // relative to the metadata survives whatever lands between them
  // (see the `raw` case in blockLine).
  private pending: BlockNode[] = [];
  // Parsed view of the held-back `[…]` line, if any — set per
  // attribute line (the last one wins, as Ruby's drain overwrites
  // `attributes`), cleared by flushMetadata. Every open decision
  // reads it; nothing downstream re-derives it (spec D3).
  private pendingAttrlist: Attrlist | undefined = undefined;
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
   *   (confine() for an item buffer, the compound open for an
   *   interior) and consumed as data
   *   ({@link BlockReader.forcedCloseOffset}).
   */
  constructor(
    scope: ReaderScope,
    readonly lines: readonly SourceLine[],
    private readonly confinement?: Confinement,
  ) {
    ({
      source: this.source,
      at: this.at,
      documentLines: this.documentLines,
    } = scope);
    this.scope = scope;
  }

  /**
   * Whether a `+` printed at the very end of this reader's lines
   * re-reads inert — see ListHost.tailSafe. The document's end is
   * EOF, always safe; an item buffer's end is wherever the enclosing
   * item ended, so the answer is that item's own; a block child's is
   * `closed || enclosing`, decided at the compound open (spec
   * D2/D3).
   * @returns the boundary fact the extent scans inherit
   */
  get tailSafe(): boolean {
    return this.confinement?.tailSafe ?? true;
  }

  /**
   * Where a forced close at THIS reader's stream end falls: the
   * document length for the document reader (one past the final
   * newline — the spelling every unclosed-at-EOF position has always
   * had), the confinement's boundary for a confined one. One
   * derivation for the boundary every forced close shares (spec D2),
   * pinned by tests/parser/delimited-end-convention.test.ts and the
   * b44 fixtures' position literals.
   * @returns the offset a forced close at stream end is stamped with
   */
  get forcedCloseOffset(): number {
    return this.confinement?.closeOffset ?? this.source.length;
  }

  // ── context ────────────────────────────────────────────────────────

  /**
   * The reader's state as `classifyLine` consumes it — read, never
   * derived.
   * @param openParagraph - which paragraph shape is open, if any
   * @param firstLineAfterStart - whether the line being classified is
   *   the first one after the block started
   * @returns the read-only context view
   */
  context(
    openParagraph?: ParagraphContext,
    firstLineAfterStart = false,
  ): ReaderContext {
    // Lists are read extent-first and a confined buffer is already
    // truncated at every ancestor list's boundary, so ONE style — the
    // confined item's own — is the whole ancestry the classifier can
    // ever need (the foreign-marker verbatim rule keys on it). A
    // block child reports undefined: fresh-reader behavior is Ruby's
    // (build_block → Reader.new, no list_type).
    return {
      openParagraph,
      openListStyle:
        this.confinement?.kind === "item" ? this.confinement.style : undefined,
      firstLineAfterStart,
    };
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
   * Append a finished block to the document's children.
   * @param node - the block just built
   */
  push(node: BlockNode): void {
    this.blocks.push(node);
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
   * Push a one-line block WITHOUT resetting the blank run — for lines
   * Ruby's `skipped` count reads through: a document attribute is
   * processed inside parse_block_metadata_lines (next_block l.512),
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

  /**
   * Read a plain paragraph and push it.
   * @param context - which interrupting set applies
   * @param line - the paragraph's first line
   * @param from - raw column index where its text starts
   */
  paragraph(context: ParagraphContext, line: SourceLine, from: number): void {
    // The non-verbatim paragraph-form fold (spec D4c): only a line
    // that opens a PARAGRAPH converts — today's observed shape,
    // reproduced exactly. The style is read before readParagraph
    // flushes the run; the extent is the paragraph's own (unchanged
    // context threading).
    const formVariant = paragraphFormVariant(this.actionableStyle());
    const annotatedBy = this.annotation();
    const tokens = readParagraph(this, context, line, from);
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
        fragmentOfLine(line, 0, labelEnd),
        tokens,
        this.at,
      ),
    );
  }

  /**
   * Read an indented literal paragraph and push it.
   * @param line - its first (indented) line
   */
  literalParagraph(line: SourceLine): void {
    const annotatedBy = this.annotation();
    const lines = readLiteralParagraph(this, line);
    const node = buildLiteralParagraph(
      lines.map((each) => fragmentOfLine(each)),
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
      const kind = classifyLine(line.text, this.context());
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

  // ── the ListHost seam ──────────────────────────────────────────────

  /**
   * Parse one list item's interior from its buffer — Ruby's
   * `Reader.new read_lines_for_list_item(…)` + the `next_block` loop of
   * parse_list_item (l.1350-1375). The marker line rides at the front so
   * `readParagraph`'s advance consumes it and the text's continuation
   * lines come from the buffer; the rest of the buffer is then read by
   * the ordinary block loop, whose blocks ARE the item's blocks.
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
    // The buffer's last line — the marker line itself when the buffer
    // is empty — is where a forced close inside this item falls: its
    // raw end, the vii-b clamp as DATA (spec D2). The marker line
    // rides at the front of every buffer, so the `??` arm is total
    // without a further guard.
    const last = buffer.at(-1) ?? markerLine;
    const inner = new BlockReader(this.scope, [markerLine, ...buffer], {
      kind: "item",
      style: marker.style,
      tailSafe,
      closeOffset: last.offset + last.raw.length,
    });
    const text = readParagraph(inner, "listItem", markerLine, marker.markerEnd);
    return { text, blocks: inner.run() };
  }

  /**
   * Whether the next block belongs to a list item's DIRECT interior.
   * `options[:list_type]` travels only through parse_list_item's own
   * next_block loop: a delimited block inside the item parses its
   * children from a fresh reader with no list flavor (`build_block` →
   * `Reader.new`), which is now literally what happens — the block
   * child carries `kind: "block"`, so the item's contexts stop at it
   * BY CONSTRUCTION (the flavor bit, spec D2; pinned by the
   * flavor-bit row in tests/format/confinement.test.ts).
   * @returns true in an item-confined reader
   */
  private directlyInItem(): boolean {
    return this.confinement?.kind === "item";
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
  blockLine(line: SourceLine, kind: LineKind): void {
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
        this.literalParagraph(line);
        return;
      }
      case "dlistTerm": {
        this.paragraph("dlistItem", line, kind.indent);
        return;
      }
      case "listMarker": {
        // Lists are the one construct read recursively: the extent
        // scan bounds every item, a confined reader parses it, and
        // this loop resumes past the whole list. Metadata read ahead
        // of the first marker annotates the LIST, so it flushes into
        // this container BEFORE any item is built — the order is
        // decided here, at the one call site that owns the block
        // sequence.
        this.flushMetadata();
        const { node, end } = readList(this, this.index, kind);
        this.push(node);
        this.index = end;
        this.blanks = 0;
        return;
      }
      case "continuation": {
        if (this.directlyInItem()) {
          // An unerased `+` in an item's buffer is Ruby's frozen
          // adjacent continuation (parser.rb l.1433-38), kept as its own
          // raw line rather than folded into the paragraph — the pinned
          // oracle divergence (D5): same bytes, same rendering, and a
          // column-0 `+` may not be reflowed into text. Transparent to
          // the blank run — see transparentLeaf: the erased `+` above it
          // reads as a blank to Ruby, so the paragraph after this line
          // keeps the listContinuation set.
          this.transparentLeaf(
            buildRawBlockLine(fragmentOfLine(line), this.at),
          );
          return;
        }
        // At block level a lone `+` opens a plain paragraph:
        // read_lines_until breaks on a `+` only once a line has been
        // read (`line_read`).
        this.paragraph("paragraph", line, 0);
        return;
      }
      default: {
        this.paragraph(this.bodyContext(), line, 0);
      }
    }
  }

  /** Consume the current line and forget the blank run before it. */
  advance(): void {
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
  holdMetadata(line: SourceLine, kind: LineKind): boolean {
    const node = heldMetadataNode(kind, line, this.at);
    if (node === undefined) return false;
    if (kind.kind === "attributeLine") {
      this.pendingAttrlist = parseAttrlist(line.text.slice(1, -1));
    }
    this.pending.push(node);
    this.index += 1;
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
    this.pendingAttrlist = undefined;
  }

  /**
   * The held style, when the reader may ACT on it: the LAST held
   * attribute line's first positional, valid only while every held
   * node after that attribute line is reader-eaten (a raw
   * comment/directive line) — the transparency the deleted
   * `annotatedBlockIndex` scan implemented, applied BEFORE the open
   * instead of after the parse (spec D4c guard, M-ruled: reproduce,
   * never widen). A held title or anchor after the attribute line
   * disables the style, pinned by the characterization rows in
   * tests/parser/block-masquerade.test.ts and
   * tests/parser/verbatim-styled.test.ts (the recorded §5
   * divergences). Written as a forward walk — the flag resets at each
   * attribute line, so it ends true exactly when the run's tail is
   * transparent — because architecture.test.ts bans `findLast(` and
   * `findLastIndex(` under src/parse.
   * @returns the style, or undefined when none is actionable
   */
  private actionableStyle(): string | undefined {
    if (this.pendingAttrlist === undefined) return undefined;
    let transparent = true;
    for (const node of this.pending) {
      if (node.type === "blockAttributeList") transparent = true;
      else if (!isReaderConsumedLine(node)) transparent = false;
    }
    return transparent ? this.pendingAttrlist.style : undefined;
  }

  /**
   * The reader's own record of the annotation it is about to act on
   * (spec D5a): set iff the held run's LAST node is the attribute
   * line — stricter than actionableStyle's transparency on purpose,
   * so the recorded value equals the sibling BlockAttributeListNode's
   * `value` by construction and invariant (xi) can check the pairing
   * on every parse. Plan ruling: copied from the held NODE, not from
   * Attrlist.raw, so the equality holds even on a trailing-whitespace
   * attribute line, where the rstripped and raw interiors differ.
   * @returns the sibling-to-be's value, or undefined
   */
  private annotation(): string | undefined {
    const last = this.pending.at(-1);
    return last?.type === "blockAttributeList" ? last.value : undefined;
  }

  /**
   * A heading line — a LEAF at every level (spec D10). The section
   * frame only routed finished nodes into a container, deciding
   * nothing about any line, which is why it left without a
   * reader-visible trace; the CONFINEMENT arm below is a different
   * thing entirely — the physical line boundary of an interior
   * (parse_list_item l.1364; parse_blocks, parser.rb:1082-1083,
   * pinned by oracle rows P4/P5).
   * @param line - the title line
   * @param kind - the classifier's parse of the title line
   * @param kind.level - the classifier's level; 0 is the document title
   * @param kind.title - the title text after the markers
   */
  sectionTitle(line: SourceLine, kind: { level: number; title: string }): void {
    if (this.confinement !== undefined) {
      // ONE arm for both flavors: bodyContext() already answers
      // "paragraph" for a block child, because directlyInItem() is
      // false there.
      this.paragraph(this.bodyContext(), line, 0);
      return;
    }
    if (this.pendingAttrlist?.style === DISCRETE_STYLE) {
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
    this.leaf(
      buildHeading(fragmentOfLine(line), kind.level, kind.title, this.at),
    );
  }

  // ── delimited blocks: is_delimited_block? + build_block ────────────

  /**
   * Open a delimited block — the WHOLE read (spec D1b): capture the
   * annotation, resolve the style (α D4a), flush, collect the extent
   * (build_block's read_lines_until, parser.rb:1007-1077), then
   * either slice (verbatim — the collected lines ARE the content and
   * no reader ever holds them, :1028-1030) or parse the interior
   * with a fresh CONFINED child reader (compound, :1037; no sections
   * inside, :1082-1083), and resume past the extent. Held metadata
   * order is untouched by construction: the flush still happens
   * between the style resolution and the first interior line.
   * @param line - the opening delimiter line
   * @param block - which delimited block it opens
   */
  openDelimited(line: SourceLine, block: DelimiterKind): void {
    const annotatedBy = this.annotation();
    const resolved = resolveDelimitedOpen(block, this.actionableStyle());
    this.flushMetadata();
    const extent = delimitedExtent(this.lines, this.index, block);
    const blockExtent = this.packageExtent(extent);
    if (resolved.model === "verbatim") {
      const node = buildVerbatimBlock(
        blockExtent,
        withFenceLanguage(resolved.role, block, line.text),
        this.at,
      );
      // annotatedBy stays a POST-construction assignment (spec D7.4).
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
   * The builders' BlockExtent for one extent-first read — the ONE
   * packaging site (spec D1b), stating the two-offsets convention
   * (spec D2) in code: `contentEnd` is always a line's OWN raw end
   * (the last interior line's; the open line's when the interior is
   * empty, which puts it before contentStart and the slice guard
   * yields ""); `end` is past the close line's raw end when the
   * block closed, and this reader's forced-close boundary
   * ({@link BlockReader.forcedCloseOffset}) when it did not.
   * @param extent - what the extent scan collected
   * @param extent.open - the opening delimiter line
   * @param extent.close - the terminator line, when the block met one
   * @param extent.interior - the lines between the delimiters
   * @returns the packaged extent
   */
  private packageExtent(extent: {
    readonly open: SourceLine;
    readonly close: SourceLine | undefined;
    readonly interior: readonly SourceLine[];
  }): BlockExtent {
    const open = fragmentOfLine(extent.open);
    const last = extent.interior.at(-1);
    return {
      open,
      close:
        extent.close === undefined ? undefined : fragmentOfLine(extent.close),
      contentEnd:
        last === undefined
          ? open.offset + open.image.length
          : last.offset + last.raw.length,
      end:
        extent.close === undefined
          ? this.forcedCloseOffset
          : extent.close.offset + extent.close.raw.length,
      source: this.source,
    };
  }

  /**
   * `next_block`'s verbatim-styled branch (parser.rb:555-560): with a
   * held VERBATIM_STYLES style actionable (the D4c guard), every line
   * except a section title, a delimiter and an attribute entry opens
   * the styled paragraph AT that line — list markers, macros, breaks,
   * admonition labels, dlist terms, indented lines, a lone `+`, plain
   * text alike (probed: `"[source]\n* item\n"` is one listing).
   * Section titles keep their own dispatch (next_section runs outside
   * next_block); a delimiter goes to openDelimited's masquerade
   * resolution; an attribute entry stays a leaf whose flush kills the
   * style (the recorded §5 divergence from Ruby's drain,
   * parser.rb:2068-2070 — α does not change it).
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
    const [firstLine, ...rest] = readVerbatimStyledLines(this, line);
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
  closeAll(): void {
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
  const reader = new BlockReader({ source, at, documentLines }, documentLines);
  const children = reader.run();
  return {
    type: "document",
    children,
    position: {
      start: at.at(0),
      end: at.at(source.length),
    },
  };
}
