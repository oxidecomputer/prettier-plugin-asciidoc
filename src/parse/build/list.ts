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
import { rstrip } from "../line-shapes.js";
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
 * The body half of a list-like item's input: everything
 * {@link ItemBody} needs, and nothing about what introduced the item.
 * The two item kinds share it by EXTENSION here for the same reason
 * their nodes share `ItemBody` in src/ast.ts - one home, rather than
 * a set of members copied between two builders that could come to
 * disagree.
 *
 * Exported for src/parse/build/description-list.ts, whose item is
 * introduced by terms instead of by a marker and reuses this half
 * whole.
 */
export interface ItemBodyInput {
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
 * Everything one list item is built from, as the reader read it.
 * Exported for its unit test (tests/parser/build/list.test.ts); no src
 * consumer.
 * @internal
 */
export interface ListItemInput extends ItemBodyInput {
  /** The item's marker as written, leading indent excluded. */
  readonly marker: Fragment;
  /**
   * The marker's own spelling - what the printer replays (see
   * {@link ListItemNode.markerSpelling}). Separate from the Fragment
   * beside it, which spans the marker AND its gap because it measures
   * the item's POSITION.
   */
  readonly markerSpelling: string;
  /**
   * The whitespace the marker line opens with, verbatim - the indent
   * the Fragment beside it excludes (see
   * {@link ListItemNode.markerIndent}).
   */
  readonly markerIndent: string;
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
}

/**
 * Detects a checklist prefix (`[x] `, `[*] `, `[ ] `) at the start of
 * an item's first line. The prefix is always
 * {@link CHECKBOX_PREFIX_LEN} characters long, so the state is the
 * only thing a caller learns here.
 * @param line - the item's first source line, right-stripped
 * @returns the checkbox state, or undefined where the line opens with
 *   no checklist prefix at all
 */
function parseCheckbox(line: string): ListItemNode["checkbox"] {
  const match = CHECKBOX_RE.exec(line);
  if (match?.groups === undefined) {
    return undefined;
  }
  const {
    groups: { mark },
  } = match;
  return mark === " " ? "unchecked" : "checked";
}

/**
 * Take the checklist prefix off the item's leading text node.
 *
 * The tokenizer keeps the marker in the item's inline text, so the
 * prefix comes off after building and the AST stores the checkbox
 * state apart from the item's visible text. The leading node is
 * mutated in place, which is safe because it was freshly built and is
 * not shared.
 *
 * The bytes the source line spells are not always bytes the built
 * nodes still hold: the checked marker's own `*` is a bold delimiter
 * too, so in `* [*] *b*` it pairs with the `*` behind it, the
 * tokenizer hands the builder a span, and the leading text node holds
 * only `[`. Slicing four characters off that node would delete an
 * author's bracket and half a span, so the prefix is only taken where
 * it is really there. Refusing leaves the item without the checkbox
 * the oracle reads, which is a divergence in the one direction that
 * cannot corrupt text: every byte of the item's own text survives,
 * and what changes is presentation - a refused item wraps its
 * continuation lines under the marker rather than under the text,
 * because the six columns the checkbox prefix holds are text to it.
 * @param children - the item's inline nodes, mutated in place
 * @param prefix - the checklist prefix read off the source line
 * @returns true when the prefix was taken off
 */
function stripCheckboxPrefix(children: InlineNode[], prefix: string): boolean {
  const first = children.at(0);
  if (first?.type !== "text" || !first.value.startsWith(prefix)) {
    return false;
  }
  first.value = first.value.slice(prefix.length);
  return true;
}

/**
 * The one line a checklist prefix can sit on, as Asciidoctor sees it.
 *
 * The prefix is tested against `item_text`, which is group 2 of the
 * marker row on the item's OPENING line
 * (`list_item = ListItem.new(list_block, (item_text = match[2]))`,
 * parser.rb l.1316) and nothing else, and the reader has already
 * taken that line's trailing whitespace off (`prepare_lines`,
 * reader.rb l.582, whose own comment calls the cleaning "very
 * important to how Asciidoctor works"; {@link rstrip},
 * src/parse/line-shapes.ts, is that set spelled once for this repo,
 * and is used here so the two readings cannot drift). So the source
 * bytes to ask about are the item's first line, right-stripped:
 * `* [*] ` is the literal text `[*]`, and text that only arrives on a
 * continuation line arrives after the question was settled.
 *
 * The strip runs whether or not the item's text continues below, which
 * is the reader's own reading and not a convenience: `* [*] ` with
 * `more` written under it carries NO checkbox, because the trailing
 * space came off before the prefix was tested. What that costs is a
 * tree whose printed spelling has to be held apart from the marker
 * line - `markerLineGuard` (src/print/list-hazard.ts) is the other
 * half of it, and without that half this strip would only trade the
 * render failure for an idempotency one.
 *
 * Read off the token images rather than the built nodes, because the
 * prefix's line can end inside a construct - `* [x] *b*` puts `[x] `
 * in a text node and `b` in a span - and only the images still hold
 * the source bytes in order.
 * @param tokens - the item's principal text, as tokenized
 * @returns the item's first source line, right-stripped
 */
function checkboxLine(tokens: readonly InlineToken[]): string {
  const text = tokens.map((token) => token.image).join("");
  const breakAt = text.indexOf("\n");
  return rstrip(breakAt === -1 ? text : text.slice(0, breakAt));
}

/**
 * Read a checklist prefix off an item's text and strip it. Only an
 * unordered item can be a checklist item (`parse_list_item`:
 * `if list_type == :ulist && text.start_with?('[')`); `. [x] text` is
 * an ordered item whose text begins with brackets.
 * @param variant - which list kind the item's marker opened
 * @param tokens - the item's principal text, as tokenized
 * @param inlineChildren - the item's inline nodes, trimmed in place
 * @returns the checkbox state, or undefined
 */
function takeCheckbox(
  variant: ListNode["variant"],
  tokens: readonly InlineToken[],
  inlineChildren: InlineNode[],
): ListItemNode["checkbox"] {
  if (variant !== "unordered") {
    return undefined;
  }
  const line = checkboxLine(tokens);
  const checkbox = parseCheckbox(line);
  if (checkbox === undefined) {
    return undefined;
  }
  const prefix = line.slice(0, CHECKBOX_PREFIX_LEN);
  return stripCheckboxPrefix(inlineChildren, prefix) ? checkbox : undefined;
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
  const checkbox = takeCheckbox(input.variant, input.text, text);
  return {
    type: "listItem",
    markerSpelling: input.markerSpelling,
    markerIndent: input.markerIndent,
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
