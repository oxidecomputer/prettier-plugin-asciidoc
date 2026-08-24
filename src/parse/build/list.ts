/**
 * Lists: one item, and the list its items make.
 *
 * Every function here is `(input, index) → node` and nothing else: no
 * traversal, no context. What a line MEANS was decided by
 * lines/classify.ts against the registry in line-shapes.ts, and which
 * block it belongs to by the extent lines/reader.ts collected for it.
 * These only take it apart.
 */
import type {
  InlineNode,
  ItemBlock,
  ListItemNode,
  ListNode,
} from "../../ast.js";
import { AUTO_CALLOUT_NUMBER } from "../../constants.js";
import { buildFromTokens } from "../inline/inline-node-builder.js";
import type { InlineToken } from "../inline/tokens.js";
import type { ListVariant } from "../lines/classify.js";
import type { Fragment, LocationIndex } from "../positions.js";
import { bodyExtent } from "./paragraph.js";

// Regex extracting the number between angle brackets in a
// callout marker: `<1> ` → "1", `<.> ` → ".".
const CALLOUT_NUMBER_RE = /<(?<inner>[^>]+)>/v;

// Checklist marker: `[x] `, `[*] `, or `[ ] ` at the start
// of an unordered list item's text. The named group captures the
// inner character so we can distinguish checked from unchecked.
const CHECKBOX_RE = /^\[(?<mark>[x* ])\] /v;
// Length of the checkbox prefix: `[x] ` = 4 characters.
export const CHECKBOX_PREFIX_LEN = 4;

/** Everything one list item is built from, as the reader read it. */
export interface ListItemInput {
  /** The item's marker as written, leading indent excluded. */
  readonly marker: Fragment;
  /** Which list kind the marker opened. */
  readonly variant: ListVariant;
  /** The item's principal text, already tokenized. */
  readonly text: readonly InlineToken[];
  /** Everything the item holds after its text, gaps attached. */
  readonly blocks: readonly ItemBlock[];
  /** Whether the item ends on an unerased `+` that attached nothing. */
  readonly trailingContinuation: boolean;
}

/**
 * Detects a checklist prefix (`[x] `, `[*] `, `[ ] `) at the
 * start of item text. Returns the checkbox state and the text
 * with the prefix stripped, or undefined/original text if no
 * checkbox is present.
 * @param rawValue - The raw text content of a list item,
 *   possibly starting with a checkbox marker.
 * @returns The checkbox state ("checked", "unchecked", or
 *   undefined if absent) and the byte length of the prefix
 *   to strip from the value before building inline children.
 */
function parseCheckbox(rawValue: string): {
  checkbox: "checked" | "unchecked" | undefined;
  prefixLength: number;
} {
  const match = CHECKBOX_RE.exec(rawValue);
  if (match?.groups === undefined) {
    return {
      checkbox: undefined,
      prefixLength: 0,
    };
  }
  const {
    groups: { mark },
  } = match;
  return {
    checkbox: mark === " " ? "unchecked" : "checked",
    prefixLength: CHECKBOX_PREFIX_LEN,
  };
}

/**
 * Trim a checkbox prefix (e.g. `[x] `) from the beginning
 * of an InlineNode[] array.
 *
 * The tokenizer keeps the checkbox marker in the item's inline text.
 * This function strips it after building so the AST stores the
 * checkbox state separately from the item's visible text. Mutates the
 * first TextNode in-place — safe because the node was freshly built
 * and is not shared.
 * @param children - Inline children to trim. Mutated in
 *   place; does nothing if the first child is not a
 *   TextNode.
 * @param prefixLength - Number of characters to strip
 *   from the first TextNode's value (e.g. 4 for `[x] `).
 */
function trimCheckboxPrefix(
  children: InlineNode[],
  prefixLength: number,
): void {
  if (children.length === 0) return;
  const [first] = children;
  if (first.type === "text") {
    first.value = first.value.slice(prefixLength);
  }
}

/**
 * The value of the first inline child when it is a text node — the
 * only place a checklist prefix (`[x] `) can sit.
 * @param children - the item's inline children
 * @returns the text, or an empty string
 */
function firstTextValue(children: InlineNode[]): string {
  const [first] = children;
  return children.length > 0 && first.type === "text" ? first.value : "";
}

/**
 * Read a checklist prefix off an item's text and strip it. Only an
 * unordered item can be a checklist item (`parse_list_item`:
 * `if list_type == :ulist && text.start_with?('[')`); `. [x] text` is
 * an ordered item whose text begins with brackets.
 * @param variant - which list kind the item's marker opened
 * @param inlineChildren - the item's inline nodes, trimmed in place
 * @returns the checkbox state, or undefined
 */
function takeCheckbox(
  variant: ListVariant,
  inlineChildren: InlineNode[],
): ListItemNode["checkbox"] {
  if (variant !== "unordered") {
    return undefined;
  }
  const { checkbox, prefixLength } = parseCheckbox(
    firstTextValue(inlineChildren),
  );
  if (prefixLength > 0) {
    trimCheckboxPrefix(inlineChildren, prefixLength);
  }
  return checkbox;
}

/**
 * The callout number of a callout marker: `<1> ` → 1, `<.> ` → 0 (auto).
 * @param marker - the callout marker span
 * @returns the number, or the auto sentinel
 */
function calloutNumberOf(marker: Fragment): number {
  // Total fallback: only a callout ITEM reaches here, and the reader
  // opened it because this marker already matched the callout shape,
  // so the group is always there. Degrading to `.` (auto-numbering)
  // rather than throwing keeps the builder total.
  // The blast radius is one marker: a miss would print that item's
  // callout as auto-numbered and change nothing else.
  const inner = CALLOUT_NUMBER_RE.exec(marker.image)?.groups?.inner ?? ".";
  return inner === "." ? AUTO_CALLOUT_NUMBER : Number.parseInt(inner, 10);
}

/**
 * One list item: its principal text, and every block the reader put
 * inside it in source order, each behind its verbatim gap. The blocks
 * arrive already style-converted (style decisions resolve at the
 * OPENING line, spec D4), and already in source order — the confined
 * reader pushed them as it met them, so there is nothing to merge.
 *
 * Field order in the literal is load-bearing: `text` before `blocks`
 * keeps the generic pre-order walk in document order.
 * @param input - the item's parts (see {@link ListItemInput})
 * @param at - the document's location index
 * @returns the item node
 */
export function buildListItem(
  input: ListItemInput,
  at: LocationIndex,
): ListItemNode {
  const text = buildFromTokens(input.text, at);
  const checkbox = takeCheckbox(input.variant, text);
  const isCallout = input.variant === "callout";
  return {
    type: "listItem",
    checkbox,
    calloutNumber: isCallout ? calloutNumberOf(input.marker) : undefined,
    text,
    blocks: [...input.blocks],
    trailingContinuation: input.trailingContinuation,
    position: {
      start: at.start(input.marker),
      end:
        input.blocks.at(-1)?.block.position.end ??
        (input.text.length > 0
          ? bodyExtent(input.text, at).end
          : at.end(input.marker)),
    },
  };
}

/**
 * A list: its items, with the variant and the marker spelling the
 * reader read off the first item's marker (every item of one list has
 * the same marker — the reader opens the list on that style and ends
 * it at any other, list-reader.ts's style check). A list always
 * has an item: the reader opens one on a marker line and builds that
 * item before it closes the list.
 * @param variant - which list kind it is
 * @param marker - the shared marker spelling (`ListNode.marker`)
 * @param items - the items, in source order; never empty
 * @returns the list node
 */
export function buildList(
  variant: ListNode["variant"],
  marker: string,
  items: readonly ListItemNode[],
): ListNode {
  const [first] = items;
  const last = items.at(-1) ?? first;
  return {
    type: "list",
    variant,
    marker,
    children: [...items],
    position: { start: first.position.start, end: last.position.end },
  };
}
