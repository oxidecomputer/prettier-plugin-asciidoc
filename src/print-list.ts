/**
 * List printing for the AsciiDoc printer: lists, list items, and the
 * blocks inside an item (nested lists and `+`-attached blocks) in the
 * spelling Asciidoctor's `read_lines_for_list_item` will read back the
 * same way. Split out of print-blocks.ts by responsibility.
 */
import { doc, type Doc } from "prettier";
import type { GapLine, ItemBlock, ListItemNode, ListNode } from "./ast.js";
import { MARKER_OFFSET } from "./constants.js";
import { CHECKBOX_PREFIX_LEN } from "./parse/build/list.js";
import { hazard, type Hazard } from "./print-list-hazard.js";
import {
  flattenForFill,
  keepLastBreak,
  stripLeadingHazardBreak,
} from "./reflow.js";
import type { PrintFunction, PrintPath } from "./print-blocks.js";

const {
  builders: { align, fill, hardline },
} = doc;

// One blank line, as a gap: what an introduced `+` forces in front of
// an otherwise-adjacent nested list (see printListItem).
const BLANK_GAP: readonly GapLine[] = [""];

/**
 * Prints a list node: items separated by hard line
 * breaks.
 *
 * Items at different depths are handled by the nested
 * ListNode structure — each ListItemNode prints its own
 * nested children recursively.
 * @param node - The list node.
 * @param path - Prettier's AST path, used to recurse
 *   into list items via `path.map(print, "children")`.
 * @param print - Prettier's recursive print callback.
 * @returns Doc IR for the formatted list.
 */
export function printList(
  node: ListNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  const items = path.map(print, "children");
  const parts: Doc[] = [];
  for (const [index, item] of items.entries()) {
    if (index > 0) {
      // A literal paragraph attached with `+` reads on to the next
      // BLANK line — `read_lines_for_list_item` takes it with
      // `read_lines_until(break_on_blank_lines, break_on_list_continuation)`
      // and no sibling check — so a sibling marker directly under one
      // would be swallowed into it. The blank line keeps the item.
      const previous = node.children[index - 1];
      parts.push(
        endsWithLiteralParagraph(previous) ? [hardline, hardline] : hardline,
      );
    }
    parts.push(item);
  }
  return parts;
}

/**
 * Whether an item's last block, in source order, is an indented literal
 * paragraph — looking into a trailing nested list, whose own last item
 * may end on one. `blocks` is already source-ordered, so the last
 * entry IS the last thing printed.
 * @param item - the list item
 * @returns true when a literal paragraph is the last thing printed
 */
function endsWithLiteralParagraph(item: ListItemNode): boolean {
  if (item.trailingContinuation) return false;
  const last = item.blocks.at(-1)?.block;
  if (last?.type === "list") {
    const lastItem = last.children.at(-1);
    return lastItem !== undefined && endsWithLiteralParagraph(lastItem);
  }
  return last?.type === "delimitedBlock" && last.form === "indented";
}

/**
 * Builds the marker string for a list item based on the
 * parent list's variant.
 *
 * Callout lists use `<N>` or `<.>` markers; ordered
 * lists use dots; unordered lists use asterisks. The
 * marker depth (number of repeated characters) encodes
 * the nesting level.
 * @param node - The list item whose marker to build.
 * @param parentList - The parent list node, used to
 *   determine the variant (ordered, unordered, callout).
 * @returns The marker string (e.g. `**`, `...`, `<1>`).
 */
function buildMarker(
  node: ListItemNode,
  parentList: ListNode | undefined,
): string {
  if (parentList?.variant === "callout") {
    // Auto-numbered callouts store 0 as calloutNumber.
    const calloutLabel =
      node.calloutNumber === 0 ? "." : String(node.calloutNumber);
    return `<${calloutLabel}>`;
  }
  const markerChar = parentList?.variant === "ordered" ? "." : "*";
  return markerChar.repeat(node.depth);
}

/**
 * Formats a checklist checkbox into its canonical string
 * representation.
 *
 * Normalizes `[*]` to `[x]` (the canonical checked
 * form). Returns an empty string for non-checklist items
 * so the caller can unconditionally prepend the result.
 * @param checkbox - The checkbox state: "checked",
 *   "unchecked", or undefined for non-checklist items.
 * @returns The checkbox prefix string, or empty string
 *   if the item has no checkbox.
 */
function formatCheckbox(checkbox: ListItemNode["checkbox"]): string {
  if (checkbox === "checked") {
    return "[x] ";
  }
  if (checkbox === "unchecked") {
    return "[ ] ";
  }
  return "";
}

/**
 * Prints a single list item to Doc IR.
 *
 * Produces marker + space + text content, with text reflowed via
 * fill(). Continuation lines are aligned to the text start (past the
 * marker). The item's blocks — nested lists and `+`-attached blocks
 * alike — follow in source order, each behind its gap replayed
 * VERBATIM ({@link gapParts}); the only spelling the printer decides
 * itself is the hazard's (Rulings 26-30, `hazard()`).
 * @param node - The list item AST node.
 * @param path - Prettier's AST path, used to recurse
 *   into the text and blocks and access the parent list node.
 * @param print - Prettier's recursive print callback.
 * @returns Doc IR for the formatted list item.
 */
export function printListItem(
  node: ListItemNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prettier path traversal returns generic node
  const parentList = path.getParentNode() as ListNode | undefined;
  const marker = buildMarker(node, parentList);
  const checkboxPrefix = formatCheckbox(node.checkbox);
  const markerWidth = marker.length + MARKER_OFFSET;
  const checkboxWidth = node.checkbox === undefined ? 0 : CHECKBOX_PREFIX_LEN;

  const flattened = stripLeadingHazardBreak(
    flattenForFill(path.map(print, "text")),
  );
  // Rulings 26-30 as a pure predicate over the finished node: reflow
  // may not push leading metadata onto the first rest line.
  const guard = hazard(node);
  const inlineParts =
    guard === "keepBreak" ? keepLastBreak(flattened) : flattened;

  const item = fill([
    marker,
    " ",
    checkboxPrefix,
    align(markerWidth + checkboxWidth, fill(inlineParts)),
  ]);

  const printedBlocks = path.map(
    (blockPath) => blockPath.call(print, "block"),
    "blocks",
  );
  const parts: Doc[] = [item];
  for (const index of node.blocks.keys()) {
    if (index === 0 && guard === "plus") {
      // The explicit `+` Ruling 26 puts above a leading metadata run a
      // block of the item follows (the run's own gap is empty by the
      // hazard's definition, so nothing else prints between).
      parts.push(hardline, "+");
    }
    const adjusted = printedGap(node, parentList, index, guard);
    parts.push(...gapParts(adjusted), printedBlocks[index]);
  }
  if (node.trailingContinuation) {
    // ONE hardline, unconditionally — including after a nested list.
    // Under the extent-first reader the trailing `+` of
    // `* a\n** b\n+\n` belongs to the OUTER item (a's scan buffers it
    // via the final else and pops it in finish(); b's buffer ends
    // before it), and printing it back directly under the nested list
    // re-parses to the SAME node. Today's printer inserted a blank
    // line here — right for the old reader, but under the new one a
    // blank would turn the `+` DETACHED on re-parse, l.1562 would
    // erase it, and the second format would drop it: the extra
    // hardline is exactly what would break idempotence now
    // (plan-review M5).
    parts.push(hardline, "+");
  }
  return parts;
}

/**
 * The gap one block prints behind — the recorded one, adjusted in the
 * cases where verbatim replay would not read back as the same
 * structure, all involving a nested list:
 *
 * - marker NORMALIZATION can collide a nested list's marker with its
 *   parent item's (`- Foo` holding `* Boo` both print `* `), and then
 *   any blank-only gap reads back as a SIBLING boundary — worse, the
 *   sibling probe eats the blank, so a second pass prints different
 *   bytes. Printing the collided pair ADJACENT (the baseline's
 *   spelling) reads back flat the same way on every pass. The nesting
 *   the input expressed through the marker style is lost either way —
 *   that fidelity gap is marker normalization's, tracked as issue
 *   #16; this arm only keeps the loss IDEMPOTENT. A gap carrying a
 *   `+` is left alone: the `+` is live and must survive. Checked
 *   FIRST: a blank invented in front of a collided marker would end
 *   the item at a sibling boundary instead.
 * - an empty gap gets a blank line invented in front of the list when
 *   the marker would otherwise be SWALLOWED on re-read (the blank is
 *   safe — after one, `read_lines_for_list_item` keeps every nestable
 *   marker in the item — and the next pass re-parses it AS [""],
 *   which the replay reproduces: idempotent). Two readings need it,
 *   each tested precisely ({@link slurpReaches}):
 *   (1) after the hazard's INTRODUCED `+` (Rulings 26/27) the block
 *   following the metadata run reads back with the PLAIN interrupting
 *   set (the erased `+` makes `skipped` ≥ 1), and a nested marker
 *   directly under that block folds into it as text;
 *   (2) an indented literal earlier in the item re-reads with a slurp
 *   (`read_lines_until break_on_blank_lines`) that runs THROUGH
 *   adjacent metadata and marker lines, so a marker connected to the
 *   literal by empty gaps would be swallowed into it — and, past the
 *   item's end, so would the next item's marker (review B3,
 *   `* a\n\n  lit\n[role]\n** b\n\n* a\n`).
 *   The arm deliberately does NOT fire elsewhere: under a frozen `+`
 *   raw line the adjacency is load-bearing the other way (a blank
 *   would erase the `+` chain on re-read — the family the cut-over
 *   fixed), and plain verbatim replay is already a fixed point.
 * @param node - the item being printed
 * @param parentList - its list, for the marker spelling
 * @param index - which of the item's blocks is being placed (the
 *   first keeps its adjacency to the text)
 * @param guard - the item's hazard answer, for reading (1)
 * @returns the gap to print
 */
function printedGap(
  node: ListItemNode,
  parentList: ListNode | undefined,
  index: number,
  guard: Hazard,
): readonly GapLine[] {
  const { blocks } = node;
  const { gap, block } = blocks[index];
  if (block.type !== "list") return gap;
  const nestedFirst = block.children.at(0);
  if (
    nestedFirst !== undefined &&
    buildMarker(nestedFirst, block) === buildMarker(node, parentList)
  ) {
    return gap.includes("+") ? gap : [];
  }
  if (
    index > 0 &&
    gap.length === 0 &&
    (guard === "plus" || slurpReaches(node.blocks, index))
  ) {
    return BLANK_GAP;
  }
  return gap;
}

/**
 * Whether the re-read literal slurp reaches the block at `index`: an
 * indented literal stands earlier in the item, connected to it by
 * EMPTY gaps only. The slurp (`read_lines_until break_on_blank_lines,
 * break_on_list_continuation`) consumes every adjacent line whatever
 * its shape, and stops only at a blank or a `+` — which is exactly a
 * non-empty gap.
 * @param blocks - the item's blocks, in source order
 * @param index - the block being placed
 * @returns true when a literal's slurp would swallow it on re-read
 */
function slurpReaches(blocks: readonly ItemBlock[], index: number): boolean {
  for (const previous of blocks.slice(0, index).toReversed()) {
    if (
      previous.block.type === "delimitedBlock" &&
      previous.block.form === "indented"
    ) {
      return true;
    }
    if (previous.gap.length > 0) return false;
  }
  return false;
}

/**
 * The line breaks that replay one gap verbatim: a hardline ends the
 * previous line, then each `""` is one more hardline (a blank line)
 * and each `"+"` is a `+` on a line of its own. No normalisation —
 * collapsing a blank run after a `+` can resurrect a dead continuation
 * and change the rendering (spec D2), and in-item gaps are already
 * within Asciidoctor's blank budgets.
 * @param gap - the recorded separator lines
 * @returns the Doc parts to put in front of the block
 */
function gapParts(gap: readonly GapLine[]): Doc[] {
  const parts: Doc[] = [hardline];
  for (const line of gap) {
    if (line === "+") parts.push("+");
    parts.push(hardline);
  }
  return parts;
}
