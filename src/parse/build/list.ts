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
import { buildFromTokens } from "../inline/inline-node-builder.js";
import type { InlineToken } from "../inline/tokens.js";
import type { Fragment, LocationIndex } from "../positions.js";
import { bodyExtent } from "./paragraph.js";

// Checklist marker: `[x] `, `[*] `, or `[ ] ` at the start
// of an unordered list item's text. The named group captures the
// inner character so we can distinguish checked from unchecked.
const CHECKBOX_RE = /^\[(?<mark>[x* ])\] /v;
// Length of the checkbox prefix: `[x] ` = 4 characters.
/**
 * Exported for its unit test (tests/parser/build/list.test.ts); no src
 * consumer.
 * @internal
 */
export const CHECKBOX_PREFIX_LEN = 4;

/**
 * Everything one list item is built from, as the reader read it.
 * Exported for its unit test (tests/parser/build/list.test.ts); no src
 * consumer.
 * @internal
 */
export interface ListItemInput {
  /** The item's marker as written, leading indent excluded. */
  readonly marker: Fragment;
  /**
   * The marker's own spelling - what the printer replays (see
   * {@link ListItemNode.markerSpelling}). Separate from the Fragment
   * beside it, which spans the marker AND its gap because it measures
   * the item's POSITION.
   */
  readonly markerSpelling: string;
  /** Which list kind the marker opened. */
  readonly variant: ListNode["variant"];
  /**
   * The number a callout marker spells (`<3>` → 3, `<.>` → the auto
   * sentinel), undefined for every other variant. Read off the group
   * the classifier's match captured (lines/classify.ts, ParsedMarker's
   * callout arm) — this builder does not re-match the marker, so there
   * is no impossible miss here to degrade from.
   */
  readonly calloutNumber: number | undefined;
  /** The item's principal text, already tokenized. */
  readonly text: readonly InlineToken[];
  /** Everything the item holds after its text, gaps attached. */
  readonly blocks: readonly ItemBlock[];
  /** Whether a `+` off the item's end must be printed back. */
  readonly trailingContinuation: boolean;
  /**
   * Whether the erased detached tail must be printed back (see
   * {@link ListItemNode}'s `detachedTail`).
   */
  readonly detachedTail: boolean;
  /**
   * Whether the item ends with its continuation still armed (see
   * {@link ListItemNode}'s `activeTail`).
   */
  readonly activeTail: boolean;
  /**
   * Whether every line the item's text wrote under the marker line is
   * indented (see {@link ListItemNode}'s `everyTextLineIndented`).
   */
  readonly everyTextLineIndented: boolean;
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
  variant: ListNode["variant"],
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
 * One list item: its principal text, and every block the reader put
 * inside it in source order, each behind its verbatim gap. The blocks
 * arrive already style-converted (style decisions resolve at the
 * OPENING line), and already in source order — the confined
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
  return {
    type: "listItem",
    markerSpelling: input.markerSpelling,
    checkbox,
    calloutNumber: input.calloutNumber,
    text,
    blocks: [...input.blocks],
    trailingContinuation: input.trailingContinuation,
    detachedTail: input.detachedTail,
    activeTail: input.activeTail,
    everyTextLineIndented: input.everyTextLineIndented,
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
 * A list: its items, with the variant and the marker STYLE the reader
 * resolved off the first item's marker (every item of one list has
 * the same style - the reader opens the list on that style and ends
 * it at any other, list-reader.ts's style check; the SPELLINGS may
 * differ from item to item, so each item carries its own).
 *
 * The opening item is its OWN parameter, so "a list always has an
 * item" is what the signature says rather than a sentence the body
 * re-checks — the reader opens a list on a marker line and reads that
 * item before it looks for a sibling. `rest.at(-1) ?? first` is then a
 * total answer, not a guard: `rest` really is empty for a one-item
 * list.
 * @param variant - which list kind it is
 * @param marker - the shared marker STYLE (`ListNode.marker`); each
 *   item's own spelling rides on the item
 * @param first - the item the list opened on
 * @param rest - the sibling items after it, in source order; empty for
 *   a one-item list
 * @returns the list node
 */
export function buildList(
  variant: ListNode["variant"],
  marker: string,
  first: ListItemNode,
  rest: readonly ListItemNode[],
): ListNode {
  const last = rest.at(-1) ?? first;
  return {
    type: "list",
    variant,
    marker,
    children: [first, ...rest],
    position: { start: first.position.start, end: last.position.end },
  };
}
