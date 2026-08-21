/**
 * The BlockReader: Asciidoctor's line reader as ONE explicit state
 * machine. It walks the lines once with a frame stack and decides where
 * blocks END where Asciidoctor does — `Parser.next_section` (section
 * boundaries and the block-metadata lookahead),
 * `parse_block_metadata_lines`, `next_block` (what a block's first line
 * opens), `is_delimited_block?` / `build_block` (terminators), and
 * `read_paragraph_lines` / `Reader.read_lines_until` (paragraph extent,
 * in paragraph-reader.ts) — then emits the token stream the mechanical
 * grammar will consume.
 *
 * Nothing downstream ever re-derives block context: this stack is the
 * only place it exists. Lists are the `read_lines_for_list_item` port
 * in list-reader.ts, which reads this class through its public
 * surface and owns nothing itself.
 */
import type { IToken, TokenType } from "chevrotain";
import {
  EMPTY,
  FIRST,
  FIRST_COLUMN,
  FIRST_LINE,
  LAST_ELEMENT,
  NEXT,
  NOT_FOUND,
} from "../../constants.js";
import type { ParagraphContext } from "../line-shapes.js";
import {
  classifyLine,
  type DelimiterKind,
  type LineKind,
  type ReaderContext,
} from "./classify.js";
import {
  heldMetadataToken,
  type Frame,
  type HeldLead,
  type ListHost,
} from "./frames.js";
import { closeList, listLine, openList } from "./list-reader.js";
import { readLiteralParagraph, readParagraph } from "./paragraph-reader.js";
import { splitLines, type SourceLine } from "./split.js";
import { boundaryToken, lineToken } from "./token-factory.js";
import * as T from "./tokens.js";

// Delimited blocks whose content is parsed as BLOCKS rather than kept
// verbatim — `DELIMITED_BLOCKS`' content model, minus the masquerades
// (`[source]` on a `--` block and friends), which stay a post-hoc
// re-slice in paragraph-form.ts exactly as today.
const COMPOUND_KINDS = new Set<DelimiterKind>([
  "example",
  "sidebar",
  "openBlock",
  "quote",
]);

// A fenced code block's terminator is the bare tip, never the opening
// line: `is_delimited_block?` rewrites `line` to `tip` for the fence
// case, and that rewritten value is the BlockMatchData terminator, so
// ```` ```ruby ```` is closed by ```` ``` ````.
const FENCE_TIP = "```";

// The one block-attribute style the reader itself acts on: it turns the
// heading that follows into a leaf instead of a section frame.
const DISCRETE_STYLE = "discrete";

// Line kinds that ARE a block, whole and entire: no extent to read, no
// frame to open.
const LEAF_TOKENS = new Map<LineKind["kind"], TokenType>([
  ["attributeEntry", T.AttributeEntryLine],
  ["blockMacro", T.BlockMacroLine],
  ["thematicBreak", T.ThematicBreakLine],
  ["pageBreak", T.PageBreakLine],
]);

// The bottom frame, and the total fallback for a pop that cannot fail.
const DOCUMENT_FRAME: Frame = { kind: "document" };

/**
 * Reads a document into block tokens. One instance per document; `run`
 * consumes it.
 */
class BlockReader implements ListHost {
  /** The token stream under construction, in emission order. */
  readonly tokens: IToken[] = [];
  /** The open frames, outermost first; the ONLY block-context store. */
  readonly stack: Frame[] = [DOCUMENT_FRAME];
  /** Every source line, rstripped, with offsets. */
  readonly lines: SourceLine[];
  /** Index of the next unread line. */
  index = FIRST;
  /**
   * Blank lines seen since the last line the reader CONSUMED —
   * Ruby's `prev_line.empty?` test over an item's buffered lines,
   * which a held-back metadata line resets just like a content one.
   * list-reader.ts is its only consumer: one blank before a `+` still
   * attaches, two drop the continuation.
   */
  blanks = EMPTY;

  // Metadata line tokens held back until we know what they annotate.
  // Comment and preprocessor lines ride along so their SOURCE ORDER
  // relative to the metadata survives a section boundary landing
  // between them (see the `raw` case in blockLine).
  private pendingMetadata: IToken[] = [];
  // First positional attribute of the held-back `[…]` line, if any.
  private pendingStyle: string | undefined = undefined;
  // Where the held-back run starts. A section that a heading closes
  // ends HERE, not at the heading: the metadata belongs to the section
  // the heading opens, so the SectionEnds must precede it — and the
  // token stream has to stay offset-sorted.
  private pendingStart: SourceLine | undefined = undefined;
  // How a list item's held-back run is to be introduced when it is
  // released — decided by the list reader at hold time, for both
  // outcomes, and resolved here at release (see HeldLead).
  private pendingLead: HeldLead | undefined = undefined;
  /** How many lines are held back right now. */
  heldLines = EMPTY;

  /**
   * @param source - the whole document
   */
  constructor(readonly source: string) {
    this.lines = splitLines(source);
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
    const openListStyles: string[] = [];
    const openTerminators: string[] = [];
    const verbatimTerminators: string[] = [];
    for (const frame of this.stack) {
      switch (frame.kind) {
        case "list": {
          // Innermost first, which is the order is_sibling_list_item?
          // walks the ancestry in.
          openListStyles.unshift(frame.style);
          break;
        }
        case "compound": {
          openTerminators.push(frame.terminator);
          break;
        }
        case "verbatim": {
          verbatimTerminators.push(frame.terminator);
          break;
        }
        default: {
          break;
        }
      }
    }
    // At most one verbatim frame can ever be open — inside one, every
    // line is content or its terminator — but taking the innermost
    // keeps that an observation rather than an assumption.
    const close = verbatimTerminators.at(LAST_ELEMENT);
    return {
      openParagraph,
      openListStyles,
      openTerminators,
      inVerbatim: close === undefined ? undefined : { close },
      firstLineAfterStart,
    };
  }

  /**
   * The innermost open frame.
   * @returns the top of the stack
   */
  topFrame(): Frame {
    return this.stack.at(LAST_ELEMENT) ?? DOCUMENT_FRAME;
  }

  /**
   * The next unread line.
   * @returns the line, or undefined at end of input
   */
  peek(): SourceLine | undefined {
    return this.lines.at(this.index);
  }

  // ── emit helpers ───────────────────────────────────────────────────

  /**
   * Emit a whole-line token.
   * @param type - the token type
   * @param line - the source line
   * @param from - raw start column index, 0-based
   * @param to - raw end column index, exclusive
   */
  emitLine(
    type: TokenType,
    line: SourceLine,
    from?: number,
    to?: number,
  ): void {
    this.tokens.push(lineToken(type, line, from, to));
  }

  /**
   * Emit a zero-length boundary token inside a line.
   * @param type - the token type
   * @param line - the source line the boundary falls on
   * @param column - raw column index, 0-based; the line's end by default
   */
  emitBoundaryAt(
    type: TokenType,
    line: SourceLine,
    column = line.raw.length,
  ): void {
    this.tokens.push(
      boundaryToken(
        type,
        line.offset + column,
        line.line,
        column + FIRST_COLUMN,
      ),
    );
  }

  /**
   * Hold back a zero-length boundary token ahead of the metadata line
   * about to be held — it is released with the run, in order.
   * @param type - the token type
   * @param line - the metadata line
   */
  holdBoundary(type: TokenType, line: SourceLine): void {
    this.pendingStart ??= line;
    this.pendingMetadata.push(
      boundaryToken(type, line.offset, line.line, FIRST_COLUMN),
    );
  }

  /**
   * The 1-based line number of the last line the reader consumed —
   * content, metadata, a `+` or a blank alike.
   * @returns the line number, or undefined before the first line
   */
  lastConsumedLine(): number | undefined {
    return this.lines.at(this.index + LAST_ELEMENT)?.line;
  }

  /**
   * Emit a zero-length boundary token at end of input — one past the
   * document's last character, on the line a further character would
   * land on.
   * @param type - the token type
   */
  emitBoundaryAtEof(type: TokenType): void {
    const last = this.lines.at(LAST_ELEMENT);
    const endsWithNewline = this.source.endsWith("\n");
    const line =
      last === undefined
        ? FIRST_LINE
        : last.line + (endsWithNewline ? NEXT : EMPTY);
    const column =
      last === undefined || endsWithNewline
        ? FIRST_COLUMN
        : last.raw.length + FIRST_COLUMN;
    this.tokens.push(boundaryToken(type, this.source.length, line, column));
  }

  // ── main loop ──────────────────────────────────────────────────────

  /**
   * Walk every line once and close whatever is still open at EOF.
   * @returns the block token stream
   */
  run(): IToken[] {
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
        this.emitLine(T.VerbatimLine, line);
        this.index += NEXT;
        continue;
      }
      // Inside a list frame the confined reader is
      // read_lines_for_list_item, not next_block.
      if (this.topFrame().kind === "list") {
        listLine(this, line, kind);
      } else {
        this.blockLine(line, kind);
      }
    }
    this.closeAll();
    return this.tokens;
  }

  // ── block level: next_section / parse_block_metadata_line / next_block

  /**
   * Dispatch a line that starts a block.
   * @param line - the source line
   * @param kind - what the classifier made of it
   */
  blockLine(line: SourceLine, kind: LineKind): void {
    if (this.holdMetadata(line, kind)) {
      return;
    }
    const leafToken = LEAF_TOKENS.get(kind.kind);
    if (leafToken !== undefined) {
      this.leaf(leafToken, line);
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
        this.flushMetadata();
        this.emitLine(T.AdmonitionLabel, line, FIRST, kind.labelEnd);
        readParagraph(this, "paragraph", line, kind.labelEnd);
        return;
      }
      case "indented": {
        readLiteralParagraph(this, line);
        return;
      }
      case "dlistTerm": {
        // No dlist node yet (#9), but the EXTENT is right: the term
        // line is the item's first line and `dlistItem` is its
        // interrupting set.
        readParagraph(this, "dlistItem", line, kind.indent);
        return;
      }
      case "listMarker": {
        openList(this, line, kind);
        return;
      }
      // `blank`, `delimiterClose` and `verbatim` are handled in run()
      // and never arrive here. What is left is `text` and a lone `+`:
      // both open a plain paragraph, because read_lines_until breaks on
      // a `+` only once a line has already been read (`line_read`).
      default: {
        readParagraph(this, "paragraph", line, FIRST);
      }
    }
  }

  /** Consume the current line and forget the blank run before it. */
  advance(): void {
    this.index += NEXT;
    this.blanks = EMPTY;
  }

  /**
   * Emit a one-line block, releasing any metadata it annotates first.
   * @param type - the token type
   * @param line - the source line
   */
  leaf(type: TokenType, line: SourceLine): void {
    this.flushMetadata();
    this.emitLine(type, line);
    this.advance();
  }

  /**
   * Hold a line back until we know what block it belongs to.
   * @param type - the token type
   * @param line - the source line
   */
  hold(type: TokenType, line: SourceLine): void {
    this.pendingStart ??= line;
    this.pendingMetadata.push(lineToken(type, line));
    this.heldLines += NEXT;
    this.index += NEXT;
    // A held line is still a line Asciidoctor BUFFERED: inside a list
    // item it makes Ruby's `prev_line` non-empty, so the run of blanks
    // before it no longer separates anything.
    this.blanks = EMPTY;
  }

  /**
   * `parse_block_metadata_line`: an anchor, an attribute list or a
   * block title annotates the block that FOLLOWS, and comment and
   * preprocessor lines are consumed inside the same scan — all before
   * `next_section` asks whether the next line is a title. Holding them
   * back together is what keeps source order when a heading closes
   * sections between them: the SectionEnds go first, then the whole
   * held-back run in the order it was written.
   * @param line - the source line
   * @param kind - what the classifier made of it
   * @returns whether the line was held back
   */
  holdMetadata(line: SourceLine, kind: LineKind): boolean {
    const type = heldMetadataToken(kind);
    if (type === undefined) {
      return false;
    }
    if (kind.kind === "attributeLine") {
      this.pendingStyle = firstPositional(line.text);
    }
    this.hold(type, line);
    return true;
  }

  /**
   * Decide, ahead of release, how the held-back run will be introduced
   * — see {@link HeldLead}. The list reader calls this at hold time; it
   * is the reader's decision, made with what the reader knows then, and
   * only WHICH of the two outcomes applies waits for the release.
   * @param lead - the two outcomes
   */
  holdLead(lead: HeldLead): void {
    this.pendingLead = lead;
  }

  /**
   * Release every held-back line, in source order, behind the lead the
   * list reader decided for the run.
   * @param blockFollows - whether a block of the item is about to be
   *   read for the run (true), or the run is trailing — the item, list
   *   or block is closing (false)
   */
  flushMetadata(blockFollows = false): void {
    const { pendingLead: lead, pendingStart: start } = this;
    if (lead !== undefined && start !== undefined) {
      const mark = blockFollows ? lead.block : lead.trailing;
      if (mark !== undefined) {
        for (let index = EMPTY; index < lead.repeats; index += NEXT) {
          this.emitBoundaryAt(mark, start, FIRST);
        }
      }
    }
    this.tokens.push(...this.pendingMetadata);
    this.pendingMetadata = [];
    this.pendingStyle = undefined;
    this.pendingStart = undefined;
    this.pendingLead = undefined;
    this.heldLines = EMPTY;
  }

  /**
   * The lines strictly between two line numbers.
   * @param from - 1-based line number of the earlier line
   * @param to - 1-based line number of the later line
   * @returns the lines between them, in order
   */
  linesBetween(from: number, to: number): readonly SourceLine[] {
    return this.lines.slice(from, to + LAST_ELEMENT);
  }

  /**
   * An ATX title: `next_section` closes every open section of level
   * `level` or deeper before opening the new one, and the metadata read
   * ahead of the title belongs to the section the title opens — which
   * is why the SectionEnds are emitted BEFORE the held-back lines.
   * @param line - the title line
   * @param level - the title's level; 0 is the document title
   */
  sectionTitle(line: SourceLine, level: number): void {
    const enclosing = this.topFrame();
    if (enclosing.kind !== "document" && enclosing.kind !== "section") {
      // Inside a compound block the confined reader never calls
      // next_section: a heading is paragraph text. (A list frame never
      // reaches here — listLine claims the line first.)
      readParagraph(this, "paragraph", line, FIRST);
      return;
    }
    if (this.pendingStyle === DISCRETE_STYLE) {
      this.flushMetadata();
      this.emitLine(T.DiscreteHeadingLine, line);
      this.advance();
      return;
    }
    if (level === EMPTY) {
      this.leaf(T.DocumentTitleLine, line);
      return;
    }
    const endsAt = this.pendingStart ?? line;
    for (
      let top = this.topFrame();
      top.kind === "section" && top.level >= level;
      top = this.topFrame()
    ) {
      this.stack.pop();
      this.emitBoundaryAt(T.SectionEnd, endsAt, FIRST);
    }
    this.flushMetadata();
    this.emitLine(T.SectionTitleLine, line);
    this.stack.push({ kind: "section", level });
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
    if (COMPOUND_KINDS.has(block)) {
      this.emitLine(T.CompoundBlockOpen, line);
      this.stack.push({ kind: "compound", terminator });
    } else {
      this.emitLine(T.VerbatimBlockOpen, line);
      this.stack.push({ kind: "verbatim", terminator });
    }
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
      // Unreachable: classifyLine reports delimiterClose only for a
      // terminator this stack holds. The fallback keeps block level
      // unable to fail, which is the reader's contract.
      readParagraph(this, "paragraph", line, FIRST);
      return;
    }
    // Metadata held back inside the block belongs to the block: release
    // it before the block ends, or it would surface after the close.
    this.flushMetadata();
    this.closeDownTo(target + NEXT, line);
    const frame = this.stack.pop();
    this.emitLine(
      frame?.kind === "verbatim" ? T.VerbatimBlockClose : T.CompoundBlockClose,
      line,
    );
    this.advance();
  }

  /**
   * Pop frames until the stack is `depth` deep, ending each one.
   * @param depth - the stack length to stop at
   * @param line - the line the ends fall on, or undefined at EOF
   */
  closeDownTo(depth: number, line?: SourceLine): void {
    while (this.stack.length > depth) {
      this.endFrame(this.stack.pop() ?? DOCUMENT_FRAME, line);
    }
  }

  /**
   * Emit the end token(s) of one forced-closed frame.
   * @param frame - the frame being popped
   * @param line - the line the ends fall on, or undefined at EOF
   */
  endFrame(frame: Frame, line?: SourceLine): void {
    const emit = (type: TokenType): void => {
      if (line === undefined) {
        this.emitBoundaryAtEof(type);
      } else {
        this.emitBoundaryAt(type, line, FIRST);
      }
    };
    switch (frame.kind) {
      case "section": {
        emit(T.SectionEnd);
        break;
      }
      case "compound":
      case "verbatim": {
        emit(T.UnclosedEnd);
        break;
      }
      case "list": {
        closeList(this, frame, line);
        break;
      }
      default: {
        // The document frame ends nothing.
        break;
      }
    }
  }

  /** End of input: release held-back lines, then close every frame. */
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
 * Read a whole document into the block token stream.
 * @param source - the document
 * @returns the tokens the mechanical grammar consumes
 */
export function readBlocks(source: string): IToken[] {
  return new BlockReader(source).run();
}
