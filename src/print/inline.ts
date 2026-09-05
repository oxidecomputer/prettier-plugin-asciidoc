/**
 * Inline node → ATOMS: turns a block's inline AST nodes (text, bold,
 * italic, monospace, highlight, curved quotes, super/subscripts,
 * character references, attribute references, links, xrefs,
 * inline anchors, inline images, UI macros, footnotes, passthroughs,
 * raw lines and hard line breaks) into the flat atom list
 * {@link wrap} packs into output lines.
 *
 * The join between two neighbouring nodes is the whole protocol here,
 * and it is decided in ONE place: a running {@link Boundary} that each
 * node leaves behind and the next node's first atom carries. A node
 * that ends without whitespace leaves `"glue"`, so the next atom fuses
 * onto it with no space and no break — the alternation bookkeeping a
 * separator-slot representation needs has no analogue, because a join
 * is a fact ON an atom rather than an element beside it.
 *
 * Extracted from the main printer to keep file size within
 * the max-lines lint limit.
 */
import type { InlineNode, RawLineNode, TextNode } from "../ast.js";
import { FIRST_COLUMN } from "../constants.js";
import { ASCII_WHITESPACE } from "../parse/line-shapes.js";
import { MARK_BOUNDARY, QUOTE_ROW } from "../parse/inline/quote-boundaries.js";
import { verbatimText } from "./serialize-inline.js";
import {
  bracketsAllowIt,
  delimitersOf,
  addressSwallowsAMark,
  fixedSpanMarks,
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
import {
  atomOf,
  type Atom,
  HARD_BREAK_IMAGE,
  isBlockSyntaxAtLineStart,
  splitWords,
  wordsToAtoms,
} from "./reflow.js";
import {
  keepBlockStartBreak,
  openMarkStandsApart,
  type BlockStart,
} from "./block-start-hazard.js";
import {
  strongerBoundary,
  withBoundary,
  type Boundary,
  type Cursor,
} from "./atom-join.js";
import { appendLiteralText, spanIsFlush } from "./literal-span.js";
import { keptLeadingRun, keptTrailingRun } from "./whitespace-fold.js";
import {
  appendWholeRun,
  hasFollowingInlineSibling,
  hasPrecedingInlineSibling,
  leadingBoundary,
  neighboursOf,
  ridesOnWhatFollows,
  ridesOnWhatIsWritten,
  trailingPlusPolicy,
  wordsOfText,
} from "./text-edges.js";

// Whether a text node's FIRST character is a source separator standing
// between it and the previous inline sibling. ASCII only (see
// ASCII_WHITESPACE, issue #75): a no-break space at this position is
// CONTENT glued directly to whatever precedes it, not a join the
// printer may turn into a breakable space or a break.
const LEADS_WITH_ASCII_WHITESPACE = new RegExp(
  `^${ASCII_WHITESPACE.source}`,
  "v",
);

// Whether a text node's LAST character is a source separator standing
// between it and the next inline sibling. Mirrors
// LEADS_WITH_ASCII_WHITESPACE at the trailing edge.
const TRAILS_WITH_ASCII_WHITESPACE = new RegExp(
  `${ASCII_WHITESPACE.source}$`,
  "v",
);

// A hard line break OWNS its line when nothing but whitespace
// precedes it there — which, in AST terms, means the text node in
// front of it ends with the newline that opened the line (plus any
// further indentation the token did not take).
const LINE_START_BEFORE_BREAK = /\n[ \t]*$/v;

/**
 * Whether the source gave the hard line break at `index` a line of
 * its own.
 *
 * A break that opens the block's inline content is NOT counted:
 * there is nothing in front of it to break away from, and emitting
 * a leading break would open the block with a blank line.
 *
 * Two shapes of predecessor answer yes. A TEXT node answers from its
 * own bytes, ending with the newline that opened the break's line. A
 * node that ENDS the line it stands on answers by construction,
 * whatever its bytes: a raw line IS a whole source line, and another
 * hard break's ` +` closes one, so in both cases the break at `index`
 * can only stand on the next line. Those two are the same nodes the
 * printer hands a `"literal"` join anyway, so reading them here moves
 * no byte - it makes the predicate answer for the lines the printer
 * actually writes.
 *
 * Over the SIBLINGS rather than over a `Cursor`, because the item's
 * reflow hazard (src/print/list-hazard.ts) asks the same question of
 * a finished node and the two must not answer it differently: which
 * breaks print a ` +` of their own is what puts an indented line on a
 * list item's first rest line.
 * The two-arm test below is exhaustive because the tokenizer
 * materializes inter-sibling whitespace - a newline included - as a
 * text node: a break's predecessor either is that text node, or is a
 * node that ended with no newline behind it, so no other node kind
 * can put line-opening whitespace in front of the break.
 * @param siblings - the inline nodes the break sits among.
 * @param index - the break's index among them.
 * @returns True when only whitespace precedes it on its line.
 */
export function hardBreakOwnsItsLine(
  siblings: readonly InlineNode[],
  index: number,
): boolean {
  if (index <= 0) {
    return false;
  }
  const previous = siblings.at(index - 1);
  if (previous?.type === "rawLine" || previous?.type === "hardLineBreak") {
    return true;
  }
  return (
    previous?.type === "text" && LINE_START_BEFORE_BREAK.test(previous.value)
  );
}

/**
 * How many leading words of this text node sit on the enclosing
 * BLOCK's first source line. Feeds wordsToAtoms' dlist guard: a
 * `term::` word from a later source line is plain text where it
 * stands, but would become a description-list term if reflow packed
 * it onto the block's first output line.
 *
 * Source positions rather than a scan of earlier siblings at every
 * level: `Node.position` is required on every AST node (see
 * src/ast.ts) and is accurate inside nested spans, so one line
 * comparison replaces a recursive sibling walk that would also have
 * to reason about each ancestor's own newlines. A hazard word nested in
 * `*…*` belongs to the paragraph's line numbering, not the span's, so
 * the line compared against is the BLOCK's — stopping at the span would
 * silently disable the guard for `a line\n*term:: x*`.
 * @param node - The text node being printed.
 * @param cursor - where the node sits, for the block's first line.
 * @param words - The node's whitespace-split words, so the "no line
 *   break anywhere" answer costs no second split.
 * @returns The count of leading words still on the block's first
 *   source line; `words.length` when the whole node is on it.
 */
function firstSourceLineWordCount(
  node: TextNode,
  cursor: Cursor,
  words: readonly string[],
): number {
  if (node.position.start.line !== cursor.blockStartLine) {
    // The node itself begins on a later source line: none of its words
    // are on the block's first line.
    return 0;
  }
  const firstNewline = node.value.indexOf("\n");
  if (firstNewline === -1) {
    return words.length;
  }
  return splitWords(node.value.slice(0, firstNewline)).length;
}

// How a text node OPENS when a list continuation is its first line: a
// `+` and then the line break that ended that line. The reader rstrips
// every line, so nothing else can stand between the two.
const OPENING_CONTINUATION_LINE = "+\n";

/**
 * Whether the node opens with a `+` that stood ALONE on its own source
 * line, which reflow must give an output line of its own back
 * (`keepContinuationLine` in src/print/reflow.ts).
 *
 * Column 1 is what makes "alone" true rather than merely likely. A `+`
 * that opens a text node has a line to itself only when nothing at all
 * precedes it on that line, and the node's own start column is the
 * cheapest statement of that: it excludes an admonition body
 * (`NOTE: +`), a formatting span's content (the opening mark holds
 * column 1), a list item's text (`* +`) and any inline sibling that
 * ended on the same line. In every one of those the `+` sits after a
 * space, where it is a hard line break rather than a continuation, and
 * the ordinary line-end rule is the one that must hold.
 *
 * A node this predicate accepts is always its block's FIRST inline
 * node: a `+` at column 1 always opens a new block, so no preceding
 * sibling can exist to hand it a glue lead. `keepContinuationLine`'s
 * rewrite of the node's own atoms leans on that.
 * @param node - the text node being printed.
 * @returns Whether its first word is a continuation line of its own.
 */
function opensWithContinuationLine(node: TextNode): boolean {
  return (
    node.position.start.column === FIRST_COLUMN &&
    node.value.startsWith(OPENING_CONTINUATION_LINE)
  );
}

/**
 * The join a text node leaves BEHIND it, for the sibling that follows.
 *
 * The continuation-line arm is the cross-node half of
 * `keepContinuationLine` (src/print/reflow.ts), which can only reach
 * the words inside one node. A `+` alone on its source line is the
 * node's ONLY word whenever the line after it opens an inline
 * construct — `+` then `*a*` leaves the text node as just `"+\n"`
 * with the span as the next sibling — and then the join is what
 * decides whether the `+` keeps its line. It is a mandatory break at
 * column 0, the same one a raw line asks for: the `+` and the content
 * after it were both written at column 0, which is where a
 * continuation and the block it attaches have to be.
 * @param node - the text node.
 * @param words - its whitespace-split words, non-empty.
 * @param glueToSibling - whether a trailing `+` must fuse forward.
 * @param keptRun - the node's trailing run where its bytes ride inside
 *   the last atom instead of folding, which leaves the printer nothing
 *   to write between the two nodes.
 * @returns the join.
 */
function trailingBoundary(
  node: TextNode,
  words: readonly string[],
  glueToSibling: boolean,
  keptRun: string,
): Boundary {
  if (keptRun !== "" || !TRAILS_WITH_ASCII_WHITESPACE.test(node.value)) {
    return "glue";
  }
  if (words.length === 1 && opensWithContinuationLine(node)) {
    return "literal";
  }
  // A trailing `+` with a sibling after it keeps the source's space but
  // forbids the break, so no break can land after the `+` (where ` +`
  // at end of line would become a hard line break).
  return glueToSibling && words.at(-1) === "+" ? "space" : "break";
}

/**
 * Append a text node's atoms.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of this node.
 * @param cursor - where the node sits.
 * @param node - the text node.
 * @returns the join this node leaves behind.
 */
function appendText(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  node: TextNode,
): Boundary {
  const neighbours = neighboursOf(cursor);
  const words = wordsOfText(node.value, neighbours);
  // A kept edge run rides inside the atom at its end, so the join
  // there stays the glue it already was and the printer writes nothing
  // of its own between the two nodes.
  const gluedInFront = ridesOnWhatIsWritten(out, boundary, cursor);
  // All-whitespace text nodes (e.g. " " between adjacent formatting
  // marks, or " " as sole content of a formatting span like `** **`).
  // They contribute no atom, only the break opportunity their
  // whitespace stands for — dropping that would fuse adjacent siblings
  // or collapse content whitespace inside formatting marks. Where the
  // run itself is what a replacement row reads, there is no atom for
  // it to ride inside, so it becomes one: glued at both ends, so the
  // printer writes the author's bytes there and nothing else.
  if (words.length === 0) {
    return appendWholeRun(out, boundary, node.value, cursor);
  }
  const leading = keptLeadingRun(node.value, words, gluedInFront, neighbours);
  // The lead is computed BEFORE the atoms, because the trailing-`+`
  // policy reads it: a one-word node carrying a glue cannot reach a
  // line boundary, and a `+` that cannot reach one needs no escape.
  const lead =
    leading === "" && LEADS_WITH_ASCII_WHITESPACE.test(node.value)
      ? strongerBoundary(boundary, leadingBoundary(cursor, words))
      : boundary;
  const { escapeTrailingPlus, glueToSibling } = trailingPlusPolicy(
    cursor,
    words,
    lead,
  );
  const trailing = keptTrailingRun(
    node.value,
    words,
    ridesOnWhatFollows(cursor),
    neighbours,
  );
  const atoms = wordsToAtoms(words, {
    escapeTrailingPlus,
    firstLineWordCount: firstSourceLineWordCount(node, cursor, words),
    opensWithContinuationLine: opensWithContinuationLine(node),
    edgeRuns: { leading, trailing },
  });
  out.push(withBoundary(atoms[0], lead), ...atoms.slice(1));
  return trailingBoundary(node, words, glueToSibling, trailing);
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
 * A RAW LINE among the children is not a fifth place, and the reason
 * is worth writing down because the oracle's own reading makes it
 * look like one. The oracle DELETES a kept comment line before the
 * quote pass runs, so the characters beside the marks in the rendered
 * text are not the ones a tree can see: `**a` / `// c` / `b** d`
 * renders `<strong>a\nb</strong>`, with the comment gone. But no span
 * that reaches this function holds one. A raw line is a piece of its
 * own, and each reflowable RUN between two pieces is tokenized on its
 * own (`tokenizeRun`, src/parse/lines/paragraph-reader.ts), while an
 * unconstrained delimiter comes from a scan of ONE such fragment
 * (`scanDoubledMarks`, src/parse/inline/doubled-marks.ts). The
 * pairing walk itself runs body-wide and does cross raw-line tokens
 * (`resolveSpans`, src/parse/inline/span-pairing.ts); what confines a
 * pair to its fragment is the scans, which record doubled and
 * super/sub delimiters in open-close PAIRS per fragment, so the
 * sequential pairing has even parity inside every fragment and never
 * straddles one. A span carrying a raw line is therefore already
 * the constrained spelling, and `node.constrained` answers ahead of
 * the call.
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

/**
 * Append a formatting span's atoms: the span's content joins the
 * block's ONE flat atom list, with the marks fused onto the first and
 * last atoms so they stay adjacent to their words (required for
 * AsciiDoc constrained formatting) and the packer measures them.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the span.
 * @param cursor - where the span sits.
 * @param node - the span node.
 * @returns the join the span leaves behind.
 */
function appendSpan(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  node: SpanNode,
): Boundary {
  // A monospace ancestor - this node or an outer one - makes every
  // BYTE of the content CONTENT: see Cursor.literalInterior.
  const literalInterior = cursor.literalInterior || node.type === "monospace";
  const { atoms: inner, trailing } = collectAtoms(node.children, {
    blockStartLine: cursor.blockStartLine,
    enclosing: node,
    blockNodes: cursor.blockNodes,
    // Content inside a span opens no block line of its own: the marks
    // around it hold the column whatever the block does.
    blockStart: { atColumnZero: false },
    literalInterior,
  });
  // The span's own whitespace lives INSIDE its marks: content whitespace
  // at either edge is a space in the output, never a break, because the
  // marks fuse onto the content they enclose. Both edges are read off
  // the joins themselves — the first atom carries the join its content
  // asked for, and `trailing` is the join the last one left behind.
  const openSpace = inner.length > 0 && inner[0].glueLeft ? "" : " ";
  const closeSpace = trailing === "glue" ? "" : " ";
  const flush = spanIsFlush(inner, openSpace, closeSpace);
  const { open, close } = isMarkSpanNode(node)
    ? spanMarks(
        node,
        node.constrained ||
          constrainedIsLegal(node, cursor, {
            flush,
            texts: inner.map((atom) => atom.text),
          }),
      )
    : fixedSpanMarks(node);
  // Children that are all whitespace produce no atoms (`x ** ** y`,
  // where the bold holds only a space). Emit the bare marks around
  // whatever whitespace they stood for. That is one of THREE homes of
  // "a span may not be empty", and none of them subsumes another:
  //
  // - a CONSTRAINED span may not hold whitespace at either edge, and
  //   that is read off the source characters beside the mark, before
  //   any pairing (canOpenAt/canCloseAt, quote-boundaries.ts): `x * *
  //   y` is plain text, never a span;
  // - a span may not hold NOTHING, which the pairing enforces by
  //   skipping an adjacent close (closeForOpen,
  //   src/parse/inline/span-pairing.ts), so `____` never reaches the
  //   printer as a node at all;
  // - and an UNCONSTRAINED span may hold whitespace alone, because
  //   its patterns test no boundary - which is the shape that gets
  //   here, and only here.
  if (inner.length === 0) {
    appendWhitespaceOnlySpan(out, boundary, cursor, {
      open,
      close,
      closeSpace,
    });
    return "glue";
  }
  pushSpanAtoms(out, boundary, inner, {
    openText: `${open}${openSpace}`,
    closeText: `${closeSpace}${close}`,
    ...markPlacement(cursor, inner),
  });
  return "glue";
}

/**
 * Where a span's OPENING mark goes relative to the content atom beside
 * it.
 *
 * `"fused"` is the ordinary case: mark and first content atom become
 * one atom, which is what keeps them adjacent for AsciiDoc's
 * constrained formatting. `"apart"` keeps the mark as an atom of its
 * own with the space the fusion would have written behind it, and
 * leaves the break to the block-start hazard net.
 */
type OpenMarkPlacement = "fused" | "apart";

/**
 * Where a span's marks go: the opening one's placement, and whether
 * the closing one must stand alone against a literal break. Split from
 * {@link appendSpan} for the complexity ceiling.
 *
 * NEITHER EDGE CAN BE A RAW LINE, so neither answer guards one. A raw
 * line ends the reflowable run it follows and opens the next, and each
 * run is tokenized on its own (`tokenizeRun`,
 * src/parse/lines/paragraph-reader.ts): an unconstrained pair's two
 * marks come from a scan of a single such fragment (`scanDoubledMarks`,
 * src/parse/inline/doubled-marks.ts), and a constrained mark may not
 * open with whitespace behind it nor close with whitespace in front of
 * it (`canOpenAt`/`canCloseAt`,
 * src/parse/inline/quote-boundaries.ts), which is what a mark alone at
 * a fragment's end or start would be. A raw line INSIDE the content
 * still keeps every mark off itself, but that is its own line's doing
 * rather than a placement: it takes a literal join on both sides
 * ({@link appendRawLine}, `OWN_LINE_SIBLINGS`), so the marks fuse onto
 * text atoms and never onto the comment. They must not: fusing the
 * close onto a kept comment line writes `// c**`, which the re-reader
 * swallows into the comment, and the rendered text loses the mark and
 * everything behind it (measured on `para\n** b\n// c\n** b`).
 *
 * At a BLOCK START the mark comes apart from the content without a
 * break behind it (see {@link openMarkStandsApart}): the two atoms pack
 * into the same bytes the fusion would have written, and the net that
 * can see the whole packed line decides afterwards whether the space
 * becomes the author's break.
 *
 * A HARD LINE BREAK last in the content owns its line END the same
 * way: `LineBreakRx` is `^(.*)[ \t]\+$`, so the ` +` must stay at the
 * end of a line to be a break at all, and fusing the close mark
 * behind it writes `b +**` - literal text, the `<br>` gone (measured
 * on `a **b +\n** c`). Detaching puts the close on the next line and
 * leaves the break where the author had it. The OPEN side needs
 * nothing there: a break that is not last has an atom behind it
 * carrying the literal join (appendHardLineBreak), and a `+` pushed
 * to column 0 would be a list continuation.
 * @param cursor - where the span sits.
 * @param inner - the span's content atoms.
 * @returns the two placements {@link pushSpanAtoms} takes.
 */
function markPlacement(
  cursor: Cursor,
  inner: readonly Atom[],
): { openPlacement: OpenMarkPlacement; detachClose: boolean } {
  return {
    // `glueLeft` on the first content atom is where `openSpace` came
    // from (see {@link appendSpan}), so its negation is exactly "the
    // fusion writes a space the content's own whitespace stood for".
    openPlacement: openMarkStandsApart(cursor, !inner[0].glueLeft)
      ? "apart"
      : "fused",
    detachClose: inner.at(-1)?.text === HARD_BREAK_IMAGE,
  };
}

/**
 * Push a span's atoms with its marks placed: fused onto the edge
 * content atoms in the ordinary case, or standing as atoms of their
 * own where fusing would corrupt or would hide a break the net may
 * need (the block start, a hard line break last in the content).
 * Split from {@link appendSpan} for the complexity ceiling.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the span.
 * @param inner - the span's content atoms (mutated: marks fuse on).
 * @param marks - how to place the two marks.
 * @param marks.openText - the open mark plus the space the content's
 *   leading whitespace became.
 * @param marks.closeText - the space the content's trailing
 *   whitespace became, plus the close mark.
 * @param marks.openPlacement - where the open mark goes
 *   ({@link OpenMarkPlacement}).
 * @param marks.detachClose - emit the close mark on its own line at
 *   column 0 instead of fusing it onto the last atom.
 */
function pushSpanAtoms(
  out: Atom[],
  boundary: Boundary,
  inner: Atom[],
  marks: {
    openText: string;
    closeText: string;
    openPlacement: OpenMarkPlacement;
    detachClose: boolean;
  },
): void {
  const { openText, closeText, openPlacement, detachClose } = marks;
  const last = inner.length - 1;
  if (!detachClose) {
    inner[last] = { ...inner[last], text: `${inner[last].text}${closeText}` };
  }
  if (openPlacement === "fused") {
    inner[0] = { ...inner[0], text: `${openText}${inner[0].text}` };
    out.push(withBoundary(inner[0], boundary), ...inner.slice(1));
  } else {
    // `"apart"` writes the SPACE the fusion would have written, so the
    // packer measures and prints the same bytes and the net that reads
    // the whole packed line decides afterwards whether that space
    // becomes the author's break.
    out.push(
      withBoundary(atomOf(openText.trimEnd()), boundary),
      withBoundary(inner[0], "space"),
      ...inner.slice(1),
    );
  }
  if (detachClose) {
    out.push(withBoundary(atomOf(closeText.trimStart()), "literal"));
  }
}

/**
 * Emit a span whose children produced NO atoms: bare marks around the
 * whitespace they stood for. Split from {@link appendSpan} for the
 * complexity ceiling. The block-start hazard net applies here too:
 * `**\n**` replayed as `** **` at column 0 is a ulist line, so at a
 * block start the two marks stay two atoms and the net puts the source
 * break between them.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the span.
 * @param cursor - where the span sits.
 * @param parts - the marks and the space the content whitespace
 *   became.
 * @param parts.open - the opening mark.
 * @param parts.close - the closing mark.
 * @param parts.closeSpace - the space the whitespace-only content
 *   stands for ("" when there was none).
 */
function appendWhitespaceOnlySpan(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  parts: { open: string; close: string; closeSpace: string },
): void {
  const { open, close, closeSpace } = parts;
  // The whitespace this span held is all there is between the two
  // marks, so `closeSpace` is the whole fusion's space here.
  if (openMarkStandsApart(cursor, closeSpace !== "")) {
    out.push(
      withBoundary(atomOf(open), boundary),
      withBoundary(atomOf(close), "space"),
    );
    return;
  }
  out.push(withBoundary(atomOf(`${open}${closeSpace}${close}`), boundary));
}

/**
 * Append a raw line — a comment, preprocessor or otherwise verbatim line
 * kept inside a paragraph.
 *
 * Such a line must start at column 0 to be one, so the joins around it
 * are LITERAL breaks: they open their line at column 0 whatever the
 * enclosing block's continuation indent is.
 *
 * A break is only demanded where a neighbour exists on that side: the
 * TRAILING one is dropped when nothing follows in this block (the block
 * joiner already supplies that break — demanding one here would open the
 * next block with a blank line), and the LEADING one when the raw line
 * is the block's first node (a paragraph that is one verbatim line —
 * the second of two adjacent `+` lines in a list item — would otherwise
 * open with a blank).
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the raw line.
 * @param cursor - where the raw line sits.
 * @param node - the raw line node.
 * @returns the join the raw line leaves behind.
 */
function appendRawLine(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
  node: RawLineNode,
): Boundary {
  const lead = cursor.index === 0 ? boundary : "literal";
  out.push(withBoundary(atomOf(node.value), lead));
  return hasFollowingInlineSibling(cursor) ? "literal" : "glue";
}

/**
 * Append a hard line break (` +` at end of a line).
 *
 * The break it forces is LITERAL, so the line after it starts at column
 * 0 regardless of the block's continuation indent — a list item's text
 * indent must not reach the line Asciidoctor reads after the `<br>`.
 *
 * A ` +` the source put alone on its line keeps that line.
 * Asciidoctor's `LineBreakRx` captures everything before the space
 * (`^(.*)[ \t]\+$`), so ` +` alone renders `<br>` with the
 * preceding line's text AND its newline intact, while `text +`
 * renders `text<br>` — joining the two lines would drop a space from
 * the rendered output. The trailing break is demanded only when an
 * inline sibling follows in the same block.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the break.
 * @param cursor - where the break sits.
 * @returns the join the break leaves behind.
 */
function appendHardLineBreak(
  out: Atom[],
  boundary: Boundary,
  cursor: Cursor,
): Boundary {
  const lead = hardBreakOwnsItsLine(cursor.siblings, cursor.index)
    ? "literal"
    : boundary;
  out.push(withBoundary(atomOf(HARD_BREAK_IMAGE), lead));
  return hasFollowingInlineSibling(cursor) ? "literal" : "glue";
}

/**
 * The join in front of a VERBATIM node's one atom.
 *
 * The cross-node half of {@link leadingBoundary}, for the nodes whose
 * atom text is not words: a construct that would become block syntax
 * at column 0 may not be handed a breakable join, or the packer can
 * open a line with it. The passthrough `++++` is the shape that made
 * this necessary — it is a passthrough with empty content to
 * Asciidoctor, and a delimited-block delimiter at the head of a line —
 * and the same net covers an inline anchor, whose `[[id]]` is a block
 * anchor there.
 *
 * A node with nothing before it in the block keeps its join: it
 * already opens the block's first output line, exactly where the
 * source put it, and fusing it backwards onto nothing would change
 * nothing.
 * @param boundary - the join standing in front of the node.
 * @param cursor - where the node sits.
 * @param image - the text its atom will carry.
 * @returns the join, downgraded to a non-breaking space where a break
 *   would be unsafe.
 */
function verbatimBoundary(
  boundary: Boundary,
  cursor: Cursor,
  image: string,
): Boundary {
  return boundary === "break" &&
    isBlockSyntaxAtLineStart(image) &&
    hasPrecedingInlineSibling(cursor)
    ? "space"
    : boundary;
}

/**
 * Append one inline node's atoms to the block's list.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of this node.
 * @param cursor - where the node sits.
 * @returns the join this node leaves behind.
 */
function appendNode(out: Atom[], boundary: Boundary, cursor: Cursor): Boundary {
  const node = cursor.siblings[cursor.index];
  switch (node.type) {
    case "text": {
      return cursor.literalInterior
        ? appendLiteralText(out, boundary, cursor, node)
        : appendText(out, boundary, cursor, node);
    }
    case "bold":
    case "italic":
    case "monospace":
    case "highlight":
    case "curvedQuote":
    case "superscript":
    case "subscript": {
      return appendSpan(out, boundary, cursor, node);
    }
    case "rawLine": {
      return appendRawLine(out, boundary, cursor, node);
    }
    case "hardLineBreak": {
      return appendHardLineBreak(out, boundary, cursor);
    }
    default: {
      const image = verbatimText(node);
      out.push(
        withBoundary(atomOf(image), verbatimBoundary(boundary, cursor, image)),
      );
      return "glue";
    }
  }
}

/** The block-level facts every cursor of one run shares. */
interface RunContext {
  /** 1-based source line the enclosing BLOCK starts on. */
  readonly blockStartLine: number;
  /**
   * The span this run is the content of, when it is one: the printer
   * needs the NODE and not just the fact, because what stands beside a
   * span at the edge of its parent is the parent's delimiter as the
   * child's row reads it (span-edges.ts). `undefined` at block level.
   */
  readonly enclosing: SpanNode | undefined;
  /**
   * The block's top-level inline children. A constrained spelling
   * exposes its marks to a pass that scans the whole LINE, so the
   * stray-mark question is about the block and not about the span's
   * siblings - see {@link constrainedIsLegal}.
   */
  readonly blockNodes: readonly InlineNode[];
  /** Where the block's first atom lands (block-start-hazard.ts). */
  readonly blockStart: BlockStart;
  /** See {@link Cursor.literalInterior}; carried into every cursor the run builds. */
  readonly literalInterior: boolean;
}

/**
 * Build the atoms for a run of inline siblings.
 * @param nodes - the inline siblings, in order.
 * @param context - the block facts the run's cursors share: source
 *   start line (for the dlist first-line guard), the enclosing span
 *   and the block's own children (for the stray-mark scan), and
 *   whether the first atom opens its line at column 0.
 * @returns the atoms, in order, and the join the last one leaves behind.
 */
function collectAtoms(
  nodes: readonly InlineNode[],
  context: RunContext,
): { atoms: Atom[]; trailing: Boundary } {
  const out: Atom[] = [];
  let boundary: Boundary = "glue";
  for (const index of nodes.keys()) {
    boundary = appendNode(out, boundary, {
      siblings: nodes,
      index,
      ...context,
    });
  }
  return { atoms: out, trailing: boundary };
}

/**
 * Convert a block's inline content to atoms.
 * @param nodes - the block's inline children, in order.
 * @param blockStartLine - 1-based source line the block starts on.
 * @param blockStart - where the block's first atom lands, and where
 *   that is column 0, whether the source line under it ended after
 *   its first word (block-start-hazard.ts).
 * @returns the block's atoms, ready for {@link wrap}.
 */
export function inlineAtoms(
  nodes: readonly InlineNode[],
  blockStartLine: number,
  blockStart: BlockStart,
): Atom[] {
  const { atoms } = collectAtoms(nodes, {
    blockStartLine,
    enclosing: undefined,
    blockNodes: nodes,
    blockStart,
    literalInterior: false,
  });
  // The net's precondition is the caller's to establish, so the callee
  // re-checks nothing: it runs only over a block that opens at column
  // 0 on a source line its first word ended.
  if (blockStart.atColumnZero && blockStart.firstWordEndsItsLine) {
    keepBlockStartBreak(atoms);
  }
  return atoms;
}
