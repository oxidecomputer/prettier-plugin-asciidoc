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
  SuperscriptNode,
  SubscriptNode,
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
 * A span with ONE spelling and nothing to choose: rows 3 and 4 of
 * `QUOTE_SUBS` (the curved pair) and rows 11 and 12 (super/sub) each
 * have exactly one delimiter pair, so none of them carries the
 * questions {@link MarkSpanNode} answers. Not exported: it reaches
 * callers as the half of {@link SpanNode} that {@link isMarkSpanNode}
 * narrows away, and {@link fixedSpanMarks} takes it structurally.
 */
type FixedSpanNode = CurvedQuoteNode | SuperscriptNode | SubscriptNode;

/**
 * Every span the printer writes: the four with a constrained spelling
 * to choose, plus the four rows that have only one.
 */
export type SpanNode = MarkSpanNode | FixedSpanNode;

// The attrlist group's own brackets, `(?:\[([^\[\]]+)\])?`, which
// every `QUOTE_SUBS` row carries in front of its opening delimiter.
const ATTRLIST_OPEN = "[";
const ATTRLIST_CLOSE = "]";

// The escape character the UNCONSTRAINED rows carry a `\\?` for in
// front of that group and the constrained rows do not
// (asciidoctor.rb l.446-468); see {@link attrlistAllowsIt}.
const ATTRLIST_ESCAPE = "\\";

// A bracketed run the bytes in front of a span leave OPEN: a `[` with
// no `]` after it. The group's interior crosses no `]`, so a group
// standing there can only have opened at a `[` this run holds.
const OPEN_BRACKET_RUN = /\[[^\]]*$/v;

// The bytes that CLOSE such a run flush against the span behind them:
// no `]` of their own, then the one the group ends with and nothing
// after it, because the group's `]` has to be the last byte in front
// of that span's delimiter.
const CLOSES_FLUSH = /^[^\]]*\]$/v;

// A whole bracketed run and nothing else: the shape the bytes between
// two spans have when the second one's attributes group opens flush
// against the first one's closing delimiter.
const FLUSH_ATTRLIST = /^\[[^\]]+\]$/v;

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

// The single character each of the last two rows doubles nothing of:
// `\^(\S+?)\^` and `~(\S+?)~` (asciidoctor.rb l.465-468), whose
// delimiter is the same character at both ends.
const SUPER_SUB_MARKS = {
  superscript: "^",
  subscript: "~",
} as const;

/**
 * A fixed-spelling span's delimiters. Unlike a mark span's there is no
 * choice to make: each of these four rows has exactly one spelling.
 * @param node - the curved-quote, superscript or subscript span
 * @returns its opening and closing delimiters
 */
export function fixedSpanMarks(node: FixedSpanNode): {
  open: string;
  close: string;
} {
  if (node.type === "curvedQuote") return CURVED_MARKS[node.quote];
  const mark = SUPER_SUB_MARKS[node.type];
  return { open: mark, close: mark };
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
 * @returns true when it is a bold, italic, monospace, highlight,
 *   curved-quote, superscript or subscript span
 */
export function isSpanNode(node: InlineNode): node is SpanNode {
  return (
    isMarkSpanNode(node) ||
    node.type === "curvedQuote" ||
    node.type === "superscript" ||
    node.type === "subscript"
  );
}

/**
 * Whether an inline node is one of the four spans with a CONSTRAINED
 * spelling to choose. The printer asks this before it runs the
 * respelling machinery at all: the other four span kinds have one
 * delimiter pair each and nothing to decide.
 * @param node - the inline node to check
 * @returns true when it is a bold, italic, monospace or highlight span
 */
export function isMarkSpanNode(node: InlineNode): node is MarkSpanNode {
  return (
    node.type === "bold" ||
    node.type === "italic" ||
    node.type === "monospace" ||
    node.type === "highlight"
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
  if (node.type === "superscript" || node.type === "subscript") {
    return node.type;
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
  return isMarkSpanNode(node)
    ? spanMarks(node, node.constrained)
    : fixedSpanMarks(node);
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
  if (neighbour.type === "text" || neighbour.type === "characterReference") {
    return afterSpecialchars(neighbour.value);
  }
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
  if (neighbour.type === "text" || neighbour.type === "characterReference") {
    return neighbour.value;
  }
  if (!isSpanNode(neighbour)) return undefined;
  const row = QUOTE_ROW[rowKeyOf(neighbour)];
  return row.order < askingOrder ? row.opensWith : delimitersOf(neighbour).open;
}

/**
 * The bytes a node prints.
 *
 * TOTAL, with no "cannot say" arm: a span prints its own delimiters
 * around its content - which is what makes a nested run of marks
 * visible to {@link attrlistAllowsIt} where the tree alone shows
 * only nodes - a raw line prints the line it kept and a hard break its
 * own ` +`, and every other node answers through `verbatimText`, the
 * same function the printer writes it with.
 * @param node - an inline node standing beside a span
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
 * as its role, so the printer writes the brackets itself. For the other
 * three marks the same bytes are ordinary text and spans that Ruby
 * reads as a role all the same, so the run is recovered from what those
 * siblings PRINT. Both are answered by the same scan over the bytes the
 * printer WRITES in front of the delimiter, a role's own brackets among
 * them: that rule matches on `[^\]]+`, one character wider than the
 * group below, so a parsed role is not always the group either.
 *
 * The group's interior is `[^\[\]]+` (`QuoteAttributeListRxt`,
 * `node_modules/@asciidoctor/core/build/node/index.cjs` l.59), which
 * crosses NEITHER bracket, so there is exactly one run to read: the
 * group's `[` is the LAST one standing in front of that `]`, and a `[`
 * earlier in the line opens nothing. Those earlier bytes stand in
 * FRONT of the group, which is where {@link attrlistAllowsIt} tests
 * them; reading them as part of a wider interior hides them from
 * every one of its clauses. An empty interior is no attrlist at all,
 * which is why `[]**c**` renders `[]<strong>c</strong>`.
 *
 * The Ruby this repo vendors (tag v2.0.26) spells the same group inline
 * as `\[([^\]]+)\]` in each row (`QUOTE_SUBS`,
 * asciidoctor.rb l.446-468), an interior that DOES cross a `[`. The
 * two authorities diverge here and the oracle wins: it renders
 * `[\[a]**c**` as `[<strong class="a">*c</strong>*`, the narrow
 * reading, with the escape spent on the group `[a]` and the first `[`
 * left as text.
 * @param head - what stands in front of the sibling list itself
 * @param inFront - the siblings in front of the span, in source order
 * @param role - the span's own parsed attrlist, for the one mark that
 *   has one
 * @returns the run and its left context, or undefined when no attrlist
 *   stands there
 */
function attrlistInFront(
  head: string,
  inFront: readonly InlineNode[],
  role: string | undefined,
): AttrlistInFront | undefined {
  const siblings = head + inFront.map(printedText).join("");
  const text =
    role === undefined
      ? siblings
      : `${siblings}${ATTRLIST_OPEN}${role}${ATTRLIST_CLOSE}`;
  // The group's own `\]` has to be the last byte in front of the
  // delimiter; anything else and no group can end there.
  if (!text.endsWith(ATTRLIST_CLOSE)) return undefined;
  const body = text.slice(0, -1);
  const open = body.lastIndexOf(ATTRLIST_OPEN);
  if (open === -1) return undefined;
  // Everything after the last `[` holds no `[` by construction; a `]`
  // in there is one the interior cannot cross either, and nothing in
  // front of it can open a group that ends at this `]`.
  const interior = body.slice(open + 1);
  return interior === "" || interior.includes(ATTRLIST_CLOSE)
    ? undefined
    : { interior, before: body.slice(0, open) };
}

/**
 * Whether the attrlist standing flush in front of a span leaves the
 * constrained spelling legal. Four independent refusals, each with its
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
 *
 * THE MARK ITSELF IN FRONT OF THE BRACKET. That left clause does not
 * merely test the character, it CONSUMES it - and a match of the same
 * constrained row standing in front of the bracket ends with the mark
 * it closed, so the character this match needed is already spent and
 * the `[` is read as the boundary character instead, the attributes
 * group gone. `[a]**c**[b]**d**` renders two roles and the doubly
 * shortened `[a]*c*[b]*d*` renders
 * `<strong class="a">c</strong>[b]<strong>d</strong>`, the second role
 * lost. Where no such match stands there, the mark is one the
 * constrained row may pair with a delimiter of ours instead, which is
 * the same refusal for the other reason.
 *
 * A BACKSLASH IN FRONT OF THE BRACKET. Only the UNCONSTRAINED rows
 * carry a `\\?` in front of their attributes group (`QUOTE_SUBS`,
 * asciidoctor.rb l.439-468): on those an escaped match is returned as literal text
 * for the later rows to re-read, while the constrained rows have no
 * `\\?` at all and take the backslash through the left clause, where
 * an escaped match keeps its brackets and drops only the escape
 * (`convert_quoted_text`, substitutors.rb l.1419-1426). So the two
 * spellings read the escape differently: `x \[red]**c** y` renders
 * `x <strong class="red">*c</strong>* y` and the shortened
 * `x \[red]*c* y` renders `x [red]<strong>c</strong> y`.
 * @param attrlist - the run and its left context
 * @param mark - the span's own mark character
 * @param front - the mark's own left-boundary class
 * @returns true when no refusal applies
 */
function attrlistAllowsIt(
  attrlist: AttrlistInFront,
  mark: string,
  front: RegExp,
): boolean {
  return (
    !attrlist.interior.includes(mark) &&
    !attrlist.before.endsWith(mark) &&
    !attrlist.before.endsWith(ATTRLIST_ESCAPE) &&
    !front.test(afterSpecialchars(attrlist.before))
  );
}

/**
 * Whether shortening this span would TAKE the boundary character an
 * attrlist behind it needs.
 *
 * `sub_quotes` runs one gsub per row, and a gsub resumes where its
 * last match ended: the constrained row's left clause
 * `(^|[^\p{Word};:}])` consumes a character, so a match of that row
 * ending flush against the next `[` leaves that `[` to be read as the
 * boundary character and the attributes group with nowhere to open.
 * The span asking here is still UNCONSTRAINED, so today its match is
 * on the row in front and takes nothing; shortening moves it onto the
 * row that resolves the span behind, where it takes the character
 * first. Measured: `[red]**c**[b]*d*` renders
 * `<strong class="red">c</strong><strong class="b">d</strong>` and
 * `[red]*c*[b]*d*` renders
 * `<strong class="red">c</strong>[b]<strong>d</strong>`, the second
 * role lost.
 *
 * Only the SAME row can take it. A span behind that is resolved by any
 * other row is matched in a pass of its own, by which time this span
 * is an element and the `]` or `>` in front of its bracket is a
 * boundary character nothing has spent -
 * `[red]**c**[b]**d**` and `[red]**c**[b]_d_` both stay whole.
 * @param node - the span whose shortening is in question
 * @param behind - the siblings behind it, in source order
 * @returns true when the shortening would take that character
 */
function stealsBoundaryBehind(
  node: MarkSpanNode,
  behind: readonly InlineNode[],
): boolean {
  const between: string[] = [];
  for (const sibling of behind) {
    if (!isSpanNode(sibling)) {
      between.push(printedText(sibling));
      continue;
    }
    if (rowKeyOf(sibling) !== MARK_ROW_KEYS[node.type].constrained) {
      return false;
    }
    const run = between.join("");
    // The one mark whose attrlist this parser PARSES rides on the span
    // as a role, so its brackets stand among no siblings at all and
    // flushness is the absence of anything between.
    return (
      FLUSH_ATTRLIST.test(run) ||
      (run === "" && sibling.type === "highlight" && sibling.role !== undefined)
    );
  }
  return false;
}

/**
 * Whether the span's own bytes stand INSIDE a bracketed run that a
 * span BEHIND it takes as its attributes group.
 *
 * The run is that span's attribute VALUE, and the value is text the
 * quote pass has already been over: every row that ran before the one
 * which consumed the run rewrote the bytes inside it, so the class
 * holds a rewrite of the author's spelling rather than the spelling.
 * Respelling a span in there moves it to a different row, and the
 * class then says something else. Measured: `[**a**]*c*` renders
 * `<strong class="<strong>a</strong>">c</strong>` and the shortened
 * `[*a*]*c*` renders `<strong class="*a*">c</strong>`.
 *
 * CONSERVATIVE, in two directions that both only refuse. The run is
 * treated as the following span's group without asking whether that
 * span's own row can still reach it, and without asking whether the
 * inner span's rows run early enough for the rewrite to be the same
 * either way. A refusal keeps the author's bytes, which costs bytes
 * and no meaning.
 * @param head - what stands in front of the sibling list itself
 * @param inFront - the siblings in front of the span, in source order
 * @param behind - the siblings behind the span, in source order
 * @returns true when the span's bytes stand inside such a run
 */
function insideFollowingAttrlist(
  head: string,
  inFront: readonly InlineNode[],
  behind: readonly InlineNode[],
): boolean {
  const front = head + inFront.map(printedText).join("");
  if (!OPEN_BRACKET_RUN.test(front)) return false;
  const span = behind.findIndex((node) => isSpanNode(node));
  if (span === -1) return false;
  const between = behind.slice(0, span).map(printedText).join("");
  return CLOSES_FLUSH.test(between);
}

/**
 * Whether every bracketed run standing around a span leaves the
 * constrained spelling legal - the one entry point the printer asks,
 * over the three refusals above.
 *
 * A `[...]` run flush against a span is never just text: every
 * `QUOTE_SUBS` row carries an optional `(?:\[([^\]]+)\])?` group in
 * front of its opening delimiter (asciidoctor.rb l.446-468), so such a
 * run belongs to whichever row resolves the span it stands against.
 * Three runs can therefore answer for one shortening: the run in FRONT
 * of the span, which moves to the constrained row with it
 * ({@link attrlistAllowsIt}); a run the span stands INSIDE, which is
 * another span's attribute value ({@link insideFollowingAttrlist});
 * and a run BEHIND, whose bracket loses the boundary character it
 * stands on ({@link stealsBoundaryBehind}).
 * @param node - the span whose shortening is in question
 * @param where - where the span sits among the bytes
 * @param where.head - what stands in front of the sibling list itself
 * @param where.siblings - the span's own sibling list
 * @param where.index - the span's position in it
 * @param boundary - the span's own mark and left-boundary class
 * @param boundary.mark - the single mark character it would print
 * @param boundary.front - the mark's left-boundary class
 * @returns true when no run standing around the span refuses it
 */
export function bracketsAllowIt(
  node: MarkSpanNode,
  where: { head: string; siblings: readonly InlineNode[]; index: number },
  boundary: { mark: string; front: RegExp },
): boolean {
  const before = where.siblings.slice(0, where.index);
  const after = where.siblings.slice(where.index + 1);
  const role = node.type === "highlight" ? node.role : undefined;
  const attrlist = attrlistInFront(where.head, before, role);
  return (
    (attrlist === undefined ||
      attrlistAllowsIt(attrlist, boundary.mark, boundary.front)) &&
    !insideFollowingAttrlist(where.head, before, after) &&
    !stealsBoundaryBehind(node, after)
  );
}
