/**
 * List nesting logic for the AST builder.
 *
 * The grammar parses list items flat — each `listItem` rule just
 * captures a marker and text. This module converts that flat
 * sequence into a nested tree of ListNode/ListItemNode based on
 * marker depth (number of `*` characters).
 *
 * The algorithm mirrors nestSections in ast-builder.ts: a stack
 * tracks open nesting levels, and items are pushed/popped as the
 * depth changes.
 */
import type { CstNode, IToken } from "chevrotain";
import type {
  BlockNode,
  ListNode,
  ListItemNode,
  InlineNode,
  Location,
} from "../ast.js";
import { EMPTY, FIRST, LAST_ELEMENT } from "../constants.js";
import { buildInlineNodesWithContinuation } from "./continuation-builder.js";
import { flattenInlineTokens, unwrapInlineLines } from "./inline-tokens.js";
// When draining the nesting stack, stop when only the root level
// remains (stack has one entry).
const MIN_STACK_DEPTH = 1;

/**
 * Intermediate representation for a flat list item before nesting.
 * Produced by the AST builder's `listItem` visitor; consumed by
 * `nestListItems` to build the nested tree.
 */
export interface FlatListItem {
  /**
   * Nesting depth derived from the marker character count
   * (e.g. `**` = depth 2).
   */
  depth: number;
  /** Inline AST children for the item's text content. */
  inlineChildren: InlineNode[];
  /** Blocks attached via `+` list continuation lines. */
  attachedBlocks: BlockNode[];
  /** True when the item ends with a dangling `+` line. */
  danglingContinuation: boolean;
  /** Checkbox state for checklist items (`undefined` = none). */
  checkbox: "checked" | "unchecked" | undefined;
  /** Callout number (`undefined` = not a callout item, 0 = auto). */
  calloutNumber: number | undefined;
  /** Source position where the list item begins. */
  start: Location;
  /** Source position where the list item ends. */
  end: Location;
}

/**
 * One level on the nesting stack.
 *
 * Tracks the list items being collected at a particular
 * marker depth and which parent item they will be nested
 * under when the level is popped back to a shallower depth.
 */
interface NestingLevel {
  depth: number;
  items: ListItemNode[];
}

/**
 * Create a ListItemNode from a flat intermediate item.
 *
 * The returned node has no nested children yet — those are
 * attached later by {@link attachNestedList} once the
 * nesting stack is unwound.
 * @param item - Flat list item produced by the CST visitor
 *   (only called from `nestListItems`).
 * @returns A fresh ListItemNode with spread-copied inline
 *   children (safe for later mutation).
 */
function buildListItemNode(item: FlatListItem): ListItemNode {
  return {
    type: "listItem",
    depth: item.depth,
    checkbox: item.checkbox,
    calloutNumber: item.calloutNumber,
    // Spread-copy: attachNestedList later pushes into
    // parent.children, so a shared reference would
    // corrupt the original inlineChildren array.
    children: [...item.inlineChildren],
    attachedBlocks: [...item.attachedBlocks],
    danglingContinuation: item.danglingContinuation,
    position: { start: item.start, end: item.end },
  };
}

/**
 * Wrap an array of ListItemNodes into a ListNode.
 *
 * The position spans from the first item's start to the last
 * item's end, giving Prettier an accurate source range for
 * the entire list.
 * @param items - Ordered list item children.
 * @param variant - List kind: unordered, ordered, or callout.
 * @returns A ListNode whose position covers all items.
 */
function buildListNode(
  items: ListItemNode[],
  variant: ListNode["variant"],
): ListNode {
  const [first] = items;
  const last = items.at(LAST_ELEMENT) ?? first;
  return {
    type: "list",
    variant,
    children: items,
    position: {
      start: first.position.start,
      end: last.position.end,
    },
  };
}

/**
 * Return the topmost level on the nesting stack.
 *
 * Callers always ensure the stack is non-empty, so no
 * bounds check is needed.
 * @param stack - The nesting stack to peek.
 * @returns The current (deepest) nesting level.
 */
function topLevel(stack: NestingLevel[]): NestingLevel {
  return stack[stack.length + LAST_ELEMENT];
}

/**
 * Append a nested list to a parent item and extend the
 * parent's end position to cover the nested children.
 *
 * This is the core attachment operation when ascending from
 * a deeper nesting depth: the completed sub-list is grafted
 * onto the last item of the level above.
 * @param parent - The ListItemNode that owns the sub-list.
 * @param nested - The completed nested ListNode to attach.
 */
function attachNestedList(parent: ListItemNode, nested: ListNode): void {
  parent.children.push(nested);
  // Extend the parent's end position to cover the nested list so
  // that Prettier's source-range tracking sees the full item span.
  Object.assign(parent.position, { end: nested.position.end });
}

/**
 * Pop the topmost nesting level and attach its items as a
 * nested list on the last item of the level below.
 *
 * Callers guarantee two preconditions that make defensive
 * checks unnecessary:
 *
 * 1. `stack.length >= 2` (both call sites guard with
 *    `stack.length > MIN_STACK_DEPTH`), so `pop()` always
 *    returns a value and a parent level always exists.
 * 2. Every pushed level receives at least one item in the
 *    same loop iteration before it can be popped, so the
 *    items array is never empty.
 * @param stack - The nesting stack to pop from.
 * @param variant - List kind, forwarded to
 *   {@link buildListNode}.
 */
function collapseLevel(
  stack: NestingLevel[],
  variant: ListNode["variant"],
): void {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- precondition: stack.length ≥ 2
  const finished = stack.pop()!;
  const nestedList = buildListNode(finished.items, variant);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- precondition: parent level has items
  const parentListItem = topLevel(stack).items.at(LAST_ELEMENT)!;
  attachNestedList(parentListItem, nestedList);
}

/**
 * Nest flat list items into a tree of ListNode/ListItemNode
 * based on marker depth.
 *
 * Uses a stack-based algorithm similar to `nestSections`:
 * - Same depth: sibling in current list
 * - Deeper: start a new nested list under the previous item
 * - Shallower: pop back up and add sibling at the right
 *   level
 * @param flatItems - Flat list items in source order,
 *   produced by the CST visitor.
 * @param variant - List kind (defaults to `"unordered"`).
 * @returns A single root ListNode containing the full
 *   nested tree.
 */
export function nestListItems(
  flatItems: FlatListItem[],
  variant: ListNode["variant"] = "unordered",
): ListNode {
  // Items starting at depth > 1 without a parent at depth 1
  // are valid AsciiDoc — the nesting logic treats the first
  // item's depth as the effective root level.
  // FIRST doubles as the root depth (0) when there are
  // no items — depth 0 is the natural root for any list.
  const firstDepth = flatItems.length > EMPTY ? flatItems[FIRST].depth : FIRST;
  const stack: NestingLevel[] = [{ depth: firstDepth, items: [] }];

  for (const flatItem of flatItems) {
    // Pop deeper levels — they're finished. We stop at
    // MIN_STACK_DEPTH (not EMPTY) because the root level
    // should never be popped — collapseLevel needs a parent
    // to attach the nested list to.
    while (
      stack.length > MIN_STACK_DEPTH &&
      topLevel(stack).depth > flatItem.depth
    ) {
      collapseLevel(stack, variant);
    }

    // Going deeper — push a new nesting level.
    if (topLevel(stack).depth < flatItem.depth) {
      stack.push({
        depth: flatItem.depth,
        items: [],
      });
    }

    // Add item as sibling at the current level.
    topLevel(stack).items.push(buildListItemNode(flatItem));
  }

  // Drain nested levels back to root.
  while (stack.length > MIN_STACK_DEPTH) {
    collapseLevel(stack, variant);
  }

  const [root] = stack;
  return buildListNode(root.items, variant);
}

// --- List item inline children helpers ---
// These build InlineNode[] from the CST context of a list item,
// shared across all three item types (unordered, ordered, callout).

/**
 * Shared shape of the CST context fields that all three list
 * item types (unordered, ordered, callout) have in common.
 *
 * Extracted so that {@link buildListItemInlineChildren} can
 * accept any of the three item contexts without duplicating
 * the inline-building logic.
 */
export interface ListItemInlineContext {
  /** CST nodes for the item's inline content lines. */
  inlineLine?: CstNode[];
  /**
   * Newline tokens that separate inline content lines
   * within the same list item.
   */
  InlineNewline?: IToken[];
  /**
   * Continuation lines indented under the list item
   * (e.g. a paragraph attached via `+`).
   */
  IndentedLine?: IToken[];
  /** Newline tokens between indented continuation lines. */
  Newline?: IToken[];
}

/**
 * Return whichever token appears later in the source.
 *
 * Used to find the true end position of a list item when
 * both inline content and indented continuation lines are
 * present. If only one token is defined, returns that one.
 * @param a - First candidate token (may be undefined).
 * @param b - Second candidate token (may be undefined).
 * @returns The later token by source offset, or the one
 *   that is defined, or `undefined` if both are undefined.
 */
function laterToken(
  a: IToken | undefined,
  b: IToken | undefined,
): IToken | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return b.startOffset > a.startOffset ? b : a;
}

/**
 * Build InlineNode[] and compute end position from the
 * shared list item CST context fields.
 *
 * Extracts the common logic from the `listItem`,
 * `orderedListItem`, and `calloutListItem` visitor methods
 * so each only needs to handle its own marker parsing.
 * @param context - CST context fields shared across all
 *   list item types (inline lines, newlines, continuations).
 * @param markerToken - The item's leading marker token,
 *   used as a fallback end position when the item has no
 *   inline content.
 * @returns The inline children, blocks attached via `+`
 *   continuations, and the last content token (for
 *   computing the item's end position).
 */
export function buildListItemInlineChildren(
  context: ListItemInlineContext,
  markerToken: IToken,
): {
  inlineChildren: InlineNode[];
  attachedBlocks: BlockNode[];
  danglingContinuation: boolean;
  lastToken: IToken;
} {
  const inlineLines = context.inlineLine ?? [];
  const inlineNewlines = context.InlineNewline ?? [];
  const indentedTokens = context.IndentedLine ?? [];
  const newlines = context.Newline ?? [];

  const { inlineChildren, attachedBlocks, danglingContinuation } =
    buildInlineNodesWithContinuation(
      inlineLines,
      inlineNewlines,
      indentedTokens,
      newlines,
    );

  // The last content token determines the item's end
  // position. It's either the last inline content token
  // or the last IndentedLine token, whichever comes later.
  const contentTokens = flattenInlineTokens(unwrapInlineLines(inlineLines), []);
  const lastInline = contentTokens.at(LAST_ELEMENT);
  const lastIndented = indentedTokens.at(LAST_ELEMENT);
  // Determine which content token comes last by offset.
  // Both may be undefined if the item has no content.
  const lastContent = laterToken(lastInline, lastIndented);

  return {
    inlineChildren,
    attachedBlocks,
    danglingContinuation,
    lastToken: lastContent ?? markerToken,
  };
}

/**
 * Trim a checkbox prefix (e.g. `[x] `) from the beginning
 * of an InlineNode[] array.
 *
 * The grammar captures the checkbox marker as part of the
 * inline text. This function strips it after parsing so the
 * AST stores the checkbox state separately from the item's
 * visible text. Mutates the first TextNode in-place — safe
 * because the node was freshly built and is not shared.
 * @param children - Inline children to trim. Mutated in
 *   place; does nothing if the first child is not a
 *   TextNode.
 * @param prefixLength - Number of characters to strip
 *   from the first TextNode's value (e.g. 4 for `[x] `).
 */
export function trimCheckboxPrefix(
  children: InlineNode[],
  prefixLength: number,
): void {
  if (children.length === EMPTY) return;
  const [first] = children;
  if (first.type === "text") {
    first.value = first.value.slice(prefixLength);
  }
}
