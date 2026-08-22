/**
 * List printing for the AsciiDoc printer: lists, list items, and the
 * blocks inside an item (nested lists and `+`-attached blocks) in the
 * spelling Asciidoctor's `read_lines_for_list_item` will read back the
 * same way. Split out of print-blocks.ts by responsibility.
 */
import { doc, type Doc } from "prettier";
import type {
  BlockNode,
  ItemContinuation,
  ListItemNode,
  ListNode,
} from "./ast.js";
import {
  EMPTY,
  FIRST,
  LAST_ELEMENT,
  MARKER_OFFSET,
  NEXT,
} from "./constants.js";
import { CHECKBOX_PREFIX_LEN } from "./parse/build/list.js";
import {
  flattenForFill,
  keepLastBreak,
  stripLeadingHazardBreak,
} from "./reflow.js";
import type { PrintFunction, PrintPath } from "./print-blocks.js";

const {
  builders: { align, fill, hardline },
} = doc;

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
    if (index > FIRST) {
      // A literal paragraph attached with `+` reads on to the next
      // BLANK line — `read_lines_for_list_item` takes it with
      // `read_lines_until(break_on_blank_lines, break_on_list_continuation)`
      // and no sibling check — so a sibling marker directly under one
      // would be swallowed into it. The blank line keeps the item.
      // Hoisted out of the computed key: StrykerJS cannot place a mutant
      // inside a destructuring PATTERN and wraps the whole declaration in
      // an if/else, which would scope `previous` out of the push below.
      const previousIndex = index + LAST_ELEMENT;
      const {
        children: { [previousIndex]: previous },
      } = node;
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
 * may end on one.
 * @param item - the list item
 * @returns true when a literal paragraph is the last thing printed
 */
function endsWithLiteralParagraph(item: ListItemNode): boolean {
  if (item.danglingContinuation) {
    return false;
  }
  const last = lastBlockOf(item);
  if (last?.type === "list") {
    const lastItem = last.children.at(LAST_ELEMENT);
    return lastItem !== undefined && endsWithLiteralParagraph(lastItem);
  }
  return last?.type === "delimitedBlock" && last.form === "indented";
}

/**
 * An item's last block in source order: its trailing nested list or
 * its last attached block, whichever starts later.
 * @param item - the list item
 * @returns the block, or undefined for an item of text only
 */
function lastBlockOf(item: ListItemNode): BlockNode | undefined {
  const nested = item.children.at(LAST_ELEMENT);
  const attached = item.attachedBlocks.at(LAST_ELEMENT)?.block;
  if (nested?.type !== "list") {
    return attached;
  }
  return attached === undefined ||
    nested.position.start.offset > attached.position.start.offset
    ? nested
    : attached;
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
      node.calloutNumber === EMPTY ? "." : String(node.calloutNumber);
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
 * Produces marker + space + text content, with text
 * reflowed via fill(). Continuation lines are aligned
 * to the text start (past the marker). Nested lists
 * appear on the next line after the item text, outside
 * the fill.
 * @param node - The list item AST node.
 * @param path - Prettier's AST path, used to recurse
 *   into children and access the parent list node.
 * @param print - Prettier's recursive print callback.
 * @returns Doc IR for the formatted list item.
 */
export function printListItem(
  node: ListItemNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  // Determine the marker character from the parent list's variant.
  // The parent is always a ListNode (items live inside lists).
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Prettier path traversal returns generic node
  const parentList = path.getParentNode() as ListNode | undefined;
  // Build the list marker string. Callout lists use `<N>` or
  // `<.>` markers; ordered use dots; unordered use asterisks.
  const marker = buildMarker(node, parentList);

  // For checklist items, insert the checkbox marker between the
  // list marker and the text. Normalize [*] to [x] (canonical).
  const checkboxPrefix = formatCheckbox(node.checkbox);

  // Continuation lines should align with the text start, which
  // is marker width + 1 space after the marker character(s),
  // plus the checkbox prefix width for checklist items.
  const markerWidth = marker.length + MARKER_OFFSET;
  const checkboxWidth =
    node.checkbox === undefined ? EMPTY : CHECKBOX_PREFIX_LEN;

  const printed = path.map(print, "children");

  // Separate inline children (text, bold, hardLineBreak, etc.)
  // from nested lists. Inline children are reflowed inside a
  // fill(); nested lists follow on their own lines.
  const inlineChildren: Doc[] = [];
  const nestedListParts: ItemBlock[] = [];

  for (const [index, child] of node.children.entries()) {
    const { [index]: printedChild } = printed;
    if (child.type === "list") {
      // Nested list: printed on its own lines, outside the fill, in
      // source order with the attached blocks (see printItemBlocks).
      nestedListParts.push({
        block: child,
        doc: printedChild,
        isList: true,
        continuation: "none",
        pluses: EMPTY,
      });
    } else {
      // Inline node: collect for fill(). flattenForFill
      // handles alignment when formatting mixes with text.
      inlineChildren.push(printedChild);
    }
  }

  const flattened = stripLeadingHazardBreak(flattenForFill(inlineChildren));
  // The text prints on at least two lines when a trailing titled
  // metadata run follows it (see keepLastBreak).
  const inlineParts = node.keepTextBreak ? keepLastBreak(flattened) : flattened;

  // Build the output: marker + space + checkbox + aligned
  // fill of inline content, followed by the item's blocks.
  const item = fill([
    marker,
    " ",
    checkboxPrefix,
    align(markerWidth + checkboxWidth, fill(inlineParts)),
  ]);

  // Every block inside the item — nested lists (kept in `children`)
  // and attached blocks — in SOURCE order, which is the order the
  // reader put them in the item. The two arrays are each in source
  // order already, so one merge by start offset restores it.
  const printedAttached = path.map(
    (attachedPath) => attachedPath.call(print, "block"),
    "attachedBlocks",
  );
  const blocks = mergeItemBlocks(
    node.attachedBlocks.map(
      ({ block, continuation, pluses }, index): ItemBlock => {
        const { [index]: printedBlock } = printedAttached;
        return {
          block,
          doc: printedBlock,
          isList: false,
          continuation,
          pluses,
        };
      },
    ),
    nestedListParts,
  );
  return [item, ...printItemBlocks(blocks, node.danglingContinuation)];
}

/** One block inside a list item, with its printed form. */
interface ItemBlock {
  /** The block node (a nested ListNode or an attached block). */
  block: BlockNode;
  /** Its Doc. */
  doc: Doc;
  /** Whether it is a nested list (printed on its own lines). */
  isList: boolean;
  /** How the source introduced it (ignored for a nested list). */
  continuation: ItemContinuation;
  /** How many `+` lines introduced it (see `AttachedBlock.pluses`). */
  pluses: number;
}

/**
 * Merge an item's attached blocks and nested lists into source order.
 * Both inputs are already sorted by start offset.
 * @param attached - the attached blocks, in source order
 * @param nested - the nested lists, in source order
 * @returns one list in source order
 */
function mergeItemBlocks(
  attached: ItemBlock[],
  nested: ItemBlock[],
): ItemBlock[] {
  const merged: ItemBlock[] = [];
  let a = FIRST;
  let n = FIRST;
  while (a < attached.length && n < nested.length) {
    if (
      attached[a].block.position.start.offset <
      nested[n].block.position.start.offset
    ) {
      merged.push(attached[a]);
      a += NEXT;
    } else {
      merged.push(nested[n]);
      n += NEXT;
    }
  }
  return [...merged, ...attached.slice(a), ...nested.slice(n)];
}

/**
 * Print the blocks inside a list item after its principal text.
 *
 * A nested list appears on the next line — after a BLANK line when an
 * attached block precedes it, because directly under an attached
 * paragraph a marker of a list that is not open is that paragraph's
 * text (`read_paragraph_lines` breaks only at the open lists' own
 * markers) and directly under an attached literal paragraph it is
 * literal content; after a blank line `read_lines_for_list_item`
 * keeps the item open for any nestable marker.
 *
 * A block attached with a `+` list continuation prints as a `+` alone
 * on its line followed by the block flush left: these hardlines are
 * outside the item's align(), so both the `+` and the block start at
 * column 0 — the continuation syntax requires the `+` unindented, and
 * the attached block is its own block, not part of the item's reflowed
 * principal text. Block metadata (and comment lines) stack directly
 * above the block they precede — the whole group hangs off the single
 * `+` emitted before its first piece.
 *
 * Every block is written back the way the source introduced it
 * (`AttachedBlock.continuation`): a `+` directly above it; a DETACHED
 * `+` — blank line, `+`, block — which Asciidoctor reads differently
 * inside nested lists (`* a` / `** b` / `+` / `para` puts `para` in b;
 * with a blank line before the `+` it is a's, and with TWO detached
 * continuations in a row the first goes one level in and the last to
 * the outer item — `read_lines_for_list_item` deletes only the last
 * detached `+` from the outer buffer); or NO `+` at all, directly under
 * the line before it or after a blank line — a dlist term, a literal
 * paragraph the after-blank rule kept, a paragraph adjacent to an
 * attached delimited block. A `+` the author never wrote is never
 * invented (Ruling 24). A block that follows a nested list is always
 * detached here: that is the only way the reader puts one after a
 * nested list in the same item.
 *
 * A dangling `+` (one that attached nothing) is re-emitted verbatim:
 * the reader keeps it only where it was the item's last line, so
 * printing it back changes nothing (Ruling 23 — a `+` that Ruby
 * erased, one followed by a blank line, produces no token, and that
 * line is dropped: rendering-neutral and idempotent). After a nested
 * list it too is written in the detached form.
 * @param blocks - the item's blocks in source order
 * @param dangling - whether the item ended on a `+` that attached nothing
 * @returns the Doc parts to append after the item's text
 */
function printItemBlocks(blocks: ItemBlock[], dangling: boolean): Doc[] {
  const parts: Doc[] = [];
  let previous: ItemBlock | undefined = undefined;
  for (const entry of blocks) {
    parts.push(...introduce(entry, previous), entry.doc);
    previous = entry;
  }
  if (dangling) {
    parts.push(...(previous?.isList === true ? [hardline] : []), hardline, "+");
  }
  return parts;
}

/**
 * The line breaks (and `+`) that introduce one block of an item, given
 * what printed before it — see {@link printItemBlocks} for each rule.
 * @param entry - the block about to print
 * @param previous - the block printed before it, if any
 * @returns the Doc parts to put in front of the block
 */
function introduce(entry: ItemBlock, previous: ItemBlock | undefined): Doc[] {
  if (entry.isList) {
    const afterBlock = previous !== undefined && !previous.isList;
    return afterBlock ? [hardline, hardline] : [hardline];
  }
  if (entry.continuation === "detached" || previous?.isList === true) {
    // Blank line and `+`, once per stacked `+` (at least one).
    const parts: Doc[] = [];
    for (
      let index = FIRST;
      index < Math.max(entry.pluses, NEXT);
      index += NEXT
    ) {
      parts.push(hardline, hardline, "+");
    }
    return [...parts, hardline];
  }
  switch (entry.continuation) {
    // Directly under the line before it: the metadata group it ends
    // (stacked, no `+` of its own), an attached delimited block, or the
    // item text it follows with no `+` in the source.
    case "none": {
      return [hardline];
    }
    case "blank": {
      return [hardline, hardline];
    }
    default: {
      return [hardline, "+", hardline];
    }
  }
}
