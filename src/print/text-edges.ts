/**
 * What stands BESIDE a text node, and what its edges therefore ask of
 * the printer - the counterpart of `span-edges.ts`, which answers the
 * same two questions for a span.
 *
 * Three answers live here. Whether a sibling that shares the block's
 * packing stands on either side of the node; the join its LEADING
 * whitespace asks for; and what has to happen to a trailing `+` so it
 * never lands bare at the end of an output line. All three are read
 * by `appendText` (inline.ts) at the moment it turns one text node
 * into atoms, and all three are facts about the node's NEIGHBOURS
 * rather than about its bytes, which is why they are one module and
 * not three.
 *
 * Split out of inline.ts, whose `max-lines` ceiling the edge rules
 * issue #147 added left no room in.
 */
import type { InlineNode } from "../ast.js";
import { isBlockSyntaxAtLineStart } from "./reflow.js";
import type { Boundary, Cursor } from "./atom-join.js";

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
 * neighbour of nothing. Spelled once, here, because two callers need
 * the node itself and a third needs only whether there is one.
 * @param cursor - where the node sits.
 * @returns the preceding sibling, or undefined when there is none.
 */
export function precedingSibling(cursor: Cursor): InlineNode | undefined {
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
export function followingSibling(cursor: Cursor): InlineNode | undefined {
  return cursor.siblings.at(cursor.index + 1);
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
