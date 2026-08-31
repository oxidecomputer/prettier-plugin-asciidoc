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
