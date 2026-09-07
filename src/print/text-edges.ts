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
  type Atom,
  type HeldJoin,
} from "./reflow.js";
import { cutValue, factsOf, type NodeFacts } from "../whitespace-runs.js";
import { ASCII_HORIZONTAL_WHITESPACE } from "../parse/line-shapes.js";
import type { WhitespaceFact } from "../whitespace-record.js";
import {
  strongerBoundary,
  withBoundary,
  type Boundary,
  type Cursor,
} from "./atom-join.js";
import {
  breakMarkHeldOnItsLine,
  NO_HELD_MARK,
  NO_RULE_HERE,
  runsTheLineReads,
  type LineShare,
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
 * Whether ANY inline node stands beside this one - a raw line
 * included, which is what makes this wider than
 * {@link hasPrecedingInlineSibling} and its mirror.
 *
 * The rule that reads it is about the LINE: a value with a sibling on
 * either side does not hold the whole of one, so no fold of its runs
 * can write a line the reader reads as a rule.
 * @param cursor - where the node sits.
 * @returns true when the node has a neighbour on either side.
 */
function hasAnySibling(cursor: Cursor): boolean {
  return (
    precedingSibling(cursor) !== undefined ||
    followingSibling(cursor) !== undefined
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
 * @param words - The node's words, as {@link wordsOfText} packed
 *   them, so the "no line break anywhere" answer costs no second cut.
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
  // Every word is a contiguous slice of the value, in order, and no
  // word spans a line break (a run carrying one never rides inside
  // an atom), so walking the value once counts them exactly.
  let at = 0;
  let count = 0;
  for (const word of words) {
    at = node.value.indexOf(word, at) + word.length;
    if (at > firstNewline) {
      break;
    }
    count += 1;
  }
  return count;
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
 * @returns what of the line the value holds.
 */
export function lineShareOf(cursor: Cursor): LineShare {
  if (hasAnySibling(cursor)) {
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
 * What the whitespace record makes of one run: whether its bytes must
 * ride inside the word beside it, and what the packer must write in
 * its place where they need not.
 *
 * An atom is NEWLINE-FREE by construction, so a run whose bytes carry
 * a line break cannot ride inside a word however exactly the record
 * reads it. What is left is the break itself, held where the source
 * put it: the same bytes are not written back, but the line boundary
 * the row reads is. A one-space `verbatim` run needs no ride either -
 * the packer's own space IS those bytes - and asks only that no break
 * land there.
 * @param fact - the run's fact, or undefined for a run the record
 *   does not hold (a run inside byte-preserved content, or one at the
 *   block's own edge).
 * @param run - the run, as the source wrote it.
 * @returns whether the bytes ride, and what the join must be.
 */
export function joinOfFact(
  fact: WhitespaceFact | undefined,
  run: string,
): { readonly rides: boolean; readonly held: HeldJoin } {
  if (fact === undefined || fact.kind === "free") {
    return { rides: false, held: "none" };
  }
  if (fact.kind === "bound") {
    return { rides: false, held: fact.to === "newline" ? "newline" : "space" };
  }
  if (run.includes("\n")) {
    return { rides: false, held: "newline" };
  }
  return run === " "
    ? { rides: false, held: "space" }
    : { rides: true, held: "none" };
}

/**
 * A text node's words, and what the record holds against each join.
 *
 * Exported because it names {@link wordsOfText}'s result; its one src
 * caller destructures it, and tests/format/whitespace-fold.test.ts
 * is what reaches it.
 * @internal
 */
export interface TextWords {
  /** The words, with every run that must ride fused inside one. */
  readonly words: readonly string[];
  /** `held[index]` is the join held in front of `words[index]`. */
  readonly held: readonly HeldJoin[];
}

/**
 * A text node's words, as the printer will write them.
 *
 * ONE walk of the value's runs, reading two sources that cannot be
 * merged: the whitespace record, which says what each run MEANS where
 * the source wrote it, and the two whole-LINE rules
 * ({@link runsTheLineReads}), which say what the packed line would
 * spell. The record is read and never re-derived - the words this
 * returns carry a run's bytes only where a row of the record, or one
 * of those two line rules, put them there.
 *
 * A WORD THIS RETURNS MAY THEREFORE HOLD WHITESPACE, and every
 * question asked of one downstream has to be asked of its words
 * rather than of the whole (`holdsDescriptionSeparatorWord`,
 * src/parse/line-shapes.ts, is the registry's own spelling of the one
 * question that cares). Refusing the ride instead, to keep a
 * downstream anchored pattern true, destroys the run's bytes: a tab
 * behind a checklist bracket folds to the space that MAKES the item a
 * checkbox, so `* [x]<TAB>a:: b` rendered a checked box the source
 * never spelled (issue #294).
 * @param value - the node's raw source text.
 * @param facts - the record's facts for this node's runs.
 * @param share - what of the output line the value holds.
 * @returns its words and the joins between them.
 */
export function wordsOfText(
  value: string,
  facts: NodeFacts,
  share: LineShare,
): TextWords {
  const { words, runs } = cutValue(value);
  const lineRuns = runsTheLineReads(value, words, runs, share);
  const packed: string[] = [];
  const held: HeldJoin[] = [];
  for (const [index, word] of words.entries()) {
    if (index === 0) {
      packed.push(word);
      held.push("none");
      continue;
    }
    const run = runs[index - 1];
    const join = joinOfFact(facts.interior[index - 1], run);
    // A run the LINE reads rides for the same reason a `verbatim` run
    // does, and under the same refusal: no atom may hold a newline.
    const rides =
      join.rides || (lineRuns.has(index - 1) && !run.includes("\n"));
    if (rides) {
      packed[packed.length - 1] += run + word;
      continue;
    }
    packed.push(word);
    held.push(join.held);
  }
  return { words: packed, held };
}

/**
 * Keep the author's line break between two of a thematic break's
 * marks, so the packer's space cannot join them into one.
 *
 * The other half of the same refusal ({@link runsTheLineReads},
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
 * whitespace stands for, or the bytes themselves where the record
 * reads them.
 *
 * Such a node has no words and so no atom for the run to ride inside.
 * Where the record holds its bytes it becomes an atom of its own,
 * glued at both ends, so the printer writes the author's bytes there
 * and nothing of its own. Where the record holds only its SPELLING
 * the join carries the answer instead. Everywhere else the node
 * contributes no atom at all, only the join: dropping that would fuse
 * adjacent siblings or collapse content whitespace inside formatting
 * marks.
 * @param out - the block's atoms so far (mutated).
 * @param boundary - the join standing in front of the node.
 * @param node - the text node, whose value is all whitespace.
 * @param cursor - where the node sits, for whether the run has
 *   anything to ride against on either side.
 * @returns the join this node leaves behind.
 */
export function appendWholeRun(
  out: Atom[],
  boundary: Boundary,
  node: TextNode,
  cursor: Cursor,
): Boundary {
  const { value } = node;
  const join = joinOfFact(factsOf(cursor.facts, node).whole, value);
  const carried =
    ridesOnWhatIsWritten(out, boundary, cursor) && ridesOnWhatFollows(cursor);
  if (!join.rides || !carried) {
    return strongerBoundary(boundary, HELD_BOUNDARY[join.held]);
  }
  out.push(withBoundary(atomOf(value), "glue"));
  return "glue";
}

/**
 * The join a held run asks for. A run bound to a SPACE forbids the
 * break the packer would otherwise be free to write; one bound to a
 * NEWLINE demands it; a run the record does not hold asks for the
 * ordinary breakable space.
 */
export const HELD_BOUNDARY = {
  none: "break",
  space: "space",
  newline: "hardBreak",
} as const satisfies Record<HeldJoin, Boundary>;

// A hard line break OWNS its line when nothing but whitespace
// precedes it there, which in AST terms means the text node in front
// of it ends with the newline that opened the line (plus any further
// indentation the token did not take).
const LINE_START_BEFORE_BREAK = /\n[ \t]*$/v;

// A text node that is nothing but horizontal whitespace, which the
// walk below reads THROUGH: the newline that opened its line is not
// in it, because the node in front of it took that newline
// (`skipNewlineAfterHardBreak`, src/parse/inline/inline-node-builder.ts)
// and left the next line's indent behind as a node of its own.
const HORIZONTAL_WHITESPACE_ONLY = new RegExp(
  `^${ASCII_HORIZONTAL_WHITESPACE.source}+$`,
  "v",
);

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
 * A WALK and not one look back, because the newline is not always in
 * the node holding the indent under it: a hard break's own newline is
 * dropped when the node is built (`skipNewlineAfterHardBreak`,
 * src/parse/inline/inline-node-builder.ts), so the next line's indent
 * reaches here as a text node of nothing but horizontal whitespace
 * with no newline in it. The walk reads through such a node to what
 * ended the line in front of it and stops at anything else, which is
 * what keeps a SAME-LINE space out: `*a*  +` puts one space between
 * the span and the break's image, and the span is not a node that
 * ends a line.
 *
 * Over the SIBLINGS rather than over a `Cursor`, because the item's
 * reflow hazard (src/print/list-hazard.ts) asks the same question of
 * a finished node and the two must not answer it differently: which
 * breaks print a ` +` of their own is what puts an indented line on a
 * list item's first rest line.
 * The arms below are exhaustive because the tokenizer materializes
 * inter-sibling whitespace - a newline included - as a text node: a
 * break's predecessor either is that text node, or is a node that
 * ended with no newline behind it, so no other node kind can put
 * line-opening whitespace in front of the break.
 * @param siblings - the inline nodes the break sits among.
 * @param index - the break's index among them.
 * @returns True when only whitespace precedes it on its line.
 */
export function hardBreakOwnsItsLine(
  siblings: readonly InlineNode[],
  index: number,
): boolean {
  for (let at = index - 1; at >= 0; at -= 1) {
    const previous = siblings[at];
    if (previous.type === "rawLine" || previous.type === "hardLineBreak") {
      return true;
    }
    if (previous.type !== "text") {
      return false;
    }
    if (!HORIZONTAL_WHITESPACE_ONLY.test(previous.value)) {
      return LINE_START_BEFORE_BREAK.test(previous.value);
    }
  }
  return false;
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
 * Whether the sibling standing after the node at `cursor` opens an
 * output line of its own, so nothing follows this node on ITS line.
 *
 * A NARROWER question than {@link hasFollowingInlineSibling}, and it
 * has to be its own: that one answers whether a following node shares
 * the packing, which a hard break's own join reads to decide what it
 * leaves behind, and a break whose predecessor ends the line still
 * needs that answer. This one answers whether the node at `cursor`
 * ends an output line, which is what a trailing `+` must know: a
 * break the source gave a line of its own opens one here too
 * ({@link hardBreakOwnsItsLine}), so the ` +` such a `+` would close
 * its line with is a hard line break the source did not write.
 * @param cursor - where the node sits.
 * @returns true when the node's own output line ends with it.
 */
function followerOpensItsOwnLine(cursor: Cursor): boolean {
  const next = followingSibling(cursor);
  return (
    next?.type === "hardLineBreak" &&
    hardBreakOwnsItsLine(cursor.siblings, cursor.index + 1)
  );
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
  const followedInBlock =
    hasFollowingInlineSibling(cursor) && !followerOpensItsOwnLine(cursor);
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
