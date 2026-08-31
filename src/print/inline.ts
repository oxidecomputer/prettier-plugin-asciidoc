/**
 * Inline node → ATOMS: turns a block's inline AST nodes (text, bold,
 * italic, monospace, highlight, attribute references, links, xrefs,
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
import type {
  InlineNode,
  RawLineNode,
  TextNode,
  BoldNode,
  ItalicNode,
  MonospaceNode,
  HighlightNode,
} from "../ast.js";
import { FIRST_COLUMN } from "../constants.js";
import { ASCII_WHITESPACE } from "../parse/line-shapes.js";
import {
  MARK_BOUNDARY,
  afterSpecialchars,
} from "../parse/inline/quote-boundaries.js";
import { verbatimText } from "./serialize-inline.js";
import {
  atomOf,
  type Atom,
  type BreakBefore,
  isBlockSyntaxAtLineStart,
  splitWords,
  wordsToAtoms,
} from "./reflow.js";
import {
  type BlockStartCursor,
  hazardAtBlockStart,
  keepBlockStartBreak,
} from "./block-start-hazard.js";

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

// The two characters a hard line break prints: the space is part of
// the syntax (`LineBreakRx` requires it), not a separator.
const HARD_BREAK_IMAGE = " +";

// A hard line break OWNS its line when nothing but whitespace
// precedes it there — which, in AST terms, means the text node in
// front of it ends with the newline that opened the line (plus any
// further indentation the token did not take).
const LINE_START_BEFORE_BREAK = /\n[ \t]*$/v;

// Siblings that do NOT share the enclosing block's packing: a raw
// line forces a break on both sides. The node before one still ENDS
// an output line, so a trailing `+` there is a hard line break and
// must be escaped, and a word after one starts a line rather than
// fusing. (Nested lists are not inline siblings — an item's `text`
// holds inline nodes only; its blocks print elsewhere.)
const OWN_LINE_SIBLINGS = new Set(["rawLine"]);

/** A formatting span: its marks ride on the atoms they touch. */
type SpanNode = BoldNode | ItalicNode | MonospaceNode | HighlightNode;

/**
 * The join between the atom just emitted and the next one.
 *
 * `"glue"` fuses with no space, `"space"` puts a space there but forbids
 * a break, `"break"` is an ordinary breakable space, and `"literal"` is
 * a mandatory break that opens its line at column 0. They are RANKED:
 * when two nodes each ask for a join, the stronger one stands — which is
 * how a raw line's mandatory break survives a neighbour's whitespace
 * asking only for a breakable space.
 */
type Boundary = "glue" | "space" | "break" | "literal";

// Weakest join first: a later index outranks an earlier one.
const BOUNDARY_ORDER: readonly Boundary[] = [
  "glue",
  "space",
  "break",
  "literal",
];

/**
 * The stronger of two joins.
 * @param left - the join already standing.
 * @param right - the join being asked for.
 * @returns whichever ranks higher.
 */
function strongerBoundary(left: Boundary, right: Boundary): Boundary {
  return BOUNDARY_ORDER.indexOf(right) > BOUNDARY_ORDER.indexOf(left)
    ? right
    : left;
}

/**
 * Stamp a join onto an atom. The atom's OWN break demand survives a
 * non-breaking join: a description-list hazard word that opens a
 * formatting span still demands its break, and {@link wrap} lifts the
 * demand to the front of the run the span belongs to.
 * @param atom - the atom the join lands on.
 * @param boundary - the join.
 * @returns the atom carrying it.
 */
function withBoundary(atom: Atom, boundary: Boundary): Atom {
  const breakBefore: BreakBefore =
    boundary === "literal" ? "literal" : atom.breakBefore;
  return {
    ...atom,
    glueLeft: boundary === "glue",
    noBreakBefore: boundary === "space",
    breakBefore,
  };
}

/**
 * Where a node sits among its inline siblings, and in which block:
 * what the block-start hazard net reads ({@link BlockStartCursor}),
 * plus the block's source start line, which only the dlist
 * first-line guard reads.
 */
interface Cursor extends BlockStartCursor {
  /** 1-based source line the enclosing BLOCK starts on. */
  readonly blockStartLine: number;
}

/**
 * Check whether the node at `cursor` is followed by a sibling
 * that participates in the same block packing.
 * @param cursor - where the node sits.
 * @returns True when an inline sibling directly follows.
 */
function hasFollowingInlineSibling(cursor: Cursor): boolean {
  const next = cursor.siblings.at(cursor.index + 1);
  return next !== undefined && !OWN_LINE_SIBLINGS.has(next.type);
}

/**
 * Check whether the node at `cursor` is preceded by a sibling that
 * participates in the same block packing. Mirrors
 * hasFollowingInlineSibling — see OWN_LINE_SIBLINGS for what does
 * not count.
 * @param cursor - where the node sits.
 * @returns True when an inline sibling directly precedes.
 */
function hasPrecedingInlineSibling(cursor: Cursor): boolean {
  if (cursor.index <= 0) {
    return false;
  }
  const previous = cursor.siblings.at(cursor.index - 1);
  return previous !== undefined && !OWN_LINE_SIBLINGS.has(previous.type);
}

/**
 * Whether the source gave the hard line break at `cursor` a line of
 * its own.
 *
 * A break that opens the block's inline content is NOT counted:
 * there is nothing in front of it to break away from, and emitting
 * a leading break would open the block with a blank line.
 * @param cursor - where the hard line break sits.
 * @returns True when only whitespace precedes it on its line.
 */
function ownsItsLine(cursor: Cursor): boolean {
  if (cursor.index <= 0) {
    return false;
  }
  const previous = cursor.siblings.at(cursor.index - 1);
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
 * Decide how a text node's trailing `+` word must be protected
 * from landing bare at the end of an output line (where ` +`
 * becomes a hard line break). Three cases:
 *
 * - An inline sibling follows in the same block: fuse the `+`
 *   forward to that sibling so no break can land after it. No escape —
 *   escaping would put a literal `{plus}` mid-line.
 * - No sibling follows but this text is inside a formatting span: the
 *   closing mark lands directly after the `+` in the output, so it can
 *   never end a line bare. No escape — escaping would corrupt the
 *   span's content (issue #2's `` `+` `` case).
 * - The node is the `+` and NOTHING else, and the join in front of it
 *   is a GLUE: the `+` prints hard against the previous node's last
 *   byte, so it can neither open a line (a lone `+` line is a list
 *   continuation) nor stand behind a space at a line end (` +` is a
 *   hard line break). Both hazards need a character the glue
 *   forbids, so there is nothing to escape. This is the shape a
 *   passthrough leaves behind — `+a++` is the passthrough `+a+` and
 *   a leftover `+` — and the same shape a formatting span leaves
 *   (`*b*+`).
 * - Otherwise (block-level last child, or only a raw line follows —
 *   which owns its output line): the `+` truly ends an
 *   output line, so it must be escaped.
 * @param cursor - where the text node sits.
 * @param words - The node's whitespace-split words: a `+` that is
 *   the node's ONLY word, with nothing before it in the block, is
 *   alone on its output line, and `+` at column 0 is not a break.
 * @param lead - the join the node's first atom will carry, which is
 *   what decides whether a one-word node can reach a line boundary
 *   at all.
 * @returns Whether to rewrite an unfused trailing `+` to
 *   `{plus}`, and whether to fuse it forward to a following
 *   inline sibling instead.
 */
function trailingPlusPolicy(
  cursor: Cursor,
  words: readonly string[],
  lead: Boundary,
): {
  escapeTrailingPlus: boolean;
  glueToSibling: boolean;
} {
  const followedInBlock = hasFollowingInlineSibling(cursor);
  const startsItsOwnLine =
    words.length === 1 && !hasPrecedingInlineSibling(cursor);
  const gluedToPredecessor = words.length === 1 && lead === "glue";
  return {
    escapeTrailingPlus:
      !followedInBlock &&
      !cursor.insideSpan &&
      !startsItsOwnLine &&
      !gluedToPredecessor,
    glueToSibling: followedInBlock,
  };
}

/**
 * The join a text node's LEADING whitespace asks for.
 *
 * Normally a breakable space. But when the node's FIRST word would
 * become block syntax at column 0 (a fenced-code prefix, `----`,
 * `.Title`) and an inline sibling precedes it, a break there is unsafe:
 * wordsToAtoms fuses such a word onto its predecessor WITHIN a node, and
 * the same must hold ACROSS the node boundary — so the join is a space
 * that forbids a break, and the word travels in the preceding run.
 * @param cursor - where the text node sits.
 * @param words - The node's whitespace-split words.
 * @returns the join asked for.
 */
function leadingBoundary(cursor: Cursor, words: readonly string[]): Boundary {
  return isBlockSyntaxAtLineStart(words[0]) && hasPrecedingInlineSibling(cursor)
    ? "space"
    : "break";
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
 * @returns the join.
 */
function trailingBoundary(
  node: TextNode,
  words: readonly string[],
  glueToSibling: boolean,
): Boundary {
  if (!TRAILS_WITH_ASCII_WHITESPACE.test(node.value)) {
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
  const words = splitWords(node.value);
  // All-whitespace text nodes (e.g. " " between adjacent formatting
  // marks, or " " as sole content of a formatting span like `** **`).
  // They contribute no atom, only the break opportunity their
  // whitespace stands for — dropping that would fuse adjacent siblings
  // or collapse content whitespace inside formatting marks.
  if (words.length === 0) {
    return strongerBoundary(boundary, "break");
  }
  // The lead is computed BEFORE the atoms, because the trailing-`+`
  // policy reads it: a one-word node carrying a glue cannot reach a
  // line boundary, and a `+` that cannot reach one needs no escape.
  const lead = LEADS_WITH_ASCII_WHITESPACE.test(node.value)
    ? strongerBoundary(boundary, leadingBoundary(cursor, words))
    : boundary;
  const { escapeTrailingPlus, glueToSibling } = trailingPlusPolicy(
    cursor,
    words,
    lead,
  );
  const atoms = wordsToAtoms(words, {
    escapeTrailingPlus,
    firstLineWordCount: firstSourceLineWordCount(node, cursor, words),
    opensWithContinuationLine: opensWithContinuationLine(node),
  });
  out.push(withBoundary(atoms[0], lead), ...atoms.slice(1));
  return trailingBoundary(node, words, glueToSibling);
}

/** The one mark character each span kind is spelled with. */
const SPAN_MARKS = { bold: "*", italic: "_", monospace: "`", highlight: "#" };

/**
 * The opening and closing marks of a formatting span.
 *
 * Constrained marks (`*bold*`) require word boundaries; unconstrained
 * (`**bold**`) work anywhere, including mid-word — and where BOTH are
 * legal they render identically, so the printer writes the
 * constrained one ({@link constrainedIsLegal} decides). A role
 * attribute gives a highlight span semantic meaning used by CSS, e.g.
 * `[.red]#text#`: it is written as an inline attribute list
 * immediately before the mark, not as a block attribute list, so it is
 * emitted here and not through the block printer.
 * @param node - the span node.
 * @param constrained - whether to spell it with the single mark.
 * @returns its opening and closing marks.
 */
function spanMarks(
  node: SpanNode,
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
 * Deliberately CONSERVATIVE in four places, each costing bytes and no
 * meaning:
 *
 * - a NEIGHBOUR that is not plain text answers no — the character it
 *   will print is not this function's to predict, and
 *   `a **b**__c__ d` measures render-UNEQUAL once the bold shortens
 *   even though `_` is no word character;
 * - a span NESTED inside another answers no: the character beside it
 *   is the enclosing mark, and `_` is a word character to Ruby, so
 *   `__*b*__` would not match;
 * - CONTENT carrying the mark character answers no — the constrained
 *   pattern is non-greedy and would end the span early;
 * - and a stray mark character ANYWHERE ELSE in the paragraph answers
 *   no ({@link carriesMark}). Shortening a span exposes its marks to
 *   the constrained pass, which scans the whole line: the corpus's
 *   `[[[_1984]]] George Orwell. __1984__.` renders differently the
 *   moment the emphasis shortens, because the `_` inside the
 *   bibliography anchor becomes an opening mark.
 * @param node - the unconstrained span
 * @param cursor - where it sits among its siblings
 * @param content - the span's own facts: whether its content is flush
 *   against the marks, and the atom texts it will print
 * @param content.flush - true when neither edge carries whitespace
 * @param content.texts - the inner atoms' texts
 * @returns true when the constrained spelling carries the same meaning
 */
function constrainedIsLegal(
  node: SpanNode,
  cursor: Cursor,
  content: { flush: boolean; texts: readonly string[] },
): boolean {
  if (cursor.insideSpan || !content.flush) return false;
  // A raw line among the children answers no: the oracle deletes a
  // kept comment line before the quote pass runs, so the characters
  // beside the marks in the RENDERED text are not the ones this
  // function can see - `**\n// c\nb** c` respelled constrained
  // renders literal (the content's real head after deletion is the
  // newline, which `(\S|\S.*?\S)` refuses).
  if (node.children.some((child) => child.type === "rawLine")) return false;
  // Content ENDING in a hard line break answers no for the same
  // reason: the closing mark detaches onto its own line (appendSpan)
  // so the ` +` keeps the line end that makes it a break, and a
  // SINGLE mark alone at column 0 with text behind it is a list
  // marker - `a **b +\n** c` respelled constrained would write
  // `* c`. The doubled mark is no marker.
  if (content.texts.at(-1) === HARD_BREAK_IMAGE) return false;
  const mark = SPAN_MARKS[node.type];
  if (content.texts.some((text) => text.includes(mark))) return false;
  const others = cursor.siblings.filter((_, index) => index !== cursor.index);
  if (others.some((sibling) => carriesMark(sibling, mark))) return false;
  return neighboursAllowIt(node, cursor);
}

/**
 * The two boundary clauses of the constrained pattern, read off the
 * span's siblings — the front one after {@link afterSpecialchars}.
 * Split from {@link constrainedIsLegal} for the complexity ceiling,
 * which is also where the clause split belongs: the caller asks about
 * the SPAN, this asks about what stands beside it.
 * @param node - the span being considered
 * @param cursor - where the span sits among its siblings
 * @returns true when both neighbours leave the constrained form legal
 */
function neighboursAllowIt(node: SpanNode, cursor: Cursor): boolean {
  const { front, behind } = MARK_BOUNDARY[node.type];
  const previous = cursor.siblings.at(cursor.index - 1);
  const following = cursor.siblings.at(cursor.index + 1);
  const leftOk =
    cursor.index === 0 ||
    (previous?.type === "text" &&
      !front.test(afterSpecialchars(previous.value)));
  const rightOk =
    following === undefined ||
    (following.type === "text" && !behind.test(following.value));
  return leftOk && rightOk;
}

/**
 * Whether a node beside a span may put the span's mark character on
 * the line — the question {@link constrainedIsLegal}'s last clause
 * asks of every other node in the paragraph.
 *
 * Text answers by its own bytes, and a macro, link, xref or anchor by
 * the bytes {@link verbatimText} will actually write. A formatting
 * span answers for its CONTENT only: its own marks are a balanced
 * pair, and Ruby's scan consumes them as one, so they cannot pair
 * with a neighbour's. A raw line or a hard break answers YES without
 * being asked — a verbatim line is arbitrary bytes, and neither is
 * worth a case here.
 * @param node - an inline node beside the span
 * @param mark - the span's mark character
 * @returns true when the node may print that character
 */
function carriesMark(node: InlineNode, mark: string): boolean {
  switch (node.type) {
    case "text": {
      return node.value.includes(mark);
    }
    case "bold":
    case "italic":
    case "monospace":
    case "highlight": {
      return node.children.some((child) => carriesMark(child, mark));
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
  const { atoms: inner, trailing } = collectAtoms(node.children, {
    blockStartLine: cursor.blockStartLine,
    insideSpan: true,
    blockAtColumnZero: false,
  });
  // The span's own whitespace lives INSIDE its marks: content whitespace
  // at either edge is a space in the output, never a break, because the
  // marks fuse onto the content they enclose. Both edges are read off
  // the joins themselves — the first atom carries the join its content
  // asked for, and `trailing` is the join the last one left behind.
  const openSpace = inner.length > 0 && inner[0].glueLeft ? "" : " ";
  const closeSpace = trailing === "glue" ? "" : " ";
  const { open, close } = spanMarks(
    node,
    node.constrained ||
      constrainedIsLegal(node, cursor, {
        flush: openSpace === "" && closeSpace === "",
        texts: inner.map((atom) => atom.text),
      }),
  );
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
  const openText = `${open}${openSpace}`;
  pushSpanAtoms(out, boundary, inner, {
    openText,
    closeText: `${closeSpace}${close}`,
    ...detachedMarks(node, cursor, inner, openText),
  });
  return "glue";
}

/**
 * Which of a span's marks may NOT fuse onto the content atom beside
 * it, and must stand alone against a literal break instead. Split
 * from {@link appendSpan} for the complexity ceiling.
 *
 * A raw line at a span EDGE owns its output line, and a mark cannot
 * ride it: fusing the close onto a kept comment line writes
 * `// c**`, which the re-reader swallows into the comment and the
 * rendered text loses the mark and everything behind it (measured on
 * `para\n** b\n// c\n** b`). The span keeps the SOURCE break on that
 * side instead - the mark stands alone against a literal break,
 * exactly where the author's line boundary was. (A span holding a raw
 * line never respells constrained either - constrainedIsLegal's
 * raw-line clause.) The block-start hazard net detaches the open mark
 * the same way (see {@link hazardAtBlockStart}).
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
 * @param node - the span node.
 * @param cursor - where the span sits.
 * @param inner - the span's content atoms.
 * @param openText - the open mark plus the space the content's
 *   leading whitespace became, the atom text the fusion would make.
 * @returns the two placements {@link pushSpanAtoms} takes.
 */
function detachedMarks(
  node: SpanNode,
  cursor: Cursor,
  inner: readonly Atom[],
  openText: string,
): { detachOpen: boolean; detachClose: boolean } {
  return {
    detachOpen:
      node.children[0].type === "rawLine" ||
      hazardAtBlockStart(cursor, `${openText}${inner[0].text}`),
    detachClose:
      node.children.at(-1)?.type === "rawLine" ||
      inner.at(-1)?.text === HARD_BREAK_IMAGE,
  };
}

/**
 * Push a span's atoms with its marks placed: fused onto the edge
 * content atoms in the ordinary case, or standing alone against a
 * literal break where fusing would corrupt (a raw-line edge, the
 * block-start hazard). Split from {@link appendSpan} for the
 * complexity ceiling.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the span.
 * @param inner - the span's content atoms (mutated: marks fuse on).
 * @param marks - how to place the two marks.
 * @param marks.openText - the open mark plus the space the content's
 *   leading whitespace became.
 * @param marks.closeText - the space the content's trailing
 *   whitespace became, plus the close mark.
 * @param marks.detachOpen - emit the open TEXT as its own atom and
 *   open the content at column 0 (the source's own break).
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
    detachOpen: boolean;
    detachClose: boolean;
  },
): void {
  const { openText, closeText, detachOpen, detachClose } = marks;
  const last = inner.length - 1;
  if (!detachClose) {
    inner[last] = { ...inner[last], text: `${inner[last].text}${closeText}` };
  }
  if (detachOpen) {
    out.push(
      withBoundary(atomOf(openText.trimEnd()), boundary),
      withBoundary(inner[0], "literal"),
      ...inner.slice(1),
    );
  } else {
    inner[0] = { ...inner[0], text: `${openText}${inner[0].text}` };
    out.push(withBoundary(inner[0], boundary), ...inner.slice(1));
  }
  if (detachClose) {
    out.push(withBoundary(atomOf(closeText.trimStart()), "literal"));
  }
}

/**
 * Emit a span whose children produced NO atoms: bare marks around the
 * whitespace they stood for. Split from {@link appendSpan} for the
 * complexity ceiling. The block-start hazard net applies here too:
 * `**\n**` replayed as `** **` at column 0 is a ulist line, so the
 * net keeps the source break between the two bare marks.
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
  if (hazardAtBlockStart(cursor, `${open}${closeSpace}${close}`)) {
    out.push(
      withBoundary(atomOf(open), boundary),
      withBoundary(atomOf(close), "literal"),
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
  const lead = ownsItsLine(cursor) ? "literal" : boundary;
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
      return appendText(out, boundary, cursor, node);
    }
    case "bold":
    case "italic":
    case "monospace":
    case "highlight": {
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
   * Whether the run is a formatting span's content, where a closing
   * mark follows in the output.
   */
  readonly insideSpan: boolean;
  /** Whether the block's first atom opens its line at column 0. */
  readonly blockAtColumnZero: boolean;
}

/**
 * Build the atoms for a run of inline siblings.
 * @param nodes - the inline siblings, in order.
 * @param context - the block facts the run's cursors share: source
 *   start line (for the dlist first-line guard), span membership, and
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
 * @param blockAtColumnZero - whether the first atom opens its output
 *   line at column 0 (a paragraph) or follows a printed prefix that
 *   holds the column (a list item's marker, an admonition's label).
 * @returns the block's atoms, ready for {@link wrap}.
 */
export function inlineAtoms(
  nodes: readonly InlineNode[],
  blockStartLine: number,
  blockAtColumnZero: boolean,
): Atom[] {
  const { atoms } = collectAtoms(nodes, {
    blockStartLine,
    insideSpan: false,
    blockAtColumnZero,
  });
  if (blockAtColumnZero && nodes.length > 0) keepBlockStartBreak(atoms, nodes);
  return atoms;
}
