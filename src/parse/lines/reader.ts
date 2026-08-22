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
 * only place it exists. Lists are the `read_lines_for_list_item` port
 * in list-reader.ts, which reads this class through its public
 * surface and owns nothing itself. What a node is MADE of is the
 * builders' business (src/parse/build/); this file only decides which
 * one to call and where its result goes.
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
import { buildFrontMatter } from "../build/front-matter.js";
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
import { textLines } from "../inline/text-lines.js";
import {
  FRONT_MATTER_DELIMITER,
  type ParagraphContext,
} from "../line-shapes.js";
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
  type HeldLead,
  type ListHost,
} from "./frames.js";
import { pushIntoItem } from "./list-frames.js";
import type { PendingMark } from "./list-item.js";
import { closeList, listLine, openList } from "./list-reader.js";
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

// A fenced code block's terminator is the bare tip, never the opening
// line: `is_delimited_block?` rewrites `line` to `tip` for the fence
// case, and that rewritten value is the BlockMatchData terminator, so
// ```` ```ruby ```` is closed by ```` ``` ````.
const FENCE_TIP = "```";

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

// A metadata node held back until the block it annotates is known,
// with the mark it will be introduced under inside a list item.
interface HeldNode {
  /** The node, built when the line was held. */
  readonly node: BlockNode;
  /** Its mark; the first node of a run gets its mark at release. */
  mark: PendingMark | undefined;
}

/**
 * Reads a document into its blocks. One instance per document; `run`
 * consumes it.
 */
class BlockReader implements ListHost {
  /** The bottom frame, and the total fallback for a pop that cannot fail. */
  private readonly root: DocumentFrame = { kind: "document", children: [] };
  /** The open frames, outermost first; the ONLY block-context store. */
  readonly stack: Frame[] = [this.root];
  /** Every source line, rstripped, with offsets. */
  readonly lines: SourceLine[];
  /** The document's offset→Location index, built once. */
  readonly at: LocationIndex;
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

  // Metadata NODES held back until we know what they annotate, each
  // with the mark it will be introduced under inside a list item.
  // Comment and preprocessor lines ride along so their SOURCE ORDER
  // relative to the metadata survives a section boundary landing
  // between them (see the `raw` case in blockLine).
  private pending: HeldNode[] = [];
  // First positional attribute of the held-back `[…]` line, if any.
  private pendingStyle: string | undefined = undefined;
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
    this.at = makeLocationIndex(source);
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
    return this.stack.at(LAST_ELEMENT) ?? this.root;
  }

  /**
   * The next unread line.
   * @returns the line, or undefined at end of input
   */
  peek(): SourceLine | undefined {
    return this.lines.at(this.index);
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
   * The lines strictly between two line numbers.
   * @param from - 1-based line number of the earlier line
   * @param to - 1-based line number of the later line
   * @returns the lines between them, in order
   */
  linesBetween(from: number, to: number): readonly SourceLine[] {
    return this.lines.slice(from, to + LAST_ELEMENT);
  }

  // ── where a finished block goes ────────────────────────────────────

  /**
   * Put a finished block where the innermost frame wants it: into the
   * open list item, or into the frame's children.
   * @param node - the block just built
   */
  push(node: BlockNode): void {
    const frame = this.topFrame();
    switch (frame.kind) {
      case "list": {
        pushIntoItem(frame, node);
        break;
      }
      case "verbatim": {
        // Unreachable: inside a verbatim frame every line is content or
        // the terminator, and content is sliced from the source at
        // close. Kept as a total function rather than a throw.
        break;
      }
      default: {
        frame.children.push(node);
      }
    }
  }

  /**
   * Push a block behind a mark the list reader decided for it — a
   * held-back node's, at release.
   * @param node - the block
   * @param mark - how it was introduced, when an item is open
   */
  private pushMarked(node: BlockNode, mark: PendingMark | undefined): void {
    const frame = this.topFrame();
    if (frame.kind === "list" && mark !== undefined) {
      frame.item.markNext(mark);
    }
    this.push(node);
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

  // ── document start ─────────────────────────────────────────────────

  /**
   * `skip_front_matter!`: take a `---`-fenced block off the top of the
   * document, wholesale.
   *
   * Runs ONCE, before the main loop, and only when the very first line
   * is `---` — which is Asciidoctor's own guard, and the reason this is
   * not a line shape `classify.ts` can reach. A `---` anywhere else is
   * an open-block delimiter or plain text, and reclassifying it at
   * document start is exactly the "every line re-classified as if at
   * the top" inversion line-shapes.ts exists to prevent.
   *
   * Content is not read line by line: the builder slices it out of the
   * source, so interior blank lines and trailing whitespace survive
   * byte for byte.
   *
   * AN UNTERMINATED BLOCK IS NOT FRONT MATTER. `skip_front_matter!`
   * scans for the closing `---`, and on reaching EOF without one it
   * unshifts every line it took back onto the reader and returns nil —
   * the document is then parsed as if the guard had never matched, so
   * a lone `---` is the thematic break it looks like. This scans for
   * the terminator BEFORE consuming anything for the same reason: the
   * alternative swallows the whole document into one verbatim node,
   * which round-trips (nothing is reflowed, so nothing visibly
   * changes) while silently turning the formatter off for every block
   * below a stray `---`.
   */
  private frontMatter(): void {
    const open = this.peek();
    if (
      this.index !== FIRST ||
      open === undefined ||
      !FRONT_MATTER_DELIMITER.test(open.text)
    ) {
      return;
    }
    const close = this.findFrontMatterClose();
    if (close === undefined) {
      return;
    }
    this.index = close.index + NEXT;
    this.push(
      buildFrontMatter(
        {
          open: fragmentOfLine(open),
          close: fragmentOfLine(close.line),
          source: this.source,
        },
        this.at,
      ),
    );
    this.blanks = EMPTY;
  }

  /**
   * Finds the `---` that closes front matter, without consuming it.
   *
   * Separate from {@link frontMatter} because the search must not move
   * the reader: if there is no terminator the document is not front
   * matter at all and every line has to still be there for the main
   * loop.
   * @returns the closing line and its index, or undefined when the
   *   document ends without one
   */
  private findFrontMatterClose():
    | { line: SourceLine; index: number }
    | undefined {
    const from = this.index + NEXT;
    const found = this.lines
      .slice(from)
      .findIndex((line) => FRONT_MATTER_DELIMITER.test(line.text));
    if (found === NOT_FOUND) {
      return undefined;
    }
    const index = from + found;
    const line = this.lines.at(index);
    return line === undefined ? undefined : { line, index };
  }

  // ── main loop ──────────────────────────────────────────────────────

  /**
   * Walk every line once and close whatever is still open at EOF.
   * @returns the document's blocks, nested as the frames nested
   */
  run(): BlockNode[] {
    this.frontMatter();
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
      // Inside a list frame the confined reader is
      // read_lines_for_list_item, not next_block.
      if (this.topFrame().kind === "list") {
        listLine(this, line, kind);
      } else {
        this.blockLine(line, kind);
      }
    }
    this.closeAll();
    return this.root.children;
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
    if (isLeafKind(kind.kind)) {
      this.leaf(leafBuilder(kind.kind)(fragmentOfLine(line), this.at));
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
        this.admonition("paragraph", line, kind.labelEnd);
        return;
      }
      case "indented": {
        this.literalParagraph(line);
        return;
      }
      case "dlistTerm": {
        // No dlist node yet (#9), but the EXTENT is right: the term
        // line is the item's first line and `dlistItem` is its
        // interrupting set.
        this.paragraph("dlistItem", line, kind.indent);
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
        this.paragraph("paragraph", line, FIRST);
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
   * @param mark - how the line is introduced inside a list item, when
   *   the list reader already knows (a later line of a held run)
   * @returns whether the line was held back
   */
  holdMetadata(line: SourceLine, kind: LineKind, mark?: PendingMark): boolean {
    const node = heldMetadataNode(kind, line, this.at);
    if (node === undefined) {
      return false;
    }
    if (kind.kind === "attributeLine") {
      this.pendingStyle = firstPositional(line.text);
    }
    this.pending.push({ node, mark });
    this.heldLines += NEXT;
    this.index += NEXT;
    // A held line is still a line Asciidoctor BUFFERED: inside a list
    // item it makes Ruby's `prev_line` non-empty, so the run of blanks
    // before it no longer separates anything.
    this.blanks = EMPTY;
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
   * Release every held-back node, in source order, behind the lead the
   * list reader decided for the run.
   * @param blockFollows - whether a block of the item is about to be
   *   read for the run (true), or the run is trailing — the item, list
   *   or block is closing (false)
   */
  flushMetadata(blockFollows = false): void {
    const { pendingLead: lead } = this;
    const first = this.pending.at(FIRST);
    if (lead !== undefined && first !== undefined) {
      first.mark = blockFollows ? lead.block : lead.trailing;
    }
    for (const held of this.pending) {
      this.pushMarked(held.node, held.mark);
    }
    this.pending = [];
    this.pendingStyle = undefined;
    this.pendingLead = undefined;
    this.heldLines = EMPTY;
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
    const enclosing = this.topFrame();
    if (enclosing.kind !== "document" && enclosing.kind !== "section") {
      // Inside a compound block the confined reader never calls
      // next_section: a heading is paragraph text. (A list frame never
      // reaches here — listLine claims the line first.)
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
      // Unreachable: classifyLine reports delimiterClose only for a
      // terminator this stack holds. The fallback keeps block level
      // unable to fail, which is the reader's contract.
      this.paragraph("paragraph", line, FIRST);
      return;
    }
    // Metadata held back inside the block belongs to the block: release
    // it before the block ends, or it would surface after the close.
    this.flushMetadata();
    this.closeDownTo(target + NEXT, line);
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
   * start of that line or one past the document's last character.
   * @param line - the line the close falls on, or undefined at EOF
   * @returns the close, for the builders
   */
  private forcedClose(line: SourceLine | undefined): BlockClose {
    return {
      close: undefined,
      unclosed: { image: "", offset: line?.offset ?? this.source.length },
    };
  }

  /**
   * Pop frames until the stack is `depth` deep, closing each one.
   * @param depth - the stack length to stop at
   * @param line - the line the closes fall on, or undefined at EOF
   */
  closeDownTo(depth: number, line?: SourceLine): void {
    const close = this.forcedClose(line);
    while (this.stack.length > depth) {
      this.closeFrame(this.stack.pop() ?? this.root, close);
    }
  }

  /**
   * Build one closing frame's node and give it to its parent.
   *
   * The style-driven conversions run HERE, on the container's own
   * children: every container — the document (in {@link readDocument}),
   * a section, a compound block, a list item (`endItem` in
   * list-reader.ts) — goes through `convertParagraphFormBlocks`, so a
   * `[source]` paragraph inside an example block is converted as one at
   * the top level is. It is a post-parse transform over a flat block
   * array, not part of construction (spec Decision 4); folding it into
   * frame OPEN is the next plan, not this one.
   * @param frame - the frame being popped
   * @param close - how a delimited block ended; sections and lists
   *   close on their own terms and ignore it
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
      case "list": {
        closeList(this, frame);
        break;
      }
      default: {
        // The document frame never closes: readDocument reads it off
        // the reader once the run is over.
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
  const reader = new BlockReader(source);
  const children = reader.run();
  return {
    type: "document",
    children: convertParagraphFormBlocks(children, source),
    position: {
      start: reader.at.at(FIRST),
      end: reader.at.at(source.length),
    },
  };
}
