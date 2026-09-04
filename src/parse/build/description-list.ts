/**
 * Description lists: one term, one item, and the list its items make.
 *
 * Every function here is `(input, index) -> node` and nothing else: no
 * traversal, no context. What a line MEANS was decided by
 * lines/classify.ts against the registry in line-shapes.ts, and which
 * lines belong to which item by the extent lines/list-reader.ts
 * collected for it. These only take it apart.
 *
 * The one rule this file carries that build/list.ts does not is the
 * TERM FOLD, because an item and a parsed sibling are not the same
 * thing here: Ruby appends a term-only sibling to the pair already
 * open instead of starting a new one, so the list is what decides how
 * many items its siblings make. Ruby line numbers cite parser.rb at
 * Asciidoctor core 2.0.26, the revision the oracle runs.
 */
import type {
  DescriptionDelimiter,
  DescriptionListItemNode,
  DescriptionListNode,
  DescriptionPrinting,
  DescriptionTermNode,
  TermEntry,
  TermGapLine,
} from "../../ast.js";
import { buildFromTokens } from "../inline/inline-node-builder.js";
import type { InlineToken } from "../inline/tokens.js";
import type { Fragment, LocationIndex } from "../positions.js";
import type { ItemBodyInput } from "./list.js";
import { bodyExtent } from "./paragraph.js";

/**
 * One term: its inline children, and the span of the term text alone.
 *
 * The span is the TERM's, not the term line's - it ends before the
 * delimiter, so a description that follows on the same line is outside
 * it and the two never overlap.
 * @param tokens - the term text, already tokenized
 * @param span - the term text's own source span
 * @param line - the whole source line the term was written on
 * @param at - the document's location index
 * @returns the term node
 */
export function buildDescriptionTerm(
  tokens: readonly InlineToken[],
  span: Fragment,
  line: string,
  at: LocationIndex,
): DescriptionTermNode {
  return {
    type: "descriptionTerm",
    children: buildFromTokens(tokens, at),
    line,
    position: { start: at.start(span), end: at.end(span) },
  };
}

/**
 * Everything one description item is built from: the terms that
 * introduce it, and the body every list-like item has.
 *
 * Not exported: every caller passes an object literal, and the one
 * src route to this builder is {@link buildDescriptionList}, which is
 * what decides how many terms one item has.
 */
interface DescriptionItemInput {
  /**
   * The terms this item is introduced by, each with the lines that
   * followed it. Non-empty because an item exists only where a term
   * line opened one.
   */
  readonly terms: readonly [TermEntry, ...TermEntry[]];
  /** The body half, shared whole with a marker item's. */
  readonly body: ItemBodyInput;
  /**
   * The source lines the body's principal text was read from
   * ({@link DescriptionListItemNode.textLines}).
   */
  readonly textLines: readonly string[];
  /** What the printer may do with the item's recorded lines. */
  readonly printing: DescriptionPrinting;
}

/**
 * One description item: its terms, then its principal text and every
 * block the reader put inside it in source order, each behind its
 * verbatim gap.
 *
 * Field order in the literal is load-bearing, and here it carries one
 * more piece than a marker item's does: `terms` before `text` before
 * `blocks` is the source order of the three, which keeps the generic
 * pre-order walk in document order (see buildListItem's note in
 * ./list.ts).
 *
 * Exported for its unit tests
 * (tests/parser/description-structure.test.ts); src reaches it
 * through {@link buildDescriptionList}.
 * @param input - the item's parts (see {@link DescriptionItemInput})
 * @param at - the document's location index
 * @returns the item node
 * @internal
 */
export function buildDescriptionListItem(
  input: DescriptionItemInput,
  at: LocationIndex,
): DescriptionListItemNode {
  const { body, printing, textLines } = input;
  const [opening, ...rest] = input.terms;
  // Total, not a guard: `rest` really is empty for a one-term item,
  // exactly as it is for a one-item list in buildList.
  const closing = rest.at(-1) ?? opening;
  return {
    type: "descriptionListItem",
    terms: [opening, ...rest],
    text: buildFromTokens(body.text, at),
    blocks: [...body.blocks],
    trailingContinuation: body.trailingContinuation,
    detachedTail: body.detachedTail,
    activeTail: body.activeTail,
    everyTextLineIndented: body.everyTextLineIndented,
    textLines: [...textLines],
    printing,
    position: {
      start: opening.term.position.start,
      end:
        body.blocks.at(-1)?.block.position.end ??
        (body.text.length > 0
          ? bodyExtent(body.text, at).end
          : closing.term.position.end),
    },
  };
}

/**
 * One parsed sibling of a description list: the term line the sibling
 * pattern matched, the source between it and what follows, and the
 * body that read produced.
 *
 * A sibling, NOT an item. How many items a run of siblings makes is
 * {@link buildDescriptionList}'s answer, because it is the fold that
 * decides it.
 *
 * src builds one per sibling in the reader that scanned it
 * (src/parse/lines/description-list-node.ts).
 */
export interface DescriptionPair {
  /** The term this sibling's line carried. */
  readonly term: DescriptionTermNode;
  /**
   * The lines strictly between this term line and the next piece of
   * the item (see {@link TermEntry}'s own `gap`).
   */
  readonly gap: readonly TermGapLine[];
  /** The description half, empty where the sibling carried none. */
  readonly body: ItemBodyInput;
  /**
   * The source lines that half's principal text was read from
   * ({@link DescriptionListItemNode.textLines}).
   */
  readonly textLines: readonly string[];
  /**
   * What the printer may do with THIS sibling's recorded lines. The
   * item takes the answer of the sibling that closed it, because that
   * is the sibling whose lines the description is.
   */
  readonly printing: DescriptionPrinting;
}

/**
 * Whether a sibling's description half is Ruby's nil:
 * `list_item.text? || list_item.blocks?` (parser.rb:1387) read the
 * other way round.
 *
 * DERIVED rather than carried beside the body, so that the answer and
 * the body it is about cannot come to disagree - the fold below turns
 * on it, and a flag a reader set by hand would decide the item count.
 * @param body - the sibling's description half
 * @returns true when the half carries neither text nor blocks
 */
function hasNoBody(body: ItemBodyInput): boolean {
  return body.text.length === 0 && body.blocks.length === 0;
}

/** One item's parts, as the fold accumulates them. */
interface FoldedItem {
  /** The terms folded onto this item so far, in source order. */
  readonly terms: readonly [TermEntry, ...TermEntry[]];
  /** The body of the sibling that is currently open. */
  readonly body: ItemBodyInput;
  /** That sibling's recorded text lines. */
  readonly textLines: readonly string[];
  /** That sibling's printing answer. */
  readonly printing: DescriptionPrinting;
}

/**
 * One sibling's own term entry: the term and what followed it.
 * @param pair - the parsed sibling
 * @returns the entry the item records for it
 */
function entryOf(pair: DescriptionPair): TermEntry {
  return { term: pair.term, gap: pair.gap };
}

/**
 * The same item with one more term folded onto it, and the folded
 * sibling's body and printing in place of the empty ones it had.
 *
 * WHAT THE FOLD MAY DISCARD, and why the discard is empty. The open
 * item's body is replaced WHOLESALE, so everything the absorbed
 * sibling's body carried is gone. That is lossless only because a
 * sibling {@link hasNoBody} admits carries nothing: no text, no
 * blocks, and none of the three tail facts either. The tail facts are
 * ours rather than Ruby's, so `list_item.text? || list_item.blocks?`
 * (parser.rb:1387) does not rule them out on its own, and the reader
 * that builds a pair owes this the way it owes the term itself:
 *
 * - `trailingContinuation` and `detachedTail` are the `+` bytes a
 *   sibling's read consumed. Between two term lines a `+` is buffered
 *   by the read loop's `ListContinuationMarker` arm
 *   (parser.rb:1557-1559) and dropped by the post-loop pop of that
 *   same marker (parser.rb:1580-1582), so it gives the sibling no
 *   body and the fold rolls on over it. Its byte's home
 *   is the term's own gap ({@link TermGapLine}'s `"+"` arm), and a
 *   reader that leaves it on the body instead loses it here, silently
 *   and render-equally.
 * - `activeTail` is a `+` still armed under a TRAILING METADATA
 *   BLOCK, so it cannot arise without a block, and a sibling with a
 *   block is one the fold never reaches.
 *
 * The last sibling of an item is not folded away and keeps every one
 * of them: that is where a real trailing `+` belongs.
 *
 * `textLines` is replaced wholesale too, and that discard is empty
 * for the same reason read the other way round: the lines are the
 * source the body's `text` was read from, so a sibling that
 * {@link hasNoBody} admits has none of them either.
 * @param item - the item currently open
 * @param pair - the term-only sibling that follows it
 * @returns the widened item
 */
function withTerm(item: FoldedItem, pair: DescriptionPair): FoldedItem {
  const [opening, ...rest] = item.terms;
  return {
    terms: [opening, ...rest, entryOf(pair)],
    body: pair.body,
    textLines: pair.textLines,
    printing: pair.printing,
  };
}

/**
 * One sibling as an item of its own: what the fold starts from, and
 * what it falls back to whenever the open item already has a body.
 * @param pair - the parsed sibling
 * @returns the item it opens
 */
function itemOf(pair: DescriptionPair): FoldedItem {
  return {
    terms: [entryOf(pair)],
    body: pair.body,
    textLines: pair.textLines,
    printing: pair.printing,
  };
}

/**
 * Every sibling folded into the items it really makes - the whole of
 * `parse_description_list`'s loop (parser.rb:1230-1235). While the
 * open pair's description half is nil, the next sibling's term joins
 * THAT pair and its body becomes the pair's, so `a::` / `b::` /
 * `c:: shared` is one item with three terms; a sibling that arrives
 * behind a pair that already has a body opens a new one.
 *
 * The item still OPEN when the siblings run out is returned apart from
 * the closed ones, which is how "a list always has a last item" is
 * said in the type rather than recovered from an array afterwards.
 * @param opening - the sibling the list opened on
 * @param rest - the siblings after it, in source order
 * @returns the items closed during the fold, and the one left open
 */
function foldTerms(
  opening: DescriptionPair,
  rest: readonly DescriptionPair[],
): { closed: readonly FoldedItem[]; open: FoldedItem } {
  const closed: FoldedItem[] = [];
  let open = itemOf(opening);
  for (const pair of rest) {
    if (hasNoBody(open.body)) {
      open = withTerm(open, pair);
    } else {
      closed.push(open);
      open = itemOf(pair);
    }
  }
  return { closed, open };
}

/**
 * A description list: its items, with the delimiter every one of them
 * repeats.
 *
 * The opening sibling is its OWN parameter, so "a list always has an
 * item" is what the signature says rather than a sentence the body
 * re-checks, exactly as in buildList - and here it says more, because
 * the fold reads the open item on every turn and an empty run would
 * leave it with nothing to read.
 * @param delimiter - the delimiter the list's sibling pattern is keyed
 *   on; every item's term line repeats it
 * @param pairs - one parsed sibling per term line, in source order
 * @param at - the document's location index
 * @returns the list node
 */
export function buildDescriptionList(
  delimiter: DescriptionDelimiter,
  pairs: readonly [DescriptionPair, ...DescriptionPair[]],
  at: LocationIndex,
): DescriptionListNode {
  const [opening, ...siblings] = pairs;
  const folded = foldTerms(opening, siblings);
  const closed = folded.closed.map((item) =>
    buildDescriptionListItem(item, at),
  );
  const last = buildDescriptionListItem(folded.open, at);
  // Total, not a guard: the item the fold left open is the list's
  // last, and it is also its FIRST wherever every sibling folded onto
  // it - which is the whole of a one-item list.
  const first = closed.at(0) ?? last;
  return {
    type: "descriptionList",
    delimiter,
    children: [...closed, last],
    position: { start: first.position.start, end: last.position.end },
  };
}
