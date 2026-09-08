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
 *   predicate over the finished node; three break answers, and none of
 *   them an invented continuation line. Everything from here down to
 *   that function is about this question. It carries a second fact
 *   ({@link TextGuard}) for the one shape where the WRAP direction is
 *   a hazard too.
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
 *   held line has to stand there. WHETHER it is a break is not asked
 *   again here: the reader read the item's own lines, applied that
 *   walk to them and retyped every ` +` the strip turned into a plain
 *   plus (src/parse/lines/paragraph-reader.ts, the literal-plus
 *   rule), so a `hardLineBreak` child IS a break and needs the line
 *   whatever the source's columns were. {@link continuationIndent}
 *   writes the item's other text lines at column 0 for the same
 *   reason.
 * - `"none"` — everything else; the gap is replayed verbatim.
 *
 * The FOLD direction is what the three decisions' argument covers.
 * The WRAP direction - the packer pushing words down onto a rest line
 * the source never wrote - is a hazard of its own, and one the three
 * break answers cannot express, since a held break MAKES a line and
 * cannot forbid one. It is answered for the one shape where a rest
 * line the packer wrote changes a reading rather than only a column
 * ({@link opensOnARuleMarkerLine}); the older divergence, a width
 * wrap pushing first-rest-line metadata later, remains outside what
 * the predicate can see (`reflowReachesFirstRestLine` needs a text
 * child beyond the marker line).
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
import type { BlockNode, InlineNode, ListItemNode, ListNode } from "../ast.js";
import {
  anchorLineShape,
  isBlockMetadata,
  isLineComment,
} from "../block-metadata.js";
import { LINE_COMMENT_HEAD } from "../parse/line-shapes.js";
import { opensOnARuleMarkerLine } from "../rule-marker-line.js";
import { hardBreakOwnsItsLine } from "./text-edges.js";
import { type Atom, type BreakBefore, isFused } from "./reflow.js";
import { checklistHead } from "./whitespace-fold.js";
import { childrenOf } from "../whitespace-runs.js";

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
 *
 * The walk therefore STOPS at the first break that writes a line of
 * its own: a text line BELOW such a break is something reflow could
 * move onto the break's line, never onto the marker's, and a held
 * break has to land in front of a run, so with no reflowable text
 * above the break every candidate run stands on the marker line
 * itself and holding one cuts that line in two. Red before the stop:
 * `* [ ] +` / `   +` / `  z` came out `* [\n] +\n +\nz\n`, whose
 * first line is the marker and a bare `[`, and the checklist reading
 * went with it.
 *
 * A text node of nothing but horizontal whitespace is not reflowable
 * either. It is the indent a break's dropped newline leaves behind
 * (`skipNewlineAfterHardBreak`,
 * src/parse/inline/inline-node-builder.ts), it writes no atom, and
 * counting it would say reflow reaches a line no word of the item
 * stands on.
 * @param item - the item node
 * @returns true when reflow would reach the first rest line
 */
function reflowReachesFirstRestLine(item: ListItemNode): boolean {
  const markerLine = item.position.start.line;
  let sawReflowable = false;
  for (const [index, child] of item.text.entries()) {
    if (child.type === "rawLine") {
      if (child.value.startsWith(LINE_COMMENT_HEAD)) {
        continue;
      }
      return false; // keeps its own line - reflow never reaches
    }
    if (child.type === "hardLineBreak") {
      if (hardBreakOwnsItsLine(item.text, index)) {
        return sawReflowable;
      }
      continue;
    }
    if (
      child.position.end.line > markerLine &&
      !(child.type === "text" && child.value.trim() === "")
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
  if (holdsOwnLineHardBreak(item.text)) {
    return "hardBreak";
  }
  return item.text.some((child) => child.type === "rawLine")
    ? "comment"
    : undefined;
}

/**
 * Whether the item's text carries a ` +` the printer will write on a
 * line of its OWN ({@link hardBreakOwnsItsLine}) - the one shape whose
 * reading the item's own indentation decides.
 *
 * The walk DESCENDS, because the indent question is about output
 * LINES and a span puts no line of its own between the break and the
 * item: `* a` / `` `w `` / `   +` / `` x` `` is a break inside a
 * monospace span, written on a line of the item all the same, and the
 * strip reads that line beside the item's others.
 * @param nodes - the item's text, or the children of one of its nodes
 * @returns true when such a break stands anywhere under them
 */
function holdsOwnLineHardBreak(nodes: readonly InlineNode[]): boolean {
  return nodes.some((child, index) => {
    if (child.type === "hardLineBreak") {
      return hardBreakOwnsItsLine(nodes, index);
    }
    const nested = childrenOf(child);
    return nested !== undefined && holdsOwnLineHardBreak(nested);
  });
}

/**
 * The column an item's WRAPPED text lines open at.
 *
 * Normally under the text the marker line starts, which is where a
 * reader expects a continued item to line up. COLUMN 0 where the
 * item's text carries a hard break on a line of its own, and that is
 * decision 3 answered in the only vocabulary that settles it: the
 * strip takes the LEAST indent of the whole buffer and applies it to
 * every line (`adjust_indentation!`, parser.rb l.2721-2733), so a
 * ` +` line written at column 0 - one space and a plus - is the least
 * indented line of an item whose other lines stand under the marker
 * text, and the strip eats exactly the space that makes it a break
 * (`HardLineBreakRx`, rx.rb l.627). One line at indent 0 sets
 * `block_indent = nil` and cancels the strip for the whole buffer
 * (l.2727-2729), so writing the item's text there is what keeps every
 * ` +` of it reading as the break the reader recorded. A held break
 * puts a text line under the marker line where the packer would
 * otherwise have taken it up ({@link packedBreak}); this decides the
 * column that line and every line after it stands at.
 *
 * The two answers cannot be merged into always-0: an item with no
 * such break reads the same at either column, and column 0 would
 * throw away the alignment for every wrapped list item in a document.
 * @param item - the item node
 * @param underTheText - the column the item's own text starts at, past
 *   its indent, marker, gap and checkbox
 * @returns the column the packer opens continuation lines at
 */
export function continuationIndent(
  item: ListItemNode,
  underTheText: number,
): number {
  return holdsOwnLineHardBreak(item.text) ? 0 : underTheText;
}

/**
 * Whether the item's first block sits behind separator lines - a blank
 * or a `+`. Both reach Ruby's peek as an EMPTY line (a `+` becomes
 * `ListContinuationPlaceholder`, an empty string, at parser.rb l.1439
 * and l.1576), so a `//` line packed in front of one is the shape
 * decision 2 turns on.
 *
 * The RECORDED gap, which is also the printed one: the printer
 * replays an item's separator lines as the source wrote them.
 * @param item - the item node
 * @returns true when a separator line stands under the item's text
 */
function separatedFirstBlock(item: ListItemNode): boolean {
  const gap = item.blocks.at(0)?.gap;
  return gap !== undefined && gap.length > 0;
}

/**
 * What the printer must do about a list item's TEXT.
 *
 * TWO ARMS, one per hazard, because the two move the item's lines in
 * opposite directions and only one of them is a break. `kept` answers
 * the FOLD - reflow packing the source's rest line up onto the marker
 * line - and is the module comment's three-decision question, so both
 * arms carry it. The ARM answers the WRAP - the packer pushing words
 * down onto a rest line the source never wrote - which no kept break
 * can express, since a held break makes a line and cannot forbid one.
 *
 * A DISCRIMINANT rather than a flag beside `kept`, so the shape that
 * decided the answer is recoverable from the value and a third hazard
 * arrives as a third arm rather than as a second boolean.
 */
export type TextGuard =
  | {
      /** The packer places the text as it likes, within the width. */
      readonly kind: "packed";
      /** The break the text must keep on its first rest line. */
      readonly kept: BreakBefore;
    }
  | {
      /**
       * The packer may write no break of its own: the item's first
       * block start is a marker line spelling a rule
       * ({@link opensOnARuleMarkerLine}), and a rest line the packer
       * wrote would move it between `next_block`'s two calls.
       */
      readonly kind: "noWidthBreaks";
      /** The break the text must keep on its first rest line. */
      readonly kept: BreakBefore;
    };

/**
 * The item's reflow hazard - see the module comment for the fold
 * question, the three Ruby decisions that read its answer, and the
 * sufficiency argument, stated there once and pinned by the suite
 * rows, never re-derived here.
 *
 * The RULE shape is answered first and answers both halves at once,
 * because it is the one shape where a width wrap is a hazard too
 * ({@link opensOnARuleMarkerLine}). Its kept break is the item's own
 * rest line where the source wrote one, at the column the source put
 * it at ({@link ListItemNode.everyTextLineIndented} says which), and
 * `"none"` where the source wrote no rest line at all - holding a
 * break there would MAKE the second line the wrap hazard is about.
 * @param item - the finished item node
 * @returns how the printer must guard the text
 */
export function hazard(item: ListItemNode): TextGuard {
  if (opensOnARuleMarkerLine(item.blocks)) {
    return { kind: "noWidthBreaks", kept: keptRuleBreak(item) };
  }
  return { kind: "packed", kept: packedBreak(item) };
}

/**
 * The break the rule shape keeps: the item's own first rest line,
 * written back at the column the source wrote it at.
 * @param item - the finished item node
 * @returns the break to hold, `"none"` where the text is one line
 */
function keptRuleBreak(item: ListItemNode): BreakBefore {
  if (!reflowReachesFirstRestLine(item)) {
    return "none";
  }
  return item.everyTextLineIndented ? "hard" : "literal";
}

/**
 * The fold question alone, for an item the packer may still wrap.
 * @param item - the finished item node
 * @returns the break to hold in front of the first rest line
 */
function packedBreak(item: ListItemNode): BreakBefore {
  if (!reflowReachesFirstRestLine(item)) {
    return "none";
  }
  const own = firstOwnLine(item);
  if (own === "hardBreak") {
    return "literal";
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
 *
 * NOT PROTECTED BY DESIGN: an item whose text opens with two more
 * copies of its own marker, `- - - word`. A fourth answer used to keep
 * that word on the marker line, because a break in front of it leaves
 * `- - -` alone there and both programs read that as an `<hr>`. It
 * fired only where such an item ALSO ran past the print width, and no
 * author writes one: the spaced rule itself is documented (CommonMark
 * spells it), but a rule with an item's worth of text behind it is a
 * shape somebody would have to build on purpose. The row it costs is
 * in tests/format/spaced-thematic-break.test.ts.
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
 * A run holding a TAB keeps its bytes on its own account (the
 * whitespace record's tab row, `factOfRun`, src/whitespace-fact.ts),
 * and a run that IS a single space already spelled the prefix in the
 * source, where the reader would have read the checkbox. What is left
 * is the source's own line break, folded to a space by the packer,
 * and the remedy is to hold it: `* [x]` over `more` prints as two
 * lines again, and the re-reader sees `[x]` alone on the marker line
 * exactly as the author wrote it.
 *
 * Where the break may not be held - a FUSED atom, whose demand is
 * lifted to the front of its run and spells the same marker line
 * again - the line keeps its packing and DOES read as a checklist
 * item, a failure the base tree has too and one this cannot trade
 * away without inventing a worse one. What it can do is make that
 * reading a fixed point: the re-read spells a checked box `[x]`, so a
 * head spelled `[*]` has to be written the same way, or the next
 * format moves bytes this one wrote. Hence the third answer.
 *
 * ASKED OF EVERY UNORDERED LIST, including a `[bibliography]` one,
 * where Ruby takes the bibliography arm BEFORE the checkbox test
 * (parser.rb l.1321-1323) and so reads no checkbox at all. The DIVERGENCE
 * is deliberate and one-directional: the reader records no list style
 * for the printer to ask about, and the cost of asking anyway is a
 * break held where none was needed - bytes frozen, the render
 * unchanged, and the document still idempotent. The two programs
 * agree on the result, and the result is the same either way.
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
  // A FUSED atom is the one shape the hold cannot reach. `wordsToAtoms`
  // fuses a word that would open a block at a line start onto its
  // predecessor, and the text case does the same across a node
  // boundary (`leadingBoundary`), so a break demanded on one is
  // lifted to the front of its whole run ({@link runBreak}): in front
  // of the bracket rather than behind it, which spells the same marker
  // line again. `isFused` IS that answer, recorded on the atom, and
  // re-deriving it here would make a second source of truth for it.
  return isFused(atoms, at)
    ? { kind: "canonicalHead" }
    : { kind: "holdBreak", at };
}
