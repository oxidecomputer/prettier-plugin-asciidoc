/**
 * What stands BESIDE a text node, and what its edges therefore ask of
 * the printer - the counterpart of `span-edges.ts`, which answers the
 * same two questions for a span.
 *
 * Four answers live here. Which nodes stand on either side of it and
 * whether they share the block's packing; the words it splits into,
 * where a neighbour is what makes one of its runs load-bearing; the
 * join its LEADING whitespace asks for; and what has to happen to a
 * trailing `+` so it never lands bare at the end of an output line.
 * All four are read by `appendText` (inline.ts) at the moment it turns
 * one text node into atoms, and all four are facts about the node's
 * NEIGHBOURS rather than about its bytes, which is why they are one
 * module and not four.
 *
 * Split out of inline.ts, whose `max-lines` ceiling the edge rules
 * issue #147 added left no room in.
 */
import type { InlineNode } from "../ast.js";
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
  fuseRunsBesideReferences,
  keptWholeRun,
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
 * A text node's words, as the printer will write them.
 *
 * `splitWords` (src/print/reflow.ts) is asked about ONE value and
 * cannot see the tree, so where a neighbour completes a run's meaning
 * the split it returns is amended here - the one place that holds both
 * the value and the nodes beside it.
 * @param value - the node's raw source text.
 * @param neighbours - the nodes on either side of it.
 * @returns its words, in order, each carrying any run that must ride
 *   inside it.
 */
export function wordsOfText(
  value: string,
  neighbours: Neighbours,
): readonly string[] {
  return fuseRunsBesideReferences(value, splitWords(value), neighbours);
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
