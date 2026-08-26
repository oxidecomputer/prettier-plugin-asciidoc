/**
 * List printing for the AsciiDoc printer: lists, list items, and the
 * blocks inside an item (nested lists and `+`-attached blocks) in the
 * spelling Asciidoctor's `read_lines_for_list_item` will read back the
 * same way. Split out of src/print/blocks.ts by responsibility.
 */
import { doc, type Doc } from "prettier";
import type {
  BlockNode,
  GapLine,
  ItemBlock,
  ListItemNode,
  ListNode,
} from "../ast.js";
import { MARKER_OFFSET } from "../constants.js";
import { inlineAtoms } from "./inline.js";
import { hazard } from "./list-hazard.js";
import { blockBody, keepLastBreak } from "./reflow.js";
import type { PrintFunction, PrintPath } from "./blocks.js";

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
      // Siblings print ADJACENT, and the blank a source wrote between
      // two items is not replayed — except where adjacency would stop
      // spelling "sibling". A marker line ends the previous item only
      // if the reader's loop SEES it (`is_sibling_list_item?`,
      // parser.rb l.1430 and l.1519); a line the previous item's tail
      // slurps up first reaches neither check. So the blank is
      // DERIVED, not recorded: it is printed exactly where the tail
      // would swallow this marker, whatever the author typed, and
      // nowhere else.
      const previous = node.children[index - 1];
      parts.push(
        tailSwallowsMarker(previous, node) ? [hardline, hardline] : hardline,
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
 * adjacent metadata and marker lines, so both "does the slurp run off
 * the item's END" ({@link tailSwallowsMarker}, printList's double
 * hardline) and "does one stand earlier, connected by empty gaps"
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
 * Whether a marker line printed DIRECTLY under this item would read
 * back INSIDE it rather than as the sibling it is — the question
 * printList asks at every item boundary.
 *
 * The reader ends an item at a sibling marker only when its own loop
 * reads that line (`is_sibling_list_item?`, parser.rb l.1430, and l.1519
 * for the line after a blank). An indented literal denies it the
 * chance: the literal re-reads with `read_lines_until
 * break_on_blank_lines, break_on_list_continuation` (parser.rb l.1488
 * and l.1539), a slurp that runs through metadata, block delimiters and
 * marker lines alike and stops only at a blank or a `+`. So the tail
 * is walked BACKWARDS from the last line the item prints: a literal
 * the walk reaches swallows the boundary; a nested list is descended
 * into, since its own last item's tail is what the printed lines
 * actually end on; and the first gap the walk crosses that the PRINTER
 * will write non-empty stops it, because a blank or a `+` is where the
 * slurp stops. The gaps are the printed ones, not the recorded ones —
 * {@link printedGap} both invents and drops blanks, and only what is
 * written is read back. An item that PRINTS a trailing `+`
 * ({@link ListItemNode.trailingContinuation}) answers false: that `+`
 * already stops the slurp, and a blank in front of the marker would
 * put a line between the tail and the `+` that the source never had.
 * An item whose popped `+` proved inert prints no such line, so the
 * walk runs past where it stood and asks the tail the same question
 * every other item gets.
 *
 * A recorded indented literal counts wherever the walk reaches it —
 * the same spelling {@link slurpReaches} asks about, deliberately, and
 * the CONSERVATIVE side of the question: an indented block the reader
 * recorded but Ruby re-reads as folded text takes a blank it does not
 * need, which costs a byte and no meaning. The gap in front of the
 * literal cannot be the test — under a live `+` the continuation
 * survives a metadata line, so `* a\n+\n[role]\n  lit\n\n* a\n` slurps
 * from a literal whose own gap is empty (the list-shape sweep fails
 * that shape the moment the walk demands one).
 * @param item - the item the boundary follows
 * @param list - the list holding it, for the gaps its blocks print
 *   behind
 * @returns true when the marker line needs a blank in front of it
 * Exported for its unit test (tests/print/list.test.ts); no src
 * consumer.
 * @internal
 */
export function tailSwallowsMarker(
  item: ListItemNode,
  list: ListNode | undefined,
): boolean {
  if (item.trailingContinuation) return false;
  // The printed detached tail — one blank and a `+` — already stands
  // between the item's last block and the marker line, and a `+` is
  // where every slurp stops.
  if (item.detachedTail) return false;
  for (const [index, { block }] of [...item.blocks.entries()].toReversed()) {
    if (isIndentedLiteral(block)) return true;
    if (block.type === "list") {
      const lastItem = block.children.at(-1);
      if (lastItem !== undefined && tailSwallowsMarker(lastItem, block)) {
        return true;
      }
    }
    if (printedGap(item, list, index).length > 0) return false;
  }
  return false;
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
 * Exported for its unit test (tests/print/list.test.ts); no src
 * consumer.
 * @internal
 */
export function buildMarker(
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
 * Exported for its unit test (tests/print/list.test.ts); no src
 * consumer.
 * @internal
 */
export function formatCheckbox(checkbox: ListItemNode["checkbox"]): string {
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
 * never invents a `+`. A `+` at the item's END comes back only where
 * the reader could not prove it inert
 * ({@link ListItemNode.trailingContinuation}) — behind an indented
 * literal or a raw-line paragraph, or inside another item's buffer,
 * the line is content of the block above it rather than the byte
 * Ruby's pop discards.
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
  // KEPT, deliberately. `getParentNode()` is typed over the whole
  // node union, and an item's parent is a list by construction — the
  // reader builds items only into `ListNode.children`. The narrowing
  // that would delete this assertion (`p?.type === "list" ? p :
  // undefined`) buys nothing: it writes a branch whose false arm
  // cannot be reached and whose degrade is a silently wrong marker,
  // which is the shape the interior-validation registry existed to
  // forbid. The assertion states the boundary instead of hiding it.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- an item's parent is its list by construction; narrowing here would add an unreachable branch with a silent wrong-marker degrade
  const parentList = path.getParentNode() as ListNode | undefined;
  const marker = buildMarker(node, parentList);
  const checkboxPrefix = formatCheckbox(node.checkbox);
  const markerWidth = marker.length + MARKER_OFFSET;
  // The width of the prefix the printer just wrote — "" for no
  // checkbox, `[x] `/`[ ] ` otherwise. It used to be the parser's
  // CHECKBOX_PREFIX_LEN, which made the printer reach into the
  // builders for the length of a string it was holding.
  const checkboxWidth = checkboxPrefix.length;

  // `false`: the marker written below holds column 0 of the item's
  // first line.
  const atoms = inlineAtoms(node.text, node.position.start.line, false);
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
  // `path.map` walked `blocks`, so the printed docs are that array's
  // parallel — the index is the item block's own.
  for (const [index, printedBlock] of printedBlocks.entries()) {
    const adjusted = printedGap(node, parentList, index);
    parts.push(...gapParts(adjusted), printedBlock);
  }
  if (node.trailingContinuation) {
    // ONE hardline, unconditionally — including after a nested list.
    // The trailing `+` of `* a\n** b\n+\n` belongs to the OUTER item
    // (a's scan buffers it via the final else and pops it in
    // finish(); b's buffer ends before it), and printing it back
    // directly under the nested list re-parses to the SAME node. A
    // blank line here would turn the `+` DETACHED on re-parse, l.1576
    // would erase it, and the second format would drop it.
    parts.push(hardline, "+");
  }
  if (node.detachedTail) {
    // One blank line, then the `+` — the DETACHED spelling, and the
    // only correct one: an ADJACENT `+` under the item's `+` paragraph
    // would freeze onto it on re-read and the marked pop would take
    // the paragraph (parser.rb l.1443-46, l.1580-81). Detached, the
    // `+` erases into the shield (l.1576) that absorbs the pop and
    // keeps the paragraph alive ({@link ListItemNode.detachedTail}).
    // Blank-run multiplicity collapses to the one blank, the same
    // collapse gapParts applies before a `+`.
    parts.push(hardline, hardline, "+");
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
 *   parser.rb l.1404-1592): the item's read runs THROUGH an indented
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
 *   the next item's marker (B3,
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
 * Exported for its unit test (tests/print/list.test.ts); no src
 * consumer.
 * @internal
 */
export function printedGap(
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
 * The line breaks one gap prints as: a hardline ends the previous
 * line, then each `""` is one more hardline (a blank line) and each
 * `"+"` is a `+` on a line of its own.
 *
 * A blank RUN collapses to one blank — the same rule joinBlocks holds
 * between blocks, and this was the last place in the printer where
 * blank multiplicity survived. It collapses only UP TO the gap's
 * first `+`, and that boundary is the whole rule: a blank run AFTER a
 * `+` is what ERASES the `+` (`buffer[detached_continuation] =
 * ListContinuationPlaceholder`, parser.rb l.1576), so shortening it
 * can resurrect a dead continuation and attach a block that was not
 * attached. Before any `+`, a run of blanks is a run of blanks —
 * `read_lines_for_list_item` skips them all at l.1515-17 and the
 * count reaches nothing.
 * @param gap - the separator lines the block prints behind
 * @returns the Doc parts to put in front of the block
 */
function gapParts(gap: readonly GapLine[]): Doc[] {
  const parts: Doc[] = [hardline];
  let livePlus = false;
  let blankRun = false;
  for (const line of gap) {
    if (line === "+") {
      livePlus = true;
      blankRun = false;
      parts.push("+", hardline);
      continue;
    }
    if (!livePlus && blankRun) continue;
    blankRun = true;
    parts.push(hardline);
  }
  return parts;
}
