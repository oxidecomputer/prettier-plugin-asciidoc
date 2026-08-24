/**
 * List printing for the AsciiDoc printer: lists, list items, and the
 * blocks inside an item (nested lists and `+`-attached blocks) in the
 * spelling Asciidoctor's `read_lines_for_list_item` will read back the
 * same way. Split out of print-blocks.ts by responsibility.
 */
import { doc, type Doc } from "prettier";
import type {
  BlockNode,
  GapLine,
  ItemBlock,
  ItemBody,
  ListItemNode,
  ListNode,
} from "./ast.js";
import { MARKER_OFFSET } from "./constants.js";
import { CHECKBOX_PREFIX_LEN } from "./parse/build/list.js";
import { inlineAtoms } from "./print-inline.js";
import { hazard } from "./print-list-hazard.js";
import { blockBody, keepLastBreak } from "./reflow.js";
import type { PrintFunction, PrintPath } from "./print-blocks.js";

const {
  builders: { hardline },
} = doc;

// One blank line, as a gap: what a re-read literal slurp forces in
// front of an otherwise-adjacent nested list (see printedGap).
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
 * Whether a block is an indented literal paragraph — the ONE spelling
 * of the fact both slurp rules consume: such a block re-reads with
 * `read_lines_until break_on_blank_lines`, a slurp that runs through
 * adjacent metadata and marker lines, so both "does the item END on
 * one" ({@link endsWithLiteralParagraph}, printList's double hardline)
 * and "does one stand earlier, connected by empty gaps"
 * ({@link slurpReaches}, printedGap's invented blank) are questions
 * about this shape; tests/format/list-item-blocks.test.ts's literal
 * rows pin both. The next slurp rule starts here.
 * @param block - a block node
 * @returns true for an indented literal paragraph
 */
function isIndentedLiteral(block: BlockNode): boolean {
  return block.type === "delimitedBlock" && block.form === "indented";
}

/**
 * Whether an item's last block, in source order, is an indented literal
 * paragraph — looking into a trailing nested list, whose own last item
 * may end on one. `blocks` is already source-ordered, so the last
 * entry IS the last thing printed. Takes the BODY, not the node: the
 * question is about what an item HOLDS, so every item-like node
 * answers it through the one shape rather than a copy.
 * @param item - the item body
 * @returns true when a literal paragraph is the last thing printed
 */
function endsWithLiteralParagraph(item: ItemBody): boolean {
  if (item.trailingContinuation) return false;
  const last = item.blocks.at(-1)?.block;
  if (last?.type === "list") {
    const lastItem = last.children.at(-1);
    return lastItem !== undefined && endsWithLiteralParagraph(lastItem);
  }
  return last !== undefined && isIndentedLiteral(last);
}

/**
 * The marker string for a list item: callout items print from their
 * recorded number; every other item replays the list's OWN marker
 * spelling (`ListNode.marker` — the classifier's parse). Nothing is
 * reconstructed from a depth, so a spelling the author wrote can no
 * longer be normalized into a DIFFERENT list's spelling. Two lists
 * genuinely written with the SAME marker can still nest — the reader
 * follows the oracle there — and {@link printedGap} is what keeps
 * that pair printing nested.
 * @param node - The list item whose marker to build.
 * @param parentList - The parent list node, for the variant and the
 *   spelling. Prettier's path typing cannot promise the parent, so
 *   the undefined arm falls back to `*` rather than asserting; it
 *   mirrors the variant fallback that preceded it.
 * @returns The marker string (e.g. `-`, `**`, `...`, `<1>`).
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
  return parentList?.marker ?? "*";
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
 * Produces marker + space + text content, with the text packed by THE
 * block-body engine. The marker's columns are the item's continuation
 * indent, so wrapped text lines up under the text start rather than the
 * marker. The item's blocks — nested lists and `+`-attached blocks
 * alike — follow in source order, each behind its gap replayed
 * VERBATIM ({@link gapParts}); the only spelling the printer decides
 * itself is the hazard's kept break (`hazard()`) — it
 * never invents a `+`.
 * @param node - The list item AST node.
 * @param path - Prettier's AST path, used to recurse
 *   into the text and blocks and access the parent list node.
 * @param print - Prettier's recursive print callback.
 * @param printWidth - the column budget for a whole output line.
 * @returns Doc IR for the formatted list item.
 */
export function printListItem(
  node: ListItemNode,
  path: PrintPath,
  print: PrintFunction,
  printWidth: number,
): Doc {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prettier path traversal returns generic node
  const parentList = path.getParentNode() as ListNode | undefined;
  const marker = buildMarker(node, parentList);
  const checkboxPrefix = formatCheckbox(node.checkbox);
  const markerWidth = marker.length + MARKER_OFFSET;
  const checkboxWidth = node.checkbox === undefined ? 0 : CHECKBOX_PREFIX_LEN;

  const atoms = inlineAtoms(node.text, node.position.start.line);
  // The hazard, as a pure predicate over the finished node: reflow
  // may not push leading metadata onto the first rest line.
  const guard = hazard(node);
  const item: Doc[] = [
    marker,
    " ",
    checkboxPrefix,
    ...blockBody(
      guard === "keepBreak" ? keepLastBreak(atoms) : atoms,
      printWidth,
      markerWidth + checkboxWidth,
    ),
  ];

  const printedBlocks = path.map(
    (blockPath) => blockPath.call(print, "block"),
    "blocks",
  );
  const parts: Doc[] = [item];
  for (const index of node.blocks.keys()) {
    const adjusted = printedGap(node, parentList, index);
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
 * structure, both involving a nested list:
 *
 * - a nested list may SHARE its parent item's marker, and then it must
 *   print ADJACENT. Behavior is Ruby's (`read_lines_for_list_item`,
 *   parser.rb:1395–1577): the item's read runs THROUGH an indented
 *   literal and the metadata behind it, so the marker line after them
 *   lands INSIDE the item however it is spelled — the oracle reads the
 *   second `* a` of `* a\n\n  lit\n[[anc]]\n* a\n` as a nested list, and
 *   reads the same document with one blank line more as two siblings.
 *   So any blank-only gap in front of such a list reads back as a
 *   SIBLING boundary — worse, the sibling probe eats the blank, so a
 *   second pass prints different bytes. A gap carrying a `+` is left
 *   alone: the `+` is live and must survive. Checked FIRST: the blank
 *   the next arm invents would end the item at a sibling boundary
 *   instead. Pinned by the same-marker rows in
 *   tests/format/marker-spelling.test.ts and by the list-shape sweep.
 * - an empty gap gets a blank line invented in front of the list when
 *   the marker would otherwise be SWALLOWED on re-read (the blank is
 *   safe — after one, `read_lines_for_list_item` keeps every nestable
 *   marker in the item — and the next pass re-parses it AS [""],
 *   which the replay reproduces: idempotent). One reading needs it,
 *   tested precisely ({@link slurpReaches}): an indented literal
 *   earlier in the item re-reads with a slurp (`read_lines_until
 *   break_on_blank_lines`) that runs THROUGH adjacent metadata and
 *   marker lines, so a marker connected to the literal by empty gaps
 *   would be swallowed into it — and, past the item's end, so would
 *   the next item's marker (review B3,
 *   `* a\n\n  lit\n[role]\n** b\n\n* a\n`).
 *   The arm deliberately does NOT fire elsewhere: under a frozen `+`
 *   raw line the adjacency is load-bearing the other way (a blank
 *   would erase the `+` chain on re-read — the family the cut-over
 *   fixed), and plain verbatim replay is already a fixed point.
 *
 * The first arm compares the two RECORDED spellings, not a
 * reconstruction: `ListNode.marker` is what the classifier read, so
 * the comparison asks the question the re-read will ask.
 * @param node - the item being printed
 * @param parentList - its list, for the marker spelling
 * @param index - which of the item's blocks is being placed (the
 *   first keeps its adjacency to the text)
 * @returns the gap to print
 */
function printedGap(
  node: ListItemNode,
  parentList: ListNode | undefined,
  index: number,
): readonly GapLine[] {
  const { blocks } = node;
  const { gap, block } = blocks[index];
  if (block.type !== "list") return gap;
  if (block.marker === parentList?.marker) {
    return gap.includes("+") ? gap : [];
  }
  if (index > 0 && gap.length === 0 && slurpReaches(node.blocks, index)) {
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
    if (isIndentedLiteral(previous.block)) return true;
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
