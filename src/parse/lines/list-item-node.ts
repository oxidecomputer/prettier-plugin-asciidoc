/**
 * One list item's NODE, assembled from what the extent scan decided
 * and what the confined reader read — the seam between
 * src/parse/lines/list-reader.ts (extents, buffers, the gap record)
 * and src/parse/build/list.ts (the node literal). Everything here is
 * pure over its inputs: the recursion that produced the interior
 * happened in the caller, and nothing in this file can start another.
 *
 * ONE of the three tail FACTS is finished here: `detachedTail`, whose
 * scan half (the pop took the erased shield) is conjoined with the
 * block shape that makes the byte load-bearing
 * ({@link endsInPlusParagraph}). The other two arrive decided -
 * `trailingContinuation` and `activeTail` are the scan's own,
 * finished in item-tail.ts, and nothing here re-derives them. The
 * all-or-nothing indent answer the printer's reflow guard reads
 * (`everyTextLineIndented`) is asked here of the extent's own buffer,
 * for the same reason: the source lines are in hand, and the ANSWER
 * travels rather than the lines. The question itself, and the two
 * others every item body is assembled from, live in item-body.ts,
 * where a description item asks them too. Every Ruby line
 * number cites parser.rb at Asciidoctor core 2.0.26, the vendored
 * reference, exactly as list-reader.ts's do.
 */
import type { BlockNode, GapLine, ListItemNode } from "../../ast.js";
import { buildListItem } from "../build/list.js";
import type { LocationIndex } from "../positions.js";
import {
  isContinuationLine,
  isDroppedCommentLine,
  type MarkerKind,
} from "./classify.js";
import { positionDecidesTheReading } from "../line-shapes-interruption.js";
import {
  everyTextLineIndented,
  recordedTextLines,
  textEndLine,
  type ItemInterior,
} from "./item-body.js";
import type { ListItemShape } from "./list-reader.js";
import { fragmentOfLine, type SourceLine } from "./split.js";

/**
 * Each block's gap: the recorded separator lines strictly between the
 * previous piece of the item and the block. A partition of the
 * document-wide gap record (GapRecord, scope.ts) by block positions.
 * Nothing here reads line text, so a non-gap line in a gap is
 * unrepresentable. Every line between two of an item's blocks was
 * consumed by a recording arm of some scan (comments and metadata are
 * blocks), so the record covers these ranges but for the one a scan's
 * own pop took off an item's tail and the item prints back itself
 * (`finishItem`, item-tail.ts) - the exception invariant (vii) states.
 * @param record - the document-wide gap record
 * @param textEnd - the text's last line number
 * @param blocks - the item's blocks, in source order
 * @returns one gap per block
 * Lives here, beside its one caller, because list-reader.ts has no
 * room for it under `max-lines` and this is the assembly step it is
 * part of.
 *
 * Its src consumers are {@link listItemNode} above and
 * description-list-node.ts, which partitions a description item's
 * blocks by the same rule.
 */
export function gapsOf(
  record: ReadonlyMap<number, GapLine>,
  textEnd: number,
  blocks: readonly BlockNode[],
): GapLine[][] {
  // Sorted ONCE for the whole call, then walked with a single cursor:
  // block ranges are disjoint and increasing, so no entry a later
  // block needs can sit before an entry an earlier block already
  // consumed.
  const entries = [...record].toSorted(([a], [b]) => a - b);
  let cursor = 0;
  let previousEnd = textEnd;
  return blocks.map((block) => {
    // Boundaries are 1-based line numbers, both ends exclusive: the
    // previous piece ends ON previousEnd, the block starts ON its
    // start line.
    const start = previousEnd;
    previousEnd = block.position.end.line;
    // Advance past entries at or before this gap's start, which
    // skips both the previous block's own gap and any entry inside
    // the previous block's own span, before collecting this one.
    while (cursor < entries.length && entries[cursor][0] <= start) {
      cursor += 1;
    }
    const gap: GapLine[] = [];
    while (
      cursor < entries.length &&
      entries[cursor][0] < block.position.start.line
    ) {
      gap.push(entries[cursor][1]);
      cursor += 1;
    }
    return gap;
  });
}

/**
 * Assemble one item's node, once its interior has been read: the
 * marker's own span, the principal text, and each block paired with
 * the GAP that precedes it.
 * @param shape - what the extent scan decided about the item
 * @param interior - the text and blocks the caller read from the buffer
 * @param lines - the document's gap record and offset index, and what
 *   the head drain took out of this item's buffer
 * @param lines.gaps - the document-wide gap record, complete for this
 *   item by now: its own scan and every descendant scan ran before
 *   this call
 * @param lines.at - the document's offset→Location index
 * @param lines.drained - the lines the head drain took, in source
 *   order; read by the caller, which needs them for the interior too
 * @returns the item node
 */
export function listItemNode(
  shape: ListItemShape<MarkerKind>,
  interior: ItemInterior,
  lines: {
    gaps: ReadonlyMap<number, GapLine>;
    at: LocationIndex;
    drained: readonly SourceLine[];
  },
): ListItemNode {
  const { at } = lines;
  const { markerLine, marker } = shape;
  const { text, blocks } = interior;
  const textEnd = textEndLine(at, text, markerLine);
  const gaps = gapsOf(lines.gaps, textEnd, blocks);
  const paired = blocks.map((block, index) => ({ gap: gaps[index], block }));
  return buildListItem(
    {
      marker: fragmentOfLine(markerLine, marker.indent, marker.markerEnd),
      markerSpelling: marker.spelling,
      // The bytes the Fragment above skips. The classifier already
      // measured them, so this is a slice of the line in hand rather
      // than a second match, and the printer writes them back in
      // front of the marker - see ListItemNode.markerIndent for why
      // the indent decides structure.
      markerIndent: markerLine.raw.slice(0, marker.indent),
      // The other half of what the Fragment above spans, and the same
      // deal: the classifier already matched the run, so this is the
      // group it captured rather than a second match - see
      // ListItemNode.markerGap for what the bytes decide.
      markerGap: marker.gap,
      variant: marker.variant,
      // The classifier captured the number when it matched the
      // marker; only a callout has one.
      calloutNumber:
        marker.variant === "callout" ? marker.calloutNumber : undefined,
      text,
      blocks: paired,
      // The scan's answer, minus the one boundary it cannot see: an
      // item whose MARKER LINE an enclosing scan took into a LITERAL
      // PARAGRAPH's slurp stands inside a run that left
      // `within_nested_list` down, so a `+` printed at this item's end
      // is blanked in place on re-read rather than popped - that
      // slurp is what `SourceLine.slurped` names. Writing the byte
      // there costs the output its fixed point - it survives one
      // format and not the next - and a popped `+` renders nothing,
      // so it is withheld. Conjoined here for the reason
      // `detachedTail` below is: the question is about the marker
      // line, which the scan never reads.
      trailingContinuation:
        markerLine.slurped === true ? false : shape.trailingContinuation,
      detachedTail: shape.erasedTailContinuation && endsInPlusParagraph(blocks),
      activeTail: shape.activeTail,
      everyTextLineIndented: everyTextLineIndented(
        recordedTextLines(shape.buffer, markerLine.line, textEnd).map(
          (line) => line.text,
        ),
      ),
      nextLineNeedsItsPosition: nextLineNeedsItsPosition(
        shape.buffer,
        markerLine.line,
        lines.drained,
      ),
    },
    at,
  );
}

/**
 * Whether the item's last block is a paragraph holding a frozen `+` as
 * its final raw line: the block that only stays alive on re-read while
 * a detached `+` shields it (see {@link ListItemNode.detachedTail}).
 * The shape is exactly what the confined reader makes of a surviving
 * frozen `+`: it heads a paragraph whose raw line spells the byte.
 *
 * This conjunct STAYS here, and it is the one tail question the scan
 * cannot take over. The other two moved because the scan already
 * knows both their halves; this one asks what the item's BLOCKS
 * turned out to be, which is decided after every scan has run.
 *
 * The committed row that holds it is
 * `"* a\n+\npara\n\n+\n"` ("behind an attached paragraph",
 * tests/format/plus-run.test.ts): the pop really did take the erased
 * shield, so the scan's half is TRUE, and with this conjunct gone the
 * item writes the tail back - `"* a\n+\npara\n\n+\n"` where the
 * landed answer is `"* a\n+\npara\n"`, measured. The same shape is
 * a plurality of the reading ledger's lone-plus-join rows
 * (docs/harnesses.md): an erased `+` that attached nothing has one
 * route back, the shield, and an item with nothing to shield does not
 * get to take it.
 * @param blocks - the item's blocks, in source order
 * @returns true when the last block ends in a `+` raw line
 *
 * Exported for description-list-node.ts, which asks the same question
 * of a description item's blocks: the shape is the item body's, not
 * the marker's.
 */
export function endsInPlusParagraph(blocks: readonly BlockNode[]): boolean {
  const last = blocks.at(-1);
  if (last?.type !== "paragraph") {
    return false;
  }
  const child = last.children.at(-1);
  return child?.type === "rawLine" && isContinuationLine(child.value);
}

/**
 * Whether the source line directly UNDER the item's opening line is
 * read as what it is only because it stands there
 * ({@link ListItemNode}'s `nextLineNeedsItsPosition`, src/ast.ts,
 * carries the two Ruby arguments).
 *
 * TWO readings, ONE answer, because the printer's move is the same
 * for both: the item's opening line keeps exactly the words the
 * source put on it. Asking them separately would put two facts on
 * every item to serve one guard.
 *
 * The SHAPE half is the registry's own question
 * ({@link positionDecidesTheReading}), the same tables the description
 * join's condition F reads, so a shape added to either position table
 * is answered for here without being written down again. WHICH shapes
 * those are is that predicate's business, not this one's, and for
 * `listItemText` they are two: a block anchor, which the two programs
 * read alike, and a block macro, which they do not. The Ruby gem
 * 2.0.26 reads a macro under an item's text as prose at BOTH positions
 * (`parse_list_item` hands the first block to `next_block` with
 * `text_only`, parser.rb l.1368-1374); the pinned instrument opens a
 * block at the first position and reads prose below it. The oracle
 * wins on results, and the divergence is recorded at
 * {@link LIST_ITEM_FIRST_LINE_INTERRUPTERS}, so a change to that row
 * changes this fact with it.
 *
 * The question is asked of the first line under the item's opening
 * line that a COMMENT does not stand on: `next_block`'s metadata loop
 * (parser.rb l.519-523) shifts a `//` line away before it reads a
 * block context, because `parse_block_metadata_line` answers for one
 * (l.2076-2081), and `read_paragraph_lines` drops one at every later
 * position (`skip_line_comments`, l.754 and l.764), so both readings
 * skip the same lines and the line after them is the one either of
 * them decides on. INSTRUMENT: `* a` / `// c` / `image::a.png[]` is
 * an image block inside the item, and the same three lines with a
 * text line wrapped in front of the comment are one paragraph.
 *
 * The DRAIN half is the one the registry cannot answer: a `///` line
 * is ordinary text to every pattern in it, and what decides its fate
 * is which reader met it. The head drain took it
 * (`Reader#skip_line_comments`'s bare `//` prefix) and
 * `read_paragraph_lines` would keep it one line lower
 * ({@link isDroppedCommentLine}), so the reading it has at the
 * buffer's HEAD is one it has only there - nothing at all where the
 * peek lost the run, the item's own first block where a blank stopped
 * the peek - while one line lower it is the text's own last words
 * either way, measured the same in BOTH programs. Both of those arms
 * hand their run here for that reason. A `//` line the two readers
 * AGREE on is dropped at either position and needs no guard, which is
 * why the test is the disagreement rather than the drain having
 * fired.
 *
 * A DESCRIPTION sibling needs no drain half: its drained bytes are
 * replayed as the term's GAP, and a non-empty gap already forbids the
 * join ({@link siblingPrinting}).
 * @param buffer - the item's lines, in document order
 * @param openingLine - the 1-based marker line, excluded
 * @param drained - the lines the head drain took, in source order
 * @returns true when reflow may not change how many lines stand
 *   between the item's opening line and the line under it
 */
function nextLineNeedsItsPosition(
  buffer: readonly SourceLine[],
  openingLine: number,
  drained: readonly SourceLine[],
): boolean {
  const decides = buffer.find(
    (line) => line.line > openingLine && !isDroppedCommentLine(line.text),
  );
  return (
    (decides !== undefined &&
      positionDecidesTheReading(decides.text, "listItemText")) ||
    drained.some((line) => !isDroppedCommentLine(line.text))
  );
}
