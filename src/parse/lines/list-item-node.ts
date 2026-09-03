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
 * (`everyTextLineIndented`) is also computed here, off the extent's
 * buffer, for the same reason: the source lines are in hand, and the
 * ANSWER travels rather than the lines. Every Ruby line
 * number cites parser.rb at Asciidoctor core 2.0.26, the revision
 * the oracle runs, exactly as list-reader.ts's do.
 */
import type { BlockNode, GapLine, ListItemNode } from "../../ast.js";
import { buildListItem } from "../build/list.js";
import type { InlineToken } from "../inline/tokens.js";
import type { LocationIndex } from "../positions.js";
import { LINE_COMMENT_HEAD } from "../line-shapes.js";
import { isContinuationLine, isLiteralLine } from "./classify.js";
import { gapsOf, type ListItemShape } from "./list-reader.js";
import { fragmentOfLine, type SourceLine } from "./split.js";

/** What reading one item's interior produced. NOT exported. */
interface ItemInterior {
  /** The principal text's tokens. */
  readonly text: InlineToken[];
  /** The item's blocks, in source order. */
  readonly blocks: BlockNode[];
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
  shape: ListItemShape,
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
      variant: marker.variant,
      // The classifier captured the number when it matched the
      // marker; only a callout has one.
      calloutNumber:
        marker.variant === "callout" ? marker.calloutNumber : undefined,
      text,
      blocks: paired,
      trailingContinuation: shape.trailingContinuation,
      detachedTail: shape.erasedTailContinuation && endsInPlusParagraph(blocks),
      activeTail: shape.activeTail,
      everyTextLineIndented: everyTextLineIndented(
        shape.buffer,
        markerLine.line,
        textEnd,
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
 */
function endsInPlusParagraph(blocks: readonly BlockNode[]): boolean {
  const last = blocks.at(-1);
  if (last?.type !== "paragraph") {
    return false;
  }
  const child = last.children.at(-1);
  return child?.type === "rawLine" && isContinuationLine(child.value);
}

/**
 * Whether every source line the item's text wrote under the marker
 * line is indented: `ListItemNode.everyTextLineIndented` (src/ast.ts
 * carries the Ruby argument and the two exempt line kinds).
 *
 * Read off the item's own BUFFER, which is where the raw spelling of
 * those lines already is: the scan handed the lines over with their
 * indentation intact, so the question is asked of the source rather
 * than of the nodes the text was split into.
 *
 * THREE disjuncts, and only the last is the indent test. The other
 * two are `adjust_indentation!`'s own exemptions, transcribed: a
 * blank line, which the walk skips (`next if line.empty?`,
 * parser.rb l.2726), and a `//` line, which `read_paragraph_lines`
 * drops before the strip runs (l.754). The blank row cannot be
 * reached from today's extent - a blank ends the principal text, so
 * no line in `(markerLine, textEnd]` is empty - and it stays anyway:
 * it is a row of the RULE, not a guard on this call, and dropping it
 * would make the transcription answer differently from Ruby the
 * first time an extent runs through a blank.
 * @param buffer - the item's lines, in document order
 * @param markerLine - the item's marker line, which the strip does
 *   not measure
 * @param textEnd - the last line the principal text occupies
 * @returns true when no line under the marker line stands at column 0
 */
function everyTextLineIndented(
  buffer: readonly SourceLine[],
  markerLine: number,
  textEnd: number,
): boolean {
  return buffer
    .filter((line) => line.line > markerLine && line.line <= textEnd)
    .every(
      (line) =>
        line.text === "" ||
        line.text.startsWith(LINE_COMMENT_HEAD) ||
        isLiteralLine(line.text),
    );
}

/**
 * The last source line the principal text occupies — where the first
 * block's gap starts counting from.
 *
 * TOTAL over `readonly InlineToken[]`, empty array included: no
 * marker shape LIST_MARKER_LINE admits leaves the text empty today,
 * but the marker line is the honest answer where it is, and reading
 * `text.at(-1)` without it would throw rather than answer.
 * @param at - the document's offset→Location index
 * @param text - the principal text's tokens
 * @param markerLine - the item's marker line (the answer for empty text)
 * @returns the 1-based line number
 */
function textEndLine(
  at: LocationIndex,
  text: readonly InlineToken[],
  markerLine: SourceLine,
): number {
  const last = text.at(-1);
  if (last === undefined) return markerLine.line;
  // One BEFORE the exclusive end: a token ending at a newline must
  // report the line it ends ON, not the next one.
  const end = last.offset + Math.max(last.image.length, 1) - 1;
  return at.at(end).line;
}
