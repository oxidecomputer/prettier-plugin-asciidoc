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
  TextNode,
  CharacterReferenceNode,
  EscapedMarkNode,
  BoldNode,
  ItalicNode,
  MonospaceNode,
  HighlightNode,
  CurvedQuoteNode,
  SuperscriptNode,
  SubscriptNode,
} from "../ast.js";
import {
  MARK_ROW,
  QUOTE_ROW,
  afterSpecialchars,
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

// The two characters {@link resolvesToNoAttribute} reads a run with:
// the separator that ends the first positional attribute, and the
// marker that opens the shorthand role syntax.
const POSITIONAL_SEPARATOR = ",";
const SHORTHAND_ROLE = ".";

// What an attribute reference opens with. A run holding one is
// substituted before it is parsed, so what it names is not a fact this
// tree holds; see {@link writesBareTextBehind}, which refuses on one
// rather than reading it.
const ATTRIBUTE_REFERENCE = "{";

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

/**
 * The opening and closing marks of a formatting span.
 *
 * Constrained marks (`*bold*`) require word boundaries; unconstrained
 * (`**bold**`) work anywhere, including mid-word - and where BOTH are
 * legal they render identically, so the printer writes the
 * constrained one (`constrainedIsLegal` (src/print/inline.ts) decides). A role
 * attribute gives a span semantic meaning used by CSS, e.g.
 * `[.red]#text#` or `[.path]_file_`: it is written as an inline
 * attribute list immediately before the mark, not as a block attribute
 * list, so it is emitted here and not through the block printer. All
 * four mark kinds take one - Ruby's group sits inside all twelve quote
 * rows - and the prefix belongs to the OPEN mark, which is what puts
 * its `[` at the head of the atom the block-start hazard net reads
 * (src/print/block-start-hazard.ts).
 * @param node - the span node.
 * @param constrained - whether to spell it with the single mark.
 * @returns its opening and closing marks.
 */
export function spanMarks(
  node: MarkSpanNode,
  constrained: boolean,
): { open: string; close: string } {
  const single = MARK_ROW[node.type].mark;
  const mark = constrained ? single : `${single}${single}`;
  const rolePrefix = node.role === undefined ? "" : `[${node.role}]`;
  return { open: `${rolePrefix}${mark}`, close: mark };
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
  const { constrained, unconstrained } = MARK_ROW[node.type];
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

// A neighbour that prints exactly its own `value` and nothing else.
// Every other non-span kind answers `undefined` to both edge
// questions, not because its bytes are unknowable but because they
// are assembled elsewhere (serialize-inline.ts) and a boundary read
// off a reassembly is a second source of truth.
type OwnValueNode = TextNode | CharacterReferenceNode | EscapedMarkNode;

/**
 * Whether a neighbour's printed bytes are its own `value`.
 *
 * One predicate rather than the same disjunction written into both
 * edge functions, because the two must never disagree about which
 * kinds they can read. The ESCAPED MARK is here and not among the
 * kinds that answer `undefined`: `\*` prints the two characters it
 * holds, and they are the characters that stood in the text run this
 * node was carved out of, so reading them keeps every respelling
 * decision beside one exactly where it was before the node existed.
 * @param node - the neighbour being read
 * @returns whether its `value` is what it prints
 */
function hasOwnValue(node: InlineNode): node is OwnValueNode {
  return (
    node.type === "text" ||
    node.type === "characterReference" ||
    node.type === "escapedMark"
  );
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
  if (hasOwnValue(neighbour)) {
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
  if (hasOwnValue(neighbour)) {
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
 *
 * TWIN of {@link rowText}, which walks the same node shapes and
 * differs only in how it renders a span whose row has already run.
 * A node kind that needs a case here needs one there too.
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
 * What stands in front of a span's sibling list - and, just as much,
 * whether anything stands in front of THAT which this tree cannot
 * see.
 *
 * At the head of a block the answer is complete: nothing at all
 * stands in front, and no clause can be surprised by bytes it did not
 * read. Inside a span the list's own front is the enclosing span's
 * edge, and the document goes on to the left of it - the enclosing
 * span's siblings, its own attrlist, the text in front of those. The
 * refusals read the bytes a ROW reads, and that row reads straight
 * through an enclosing span's boundary, so the two cases are not the
 * same fact with a different string in it: one is a whole answer and
 * the other is a truncated one. See {@link closesGroupFromOutside}
 * for the clause that turns on the difference.
 */
export type HeadContext =
  | {
      /** Nothing stands in front of the list, and nothing is hidden. */
      readonly kind: "blockStart";
    }
  | {
      /** An enclosing span's edge stands in front, and more beyond it. */
      readonly kind: "spanEdge";
      /**
       * The enclosing span's own edge as the asking row reads it:
       * the element boundary its rewrite wrote where that row has
       * already run, and its literal opening delimiter where it has
       * not (`headContext`, src/print/inline.ts).
       */
      readonly edge: string;
    };

/**
 * The bytes a head context puts in front of the sibling list. The
 * block head writes none.
 * @param head - what stands in front of the list
 * @returns those bytes
 */
export function headBytes(head: HeadContext): string {
  return head.kind === "blockStart" ? "" : head.edge;
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
 * A MARK span's attrlist is parsed (`rules.ts`'s `RoleAttribute` row,
 * which fires in front of the four mark delimiters and nowhere else)
 * and rides on the span as its role, so the printer writes the
 * brackets itself. In front of a curved, superscript or subscript
 * span the same bytes are ordinary text that Ruby reads as a role all
 * the same, so there the run is recovered from what those siblings
 * PRINT. Both are answered by the same scan over the bytes the
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
  head: HeadContext,
  inFront: readonly InlineNode[],
  role: string | undefined,
): AttrlistInFront | undefined {
  return attrlistEnding(
    frontText(head, inFront.map(printedText).join(""), role),
  );
}

/**
 * The bytes in front of a span's opening delimiter: what stands in
 * front of the sibling list, then the siblings, then the brackets the
 * printer writes for the span's own parsed role.
 * @param head - what stands in front of the sibling list itself
 * @param siblings - the siblings in front, already rendered to text
 * @param role - the span's own parsed attrlist, when it has one
 * @returns the whole run in front of the delimiter
 */
function frontText(
  head: HeadContext,
  siblings: string,
  role: string | undefined,
): string {
  const front = `${headBytes(head)}${siblings}`;
  return role === undefined
    ? front
    : `${front}${ATTRLIST_OPEN}${role}${ATTRLIST_CLOSE}`;
}

/**
 * The attributes group ENDING at the last byte of a run, or undefined
 * when none does. The one scan, so the two views that ask it
 * ({@link attrlistInFront} and {@link inventsAttrlistInFront}) cannot
 * read a group differently.
 * @param text - the bytes standing in front of a span's delimiter
 * @returns the group and its left context, or undefined
 */
function attrlistEnding(text: string): AttrlistInFront | undefined {
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
 * What a node standing in front of a span looks like to the row that
 * would resolve the SHORTENED span - the bytes {@link printedText}
 * gives, with every span an earlier row has already replaced written
 * as the element that replaced it.
 *
 * The distinction only matters for the BRACKETS. A span's own
 * delimiters and its role's own brackets are consumed by the row that
 * resolves it: the role becomes an HTML attribute's value, so its `[`
 * and `]` are gone from the text the next row reads, while the span's
 * CONTENT stands on in the element between the tags. Which rows count
 * as earlier is the shortening's own question: it moves the span onto
 * its constrained row, and every row up to and including its own
 * unconstrained row (`askingOrder`) runs in front of that one.
 *
 * TWIN of {@link printedText}, which walks the same node shapes and
 * differs only in this one rendering. A node kind that needs a case
 * there needs one here too.
 * @param node - a node standing in front of the span
 * @param askingOrder - the asking span's unconstrained row index
 * @returns the bytes that row reads where this node stands
 */
function rowText(node: InlineNode, askingOrder: number): string {
  if (!isSpanNode(node)) return printedText(node);
  const row = QUOTE_ROW[rowKeyOf(node)];
  if (row.order > askingOrder) return printedText(node);
  const content = node.children
    .map((child) => rowText(child, askingOrder))
    .join("");
  return `${row.opensWith}${content}${row.closesWith}`;
}

/**
 * Whether shortening the span would hand it an attributes group it
 * does not have - a group that opens only once the rows in front have
 * rewritten the bytes it is made of.
 *
 * The unconstrained row reads the author's own bytes, where a `[`
 * standing before another span's brackets opens nothing: the interior
 * would have to cross them. The constrained row runs one row later,
 * with that span already replaced by an element carrying no brackets
 * at all, and the same `[` then reaches the `]` flush against our
 * delimiter. Measured: `[a[b]**c**]**f**` renders
 * `[a<strong class="b">c</strong>]<strong>f</strong>` and the
 * shortened `[a[b]**c**]*f*` renders
 * `<strong class="a<strong class="b">c</strong>">f</strong>` - the
 * bracketed text swallowed into a class, and the `[a` and `]` gone
 * from the document.
 *
 * Asked by {@link bracketsAllowIt} only where the author's own bytes
 * open NO group: where they do, the group is the span's own and
 * {@link attrlistAllowsIt} is the clause that answers for it.
 * @param head - what stands in front of the sibling list itself
 * @param inFront - the siblings in front of the span, in source order
 * @param role - the span's own parsed attrlist, when it has one
 * @param askingOrder - the asking span's unconstrained row index
 * @returns true when the shortening would open a group
 */
function inventsAttrlistInFront(
  head: HeadContext,
  inFront: readonly InlineNode[],
  role: string | undefined,
  askingOrder: number,
): boolean {
  const rewritten = inFront.map((node) => rowText(node, askingOrder)).join("");
  const text = frontText(head, rewritten, role);
  return (
    attrlistEnding(text) !== undefined || closesGroupFromOutside(head, text)
  );
}

/**
 * Whether a group could open at a `[` this tree cannot see.
 *
 * {@link attrlistEnding} answers over the bytes it was given, and
 * inside a span those bytes stop at the enclosing span's edge while
 * the row reading them does not: a `[` standing OUTSIDE the enclosing
 * span reaches a `]` inside it just as readily, because the row is a
 * regex over the whole line and an enclosing span's own delimiters
 * are gone from the text by the time a later row runs. Where the
 * visible bytes end in a `]` and hold no `[` of their own, the group
 * that `]` would close can only have opened out there, so the
 * shortening cannot be shown to be safe and the span keeps its
 * bytes.
 *
 * CONSERVATIVE, deliberately: this answers true for a `]` whose `[`
 * does not exist at all, where the shortening would in fact have been
 * legal. The rows it costs are labelled in
 * tests/format/inline-role-prefix.test.ts, under "a group may open at
 * a bracket outside the enclosing span". The direction that corrupts
 * is the other one, and the bytes that would rule it out do not reach
 * this function; most of the cost is recoverable from bytes that DO
 * reach the printer (the block's own nodes say whether the document
 * writes any `[` at all), which is issue #141.
 * @param head - what stands in front of the sibling list
 * @param text - the bytes in front of the span's delimiter
 * @returns true when a group may close here from outside
 */
function closesGroupFromOutside(head: HeadContext, text: string): boolean {
  return (
    head.kind === "spanEdge" &&
    text.endsWith(ATTRLIST_CLOSE) &&
    !text.includes(ATTRLIST_OPEN)
  );
}

/**
 * Whether the attrlist standing flush in front of a span leaves the
 * constrained spelling legal. Three independent refusals, each with
 * its own witness.
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
 *
 * An ESCAPE moves a span behind onto that same row. Only the
 * unconstrained rows carry a `\\?` in front of their attributes group
 * (`QUOTE_SUBS`, asciidoctor.rb l.446-468), so a span written
 * `\[a]##c##` is matched by its own unconstrained row and handed back
 * as literal text with the escape dropped (`convert_quoted_text`,
 * substitutors.rb l.1419-1426); the row that then resolves it is the
 * CONSTRAINED row of the same mark. The backslash is therefore not
 * something standing between the two spans - the pass that removes it
 * is the pass that would have read the group, which ends up flush
 * behind the shortened match. Measured: `##a##\[ ]##c##` renders
 * `<mark>a</mark>#c#` and `#a#\[ ]##c##` renders
 * `<mark>a</mark>[ ]<mark>#c</mark>#`.
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
    const run = between.join("");
    const rows = MARK_ROW[node.type];
    // A mark span's attrlist is PARSED and rides on the span as its
    // role, so its brackets stand among no siblings at all and
    // flushness is the absence of anything between - or, for the
    // escaped spelling, of nothing but the escape the row eats.
    const carriesRole = isMarkSpanNode(sibling) && sibling.role !== undefined;
    if (rowKeyOf(sibling) === rows.constrained) {
      return FLUSH_ATTRLIST.test(run) || (run === "" && carriesRole);
    }
    return rowKeyOf(sibling) === rows.unconstrained
      ? run === ATTRLIST_ESCAPE && carriesRole
      : false;
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
 * CONSERVATIVE, in three directions that all only refuse. The run is
 * treated as the following span's group without asking whether that
 * span's own row can still reach it, and without asking whether the
 * inner span's rows run early enough for the rewrite to be the same
 * either way; and where the span sits inside another one, a run this
 * tree cannot see is treated as open ({@link runMayBeOpen}). A
 * refusal keeps the author's bytes, which costs bytes and no meaning.
 * @param head - what stands in front of the sibling list itself
 * @param inFront - the siblings in front of the span, in source order
 * @param behind - the siblings behind the span, in source order
 * @returns true when the span's bytes stand inside such a run
 */
function insideFollowingAttrlist(
  head: HeadContext,
  inFront: readonly InlineNode[],
  behind: readonly InlineNode[],
): boolean {
  const front = headBytes(head) + inFront.map(printedText).join("");
  if (!runMayBeOpen(head, front)) return false;
  const span = behind.findIndex((node) => isSpanNode(node));
  if (span === -1) return false;
  const between = behind.slice(0, span).map(printedText).join("");
  return CLOSES_FLUSH.test(between);
}

/**
 * Whether a bracketed run may be standing open where the span does:
 * one the visible bytes open, or one that opened at a `[` OUTSIDE an
 * enclosing span, which this tree cannot see.
 *
 * A row is a regex over the whole line and reads straight through an
 * enclosing span's boundary, so `[a` written in front of an enclosing
 * `**...**` is as open inside it as it would be outside. What the
 * visible bytes can still settle is the CLOSE: a `]` among them ends
 * any run that reached this far, whatever opened it, so only a front
 * with no `]` of its own leaves the question open.
 *
 * CONSERVATIVE in the second clause, on the same terms as
 * {@link closesGroupFromOutside} and recoverable the same way (issue
 * #141): a front with no `]` is treated as standing inside a run even
 * where the document opens none. This is the clause that keeps
 * `*__a__]__c__ z*` whole, and the rows it costs are labelled in
 * tests/format/inline-role-prefix.test.ts, under "a group may open at
 * a bracket outside the enclosing span".
 * @param head - what stands in front of the sibling list
 * @param front - the visible bytes in front of the span
 * @returns true when a run may be open here
 */
function runMayBeOpen(head: HeadContext, front: string): boolean {
  return (
    OPEN_BRACKET_RUN.test(front) ||
    (head.kind === "spanEdge" && !front.includes(ATTRLIST_CLOSE))
  );
}

/**
 * Whether an attrlist run resolves to NEITHER an id NOR a role - the
 * one case in which the row that takes the run writes no element.
 *
 * `convertQuotedText` turns a `mark` into an `unquoted` the moment any
 * attrlist stands in front of it
 * (`node_modules/@asciidoctor/core/build/node/index.cjs` l.20922-20950),
 * and an `unquoted` naming neither attribute converts to its own text
 * and nothing more. So one span is spelled three ways with three
 * different renders: `##c##` is `<mark>c</mark>`, `[a]##c##` is
 * `<span class="a">c</span>`, and `[ ]##c##` is a bare `c`.
 *
 * `parseQuotedTextAttributes` (l.20981) reads only the FIRST
 * positional attribute and trims it; a leading `.` then opens the
 * shorthand role syntax (`Compliance.shorthandPropertySyntax`, on by
 * default), where the dots separating the roles become spaces and the
 * result is trimmed at its head. An empty run names nothing either
 * way. Measured against the oracle, in front of `##c##`: `[ ]`,
 * `[,]`, `[.]`, `[..]`, `[...]` and `[ ,a]` all render a bare `c`,
 * while `[a]`, `[.r]`, `[.a.b]`, `[a,b]` and `[x.y]` all render an
 * element.
 *
 * DOMAIN: a run holding no `#` and no attribute reference. Neither is
 * modelled and neither can arrive. A `#` would open the shorthand ID
 * syntax, and it is also the highlight mark, so a role holding one
 * refuses the shortening a whole clause earlier, in the block-wide
 * scan (`carriesMark`, src/print/inline.ts) - the only caller
 * ({@link writesBareTextBehind}) is reached for a highlight and for
 * nothing else. A reference is substituted before it is parsed, and
 * that caller refuses on one without asking here.
 * @param run - the interior of the attrlist's brackets, holding
 *   neither a `#` nor an attribute reference
 * @returns true when the run names neither attribute
 */
function resolvesToNoAttribute(run: string): boolean {
  const comma = run.indexOf(POSITIONAL_SEPARATOR);
  const positional = (comma === -1 ? run : run.slice(0, comma)).trim();
  if (!positional.startsWith(SHORTHAND_ROLE)) return positional === "";
  return positional.slice(1).split(SHORTHAND_ROLE).join(" ").trimStart() === "";
}

/**
 * Whether the span BEHIND is one whose own row replaces it with BARE
 * TEXT, putting that text's first character where the shortened
 * closing mark needs a boundary.
 *
 * Only a HIGHLIGHT can be asking and only a highlight can be behind,
 * and the rows are why. Shortening moves the asking span onto its
 * constrained row, and the row that runs directly in front of it is
 * the same mark's UNCONSTRAINED row - so a neighbour that row
 * resolves is already its replacement where the constrained clause
 * reads it, while a neighbour resolved by any other row is either
 * still literal or an element either way. Highlight is the one mark
 * whose replacement can be neither: an attrlist naming no attribute
 * leaves the oracle writing the span's own text
 * ({@link resolvesToNoAttribute}). Measured: `##a##[ ]##c##` renders
 * `<mark>a</mark>c` and the shortened `#a#[ ]##c##` renders `#a#c`,
 * the first span destroyed, because `[ ]##c##` has become `c` by the
 * time the constrained row looks behind `#a#`.
 *
 * The BYTES the neighbour's content prints answer the boundary clause
 * directly. Every row that runs before this one replaces what it
 * matches with an element or an entity, whose first character is `<`
 * or `&`, and leaves everything else standing - so no earlier row can
 * turn a word character at the head of that content into anything
 * else, or anything else into a word character, and the printed head
 * is as good as the rewritten one for this one question.
 *
 * An ATTRIBUTE REFERENCE in the run is refused without being read:
 * the run is substituted before it is parsed, so whether the element
 * survives is not a fact this tree holds, and refusing costs bytes and
 * no meaning.
 *
 * The mirror hazard - a bared neighbour in FRONT, putting a word
 * character where the LEFT clause reads - needs no twin of this
 * function, and the reason is worth writing down because it is not
 * this rule's own. Such a neighbour flush in front presents its
 * closing `##` (or `#`) to `edgeTail`, which the caller's
 * "no same mark may abut either delimiter" clause refuses ahead of
 * this one; with anything standing between, that something is the
 * neighbour both models read. If that abutting clause is ever
 * narrowed, the front side needs its own answer here.
 * @param node - the span whose shortening is in question
 * @param behind - the siblings behind it, in source order
 * @param behindClass - the mark's own right-boundary class
 * @returns true when the shortening would leave that text there
 */
function writesBareTextBehind(
  node: MarkSpanNode,
  behind: readonly InlineNode[],
  behindClass: RegExp,
): boolean {
  if (node.type !== "highlight" || behind.length === 0) return false;
  const [next] = behind;
  if (next.type !== "highlight" || next.constrained) return false;
  const { role } = next;
  if (role === undefined) return false;
  const bared =
    role.includes(ATTRIBUTE_REFERENCE) || resolvesToNoAttribute(role);
  if (!bared) return false;
  return behindClass.test(next.children.map(printedText).join(""));
}

/**
 * Whether every bracketed run standing around a span leaves the
 * constrained spelling legal - the one entry point the printer asks,
 * over the five refusals above.
 *
 * A `[...]` run flush against a span is never just text: every
 * `QUOTE_SUBS` row carries an optional `(?:\[([^\]]+)\])?` group in
 * front of its opening delimiter (asciidoctor.rb l.446-468), so such a
 * run belongs to whichever row resolves the span it stands against.
 * Five questions can therefore answer for one shortening. Two are
 * about the run in FRONT: whether the group standing there survives
 * the move to the constrained row ({@link attrlistAllowsIt}), and
 * whether the move OPENS a group the author's bytes do not
 * ({@link inventsAttrlistInFront}). One is about the run the span
 * stands INSIDE, which is another span's attribute value
 * ({@link insideFollowingAttrlist}). Two are about what stands
 * BEHIND: a bracket that loses the boundary character it stands on
 * ({@link stealsBoundaryBehind}), and a run naming no attribute at
 * all, which costs the span behind its element and bares its text
 * ({@link writesBareTextBehind}).
 * @param node - the span whose shortening is in question
 * @param where - where the span sits among the bytes
 * @param where.head - what stands in front of the sibling list itself
 * @param where.siblings - the span's own sibling list
 * @param where.index - the span's position in it
 * @param boundary - the span's own mark and boundary classes
 * @param boundary.mark - the single mark character it would print
 * @param boundary.front - the mark's left-boundary class
 * @param boundary.behind - the mark's right-boundary class
 * @returns true when no run standing around the span refuses it
 */
export function bracketsAllowIt(
  node: MarkSpanNode,
  where: {
    head: HeadContext;
    siblings: readonly InlineNode[];
    index: number;
  },
  boundary: { mark: string; front: RegExp; behind: RegExp },
): boolean {
  const before = where.siblings.slice(0, where.index);
  const after = where.siblings.slice(where.index + 1);
  const attrlist = attrlistInFront(where.head, before, node.role);
  const { order } = QUOTE_ROW[rowKeyOf(node)];
  return (
    // Exactly one of the two clauses answers for the run in FRONT: a
    // group standing there is the span's own, and where none does the
    // question is whether shortening opens one.
    (attrlist === undefined
      ? !inventsAttrlistInFront(where.head, before, node.role, order)
      : attrlistAllowsIt(attrlist, boundary.mark, boundary.front)) &&
    !insideFollowingAttrlist(where.head, before, after) &&
    !stealsBoundaryBehind(node, after) &&
    !writesBareTextBehind(node, after, boundary.behind)
  );
}
