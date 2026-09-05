/**
 * The interruption model: which line SHAPES end the block a reader
 * already has open, read per {@link ParagraphContext} and per
 * enclosing list.
 *
 * A SIBLING of line-shapes.ts, not a layer under it, and split out of
 * it by the registry's own growth rule: a row family moves out whole
 * when that file nears its `max-lines` ceiling. The family that moved
 * is the one that reads the READER'S STATE - the per-context tables
 * and the arms that consult the list open around the block. The
 * interrupting sets themselves are patterns and stayed with the other
 * patterns, which is why this module imports them by name; the
 * pattern-import rule in tests/parser/architecture.test.ts holds
 * `src/parse/lines` and leaves the registry's own modules to spell
 * their tables from the patterns.
 *
 * THE ENCLOSING LIST, and why two contexts need it. A confined
 * reader's lines have already been through the item scan
 * (`read_lines_for_list_item`, parser.rb l.1404) before any of them
 * is classified, so a shape that scan CUTS never reaches the block
 * reader inside the item. Two contexts answer differently inside a
 * list item than at document level for exactly that reason, and
 * {@link ENCLOSING_LIST_RULE} is the per-context table of which
 * difference applies. The rest answer the same everywhere: the sets
 * they already carry hold every marker line, so a sibling adds
 * nothing to them.
 */
import { isDescriptionSiblingLine } from "./line-shapes-description.js";
import {
  BLOCK_ANCHOR,
  BLOCK_START_CONTEXT,
  CONTINUATION_LINE,
  DLIST_FIRST_LINE_INTERRUPTERS,
  DLIST_ITEM_ANY_LINE_INTERRUPTERS,
  isDescriptionListLine,
  isRawParagraphLine,
  LIST_ITEM_FIRST_LINE_INTERRUPTERS,
  LIST_ITEM_INTERRUPTERS,
  LIST_ITEM_LATER_BLOCK_INTERRUPTERS,
  listMarkerStyle,
  type OpenList,
  type ParagraphContext,
  PARAGRAPH_INTERRUPTERS,
  type ReaderContext,
  rstrip,
} from "./line-shapes.js";

// No context-specific patterns for this position.
const NO_PATTERNS: readonly RegExp[] = [];

// The pattern list each context uses REGARDLESS of where the line
// sits and of what list encloses it. listContinuation starts from the
// plain-paragraph set and adds only the OPEN list's own siblings,
// which the line alone cannot tell it - see ENCLOSING_LIST_RULE.
const INTERRUPTERS_BY_CONTEXT: Record<ParagraphContext, readonly RegExp[]> = {
  paragraph: PARAGRAPH_INTERRUPTERS,
  listItemText: LIST_ITEM_INTERRUPTERS,
  listItem: LIST_ITEM_LATER_BLOCK_INTERRUPTERS,
  listContinuation: PARAGRAPH_INTERRUPTERS,
  dlistItem: DLIST_ITEM_ANY_LINE_INTERRUPTERS,
  dlistItemTextOnly: DLIST_ITEM_ANY_LINE_INTERRUPTERS,
  // The literal-paragraph branch of `next_block` calls
  // `read_paragraph_lines` with a nil `break_at_list` at document
  // level, so its set is the plain-paragraph one exactly.
  literalParagraph: PARAGRAPH_INTERRUPTERS,
  // Ruby reads a styled verbatim run with `read_lines_until
  // break_on_blank_lines: true, break_on_list_continuation: true`
  // (parser.rb l.1028), so blank lines are structural to the reader
  // and the lone `+` is the whole set.
  verbatimStyled: [CONTINUATION_LINE],
};

// Patterns that interrupt ONLY on the first line after the block
// started, where `next_block` still gets to choose a block context.
const FIRST_LINE_INTERRUPTERS: Record<ParagraphContext, readonly RegExp[]> = {
  paragraph: NO_PATTERNS,
  listItemText: LIST_ITEM_FIRST_LINE_INTERRUPTERS,
  // Nothing: this position is the SECOND line of a block that already
  // has a first, so `next_block` has picked its context and
  // `read_paragraph_lines` is running (parser.rb l.764) under
  // `StartOfBlockOrListProc` (chosen at l.966-67, the proc itself at
  // l.40). A block macro line matches none of that proc's three
  // alternatives, so it is prose (oracle: `* item` /
  // `image::a.png[]` / `para line` / `image::a.png[]` renders one
  // paragraph, not two blocks).
  listItem: NO_PATTERNS,
  listContinuation: NO_PATTERNS,
  dlistItem: DLIST_FIRST_LINE_INTERRUPTERS,
  dlistItemTextOnly: LIST_ITEM_FIRST_LINE_INTERRUPTERS,
  literalParagraph: NO_PATTERNS,
  verbatimStyled: NO_PATTERNS,
};

// Patterns that interrupt ONLY on a LATER line. One entry, and it is
// the mirror of the raw-line rule: a `[[a]]` directly after a list
// item's text is metadata for the item's FIRST block, which
// `fold_first` merges into the item text, anchor and all, so the
// oracle emits no id (see BLOCK_ANCHOR). Further down THAT SAME BLOCK
// there is a first line already, so the anchor opens a second block
// and keeps its id (`* item` / `foo` / `[[a]]` / `para` renders
// `<div id="a">`). Blocks after the first hold the same anchor at
// every position, which is INTERRUPTERS_BY_CONTEXT's `listItem` row.
const LATER_LINE_INTERRUPTERS: Record<ParagraphContext, readonly RegExp[]> = {
  paragraph: NO_PATTERNS,
  listItemText: [BLOCK_ANCHOR],
  listItem: NO_PATTERNS,
  listContinuation: NO_PATTERNS,
  dlistItem: NO_PATTERNS,
  dlistItemTextOnly: NO_PATTERNS,
  literalParagraph: NO_PATTERNS,
  verbatimStyled: NO_PATTERNS,
};

/**
 * Whether a line's SHAPE ends the open block: the context's
 * position-independent patterns plus the ones its position adds.
 * @param line - one rstripped source line
 * @param context - which kind of paragraph is open
 * @param firstLineAfterStart - see {@link ReaderContext}
 * @returns true when some applicable pattern matches
 */
function matchesInterrupter(
  line: string,
  context: ParagraphContext,
  firstLineAfterStart: boolean,
): boolean {
  const always = INTERRUPTERS_BY_CONTEXT[context];
  const byPosition = firstLineAfterStart
    ? FIRST_LINE_INTERRUPTERS
    : LATER_LINE_INTERRUPTERS;
  const positional = byPosition[context];
  const test = (pattern: RegExp): boolean => pattern.test(line);
  return always.some(test) || positional.some(test);
}

/**
 * What the list open AROUND a block contributes to the answer for
 * one context - the second half of the interrupting set, and the
 * half no pattern can carry because it is a comparison against the
 * open list rather than a shape.
 */
type EnclosingListRule =
  /** Nothing: the context's patterns already say everything. */
  | "nothing"
  /** A sibling item of the open list ends the block. */
  | "siblingItem"
  /** A sibling term ends it, and only in a DESCRIPTION list. */
  | "siblingDescriptionItem";

// Which rule each context takes. The six `nothing` rows are the
// contexts whose own sets already hold every list marker line
// (LIST_ITEM_INTERRUPTERS) or that stand outside a list entirely, so
// the open list tells them nothing they do not already act on.
const ENCLOSING_LIST_RULE: Record<ParagraphContext, EnclosingListRule> = {
  paragraph: "nothing",
  listItemText: "nothing",
  listItem: "nothing",
  listContinuation: "siblingItem",
  dlistItem: "nothing",
  dlistItemTextOnly: "nothing",
  literalParagraph: "siblingDescriptionItem",
  verbatimStyled: "nothing",
};

/**
 * Whether a line is a SIBLING item of the list open around the block
 * - `is_sibling_list_item?` (parser.rb l.2280-2285), which compares
 * the resolved marker for a marker list and matches the pattern keyed
 * to the delimiter for a description list.
 * @param line - one rstripped source line
 * @param openList - the list open around the block
 * @returns true when Asciidoctor would read the line as the next item
 *   of that same list
 */
function isSiblingItemLine(line: string, openList: OpenList): boolean {
  return openList.kind === "description"
    ? isDescriptionSiblingLine(line, openList.delimiter)
    : listMarkerStyle(line) === openList.style;
}

/**
 * Whether the list open around the block ends it at this line.
 * @param line - one rstripped source line
 * @param rule - the context's row of {@link ENCLOSING_LIST_RULE}
 * @param openList - the list open around the block, or undefined at
 *   document level
 * @returns true when Asciidoctor would start something new here
 */
function enclosingListEnds(
  line: string,
  rule: EnclosingListRule,
  openList: OpenList | undefined,
): boolean {
  switch (rule) {
    case "nothing": {
      return false;
    }
    case "siblingItem": {
      // The item scan's own loop breaks at a sibling before any line
      // reaches the confined reader (parser.rb l.1430), whatever kind
      // of list is open. A NON-sibling marker does not end the
      // paragraph: the oracle runs it through `. next` inside a `*`
      // list and through `* next` inside a `.` list.
      return openList !== undefined && isSiblingItemLine(line, openList);
    }
    case "siblingDescriptionItem": {
      // An indented run is slurped by an inner `read_lines_until`
      // instead, so the outer loop's sibling break never sees its
      // lines. The sibling test comes back only as the block Ruby
      // passes for a dlist and for no other list type (parser.rb
      // l.1490-1495, and l.1541-1546 for the blank-line-offset run) -
      // which is why a sibling MARKER runs straight through an
      // indented run inside a marker item.
      return (
        openList?.kind === "description" && isSiblingItemLine(line, openList)
      );
    }
  }
}

// Contexts in which a `term::` word starts a nested description list
// rather than being plain text.
const ENDED_BY_DLIST_TERM = new Set<ParagraphContext>([
  "listItemText",
  "listItem",
  "dlistItem",
  "dlistItemTextOnly",
]);

/**
 * Whether a line ends the open paragraph (or list item text).
 *
 * `context` stays its own parameter beside `reader`, whose
 * `openParagraph` names the same thing: the caller has already
 * narrowed the open paragraph to a definite one to be asking at all,
 * and passing the narrowing is what keeps the interrupting-set lookup
 * total without an absent case.
 * @param rawLine - one source line, without its trailing newline;
 *   trailing whitespace is trimmed here (see rstrip)
 * @param context - which kind of paragraph is open; see
 *   {@link ParagraphContext} for what each set contains
 * @param reader - the line's position in the block and the enclosing
 *   list ancestry, neither of which the line alone conveys; see
 *   {@link ReaderContext}
 * @returns true when Asciidoctor would start a new block (or item) here
 */
export function interruptsParagraph(
  rawLine: string,
  context: ParagraphContext,
  reader: ReaderContext = BLOCK_START_CONTEXT,
): boolean {
  // A comment or preprocessor line is consumed while READING, before
  // block structure exists, so it can never end anything, including
  // when its shape (`ifdef::flag[]`) also reads as a block macro.
  // Context-free on purpose: the block-anchor rule below is about
  // how a line is PRINTED, not about what the preprocessor eats.
  if (isRawParagraphLine(rawLine)) {
    return false;
  }
  const line = rstrip(rawLine);
  if (matchesInterrupter(line, context, reader.firstLineAfterStart)) {
    return true;
  }
  if (enclosingListEnds(line, ENCLOSING_LIST_RULE[context], reader.openList)) {
    return true;
  }
  // A dlist term interrupts a LIST ITEM's text (the oracle nests a
  // fresh `<div class="dlist">` inside the `<li>`) but is swallowed
  // as plain text mid-PARAGRAPH (confirmed against the oracle for
  // "term:: definition" in every context). Surprising: it is the only
  // pattern in this registry whose verdict flips by context rather
  // than being a strict superset/subset relationship.
  return ENDED_BY_DLIST_TERM.has(context) && isDescriptionListLine(line);
}
