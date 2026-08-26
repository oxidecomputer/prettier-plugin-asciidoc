/**
 * One list item's NODE, assembled from what the extent scan decided
 * and what the confined reader read — the seam between
 * src/parse/lines/list-reader.ts (extents, buffers, the gap record)
 * and src/parse/build/list.ts (the node literal). Everything here is
 * pure over its inputs: the recursion that produced the interior
 * happened in the caller, and nothing in this file can start another.
 *
 * The three tail FACTS the item carries are computed here, each one a
 * scan fact conjoined with the block shape that makes it printable:
 * `trailingContinuation` ({@link keptTrailingContinuation}),
 * `detachedTail` ({@link endsInPlusParagraph}) and `activeTail`
 * ({@link armedTailPrints}). Every Ruby line number cites parser.rb
 * at Asciidoctor core 2.0.26 — the revision the oracle runs — exactly
 * as list-reader.ts's do.
 */
import type { BlockNode, GapLine, ItemBlock, ListItemNode } from "../../ast.js";
import { buildListItem } from "../build/list.js";
import type { InlineToken } from "../inline/tokens.js";
import type { LocationIndex } from "../positions.js";
import { isContinuationLine } from "./classify.js";
import { fragmentOfLine } from "./frames.js";
import { gapsOf, type ListItemShape } from "./list-reader.js";
import type { SourceLine } from "./split.js";

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
 * @param lines - the document's gap record and offset index, plus
 *   whether this item was read from ANOTHER item's buffer
 * @param lines.gaps - the document-wide gap record, complete for this
 *   item by now: its own scan and every descendant scan ran before
 *   this call
 * @param lines.at - the document's offset→Location index
 * @param lines.nested - true when the enclosing reader is confined to
 *   a list item's buffer
 * @returns the item node
 */
export function listItemNode(
  shape: ListItemShape,
  interior: ItemInterior,
  lines: {
    gaps: ReadonlyMap<number, GapLine>;
    at: LocationIndex;
    nested: boolean;
  },
): ListItemNode {
  const { at, nested } = lines;
  const { markerLine, marker } = shape;
  const { text, blocks } = interior;
  const gaps = gapsOf(lines.gaps, textEndLine(at, text, markerLine), blocks);
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
      trailingContinuation: keptTrailingContinuation(shape, blocks, nested),
      detachedTail: shape.erasedTailContinuation && endsInPlusParagraph(blocks),
      activeTail: shape.activeTailContinuation && armedTailPrints(paired),
    },
    at,
  );
}

/**
 * Whether the item's printed tail still SHOWS the armed `+` — the
 * other half of `ListItemNode.activeTail`'s condition (src/ast.ts).
 * The scan saying `:active` at the end is not enough: an activation
 * whose `+` was followed by blanks alone leaves nothing in the
 * buffer, the item prints without the byte, and a re-read of the
 * output finds no continuation to arm. The `+` reaches the output
 * only inside the gap of a block behind it, and under an
 * active-at-end scan every block after the activation is metadata
 * (anything else deactivates: `read_lines_for_list_item` sets
 * `continuation = :inactive`, parser.rb l.1511) — so the walk runs
 * back over the trailing metadata run and asks whether one of its
 * gaps replays a `+`.
 * @param blocks - the item's blocks, gaps attached, in source order
 * @returns true when the printed tail carries a live `+`
 */
function armedTailPrints(blocks: readonly ItemBlock[]): boolean {
  for (const { gap, block } of [...blocks].toReversed()) {
    if (!isMetadataBlock(block)) return false;
    if (gap.includes("+")) return true;
  }
  return false;
}

/**
 * Whether a block is one of the four shapes the `:active` arm reads
 * through (parser.rb l.1499-1501) — the node kinds
 * {@link armedTailPrints}' trailing walk may cross: exactly the
 * producers of list-reader.ts's `isBlockMetadataLine` line shapes.
 * @param block - one of the item's blocks
 * @returns true for a metadata block
 */
function isMetadataBlock(block: BlockNode): boolean {
  return (
    block.type === "blockTitle" ||
    block.type === "blockAttributeList" ||
    block.type === "blockAnchor" ||
    block.type === "attributeEntry"
  );
}

/**
 * Whether the item's last block is a paragraph holding a frozen `+` as
 * its final raw line — the block that only stays alive on re-read
 * while a detached `+` shields it (see `ListItemNode.detachedTail` in
 * src/ast.ts). The shape is exactly what the confined reader makes of
 * a surviving frozen `+`: it heads a paragraph whose raw line spells
 * the byte.
 * @param blocks - the item's blocks, in source order
 * @returns true when the last block ends in a `+` raw line
 */
function endsInPlusParagraph(blocks: readonly BlockNode[]): boolean {
  const last = blocks.at(-1);
  if (last?.type !== "paragraph") return false;
  const child = last.children.at(-1);
  return child?.type === "rawLine" && isContinuationLine(child.value);
}

/**
 * Whether a `+` the scan popped off an item's end must be printed
 * back — the question `ListItemNode.trailingContinuation` answers.
 *
 * The pop is Ruby's and the byte renders nothing WHEN Ruby's own read
 * of the item ended where ours did. Two tails are where it does not,
 * and both are measured rather than argued (the list-shape sweep's own
 * alphabet, exhaustive to depth 5):
 *
 * - an INDENTED LITERAL. Its re-read slurp
 *   (`read_lines_until break_on_blank_lines, break_on_list_continuation`)
 *   takes the `+` and whatever follows into the `<pre>`, so
 *   `* a\n** b\n+\n  lit\n+\n** b\n` renders a three-line literal and
 *   dropping the byte renders a one-line one plus an `<li>` that was
 *   never written.
 * - a paragraph carrying a RAW LINE. That is the reader's record of a
 *   line Ruby folded into prose — a frozen `+`, a marker line a
 *   paragraph swallowed — and the `+` beside it is prose too:
 *   `* a\n+\npara\n** b\n+\n+\n` renders `para ** b +`.
 *
 * A NESTED item — one read from another item's buffer — keeps the byte
 * whatever its own blocks look like. There the enclosing scan has
 * already re-shaped the lines (erasures, slurps, folds) before this
 * item ever saw them, so "our read ended where Ruby's did" is not a
 * claim this reader can make — the enclosing item's own read decides
 * what the byte means, so the byte stays (the nested rows in
 * tests/format/trailing-continuation.test.ts pin the family).
 * @param shape - the extent scan's record for this item
 * @param blocks - the blocks its interior read
 * @param nested - whether it was read from another item's buffer
 * @returns true when the byte must come back
 */
function keptTrailingContinuation(
  shape: ListItemShape,
  blocks: readonly BlockNode[],
  nested: boolean,
): boolean {
  if (!shape.poppedContinuation || !shape.tailSafe) return false;
  return nested || blocks.some((block) => readsOnPastTheItem(block));
}

/**
 * Whether a block the item ends with re-reads PAST the item — the two
 * tails {@link keptTrailingContinuation} refuses to drop a `+` behind.
 * @param block - one of the item's blocks
 * @returns true when the block's re-read runs on into the lines below
 */
function readsOnPastTheItem(block: BlockNode): boolean {
  if (block.type === "list") return true;
  if (block.type === "delimitedBlock") return block.form === "indented";
  if (block.type !== "paragraph") return false;
  return block.children.some((child) => child.type === "rawLine");
}

/**
 * The last source line the principal text occupies — where the first
 * block's gap starts counting from.
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
