/**
 * WHETHER A LIST-LIKE ITEM'S FIRST BLOCK OPENS ON A MARKER LINE THAT
 * SPELLS A SPACED RULE, in one function, so the reader's own printing
 * verdict and the printer's packer cannot disagree about which lines
 * that is.
 *
 * `- - -` and `* * *` are read at TWO positions by two different arms
 * of `next_block`. The item's first call may carry `text_only`
 * (`parse_list_item`, parser.rb l.1367-74), which skips the whole
 * layout-break arm (l.591-596) and leaves the list arms (l.686-704)
 * to claim the line; a later call reaches the break arm first. So the
 * same three marks are a nested `ulist` holding the item `- -` at one
 * position and an `<hr>` at the other, and MOVING the line between
 * those two positions changes what it means.
 *
 * Both halves of the formatter can move it, in opposite directions,
 * and both ask this before they do. The PACKER lifts a marker item's
 * text onto its marker line, which pulls the rule up into the first
 * call, and a width wrap pushes a second line under the marker line,
 * which pushes it out again ({@link opensOnARuleMarkerLine}'s marker
 * caller, src/print/list-hazard.ts). The DESCRIPTION item's join
 * takes its rest lines away, which leaves the rule standing directly
 * under the term line - the same first call
 * (`descriptionPrinting`'s caller, src/parse/lines/description-list-node.ts).
 *
 * A SHARED HOME AT THE ROOT, beside src/block-metadata.ts and
 * src/line-verdict.ts, rather than a fifth address into src/parse or
 * a second spelling of the same three marks. The layer rule
 * (scripts/metrics/graph.ts) counts the printer's reaches INTO
 * src/parse; a root module both halves import is not one of them.
 */
import type { ItemBlock, ListItemNode } from "./ast.js";
import { rstrip, THEMATIC_BREAK } from "./parse/line-shapes.js";

// The whole of a rule line's text: the two marks the item's own
// marker leaves behind, which the reader records as ONE text node.
// Any second node is a further word, and the line is an ordinary item
// line rather than a rule.
const ONE_TEXT_NODE = 1;

/**
 * Whether a nested item's whole MARKER LINE spells a thematic break -
 * the `- - -` and `* * *` an item's own scan reads as a one-item
 * nested list, and nothing else.
 *
 * Asked of the NODE and answered from the bytes the printer will
 * write: the marker line is the item's indent, marker and gap, all
 * replayed ({@link ListItemNode.markerSpelling} and `markerGap`,
 * src/ast.ts), and then its text. The text has to be ONE text node,
 * because a rule line carries two marks and nothing else - any further
 * node is a second word and the line is an ordinary item. The value
 * goes in as it stands rather than word-split, and that is the bytes
 * the printer writes too: a run inside a line that spells a break
 * keeps its own spacing (`runsTheLineReads`'s behind-a-mark arm,
 * src/print/whitespace-fold.ts, which holds at every position this
 * answer is asked at), so the fold cannot narrow `-  -` to `- -`
 * under it and leave a line whose gaps no longer agree.
 *
 * A TEXT NODE CARRYING A LINE BREAK is refused by the pattern itself
 * and needs no clause: the reader records an item's own rest lines
 * inside the one text node, joined with `\n` ({@link TextNode},
 * src/ast.ts), and no anchored line pattern matches across one. That
 * is the answer this question wants - `- - -` over `last` is one item
 * whose printed marker line carries `last` at some width and cannot
 * be a rule at any of them.
 *
 * RSTRIPPED, because that is the one way the source spelling and the
 * printed one differ here: the reader's text node keeps the trailing
 * whitespace the author wrote and the printer writes none, so a
 * `- - - ` would answer no to a pattern with no trailing tolerance
 * and then be written as the `- - -` both programs read as a rule.
 * The same strip is the READER's own dialect ({@link rstrip},
 * src/parse/line-shapes.ts), so the two cannot disagree about where a
 * line ends.
 * @param item - the nested list's first item
 * @returns true where the whole line reads as a rule
 */
function markerLineSpellsARule(item: ListItemNode): boolean {
  const [only] = item.text;
  // The length test comes first and is what makes the read of `only`
  // total: an item with no text at all has none to read.
  if (item.text.length !== ONE_TEXT_NODE || only.type !== "text") {
    return false;
  }
  const line = `${item.markerIndent}${item.markerSpelling}${item.markerGap}${only.value}`;
  return THEMATIC_BREAK.test(rstrip(line));
}

/**
 * Whether an item's FIRST block start is a spaced marker line that
 * both programs read as a rule at one position and as a nested list
 * at the other - the shape whose lines may not be repacked at all.
 *
 * ADJACENCY IS THE WHOLE PRECONDITION besides the line's spelling: a
 * gap carrying a blank or a `+` already puts a line of its own
 * between the item's text and the rule, and that line is replayed, so
 * nothing either caller does to the text can reach the rule's
 * position.
 *
 * THE ITEM'S OWN BLOCKS, not its node, because the two callers hold
 * two different item kinds and this reads the one piece they spell
 * alike ({@link ItemBlock}, src/ast.ts).
 * @param blocks - the item's blocks behind their recorded gaps, in
 *   source order
 * @returns true where the item's text must keep its own lines
 */
export function opensOnARuleMarkerLine(blocks: readonly ItemBlock[]): boolean {
  const first = blocks.at(0);
  if (
    first === undefined ||
    first.gap.length > 0 ||
    first.block.type !== "list"
  ) {
    return false;
  }
  return markerLineSpellsARule(first.block.children[0]);
}
