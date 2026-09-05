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
 * number cites parser.rb at Asciidoctor core 2.0.26, the revision
 * the oracle runs, exactly as list-reader.ts's do.
 */
import type { BlockNode, GapLine, ListItemNode } from "../../ast.js";
import { buildListItem } from "../build/list.js";
import type { LocationIndex } from "../positions.js";
import { isContinuationLine, type MarkerKind } from "./classify.js";
import {
  everyTextLineIndented,
  recordedTextLines,
  textEndLine,
  type ItemInterior,
} from "./item-body.js";
import type { ListItemShape } from "./list-reader.js";
import { fragmentOfLine } from "./split.js";

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
 * @param lines - the document's gap record and offset index
 * @param lines.gaps - the document-wide gap record, complete for this
 *   item by now: its own scan and every descendant scan ran before
 *   this call
 * @param lines.at - the document's offset→Location index
 * @returns the item node
 */
export function listItemNode(
  shape: ListItemShape<MarkerKind>,
  interior: ItemInterior,
  lines: {
    gaps: ReadonlyMap<number, GapLine>;
    at: LocationIndex;
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
        shape.trailingContinuation && markerLine.slurped !== true,
      detachedTail: shape.erasedTailContinuation && endsInPlusParagraph(blocks),
      activeTail: shape.activeTail,
      everyTextLineIndented: everyTextLineIndented(
        recordedTextLines(shape.buffer, markerLine.line, textEnd).map(
          (line) => line.text,
        ),
      ),
    },
    at,
  );
}

/**
 * Whether the item's last block is a paragraph holding a frozen `+` as
 * its final raw line: the block that only stays alive on re-read
 * while a detached `+` shields it (see `ListItemNode.detachedTail` in
 * src/ast.ts). The shape is exactly what the confined reader makes of
 * a surviving frozen `+`: it heads a paragraph whose raw line spells
 * the byte.
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
