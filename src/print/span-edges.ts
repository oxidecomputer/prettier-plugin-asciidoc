/**
 * The EDGE a span presents to a neighbour, and the reverse question a
 * respelling decision needs answered: what a neighbour presents to the
 * ROW that would resolve a span standing beside it.
 *
 * Which `QUOTE_SUBS` row resolves a span decides both what bytes it
 * prints and what bytes stand next to it once the rows that ran before
 * it have already rewritten the text - so the printer's own
 * constrained-vs-unconstrained choice (src/print/inline.ts) and the
 * block-wide stray-mark scan it also runs both read off the same row
 * facts. Collected here, out of src/print/inline.ts, to keep that file
 * under its line ceiling.
 */
import type {
  InlineNode,
  BoldNode,
  ItalicNode,
  MonospaceNode,
  HighlightNode,
  CurvedQuoteNode,
} from "../ast.js";
import {
  QUOTE_ROW,
  afterSpecialchars,
  type MarkKind,
  type QuoteRowKey,
} from "../parse/inline/quote-boundaries.js";
import { verbatimText } from "./serialize-inline.js";

/**
 * A formatting span with a CONSTRAINED spelling to choose: its marks
 * ride on the atoms they touch, and `constrainedIsLegal`
 * (src/print/inline.ts) decides whether the shorter spelling carries
 * the same meaning.
 */
export type MarkSpanNode =
  | BoldNode
  | ItalicNode
  | MonospaceNode
  | HighlightNode;

/**
 * Every span the printer writes. A curved-quote span has no
 * constrained spelling to choose - rows 3 and 4 of `QUOTE_SUBS` have
 * one spelling each - so it carries none of the questions
 * {@link MarkSpanNode} answers.
 */
export type SpanNode = MarkSpanNode | CurvedQuoteNode;

// The attrlist group's own brackets, `(?:\[([^\]]+)\])?`, which
// every `QUOTE_SUBS` row carries in front of its opening delimiter.
const ATTRLIST_OPEN = "[";
const ATTRLIST_CLOSE = "]";

// What a hard line break prints, spelled here because
// {@link printedText} is total and a break is one of the nodes it has
// to answer for.
const HARD_BREAK = " +";

/** The one mark character each span kind is spelled with. */
const SPAN_MARKS = { bold: "*", italic: "_", monospace: "`", highlight: "#" };

/**
 * The opening and closing marks of a formatting span.
 *
 * Constrained marks (`*bold*`) require word boundaries; unconstrained
 * (`**bold**`) work anywhere, including mid-word - and where BOTH are
 * legal they render identically, so the printer writes the
 * constrained one (`constrainedIsLegal` (src/print/inline.ts) decides). A role
 * attribute gives a highlight span semantic meaning used by CSS, e.g.
 * `[.red]#text#`: it is written as an inline attribute list
 * immediately before the mark, not as a block attribute list, so it is
 * emitted here and not through the block printer.
 * @param node - the span node.
 * @param constrained - whether to spell it with the single mark.
 * @returns its opening and closing marks.
 */
export function spanMarks(
  node: MarkSpanNode,
  constrained: boolean,
): { open: string; close: string } {
  const single = SPAN_MARKS[node.type];
  const mark = constrained ? single : `${single}${single}`;
  if (node.type === "highlight") {
    const rolePrefix = node.role === undefined ? "" : `[${node.role}]`;
    return { open: `${rolePrefix}${mark}`, close: mark };
  }
  return { open: mark, close: mark };
}

/**
 * The two delimiters of each curved pair, which have no other
 * spelling: `QUOTE_SUBS` rows 3 and 4 each have exactly one.
 */
const CURVED_MARKS = {
  double: { open: '"`', close: '`"' },
  single: { open: "'`", close: "`'" },
} as const;

/**
 * A curved-quote span's delimiters. Unlike a mark span's there is no
 * choice to make: rows 3 and 4 have one spelling each.
 * @param node - the curved-quote span
 * @returns its opening and closing delimiters
 */
export function curvedQuoteMarks(node: CurvedQuoteNode): {
  open: string;
  close: string;
} {
  return CURVED_MARKS[node.quote];
}

// What a span's neighbour looks like to the ROW that resolves the span
// - the second half of the rule `afterSpecialchars` implements the
// first half of.
//
// `sub_quotes` runs one gsub per `QUOTE_SUBS` row over the whole text
// and each row sees what the earlier rows wrote (substitutors.rb
// l.189-196). So the character standing beside a mark is not the
// character the SOURCE has there: it is whatever the rows that already
// ran left behind. For a neighbour that is itself a span, that is its
// element's `>` or `<` where its row came first, its own delimiter
// where its row has not run yet, and `;` or `&` for the two curved
// rows, whose replacement is an entity and not an element (QUOTE_ROW,
// quote-boundaries.ts).
//
// The conservative half of `constrainedIsLegal`'s refusals falls out
// of this: a neighbour whose printed bytes are not ours
// to predict (a macro, a link, an xref, an anchor, a passthrough, a
// raw line, a hard break) answers `undefined`, which the caller reads
// as no.

/**
 * Whether an inline node is one of the five spans.
 * @param node - the inline node to check
 * @returns true when it is a bold, italic, monospace, highlight or
 *   curved-quote span
 */
export function isSpanNode(node: InlineNode): node is SpanNode {
  return (
    node.type === "bold" ||
    node.type === "italic" ||
    node.type === "monospace" ||
    node.type === "highlight" ||
    node.type === "curvedQuote"
  );
}

/**
 * The two row keys each mark kind spells, by whether the span is
 * currently constrained. Split out of {@link rowKeyOf} so its own
 * complexity stays low: four kinds times two spellings is eight
 * literal branches on top of the switch, over the ceiling in one
 * function.
 */
const MARK_ROW_KEYS: Record<
  MarkKind,
  { readonly constrained: QuoteRowKey; readonly unconstrained: QuoteRowKey }
> = {
  bold: { constrained: "boldConstrained", unconstrained: "boldUnconstrained" },
  italic: {
    constrained: "italicConstrained",
    unconstrained: "italicUnconstrained",
  },
  monospace: {
    constrained: "monospaceConstrained",
    unconstrained: "monospaceUnconstrained",
  },
  highlight: {
    constrained: "highlightConstrained",
    unconstrained: "highlightUnconstrained",
  },
};

/**
 * Which `QUOTE_SUBS` row resolved this span. Exhaustive over the five
 * span kinds, which is the compile-time gate on a sixth.
 * @param node - a span node
 * @returns its row key
 */
export function rowKeyOf(node: SpanNode): QuoteRowKey {
  if (node.type === "curvedQuote") {
    return node.quote === "double" ? "curvedDouble" : "curvedSingle";
  }
  const { constrained, unconstrained } = MARK_ROW_KEYS[node.type];
  return node.constrained ? constrained : unconstrained;
}

/**
 * The delimiters a span prints, whichever kind it is.
 * @param node - a span node
 * @returns its opening and closing delimiters
 */
export function delimitersOf(node: SpanNode): { open: string; close: string } {
  return node.type === "curvedQuote"
    ? curvedQuoteMarks(node)
    : spanMarks(node, node.constrained);
}

/**
 * The TAIL of what stands in front of a span, as row `askingOrder` reads
 * it, or undefined when the neighbour's printed bytes are not ours to
 * predict.
 * @param neighbour - the node in front
 * @param askingOrder - the asking span's row index
 * @returns the text whose LAST character the front clause tests
 */
export function edgeTail(
  neighbour: InlineNode,
  askingOrder: number,
): string | undefined {
  if (neighbour.type === "text") return afterSpecialchars(neighbour.value);
  if (!isSpanNode(neighbour)) return undefined;
  const row = QUOTE_ROW[rowKeyOf(neighbour)];
  return row.order < askingOrder
    ? row.closesWith
    : delimitersOf(neighbour).close;
}

/**
 * The HEAD of what stands behind a span, mirroring {@link edgeTail}.
 * @param neighbour - the node behind
 * @param askingOrder - the asking span's row index
 * @returns the text whose FIRST character the behind clause tests
 */
export function edgeHead(
  neighbour: InlineNode,
  askingOrder: number,
): string | undefined {
  if (neighbour.type === "text") return neighbour.value;
  if (!isSpanNode(neighbour)) return undefined;
  const row = QUOTE_ROW[rowKeyOf(neighbour)];
  return row.order < askingOrder ? row.opensWith : delimitersOf(neighbour).open;
}

/**
 * The bytes a node prints.
 *
 * TOTAL, with no "cannot say" arm: a span prints its own delimiters
 * around its content - which is what makes a nested run of marks
 * visible to {@link attrlistCarriesMark} where the tree alone shows
 * only nodes - a raw line prints the line it kept and a hard break its
 * own ` +`, and every other node answers through `verbatimText`, the
 * same function the printer writes it with.
 * @param node - an inline node standing in front of a span
 * @returns its printed bytes
 */
function printedText(node: InlineNode): string {
  if (node.type === "text" || node.type === "rawLine") return node.value;
  if (node.type === "hardLineBreak") return HARD_BREAK;
  if (isSpanNode(node)) {
    const { open, close } = delimitersOf(node);
    return `${open}${node.children.map(printedText).join("")}${close}`;
  }
  return verbatimText(node);
}

/**
 * The attrlist standing flush in front of a span: the run inside its
 * brackets, and the bytes in front of its `[`.
 *
 * Every `QUOTE_SUBS` row carries an optional `(?:\[([^\]]+)\])?`
 * group in front of its opening delimiter (asciidoctor.rb l.446-464),
 * so a `[...]` run flush against a span belongs to whichever ROW
 * resolves that span. Both fields are what a respelling decision needs
 * from it, and they answer two different questions
 * ({@link attrlistAllowsIt}). Not exported: the value travels from
 * {@link attrlistInFront} to that predicate, and its one caller
 * (`neighboursAllowIt`, src/print/inline.ts) never names the type.
 */
interface AttrlistInFront {
  /** The run between the `[` and the `]`, never empty. */
  readonly interior: string;
  /**
   * What stands in front of the `[`. The row's own LEFT clause is
   * tested where the MATCH starts, which is the `[` and not the
   * delimiter, so this is the text whose last character it reads.
   */
  readonly before: string;
}

/**
 * The attrlist flush in front of a span, read from TWO places because
 * this parser models one of them and prints the other.
 *
 * A highlight's attrlist is parsed (`rules.ts`'s `RoleAttribute` row,
 * which fires in front of a `#` and nowhere else) and rides on the span
 * as its role, so the printer writes the brackets itself and every byte
 * in front of the span stands in front of them. For the other three
 * marks the same bytes are ordinary text and spans that Ruby reads as a
 * role all the same, so the run is recovered from what those siblings
 * PRINT.
 *
 * `[^\]]+` cannot cross a `]`, so the group's `[` is the first one
 * standing after the previous `]`; taking the first gives the widest
 * interior, which is the conservative reading of what the group can
 * hold. An empty interior is no attrlist at all, which is why
 * `[]**c**` renders `[]<strong>c</strong>`.
 * @param head - what stands in front of the sibling list itself
 * @param inFront - the siblings in front of the span, in source order
 * @param role - the span's own parsed attrlist, for the one mark that
 *   has one
 * @returns the run and its left context, or undefined when no attrlist
 *   stands there
 */
export function attrlistInFront(
  head: string,
  inFront: readonly InlineNode[],
  role: string | undefined,
): AttrlistInFront | undefined {
  const text = head + inFront.map(printedText).join("");
  if (role !== undefined) return { interior: role, before: text };
  // The group's own `\]` has to be the last byte in front of the
  // delimiter; anything else and no group can end there.
  if (!text.endsWith(ATTRLIST_CLOSE)) return undefined;
  const body = text.slice(0, -1);
  const region = body.slice(body.lastIndexOf(ATTRLIST_CLOSE) + 1);
  const open = region.indexOf(ATTRLIST_OPEN);
  const interior = open === -1 ? "" : region.slice(open + 1);
  return interior === ""
    ? undefined
    : { interior, before: body.slice(0, body.length - region.length + open) };
}

/**
 * Whether the attrlist standing flush in front of a span leaves the
 * constrained spelling legal. Two independent refusals, each with its
 * own witness.
 *
 * A MARK INSIDE THE RUN. The unconstrained row writes the run into its
 * element's attribute and the constrained row then matches the marks
 * left standing in there, while the constrained row doing the same
 * match consumes them itself and nothing re-reads them. Measured:
 * `[*a**a*]**c**` renders `<strong class="<strong>a</strong>*a*">c</strong>`
 * and the shortened `[*a**a*]*c*` renders `<strong class="*a**a*">c</strong>`.
 * Monospaced is no exception: its own left clause excludes `"`, which
 * guards only the run's FIRST character, and a backtick standing later
 * opens after a space or a hyphen like any other - `[a `b` c]``d``
 * renders `<code class="a <code>b</code> c">d</code>` and the shortened
 * `[a `b` c]`d`` renders `<code class="a `b` c">d</code>`.
 *
 * A WORD CHARACTER IN FRONT OF THE BRACKET. The unconstrained row has
 * no left clause and the constrained row has one, tested where the
 * MATCH starts - which is the `[`, not the delimiter. So a run the
 * wider spelling took as a role is not a role to the narrower one at
 * all: `x[a]**c**` renders `x<strong class="a">c</strong>` and the
 * shortened `x[a]*c*` renders `x[a]<strong>c</strong>`, the role gone.
 * The character is read through `afterSpecialchars` for the reason
 * quote-boundaries.ts gives: `sub_specialchars` has already run when
 * the quote pass reads it.
 * @param attrlist - the run and its left context
 * @param mark - the span's own mark character
 * @param front - the mark's own left-boundary class
 * @returns true when neither refusal applies
 */
export function attrlistAllowsIt(
  attrlist: AttrlistInFront,
  mark: string,
  front: RegExp,
): boolean {
  return (
    !attrlist.interior.includes(mark) &&
    !front.test(afterSpecialchars(attrlist.before))
  );
}
