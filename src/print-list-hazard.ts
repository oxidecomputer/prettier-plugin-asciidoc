/**
 * The reflow hazard of one list item — Rulings 26–30 as a PURE
 * predicate over the finished node (spec D2), asked by the printer.
 *
 * `parse_block_metadata_lines` runs over an item's buffered lines
 * BEFORE its text is read, and `Reader#skip_line_comments` removes
 * `//` lines before it counts — so block metadata on the FIRST line
 * after the marker line folds the block after it into the item text,
 * while the same metadata on a later line ends the text and annotates
 * an attached block. A formatter that reflows the text can therefore
 * move metadata ONTO that first rest line and change the reading.
 * The hazard says how the printer must compensate:
 *
 * - `"plus"`  — a block of the item follows the leading metadata run:
 *   print an explicit `+` before the run (it re-parents nothing,
 *   because a block of the item follows anyway — Rulings 26/27).
 * - `"keepBreak"` — the run is trailing and carries a block title
 *   (an attribute line or anchor reflowed onto the first rest line is
 *   still read as metadata; a TITLE after one is read as text): keep
 *   the text's last line break instead (Rulings 28/29/30).
 * - `"none"` — everything else; the gap is replayed verbatim.
 *
 * The predicate reads the D1 shape: `text` + `blocks`, each block
 * behind its verbatim gap — "directly under" is a literal empty gap,
 * and an author's `+` is a literal `["+"]`.
 */
import { lineOf } from "./ast.js";
import type { BlockNode, ListItemNode } from "./ast.js";
import { EMPTY, FIRST, SINGLE } from "./constants.js";

/** How the printer must guard the item's text against reflow. */
export type Hazard = "none" | "plus" | "keepBreak";

// What Reader#skip_line_comments takes for a comment: two slashes.
const COMMENT_HEAD = "//";

/**
 * Whether a block is a `//` line comment — TRANSPARENT to the run,
 * exactly as `Reader#skip_line_comments` makes it transparent to the
 * line counting on the text side (see
 * {@link reflowReachesFirstRestLine}). Today's reader reads a comment
 * between two metadata lines as not interrupting the run, and a comment
 * after the run as not being "a block of the item that follows"; both
 * fall out of one predicate.
 *
 * A `////`-delimited comment BLOCK is deliberately NOT transparent:
 * `skip_line_comments` skips `//` lines only, and a comment block is a
 * block like any other.
 * @param block - one block of the item
 * @returns true when the run reads straight through it
 */
function isLineComment(block: BlockNode): boolean {
  return block.type === "comment" && block.commentType === "line";
}

/**
 * Whether a block is metadata a held-back run is made of: an attribute
 * list, a block title, or a block anchor (which the parser stores as a
 * paragraph holding a single inlineAnchor).
 * @param block - one block of the item
 * @returns true when the run may include it
 */
function isRunMetadata(block: BlockNode): boolean {
  if (block.type === "blockAttributeList" || block.type === "blockTitle") {
    return true;
  }
  return (
    block.type === "paragraph" &&
    block.children.length === SINGLE &&
    block.children[FIRST].type === "inlineAnchor"
  );
}

/** One block the item holds, with what the source put in front of it. */
interface HeldBlock {
  /** The block. */
  block: BlockNode;
  /** Whether it starts on the line after the previous piece's end. */
  adjacent: boolean;
  /** Whether an AUTHOR-written `+` line fills the gap in front of it. */
  authorPlus: boolean;
}

/**
 * Every block the item holds, in source order, each with how the source
 * separated it from what precedes it — read straight off the block's
 * recorded gap: an empty gap is adjacency, and a gap of exactly one
 * `+` line is an author-written continuation. (The distinction from a
 * reader-INTRODUCED `+` is now structural: the reader never invents
 * one, so a `+` in a gap is always the author's; the printer's Ruling
 * 26 `+` exists only in the output, never in the node.)
 * @param item - the item node
 * @returns its blocks, earliest first
 */
function heldBlocks(item: ListItemNode): HeldBlock[] {
  return item.blocks.map(({ gap, block }) => ({
    block,
    adjacent: gap.length === EMPTY,
    authorPlus: gap.length === SINGLE && gap[FIRST] === "+",
  }));
}

/**
 * The maximal leading run of metadata blocks sitting DIRECTLY under the
 * text — the "gap []" run.
 *
 * Two things are read THROUGH once the run has started:
 *
 * - a line comment (see {@link isLineComment}), which keeps the run
 *   going without being a member of it;
 * - an AUTHOR-written `+` between two metadata lines (Ruling 66). That
 *   `+` is replayed verbatim from the gap, so the attachment needs no
 *   help from the printer, and the run stays TRAILING: for
 *   `"* a\npara\n[role]\n+\n.T\n"` the answer is `keepBreak` rather
 *   than a second `+`. A `+`-separated block that is NOT metadata
 *   still ends the run and still counts as "a block follows" — for
 *   `"* a\npara\n[role]\n+\npara\n"` the printer really does emit a
 *   `+` (measured: `"* a para\n+\n[role]\n+\npara\n"`).
 *
 * The run's FIRST member must be strictly adjacent, though: a `+` above
 * the run means the gap already speaks and there is no hazard at all
 * (`"* a\n+\n[role]\n----\nx\n----\n"` → `"none"`).
 * @param blocks - the item's blocks in source order
 * @returns the run's metadata members, and how many of `blocks` the run
 *   spans — the two differ by the line comments read through
 */
function leadingMetadataRun(blocks: readonly HeldBlock[]): {
  run: BlockNode[];
  spanned: number;
} {
  const run: BlockNode[] = [];
  let spanned = EMPTY;
  for (const held of blocks) {
    const transparent = isLineComment(held.block);
    if (!transparent && !isRunMetadata(held.block)) break;
    const started = spanned > EMPTY;
    if (!held.adjacent && !(held.authorPlus && started)) break;
    if (!transparent) run.push(held.block);
    spanned += SINGLE;
  }
  return { run, spanned };
}

/**
 * Whether reflow could put the run's first line onto the first line
 * after the marker line — the old reader's
 * `reflowWouldReachFirstRestLine` rule (deleted at the cut-over),
 * read off the text's inline nodes: at least one reflowable
 * non-comment line beyond the marker line, and no line that keeps its
 * own line (a directive or `[[anchor]]` raw line does; a `//` comment
 * is transparent, Reader#skip_line_comments).
 * @param item - the item node
 * @returns true when reflow would reach the first rest line
 */
function reflowReachesFirstRestLine(item: ListItemNode): boolean {
  const markerLine = lineOf(item.position.start);
  let sawReflowable = false;
  for (const child of item.text) {
    if (child.type === "rawLine") {
      if (child.value.startsWith(COMMENT_HEAD)) continue;
      return false; // keeps its own line — reflow never reaches
    }
    if (lineOf(child.position.end) > markerLine) sawReflowable = true;
  }
  return sawReflowable;
}

/**
 * The item's reflow hazard — see the module comment for the three
 * answers and the Rulings behind them.
 * @param item - the finished item node
 * @returns how the printer must guard the text
 */
export function hazard(item: ListItemNode): Hazard {
  const blocks = heldBlocks(item);
  const { run, spanned } = leadingMetadataRun(blocks);
  if (run.length === EMPTY || !reflowReachesFirstRestLine(item)) {
    return "none";
  }
  // "A block of the item follows the run" counts only blocks the run
  // does not already read through — line comments are transparent here
  // too (Ruling 64), so a trailing `// c` leaves the run TRAILING
  // instead of turning it into a `+` the reader never introduces.
  // An author's `+` is handled by the run itself, not here: a
  // `+`-separated METADATA line joins the run (Ruling 66), while a
  // `+`-separated block that is not metadata does follow it and does
  // earn the `+`.
  const follows = blocks
    .slice(spanned)
    .some((held) => !isLineComment(held.block));
  if (follows) return "plus";
  return run.some((block) => block.type === "blockTitle")
    ? "keepBreak"
    : "none";
}
