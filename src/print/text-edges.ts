/**
 * What stands BESIDE a text node, and what its surroundings therefore
 * ask of the printer - the counterpart of `span-edges.ts`, which
 * answers the same two questions for a span.
 *
 * Which nodes stand on either side of it and whether they share the
 * block's packing; the words it splits into, where a neighbour or the
 * line it will be written on is what makes one of its runs
 * load-bearing; how much of that line it holds; how many of its words
 * were on the BLOCK's first source line; the join its LEADING
 * whitespace asks for; and what has to happen to a trailing `+` so it
 * never lands bare at the end of an output line. Every one of them is
 * read by `appendText` (inline.ts) at the moment it turns one text
 * node into atoms, and none is a fact about the node's bytes alone,
 * which is why they are one module and not six.
 *
 * Split out of inline.ts, whose `max-lines` ceiling the edge rules
 * issue #147 added left no room in, and which still has none.
 */
import type { InlineNode, TextNode } from "../ast.js";
import {
  atomOf,
  isBlockSyntaxAtLineStart,
  splitWords,
  type Atom,
} from "./reflow.js";
import {
  strongerBoundary,
  withBoundary,
  type Boundary,
  type Cursor,
} from "./atom-join.js";
import {
  breakMarkHeldOnItsLine,
  fuseRunsBesideReferences,
  fuseRunsSpellingABreak,
  keptWholeRun,
  NO_HELD_MARK,
  NO_RULE_HERE,
  type LineShare,
  type Neighbours,
} from "./whitespace-fold.js";

// Siblings that do NOT share the enclosing block's packing: a raw
// line forces a break on both sides. The node before one still ENDS
// an output line, so a trailing `+` there is a hard line break and
// must be escaped, and a word after one starts a line rather than
// fusing. (Nested lists are not inline siblings — an item's `text`
// holds inline nodes only; its blocks print elsewhere.)
const OWN_LINE_SIBLINGS = new Set(["rawLine"]);

/**
 * The node standing directly in FRONT of the one at `cursor`, or
 * undefined at the head of the run.
 *
 * The index guard is the whole function: `at(-1)` reads the LAST
 * element, so asking for "one before index 0" off a bare array
 * answers with the node at the other end of the run - which is a
 * neighbour of nothing. Spelled once, here, because one caller needs
 * the node itself and another needs only whether there is one.
 * @param cursor - where the node sits.
 * @returns the preceding sibling, or undefined when there is none.
 */
function precedingSibling(cursor: Cursor): InlineNode | undefined {
  return cursor.index <= 0 ? undefined : cursor.siblings.at(cursor.index - 1);
}

/**
 * The node standing directly BEHIND the one at `cursor`, or undefined
 * at the end of the run. The mirror of {@link precedingSibling}, and
 * it needs no guard: an index past the end is not an index from the
 * end.
 * @param cursor - where the node sits.
 * @returns the following sibling, or undefined when there is none.
 */
function followingSibling(cursor: Cursor): InlineNode | undefined {
  return cursor.siblings.at(cursor.index + 1);
}

/**
 * Both siblings at once, for the rules that read one on each side.
 *
 * The whitespace-fold rules ask about BOTH neighbours of the same text
 * node - one carries the dashes standing beyond an edge run, and the
 * other can complete a lone dash the node's own bytes only half spell -
 * so they take the pair rather than an argument per side.
 * @param cursor - where the node sits.
 * @returns the nodes on either side, each undefined where there is
 *   none.
 */
export function neighboursOf(cursor: Cursor): Neighbours {
  return {
    inFront: precedingSibling(cursor),
    behind: followingSibling(cursor),
  };
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
export function firstSourceLineWordCount(
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

/**
 * How much of its output line a text node's value holds - the fact
 * the thematic-break rules read ({@link LineShare},
 * src/print/whitespace-fold.ts).
 *
 * A node with an inline sibling on either side shares the line with
 * it, so no fold of its runs writes a whole line. Alone, the block's
 * own start says the rest: at column 0 the value IS the line, and
 * behind a prefix only a mark that prefix writes can make a rule of
 * it.
 * @param cursor - where the node sits.
 * @param neighbours - the nodes on either side of it.
 * @returns what of the line the value holds.
 */
export function lineShareOf(cursor: Cursor, neighbours: Neighbours): LineShare {
  if (neighbours.inFront !== undefined || neighbours.behind !== undefined) {
    return NO_RULE_HERE;
  }
  const { blockStart } = cursor;
  if (blockStart.atColumnZero) {
    return { holds: "theWholeLine" };
  }
  return blockStart.markInFront === undefined
    ? NO_RULE_HERE
    : { holds: "behindAMark", ...blockStart.markInFront };
}

/**
 * A text node's words, as the printer will write them.
 *
 * `splitWords` (src/print/reflow.ts) is asked about ONE value and
 * cannot see the tree, so where a neighbour completes a run's meaning
 * the split it returns is amended here - the one place that holds both
 * the value and the nodes beside it.
 *
 * The two amendments never contend: the reference rule wants a
 * neighbour beyond one of the node's edges, and the break rule wants
 * the node to have no neighbour at all.
 * @param value - the node's raw source text.
 * @param neighbours - the nodes on either side of it.
 * @param share - what of the output line the value holds.
 * @returns its words, in order, each carrying any run that must ride
 *   inside it.
 */
export function wordsOfText(
  value: string,
  neighbours: Neighbours,
  share: LineShare,
): readonly string[] {
  const words = fuseRunsBesideReferences(value, splitWords(value), neighbours);
  return fuseRunsSpellingABreak(value, words, share);
}

/**
 * Keep the author's line break between two of a thematic break's
 * marks, so the packer's space cannot join them into one.
 *
 * The other half of the same refusal ({@link fuseRunsSpellingABreak},
 * src/print/whitespace-fold.ts) keeps a run's bytes inside a word,
 * which no run carrying a line break may do. This is the move that is
 * left, and it is the same trade the block-start net makes
 * (src/print/block-start-hazard.ts): the source's own break, put back
 * where the source had it.
 *
 * A `"literal"` break rebuilds that line at COLUMN 0, which is not
 * always the column the author used. Under a NESTED item it is not:
 * `* a` then two spaces and `- -` then two spaces and `-` comes back
 * with its last line flush left. What the choice keeps is the
 * READING, which is what the trade is for - the line is the item's
 * text at any indent, because a lone mark is no marker (the paragraph
 * below), and it holds the render and the fixed point in every nested
 * shape measured. The `"hard"` spelling would write the block's
 * continuation indent instead, which is bytes the source never had
 * wherever the author was already flush left. Pinned either way, as a
 * characterization row in tests/format/breaks.test.ts.
 *
 * `noBreakBefore` is cleared for the reason the block-start net
 * clears it: a lone `-` or `*` is fused backwards because it would be
 * a list marker at a line start, and the line this puts it back on is
 * the source's own, where a marker with no text after it is no marker
 * at all (`UnorderedListRx` wants whitespace AND text, rx.rb l.284).
 * @param atoms - the node's atoms (mutated).
 * @param value - the node's raw source text.
 * @param words - its words, as the fuse left them.
 * @param share - what of the output line the value holds.
 */
export function keepBreakBetweenMarks(
  atoms: Atom[],
  value: string,
  words: readonly string[],
  share: LineShare,
): void {
  const held = breakMarkHeldOnItsLine(value, words, share);
  if (held === NO_HELD_MARK) {
    return;
  }
  atoms[held] = {
    ...atoms[held],
    breakBefore: "literal",
    noBreakBefore: false,
  };
}

/**
 * Whether a run at the head of this text node has anything ALREADY
 * WRITTEN to ride against.
 *
 * Keeping an edge run means riding inside the atom beside it, so the
 * join in front has to be a glue AND something has to be there to
 * fuse onto. At the head of a BLOCK there is nothing, and the bytes
 * would open an output line instead of standing between two nodes. At
 * the head of a SPAN's content there is one even though no atom has
 * been emitted - the opening mark, which `appendSpan` (inline.ts)
 * writes flush onto the first atom - so the enclosing span is what
 * says the run has somewhere to go (issue #147).
 * @param out - the block's atoms so far.
 * @param boundary - the join standing in front of the node.
 * @param cursor - where the node sits.
 * @returns true when the run's bytes have somewhere to go.
 */
export function ridesOnWhatIsWritten(
  out: readonly Atom[],
  boundary: Boundary,
  cursor: Cursor,
): boolean {
  return (
    (out.length > 0 || cursor.enclosing !== undefined) && boundary === "glue"
  );
}

/**
 * Whether a run at the TAIL of this text node has anything to ride
 * against - the mirror of {@link ridesOnWhatIsWritten}.
 *
 * An inline sibling in the same block packing is one such thing; the
 * closing mark of an enclosing span is the other, and it stands
 * behind the run whatever the siblings say (issue #147). A node with
 * neither ENDS the block, where the reader's own rstrip takes the run
 * (`prepare_lines`, reader.rb l.582).
 *
 * Read by every trailing-run rule, so it is spelled once: the whole
 * of it is the two things that can carry the bytes, and a caller that
 * re-derived it would be stating that list a second time.
 * @param cursor - where the node sits.
 * @returns true when the run's bytes have somewhere to go.
 */
export function ridesOnWhatFollows(cursor: Cursor): boolean {
  return hasFollowingInlineSibling(cursor) || cursor.enclosing !== undefined;
}

/**
 * Emit an ALL-WHITESPACE text node: the break opportunity its
 * whitespace stands for, or the bytes themselves where a replacement
 * row reads them.
 *
 * Such a node has no words and so no atom for an edge run to ride
 * inside. Where the run is load-bearing it becomes an atom of its
 * own, glued at both ends, so the printer writes the author's bytes
 * there and nothing of its own. Everywhere else the node contributes
 * no atom at all, only the join: dropping that would fuse adjacent
 * siblings or collapse content whitespace inside formatting marks.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the node.
 * @param value - the node's raw source text, all whitespace.
 * @param cursor - where the node sits, for its neighbours and for
 *   whether the run has anything to ride against on either side.
 * @returns the join this node leaves behind.
 */
export function appendWholeRun(
  out: Atom[],
  boundary: Boundary,
  value: string,
  cursor: Cursor,
): Boundary {
  const glued = ridesOnWhatIsWritten(out, boundary, cursor);
  const whole = keptWholeRun(
    value,
    glued,
    ridesOnWhatFollows(cursor),
    neighboursOf(cursor),
  );
  if (whole === "") {
    return strongerBoundary(boundary, "break");
  }
  out.push(withBoundary(atomOf(whole), "glue"));
  return "glue";
}

/**
 * Check whether the node at `cursor` is followed by a sibling
 * that participates in the same block packing.
 * @param cursor - where the node sits.
 * @returns True when an inline sibling directly follows.
 */
export function hasFollowingInlineSibling(cursor: Cursor): boolean {
  const next = followingSibling(cursor);
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
export function hasPrecedingInlineSibling(cursor: Cursor): boolean {
  const previous = precedingSibling(cursor);
  return previous !== undefined && !OWN_LINE_SIBLINGS.has(previous.type);
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
 *
 * That last arm is live, and the tokenizer is why. `HARD_BREAK`
 * (src/parse/inline/rules.ts) takes a `+` behind a literal SPACE, up
 * to trailing blanks and the line end - so ` +` at a line end is
 * already a hardLineBreak node and never reaches a word list. A `+`
 * behind any OTHER whitespace is not: `a<TAB>+` is text whose last
 * word is `+`, and it comes out `a {plus}`.
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
export function trailingPlusPolicy(
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
      cursor.enclosing === undefined &&
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
export function leadingBoundary(
  cursor: Cursor,
  words: readonly string[],
): Boundary {
  return isBlockSyntaxAtLineStart(words[0]) && hasPrecedingInlineSibling(cursor)
    ? "space"
    : "break";
}
