/**
 * The reflow hazards of one list item, asked by the printer.
 *
 * Reflow packs an item's text onto its MARKER line, and that one move
 * changes what stands on TWO lines the re-reader decides by. So there
 * are two questions here, one per line. They are separate functions
 * because they read different things and answer in different
 * vocabularies:
 *
 * - {@link hazard} - what stands on the item's FIRST REST LINE. A PURE
 *   predicate over the finished node; three answers, and none of them
 *   an invented continuation line. Everything from here down to that
 *   function is about this question.
 * - {@link markerLineGuard} - whether the MARKER line itself would
 *   read back as a checklist item the source did not write. It reads
 *   the finished ATOMS rather than the node, because what the line
 *   spells is a fact about the bytes the packer would place there,
 *   and it answers with the move the printer must make.
 *
 * ── The first rest line ────────────────────────────────────
 *
 * ONE question, asked about ONE line: what stands on the item's FIRST
 * REST LINE - the line directly under the marker line. That line opens
 * the item's buffer (`read_lines_for_list_item`, parser.rb l.1404), and
 * three of Ruby's own decisions read only it:
 *
 * 1. the METADATA drain. Inside next_list_item's confined reader
 *    (parser.rb l.1359) the drain is `next_block`'s own loop over
 *    `parse_block_metadata_line` (parser.rb l.519-523) - not
 *    `parse_block_metadata_lines`, which the item path never calls -
 *    and it runs before the item's text is read. So block metadata on
 *    the first rest line is taken as the block's own attributes and
 *    the block after it folds into the item text, while the same
 *    metadata on a later line ends the text and annotates an attached
 *    block.
 * 2. the BLANK COUNT. `next_block` counts the blank lines it skipped
 *    once, on entry (parser.rb l.505), and `read_paragraph_lines`
 *    reads the count again to decide whether the block's paragraph may
 *    break at a nested list marker (parser.rb l.764). A `//` line on
 *    the first rest line is metadata to `parse_block_metadata_line`
 *    instead (`return true unless next_line.start_with? '///'`,
 *    parser.rb l.2080), so the loop that calls it eats the comment AND
 *    the blank behind it without touching the count (parser.rb
 *    l.519-523) - and the same `+`-attached paragraph then breaks at
 *    `** b` one way and swallows it the other.
 * 3. the INDENT test. `next_block` reads the block's first line to
 *    decide whether it is indented (`text_only`, parser.rb l.572), and
 *    an indented first line sends the whole block down the arm
 *    `adjust_indentation!` strips (parser.rb l.753-755) - turning a
 *    ` +` line from a hard break into a literal plus.
 *
 * Reflow packs the item's text onto the MARKER line, so whatever the
 * source wrote under that text moves up into the deciding position.
 * The hazard says how the printer must compensate:
 *
 * The answer IS the break the item's text must keep, in the printer's
 * own vocabulary ({@link BreakBefore}, src/print/reflow.ts), so
 * nothing translates between the two:
 *
 * - `"hard"` - the line that would stand there is one Ruby reads
 *   differently. {@link keepTextOnFirstRestLine} (src/print/reflow.ts) holds a
 *   break so a plain TEXT line stands on the first rest line instead,
 *   exactly as it did in the source, and the decisions come out as the
 *   input's own reading. The line opens at the item's continuation
 *   indent, which is where a wrapped item text line belongs: decisions
 *   1 and 2 do not read the column, and decision 3's indent arm folds
 *   an indented text line back into the item text unchanged.
 * - `"literal"` - the same held break, at COLUMN 0. Decision 3's arm
 *   strips the indentation of the WHOLE block it fires on
 *   (`adjust_indentation!`, called at parser.rb l.755, walks every line
 *   for the least indented one at parser.rb l.2723-2731), so an
 *   indented text line above a ` +` takes the space that makes the ` +`
 *   a line break with it. Column 0 is what makes the difference and
 *   not merely a smaller indent: a line at indent 0 sets
 *   `block_indent = nil` (parser.rb l.2727-2729) and the strip is
 *   skipped altogether. Where the item's text carries such a break the
 *   held line has to stand there, as the source wrote it. Whether the
 *   strip ALREADY fired on the input is not measured here: the item's
 *   text children are FRAGMENTS of source lines, and the reader that
 *   held the lines themselves answered it once
 *   ({@link ListItemNode.everyTextLineIndented}, src/ast.ts).
 * - `"none"` — everything else; the gap is replayed verbatim.
 *
 * The FOLD direction is what the argument covers; the WRAP direction
 * (a width-wrap pushing first-rest-line metadata later) is a recorded
 * pre-existing divergence the predicate cannot see
 * (`reflowReachesFirstRestLine` needs a text child beyond the marker
 * line).
 *
 * No answer invents bytes: the two that fire hold a break the SOURCE
 * already wrote, and the printer NEVER invents a continuation line.
 * Every `+` in its output replays a recorded author fact - the gap
 * arrays, the popped trailing `+`, the hard-break image (pinned by
 * tests/format/list-hazard.test.ts and the list-item-blocks rows).
 *
 * The predicate reads the item's shape: `text` + `blocks`, each block
 * behind its verbatim gap — "directly under" is a literal empty gap.
 * An author's `+` in a gap needs no help from the printer (it replays
 * verbatim), so a `+`-attached block is simply a FOLLOWER: it ends
 * the run and counts toward "a block follows".
 */
import type { BlockNode, ListItemNode, ListNode } from "../ast.js";
import {
  anchorLineShape,
  isBlockMetadata,
  isLineComment,
} from "../block-metadata.js";
import {
  DLIST_SEPARATOR_WORD,
  LINE_COMMENT_HEAD,
} from "../parse/line-shapes.js";
import { hardBreakOwnsItsLine } from "./inline.js";
import { type Atom, type BreakBefore, isFused } from "./reflow.js";
import { checklistHead } from "./whitespace-fold.js";

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
    if (!transparent && !isRunMetadata(held.block)) {
      break;
    }
    if (!held.adjacent) {
      break;
    }
    if (!transparent) {
      run.push(held.block);
    }
    spanned += 1;
  }
  return { run, spanned };
}

/**
 * Whether reflow could move anything onto the line after the marker
 * line, read off the text's inline nodes: at least one line of
 * REFLOWABLE text beyond the marker line, and no line that keeps its
 * own line (a directive or `[[anchor]]` raw line does; a `//` comment
 * is transparent, Reader#skip_line_comments).
 *
 * Reflowable means TEXT. A hard line break keeps its own line as
 * surely as a raw line does, so a break beyond the marker line is
 * something reflow could move ONTO the first rest line, never
 * something it could move OFF it: an item whose text is one marker
 * line and a ` +` already has the ` +` in the deciding position, and
 * holding a break there would put a line the source never wrote in
 * front of it.
 * @param item - the item node
 * @returns true when reflow would reach the first rest line
 */
function reflowReachesFirstRestLine(item: ListItemNode): boolean {
  const markerLine = item.position.start.line;
  let sawReflowable = false;
  for (const child of item.text) {
    if (child.type === "rawLine") {
      if (child.value.startsWith(LINE_COMMENT_HEAD)) {
        continue;
      }
      return false; // keeps its own line - reflow never reaches
    }
    if (
      child.type !== "hardLineBreak" &&
      child.position.end.line > markerLine
    ) {
      sawReflowable = true;
    }
  }
  return sawReflowable;
}

/**
 * Which of the item's OWN inline children the deciding tests would
 * meet once reflow has packed every word it can onto the marker line:
 * the children that keep a line of their own, READ THE WAY THE READER
 * READS THEM.
 *
 * A `//` line is DRAINED before any of the three decisions is taken -
 * `parse_block_metadata_line` answers true for it (`next_line`,
 * parser.rb l.2080) and the loop that calls it shifts it away
 * (parser.rb l.519-523) - so the walk reads THROUGH one rather than
 * stopping at it, the same way the drain does. What is left after the
 * drain is what the tests see: a ` +` the source gave a line of its own
 * ({@link hardBreakOwnsItsLine}) answers `"hardBreak"`, because its
 * image carries the leading space that makes the line indented; a
 * drain that reached the end of the text with nothing behind it
 * answers `"comment"`, because the decision then falls to whatever the
 * item holds after its text. A directive or anchor raw line is
 * neither, and never reaches here: {@link reflowReachesFirstRestLine}
 * has already answered false for an item whose text holds one.
 * @param item - the item node
 * @returns what the deciding tests would meet, or undefined when the
 *   item's text writes no line of its own
 */
function firstOwnLine(item: ListItemNode): "comment" | "hardBreak" | undefined {
  let drained = false;
  for (const [index, child] of item.text.entries()) {
    if (child.type === "rawLine") {
      drained = true;
      continue;
    }
    if (
      child.type === "hardLineBreak" &&
      hardBreakOwnsItsLine(item.text, index)
    ) {
      return "hardBreak";
    }
  }
  return drained ? "comment" : undefined;
}

/**
 * Whether the item's first block sits behind separator lines - a blank
 * or a `+`. Both reach Ruby's peek as an EMPTY line (a `+` becomes
 * `ListContinuationPlaceholder`, an empty string, at parser.rb l.1439
 * and l.1576), so a `//` line packed in front of one is the shape
 * decision 2 turns on.
 *
 * The RECORDED gap, not the printed one. `printedGap`
 * (src/print/list.ts) differs from it in exactly two ways, and neither
 * can reach the item's first block in the wrong direction: the blank it
 * invents is guarded by `index > 0`, and the blank it drops in front of
 * a same-marker nested list can only turn a held break into a byte
 * this rule did not need - a kept break, never a lost reading.
 * @param item - the item node
 * @returns true when a separator line stands under the item's text
 */
function separatedFirstBlock(item: ListItemNode): boolean {
  const gap = item.blocks.at(0)?.gap;
  return gap !== undefined && gap.length > 0;
}

/**
 * The item's reflow hazard - see the module comment for the one
 * question, the three Ruby decisions that read its answer, and the
 * sufficiency argument, stated there once and pinned by the suite
 * rows, never re-derived here.
 * @param item - the finished item node
 * @returns how the printer must guard the text
 */
export function hazard(item: ListItemNode): BreakBefore {
  if (!reflowReachesFirstRestLine(item)) {
    return "none";
  }
  const own = firstOwnLine(item);
  if (own === "hardBreak") {
    return item.everyTextLineIndented ? "none" : "literal";
  }
  if (own === "comment" && separatedFirstBlock(item)) {
    return "hard";
  }
  return metadataRunNeedsBreak(item);
}

/**
 * Decision 1 alone: whether the metadata run directly under the text
 * needs a text line held in front of it.
 * @param item - the finished item node
 * @returns how the printer must guard the text against the drain
 */
function metadataRunNeedsBreak(item: ListItemNode): BreakBefore {
  const blocks = heldBlocks(item);
  const { run, spanned } = leadingMetadataRun(blocks);
  if (run.length === 0) {
    return "none";
  }
  // "A block of the item follows the run" counts only blocks the run
  // does not already read through — line comments are transparent
  // here too (`Reader#skip_line_comments` removes `//` lines), so a
  // trailing `// c` leaves the run TRAILING.
  const follows = blocks
    .slice(spanned)
    .some((held) => !isLineComment(held.block));
  if (follows) {
    return "hard";
  }
  return run.some((block) => block.type === "blockTitle") ? "hard" : "none";
}

// ── The marker line ────────────────────────────

/**
 * What the printer must do about an item's MARKER LINE, so the line
 * reads back the way the source's own first line read.
 *
 * Three answers, because the printer has three moves and not two: the
 * line is already right, the break can be held, or the line will read
 * as a checklist item whatever the printer does and the only thing
 * left to get right is the SPELLING of that reading.
 */
type MarkerLineGuard =
  | {
      /** The line reads as the source's did; nothing to do. */
      readonly kind: "asPacked";
    }
  | {
      /** Hold a break in front of the atom at `at`. */
      readonly kind: "holdBreak";
      /** The atom whose join becomes a mandatory break. */
      readonly at: number;
    }
  | {
      /**
       * The line spells a prefix and no break can stop it, so its head
       * must be spelled the way the re-read writes that prefix back.
       */
      readonly kind: "canonicalHead";
    };

/** The one answer with no payload, built once. */
const AS_PACKED: MarkerLineGuard = { kind: "asPacked" };

/**
 * Whether a break demanded in front of the atom at `index` would land
 * on a line the reader takes for something other than the item's text.
 *
 * TWO questions, and they are asked separately because only one of
 * them is already recorded on the atom:
 *
 * - BLOCK SYNTAX at a line start is recorded. `wordsToAtoms` fuses
 *   such a word onto its predecessor, and the text case does the same
 *   across a node boundary (`leadingBoundary`, src/print/inline.ts),
 *   so `isFused` IS that answer and re-deriving it here would make a
 *   second source of truth for it. A demand recorded on a fused atom
 *   would also be lifted to the front of its whole run (`runBreak`,
 *   src/print/reflow.ts), landing in front of the bracket rather than
 *   behind it, which spells the same marker line again.
 * - A DESCRIPTION-LIST separator word is not. `wordsToAtoms` marks one
 *   only where it came from a later source line
 *   (`index >= firstLineWordCount`), because that is the only way the
 *   FOLD can move one onto the block's first line - and there the mark
 *   is a demanded break this function then reads as `breakBefore`. A
 *   separator word from the item's own first line carries no mark at
 *   all, and a break held in front of it is this function inventing
 *   the very move the mark exists to prevent: `* [x]<TAB>a:: b` would
 *   print `a:: b` on a line of its own, where it re-reads as a nested
 *   description list.
 *
 * The rule the second case violates is `wrap`'s own
 * (src/print/reflow.ts): a demanded break that is not the author's own
 * line boundary is not exempt from the hazard.
 * @param atoms - the item's atoms.
 * @param index - the atom a break would be demanded in front of.
 * @returns true when that break may not be demanded.
 */
function refusesTheBreak(atoms: readonly Atom[], index: number): boolean {
  return isFused(atoms, index) || DLIST_SEPARATOR_WORD.test(atoms[index].text);
}

/**
 * How the item's MARKER LINE must be written, so it does not read back
 * as a checklist item the source did not write.
 *
 * Asciidoctor reads a checkbox off an unordered item's first line and
 * off nothing else, testing the four-character prefix against the
 * right-stripped `item_text` (parser.rb l.1330; the two split
 * spellings a word list can reach it by are {@link checklistHead},
 * src/print/whitespace-fold.ts). The reader answered the same question
 * about the SOURCE's first line, and an item that carries no checkbox
 * is one whose first line did not spell one - so the marker line the
 * printer writes must not spell one either.
 *
 * Only a packed line break can put it there. Every other run that
 * would spell the prefix keeps its bytes at the split
 * (`manufacturedChecklistRun`, src/print/whitespace-fold.ts), and a run
 * that IS a single space already spelled the prefix in the source,
 * where the reader would have read the checkbox. What is left is the
 * source's own line break, folded to a space by the packer, and the
 * remedy is to hold it: `* [x]` over `more` prints as two lines again,
 * and the re-reader sees `[x]` alone on the marker line exactly as the
 * author wrote it.
 *
 * Where the break may not be held ({@link refusesTheBreak}) the line
 * keeps its packing and DOES read as a checklist item - a failure the
 * base tree has too, and one this cannot trade away without inventing
 * a worse one. What it can do is make that reading a fixed point: the
 * re-read spells a checked box `[x]`, so a head spelled `[*]` has to
 * be written the same way, or the next format moves bytes this one
 * wrote. Hence the third answer.
 *
 * ASKED OF EVERY UNORDERED LIST, including a `[bibliography]` one,
 * where Ruby takes the bibliography arm BEFORE the checkbox test
 * (parser.rb l.1321-1323) and so reads no checkbox at all. The DIVERGENCE
 * is deliberate and one-directional: the reader records no list style
 * for the printer to ask about, and the cost of asking anyway is a
 * break held where none was needed - bytes frozen, the render
 * unchanged, and the document still idempotent. The oracle wins on
 * results, and the result is the same either way.
 * @param item - the finished item node.
 * @param parentList - the list the item belongs to, as the printer
 *   holds it; only an unordered list reads a checkbox at all.
 * @param atoms - the item's atoms, guards already applied, in the
 *   order the packer will place them.
 * @returns what the printer must do about the line.
 */
export function markerLineGuard(
  item: ListItemNode,
  parentList: ListNode | undefined,
  atoms: readonly Atom[],
): MarkerLineGuard {
  if (parentList?.variant !== "unordered" || item.checkbox !== undefined) {
    return AS_PACKED;
  }
  const head = checklistHead(atoms.map((atom) => atom.text));
  if (head === undefined) {
    return AS_PACKED;
  }
  // The prefix's last word is the one that must move off the line: the
  // text behind `[x]`, or behind the `]` of the split spelling.
  const at = head === "markedBracket" ? 1 : 2;
  if (atoms[at].breakBefore !== "none") {
    // A break already stands there, so the line already ends at the
    // bracket and the prefix is not live.
    return AS_PACKED;
  }
  return refusesTheBreak(atoms, at)
    ? { kind: "canonicalHead" }
    : { kind: "holdBreak", at };
}
