/**
 * The declared rules: every respelling the printer is licensed to
 * make, each one stating what it matches, why it preserves meaning,
 * what pins it, and which reduction-order component it decreases.
 *
 * This is the printer's counterpart of src/parse/line-shapes.ts. There
 * the reader's decisions are an index: one row per line shape, cited
 * to the Ruby that decides it, so nothing classifies a line off to the
 * side. Here the printer's byte CHANGES are the index: one entry per
 * rule, and `Emission` (src/print/emission.ts) is what keeps the index
 * honest, because a respelling that is not one of these entries cannot
 * be expressed.
 *
 * ONE rule lives here so far - the doubled-mark respell. Every other
 * emission path still writes its bytes directly and joins as its axis
 * is touched; see the migration note in src/print/emission.ts.
 */
import type { InlineNode } from "../ast.js";
import { MARK_BOUNDARY, QUOTE_ROW } from "../parse/inline/quote-boundaries.js";
import { verbatimText } from "./serialize-inline.js";
import {
  addressSwallowsAMark,
  bracketsAllowIt,
  delimitersOf,
  edgeHead,
  edgeTail,
  headBytes,
  isMarkSpanNode,
  isSpanNode,
  rowKeyOf,
  spanMarks,
  type HeadContext,
  type MarkSpanNode,
  type SpanNode,
} from "./span-edges.js";
import { HARD_BREAK_IMAGE } from "./reflow.js";
import type { Cursor } from "./atom-join.js";
import { declareRule, replay, type Emission } from "./emission.js";

/** The two delimiters a span writes around its content. */
interface SpanDelimiters {
  /** The opening delimiter, role prefix included. */
  readonly open: string;
  /** The closing delimiter. */
  readonly close: string;
}

/**
 * One span about to be spelled: the node, where it sits, and the two
 * facts about its own printed content that the respelling reads.
 *
 * Assembled once by the caller that has all four
 * (`appendSpan`, src/print/inline.ts) rather than threaded to the rule
 * a parameter at a time.
 */
export interface SpanSite {
  /** The span whose delimiters are being spelled. */
  readonly node: SpanNode;
  /** Where it sits among its siblings, and in which block. */
  readonly cursor: Cursor;
  /** True when neither content edge carries whitespace. */
  readonly flush: boolean;
  /** The texts of the atoms the span's content produced, in order. */
  readonly texts: readonly string[];
}

/**
 * The doubled-mark respell: an UNCONSTRAINED formatting span whose
 * neighbourhood leaves Ruby's constrained pattern legal prints with
 * the single mark.
 *
 * {@link constrainedIsLegal} is the match shape, and its doc is the
 * argument for every refusal.
 *
 * Not exported: the declaration reaches a reader through the emission
 * {@link spanDelimiters} answers with, which is the same way the
 * printer sees it, so there is no second route to the rule and nothing
 * to keep in step with one.
 */
const DOUBLED_MARK_RESPELL = declareRule<SpanSite, SpanDelimiters>(
  {
    id: "doubled-mark respell",
    matches:
      "an unconstrained span (`**b**`) whose content is flush against its marks and whose block leaves the constrained pattern's three clauses satisfied",
    licence:
      "the constrained rows of `QUOTE_SUBS` (asciidoctor.rb l.448-464): where the boundary clauses hold, `**b**` and `*b*` both render `<strong>b</strong>` - measured for all four mark kinds",
    pins: [
      "tests/conformance/confluence.test.ts (the inlineSpelling rows, in every reader state)",
      "tests/conformance/inline-sweep.test.ts",
      "tests/format/inline-boundary.test.ts (the refusals, one document each)",
      "tests/conformance/reduction-order.test.ts (the strict decrease)",
    ],
    decreases:
      "redundant syntax - the third component, `redundantSyntax`, which counts an unconstrained inline mark where the constrained one suffices (tests/conformance/reduction-order.ts)",
  },
  (site) => {
    const { node, cursor, flush, texts } = site;
    // The two halves of the match shape, in front of the decision: a
    // span with only ONE spelling has nothing to respell, and a span
    // the author already wrote constrained is already the short form.
    return isMarkSpanNode(node) &&
      !node.constrained &&
      constrainedIsLegal(node, cursor, { flush, texts })
      ? spanMarks(node, true)
      : undefined;
  },
);

/**
 * THE CHOKEPOINT: the delimiters a span prints.
 *
 * Two arms and no third: the spelling the source recorded, or the one
 * a declared rule licensed. The printer takes the bytes out of the
 * emission and never chooses them, which is what makes "these marks
 * changed because a rule said so" a fact of the types rather than of
 * the review.
 * @param site - the span and everything the rules read about it.
 * @returns the delimiters, with the licence they were written under.
 */
export function spanDelimiters(site: SpanSite): Emission<SpanDelimiters> {
  return DOUBLED_MARK_RESPELL.apply(site) ?? replay(delimitersOf(site.node));
}

/**
 * Whether a raw line stands anywhere inside these nodes, at any depth.
 *
 * At ANY depth, because the fact the raw line stands for is about the
 * span's EXTENT in the source and not about its child list: the oracle
 * deletes the line before the quote pass, so every character of the
 * joined text this span covers is shifted by it, however deeply the
 * tree nests the line. A test of the direct children alone made the
 * respell depend on tree DEPTH - `a **b` / `// c` / `d** e` kept its
 * wide spelling while `**a __b` / `// c` / `c__ d** e` shortened the
 * outer span, for no reason either document can show.
 *
 * It is deliberately CONSERVATIVE rather than exact: a mid-content raw
 * line does not touch the content edges the constrained row tests, so
 * some of these spans could legally shorten. Refusing costs bytes and
 * no meaning, and the exact answer would need the joined text, which
 * the printer does not have.
 * @param nodes - a span's content, or a nested span's
 * @returns true when any descendant is a raw line
 */
function holdsARawLine(nodes: readonly InlineNode[]): boolean {
  return nodes.some(
    (node) =>
      node.type === "rawLine" ||
      ("children" in node && holdsARawLine(node.children)),
  );
}

/**
 * Whether an UNCONSTRAINED span may be respelled with the constrained
 * mark — the same question Ruby's constrained pattern asks, read off
 * the tree the printer is about to write.
 *
 * Ruby's constrained quote regexes (the `QUOTE_SUBS` table,
 * asciidoctor.rb l.448-464 — NOT rx.rb, which declares no quote
 * pattern) are
 * `(^|[^\w;:}])(?:\[…\])?\*(\S|\S.*?\S)\*(?!\w)`: the character in
 * front may not be a word character, `;`, `:` or `}`; the content may
 * not begin or end with whitespace; and no word character may follow
 * the closing mark. Where all three hold, `**b**` and `*b*` render the
 * same `<strong>b</strong>` — measured for all four span kinds —
 * so the shorter spelling is the canonical one and the longer one is
 * residue.
 *
 * Four places this can refuse a shortening. Two of them DERIVE the
 * answer from what actually stands beside the span (span-edges.ts's
 * row facts); the other two stay deliberately CONSERVATIVE, always
 * refusing, each costing bytes and no meaning:
 *
 * - DERIVED: a NEIGHBOUR whose printed bytes are not this function's
 *   to predict answers no - a macro, a link, an xref, an anchor, a
 *   passthrough, a raw line or a hard break (edgeTail/edgeHead,
 *   span-edges.ts); anything else, a text run or another span, gets
 *   its real edge read off that row - measured: `a **b**__c__ d`
 *   formats to `a **b**_c_ d`, the italic shortening against the
 *   bold's derived edge while the bold keeps its wide spelling,
 *   render-equal;
 * - DERIVED: a span NESTED inside another reads what stands beside it
 *   AS ITS OWN ROW SEES IT (span-edges.ts), which may be the enclosing
 *   span's own delimiter or a sibling of the enclosing span's:
 *   `__*b*__` still answers no, because emphasis's row runs after
 *   strong's, so the enclosing `_` is still literal text where
 *   strong's row reads it, but `x "`b __a__`" y` shortens the inner
 *   emphasis, because the character in front of it is `b`'s own
 *   trailing space, not a mark;
 * - CONSERVATIVE: CONTENT carrying the mark character answers no -
 *   the constrained pattern is non-greedy and would end the span
 *   early;
 * - CONSERVATIVE: a stray mark character ANYWHERE ELSE in the
 *   paragraph answers no ({@link carriesMark}). Shortening a span
 *   exposes its marks to the constrained pass, which scans the whole
 *   line: the corpus's `[[[_1984]]] George Orwell. __1984__.` renders
 *   differently the moment the emphasis shortens, because the `_`
 *   inside the bibliography anchor becomes an opening mark.
 *
 * - CONSERVATIVE: a RAW LINE among the children answers no. The
 *   oracle DELETES such a line before the quote pass runs, so the
 *   characters beside the marks in the RENDERED text are not the ones
 *   this function can see, and the two spellings do not agree about
 *   them: the unconstrained rows test no boundary at all, while the
 *   constrained one demands `(\S|\S.*?\S)`, non-whitespace at both
 *   content edges of the joined text. `a **b` / `// c` / `** d`
 *   renders `a <strong>b\n</strong> d`, and the same span shortened
 *   renders its marks literally - the content the constrained row
 *   would read is `b\n`, whose last character is the newline the
 *   comment line hid from the atoms this function is handed.
 * @param node - the unconstrained span
 * @param cursor - where it sits among its siblings
 * @param content - the span's own facts: whether its content is flush
 *   against the marks, and the atom texts it will print
 * @param content.flush - true when neither edge carries whitespace
 * @param content.texts - the inner atoms' texts
 * @returns true when the constrained spelling carries the same meaning
 */
function constrainedIsLegal(
  node: MarkSpanNode,
  cursor: Cursor,
  content: { flush: boolean; texts: readonly string[] },
): boolean {
  if (!content.flush) {
    return false;
  }
  // A raw line anywhere inside answers no: the doc above says why the
  // atoms cannot show what the constrained row would read.
  if (holdsARawLine(node.children)) {
    return false;
  }
  // Content ENDING in a hard line break answers no: the closing mark
  // detaches onto its own line (appendSpan) so the ` +` keeps the line
  // end that makes it a break, and a SINGLE mark alone at column 0
  // with text behind it is a list marker - `a **b +\n** c` respelled
  // constrained would write `* c`. The doubled mark is no marker.
  if (content.texts.at(-1) === HARD_BREAK_IMAGE) {
    return false;
  }
  const mark = spanMarks(node, true).close;
  if (content.texts.some((text) => text.includes(mark))) {
    return false;
  }
  // A bare address whose match reaches either mark answers no: that
  // mark stands inside the address's own match when the document is
  // read again, and only the doubled spelling is one the reader
  // recovers there (`addressSwallowsAMark`, span-edges.ts says why).
  // `` ``a http://e.com``,``<TAB>`` `` is the document that says so -
  // shortened, its second code span is gone on the next pass and the
  // tab it sheltered folds.
  if (addressSwallowsAMark(node, cursor.siblings.slice(0, cursor.index))) {
    return false;
  }
  // The BLOCK, not the siblings: shortening a span exposes its marks to
  // a pass that scans the whole LINE, and a span nested inside another
  // one has only its parent's content as siblings. Measured, on
  // `x [[[_a]]] "`b __c__`" y`: the emphasis's siblings are the curved
  // span's content, the bibliography anchor is outside it, and
  // shortening the emphasis makes the anchor's `_` an opening mark - the
  // anchor is destroyed and the emphasis crosses it.
  if (cursor.blockNodes.some((sibling) => carriesMark(sibling, mark, node))) {
    return false;
  }
  return neighboursAllowIt(node, cursor);
}

/**
 * The two boundary clauses of the constrained pattern, read off what
 * stands beside the span AS ITS OWN ROW SEES IT (span-edges.ts).
 *
 * At the edge of an enclosing span the neighbour is that span's own
 * delimiter, which is why the enclosing node and not a boolean rides on
 * the cursor: `x "`__a__`" y` may not shorten (the curved row already
 * wrote `&#8220;`, whose `;` the front clause excludes) while
 * `x "`b __a__`" y` may (a space stands there), and the two differ only
 * in what the neighbour is.
 *
 * The bracketed runs standing around the span are a separate question
 * with its own three refusals ({@link bracketsAllowIt}).
 * @param node - the span being considered
 * @param cursor - where the span sits
 * @returns true when the span's whole neighbourhood leaves the
 *   constrained form legal
 */
function neighboursAllowIt(node: MarkSpanNode, cursor: Cursor): boolean {
  const { front, behind } = MARK_BOUNDARY[node.type];
  // This function is only ever asked about a span still spelled
  // UNCONSTRAINED, so its own row is also the EARLIEST row that can
  // read the single marks the shortening would leave behind. A
  // neighbour whose own delimiter this reports (rather than its row's
  // element boundary) is therefore a delimiter that is still a literal
  // mark where those single marks would stand.
  const { order } = QUOTE_ROW[rowKeyOf(node)];
  const inFront = frontNeighbour(cursor, order);
  const behindIt = behindNeighbour(cursor, order);
  if (inFront === undefined || behindIt === undefined) {
    return false;
  }
  // NO SAME MARK MAY ABUT EITHER DELIMITER. Ruby's boundary clauses
  // permit one - a mark character is not a word character - but the
  // UNCONSTRAINED row of this same mark runs in front of the
  // constrained one and pairs a DOUBLED delimiter, so a single mark
  // written flush against another one is a `**` that row takes.
  // Measured: `[**a***]**c*` is `[` + `**a**` + `*]*` + `*c*`, and
  // shortening the first span writes `[*a**]**c*`, whose junction of
  // two constrained spans the unconstrained row reads as a span of its
  // own - `<strong>a<strong>]</strong>c</strong>` where the source has
  // `<strong class="<strong>a</strong>*">*c</strong>`. `**a****b**`
  // (issue #83) is the same hazard between two unconstrained spans.
  const mark = spanMarks(node, true).close;
  if (inFront.endsWith(mark) || behindIt.startsWith(mark)) {
    return false;
  }
  const head = headContext(cursor, order);
  const { siblings, index } = cursor;
  if (
    !bracketsAllowIt(node, { head, siblings, index }, { mark, front, behind })
  ) {
    return false;
  }
  return !front.test(inFront) && !behind.test(behindIt);
}

/**
 * What stands in front of the span: the previous sibling's tail, the
 * enclosing span's OWN edge at index 0 inside a span, or the empty
 * string at the head of a block (which no `$`-anchored class can
 * match, so it is legal).
 *
 * At index 0, the enclosing's edge is not simply its raw opening
 * delimiter: where the enclosing's own row has already run
 * (`row.order < order`), the whole match - open, content and close -
 * was rewritten as one unit, and what stands beside our content is the
 * LAST character of what that rewrite's OPEN side wrote, which for
 * every one of the five spans is the same character its CLOSE side
 * ends with too (`</strong>` and `<strong>` both end `>`, `&#8221;`
 * and `&#8220;` both end `;`) - {@link QUOTE_ROW}'s `closesWith`.
 * Measured: `x "`__a__`" y` does not shorten (`;` is excluded) while
 * `x "`b __a__`" y` does (a space stands there instead, read off the
 * PRECEDING SIBLING, not the enclosing edge - the two rows differ only
 * in whether index 0 is reached at all).
 * @param cursor - where the span sits
 * @param order - the asking span's row index
 * @returns the text the front clause tests, or undefined to refuse
 */
function frontNeighbour(cursor: Cursor, order: number): string | undefined {
  return cursor.index > 0
    ? edgeTail(cursor.siblings[cursor.index - 1], order)
    : headBytes(headContext(cursor, order));
}

/**
 * What stands in front of the sibling LIST - the enclosing span's own
 * edge, or the empty string at the head of a block.
 *
 * Split out of {@link frontNeighbour} because two questions need it and
 * only one of them is about the span's immediate neighbour: an attrlist
 * flush in front of a span can begin at the head of the list, and then
 * what the row's left clause reads is this and not a sibling's tail.
 * TOTAL where `frontNeighbour` is not: the head of a block is always
 * knowable, and only a SIBLING can be a node whose bytes are not ours
 * to predict.
 * @param cursor - where the span sits
 * @param order - the asking span's row index
 * @returns the text in front of the first sibling
 */
function headContext(cursor: Cursor, order: number): HeadContext {
  const { enclosing } = cursor;
  if (enclosing === undefined) {
    return { kind: "blockStart" };
  }
  const row = QUOTE_ROW[rowKeyOf(enclosing)];
  return {
    kind: "spanEdge",
    edge: row.order < order ? row.closesWith : delimitersOf(enclosing).open,
  };
}

/**
 * What stands behind the span, mirroring {@link frontNeighbour}: the
 * next sibling's head, the enclosing span's own edge at the LAST index
 * inside a span, or the empty string at the tail of a block.
 *
 * The already-run branch reads `opensWith` rather than `closesWith` -
 * the mirror image of {@link frontNeighbour}'s reasoning: what stands
 * right behind our content is the FIRST character of what the
 * enclosing's CLOSE side wrote, which is the same character its OPEN
 * side starts with too (`<strong>` and `</strong>` both start `<`,
 * `&#8220;` and `&#8221;` both start `&`). Neither of those two
 * characters is ever excluded on the BEHIND side of any of the four
 * marks (only the FRONT side excludes `;`/`:`/`}`), so this branch is
 * unconditionally permissive in this codebase's five span kinds - a
 * fact {@link constrainedIsLegal}'s doc notes for
 * `x "`__a__ and __b__`" y`.
 * @param cursor - where the span sits
 * @param order - the asking span's row index
 * @returns the text the behind clause tests, or undefined to refuse
 */
function behindNeighbour(cursor: Cursor, order: number): string | undefined {
  if (cursor.index < cursor.siblings.length - 1) {
    return edgeHead(cursor.siblings[cursor.index + 1], order);
  }
  const { enclosing } = cursor;
  if (enclosing === undefined) {
    return "";
  }
  const row = QUOTE_ROW[rowKeyOf(enclosing)];
  return row.order < order ? row.opensWith : delimitersOf(enclosing).close;
}

/**
 * Whether a node beside a span may put the span's mark character on
 * the line - the question {@link constrainedIsLegal}'s block-wide scan
 * asks of every other node in the block.
 *
 * Text answers by its own bytes, and a macro, link, xref or anchor by
 * the bytes {@link verbatimText} will actually write. A formatting
 * span answers for its content AND its ROLE, and the two halves are
 * there for opposite reasons. Its own MARKS are a balanced pair that
 * Ruby's scan consumes as one, so they cannot pair with a
 * neighbour's and are left out. Its role is the other way round: the
 * printer writes those bytes onto the line verbatim
 * (`spanMarks`, src/print/span-edges.ts), the row that resolves the
 * span writes them into an HTML attribute rather than consuming them
 * as delimiters, and a LATER row then reads the marks left standing
 * in there. So a role holding this mark character can pair with a
 * single mark the shortening would leave behind:
 * `[b**c]**d** **a**` shortened to `[b**c]**d** *a*` renders
 * `<strong class="b*<strong>c">d</strong> *a</strong>`, the second
 * span destroyed and the first one's class rewritten. A curved-quote
 * span answers the same way and
 * for the same underlying reason applied one row earlier: its own
 * BACKTICKS are consumed by `QUOTE_SUBS` row 2 (or 3), before rows 4
 * and later could ever see them, so they must not count against a
 * monospace downgrade elsewhere on the line. A raw line or a hard
 * break answers YES without being asked: a verbatim line is arbitrary
 * bytes, and neither is worth a case here - UNLESS it is the asking
 * span's own, which {@link constrainedIsLegal}'s earlier, more precise
 * clauses already answer (a raw-line child refuses outright; a
 * trailing hard break refuses by its atom text): the scan starts from
 * the block ROOT, so the asking span is reachable through an ancestor
 * as well as through its own siblings, and re-answering YES for its
 * own break there would refuse every span that holds one, which is
 * not what those earlier clauses decided.
 * @param node - an inline node beside the span
 * @param mark - the span's mark character
 * @param asking - the span being decided, skipped where reached (its
 *   own content is {@link constrainedIsLegal}'s to answer, not this
 *   function's)
 * @returns true when the node may print that character
 */
function carriesMark(
  node: InlineNode,
  mark: string,
  asking: SpanNode,
): boolean {
  if (node === asking) {
    return false;
  }
  if (isMarkSpanNode(node) && node.role?.includes(mark) === true) {
    return true;
  }
  if (isSpanNode(node)) {
    return node.children.some((child) => carriesMark(child, mark, asking));
  }
  switch (node.type) {
    case "text": {
      return node.value.includes(mark);
    }
    case "rawLine":
    case "hardLineBreak": {
      return true;
    }
    default: {
      return verbatimText(node).includes(mark);
    }
  }
}
