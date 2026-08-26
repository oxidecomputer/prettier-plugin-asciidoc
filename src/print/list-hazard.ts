/**
 * The reflow hazard of one list item — a PURE predicate over the
 * finished node, asked by the printer; two answers, never an invented
 * continuation line.
 *
 * `parse_block_metadata_lines` runs over an item's buffered lines
 * BEFORE its text is read (parser.rb:2014, inside next_list_item's
 * confined reader, :1359), and `Reader#skip_line_comments` removes
 * `//` lines before it counts — so block metadata on the FIRST line
 * after the marker line folds the block after it into the item text,
 * while the same metadata on a later line ends the text and annotates
 * an attached block. A formatter that reflows the text can therefore
 * move metadata ONTO that first rest line and change the reading.
 * The hazard says how the printer must compensate:
 *
 * - `"keepBreak"` — the run is what the RE-READER will see: metadata
 *   sits directly under reflowable text, and either a non-transparent
 *   block follows the run or the run carries a block title. Keeping
 *   the text's last source break leaves a TEXT line on the item's
 *   first rest line, so the re-reader's metadata drain meets every
 *   metadata line exactly where the author placed it — later than the
 *   first rest line — and reads the item as the input reads. The
 *   argument covers the FOLD direction; the WRAP direction (a
 *   width-wrap pushing first-rest-line metadata later) is a recorded
 *   pre-existing divergence the predicate cannot see
 *   (`reflowReachesFirstRestLine` needs a text child beyond the
 *   marker line).
 * - `"none"` — everything else; the gap is replayed verbatim.
 *
 * There is no third answer: the printer NEVER invents a continuation
 * line. Every `+` in its output replays a recorded author fact — the
 * gap arrays, the popped trailing `+`, the hard-break image (pinned by
 * tests/format/list-hazard.test.ts and the list-item-blocks rows).
 *
 * The predicate reads the item's shape: `text` + `blocks`, each block
 * behind its verbatim gap — "directly under" is a literal empty gap.
 * An author's `+` in a gap needs no help from the printer (it replays
 * verbatim), so a `+`-attached block is simply a FOLLOWER: it ends
 * the run and counts toward "a block follows".
 */
import type { BlockNode, ListItemNode } from "../ast.js";
import {
  anchorLineShape,
  isBlockMetadata,
  isLineComment,
} from "../block-metadata.js";
import { LINE_COMMENT_HEAD } from "../parse/line-shapes.js";

/** How the printer must guard the item's text against reflow. */
type Hazard = "none" | "keepBreak";

/**
 * Whether a block is metadata a held-back run is made of: block
 * metadata proper, or a block whose PRINTED line re-reads as a valid
 * block anchor (`anchorLineShape` — `[[id, ]]` prints `[[id, ]]`, an
 * anchor on re-read, so it stays in the run and the fold bytes stay
 * fixed points). A LOOKALIKE — a rejected id or an empty `[[id,]]`
 * reftext, printed byte-faithfully
 * — is a text line to the re-reader: it is NOT run metadata, so the
 * run ends before it and it sits in the follows slice like any other
 * block. Same record as the pairing rule's, for the same reason — the
 * printed LINE is what the reader will see again.
 * @param block - one block of the item
 * @returns true when the run may include it
 */
function isRunMetadata(block: BlockNode): boolean {
  return isBlockMetadata(block) || anchorLineShape(block) === "anchor";
}

/** One block the item holds, with what the source put in front of it. */
interface HeldBlock {
  /** The block. */
  block: BlockNode;
  /** Whether it starts on the line after the previous piece's end. */
  adjacent: boolean;
}

/**
 * Every block the item holds, in source order, each with whether the
 * source separated it from what precedes it — read straight off the
 * block's recorded gap: an empty gap is adjacency. (What fills a
 * non-empty gap no longer matters here: an author's `+` replays
 * verbatim and its block is an ordinary follower.)
 * @param item - the item node
 * @returns its blocks, earliest first
 */
function heldBlocks(item: ListItemNode): HeldBlock[] {
  return item.blocks.map(({ gap, block }) => ({
    block,
    adjacent: gap.length === 0,
  }));
}

/**
 * The maximal leading run of metadata blocks sitting DIRECTLY under
 * the text — the "gap []" run. A line comment is read THROUGH once
 * the run has started, without being a member ({@link isLineComment}).
 * Every member — the first especially — must be strictly adjacent: a
 * `+` or a blank above a line means the gap already speaks and the
 * run ends there (`"* a\n+\n[role]\n----\nx\n----\n"` → `"none"`).
 * @param blocks - the item's blocks in source order
 * @returns the run's metadata members, and how many of `blocks` the
 *   run spans — the two differ by the line comments read through
 */
function leadingMetadataRun(blocks: readonly HeldBlock[]): {
  run: BlockNode[];
  spanned: number;
} {
  const run: BlockNode[] = [];
  let spanned = 0;
  for (const held of blocks) {
    const transparent = isLineComment(held.block);
    if (!transparent && !isRunMetadata(held.block)) break;
    if (!held.adjacent) break;
    if (!transparent) run.push(held.block);
    spanned += 1;
  }
  return { run, spanned };
}

/**
 * Whether reflow could put the run's first line onto the first line
 * after the marker line, read off the text's inline nodes: at least
 * one reflowable non-comment line beyond the marker line, and no line
 * that keeps its own line (a directive or `[[anchor]]` raw line does;
 * a `//` comment is transparent, Reader#skip_line_comments).
 * @param item - the item node
 * @returns true when reflow would reach the first rest line
 */
function reflowReachesFirstRestLine(item: ListItemNode): boolean {
  const markerLine = item.position.start.line;
  let sawReflowable = false;
  for (const child of item.text) {
    if (child.type === "rawLine") {
      if (child.value.startsWith(LINE_COMMENT_HEAD)) continue;
      return false; // keeps its own line — reflow never reaches
    }
    if (child.position.end.line > markerLine) sawReflowable = true;
  }
  return sawReflowable;
}

/**
 * The item's reflow hazard — see the module comment for the two
 * answers and the sufficiency argument, stated there once and pinned
 * by the suite rows, never re-derived here.
 * @param item - the finished item node
 * @returns how the printer must guard the text
 */
export function hazard(item: ListItemNode): Hazard {
  const blocks = heldBlocks(item);
  const { run, spanned } = leadingMetadataRun(blocks);
  if (run.length === 0 || !reflowReachesFirstRestLine(item)) {
    return "none";
  }
  // "A block of the item follows the run" counts only blocks the run
  // does not already read through — line comments are transparent
  // here too (`Reader#skip_line_comments` removes `//` lines), so a
  // trailing `// c` leaves the run TRAILING.
  const follows = blocks
    .slice(spanned)
    .some((held) => !isLineComment(held.block));
  if (follows) return "keepBreak";
  return run.some((block) => block.type === "blockTitle")
    ? "keepBreak"
    : "none";
}
