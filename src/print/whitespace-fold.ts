/**
 * The whitespace runs reflow may NOT fold to a single space.
 *
 * Reflow rewrites every run of source whitespace between two words as
 * one space, or as the line break the packer puts there instead. That
 * is what a formatter is for: `a  b` and `a<TAB>b` mean `a b`, and no
 * reader can tell the three apart. Asciidoctor has rules that read
 * such a run as SYNTAX, though, and each of them spells its boundary
 * as the literal SPACE character rather than as `\s` - so folding a
 * tab there does not restyle a line, it turns text into a construct
 * the author never wrote. A rule that fired takes its boundary
 * character WITH it, so what the run is left with is a second thing
 * the fold can get wrong, and a run of two characters is not the same
 * run as one. The BREAK the packer writes instead of a space is a
 * third: a newline is a boundary the way a space is, but the position
 * behind it is also a line start, which bounds a rule while consuming
 * nothing at all, so a break bounds two rules where a space bounds
 * one.
 *
 * Only one DIRECTION of that asymmetry is answered here. Writing a
 * break where the source held a space is refused ({@link
 * breakArmsARow}), because refusing means keeping bytes and keeping
 * bytes is what this module does. REMOVING a break the source held
 * loses the line start the second rule fired on, and that is open
 * under issue #180: the remedy is a break the printer HOLDS rather
 * than bytes inside an atom, which is the packer's to give and not
 * this module's - the same answer the line-break limitation on
 * {@link edgeRun} already gives.
 *
 * This module holds those rules so the splitter that walks a value's
 * words (`splitWords`, src/print/reflow.ts) asks about a run rather
 * than deciding for itself, and so the printer can ask the same
 * question about runs no splitter sees: the ones at a text node's
 * EDGES ({@link keptLeadingRun}, {@link keptTrailingRun}) and the one
 * that IS a whole text node ({@link keptWholeRun}).
 */
import type { InlineNode } from "../ast.js";
import {
  ASCII_WHITESPACE,
  DLIST_SEPARATOR_WORD,
} from "../parse/line-shapes.js";

// The em-dash replacement row, `(?: |\n|^|\\)--(?: |\n|$)`
// (asciidoctor.rb l.498). Of what whitespace can spell, BOTH boundary
// classes hold the literal space and the literal newline and nothing
// else - never a tab - and each side matches ONE character, so it is
// the character ADJACENT to the dashes that decides whether the row
// MATCHES. `--` is very nearly the only row in that table whose
// boundary is spelled that way; the others bound themselves with word
// characters or with nothing at all.
const EM_DASH = "--";

// The same dashes behind the backslash the row's left class also
// accepts. A word ENDING this way carries its own left boundary, so
// only the run after it decides the match.
const ESCAPED_EM_DASH = String.raw`\--`;

// HALF the dashes. Where a lone dash stands FLUSH against an attribute
// reference the other half can come from the reference's value, and
// then the pattern is spelled by two things the tree holds apart:
// `-{d}` with `:d: -`, or `-{d}-` with an empty `:d:`, both render an
// em dash where the run beside them permits it. A word of one dash is
// the only word that can do this, because the row wants the two dashes
// flanked by boundaries and any other character in the word would
// stand between the run and them (issue #154).
const LONE_DASH = "-";

// What the fold writes in a run's place: one space, or the line break
// the packer puts there instead. The row accepts either, so a run whose
// adjacent character is already one of them is a fixed point.
const ROW_BOUNDARY = new Set([" ", "\n"]);

/**
 * Whether the fold would rewrite this run's bytes at all.
 *
 * Asked where the DASHES ARE THE NEIGHBOUR'S, and there matching is
 * not the whole question: the row is replaced whole, boundary
 * characters included, so a two-character run leaves one character
 * standing beside the em dash and a one-character run leaves none.
 * `a  -- b` renders a space, a thin space, an em dash, a thin space
 * and `b`, while the folded `a -- b` has lost that space with the
 * character the row ate (issue #155).
 *
 * So a run beside such a neighbour is a fixed point only when it IS
 * the one character the fold would write.
 * @param run - the run, as the source wrote it.
 * @returns true when the fold would not write the run back unchanged.
 */
function foldRewritesTheRun(run: string): boolean {
  // Membership answers the WIDTH as well: the set holds two runs and
  // each is one character, so a run it holds is already the run the
  // fold would write and a run it does not hold is not.
  return run !== "" && !ROW_BOUNDARY.has(run);
}

/**
 * Whether folding the run between `previous` and `next` would change
 * what the em-dash replacement matches.
 *
 * A tab beside a lone `--` refuses the match at the input and permits
 * it once folded: `a<TAB>--<TAB>b` renders the dashes literally and
 * `a -- b` renders a thin space, an em dash and a thin space. Which END
 * of the run is read depends on which side of it the dashes stand, and
 * only that one character matters: what the row LEAVES cannot be at
 * stake here, because dashes standing as a WORD are dashes no row
 * matched - a row that fires becomes a character reference in the tree
 * (src/parse/inline/replacements.ts) and its dashes are nobody's word.
 * `a  --<TAB>b` therefore still folds to `a --<TAB>b`, whose literal
 * dashes sit in whitespace HTML collapses either way.
 *
 * Only a `--` standing ALONE as a word can be reached from here.
 * Where the dashes sit inside a word the characters beside them
 * decide the row and the run cannot: `foo--` puts `o` in front of the
 * dashes, which the left class rejects, and the row that DOES read
 * `foo--bar` wants a word character straight after the dashes, which
 * no whitespace run supplies.
 * @param previous - the source word in front of the run.
 * @param run - the run itself, as the source wrote it. Non-empty: it
 *   is the text the split cut on.
 * @param next - the source word behind the run.
 * @returns true when the run's bytes decide the replacement.
 */
export function foldChangesEmDash(
  previous: string,
  run: string,
  next: string,
): boolean {
  return runClosesEmDash(previous, run) || runOpensEmDash(run, next);
}

/**
 * Dashes in front of the run: the run is the row's RIGHT boundary,
 * and its FIRST character is the one the row would read.
 * @param previous - the word in front of the run.
 * @param run - the run itself; empty where there is none.
 * @returns true when folding the run would admit the replacement.
 */
function runClosesEmDash(previous: string, run: string): boolean {
  return (
    run !== "" &&
    (previous === EM_DASH || previous.endsWith(ESCAPED_EM_DASH)) &&
    !ROW_BOUNDARY.has(run.slice(0, 1))
  );
}

/**
 * Dashes behind the run: the run is the row's LEFT boundary, and its
 * LAST character is the one the row would read.
 * @param run - the run itself; empty where there is none.
 * @param next - the word behind the run.
 * @returns true when folding the run would admit the replacement.
 */
function runOpensEmDash(run: string, next: string): boolean {
  return run !== "" && next === EM_DASH && !ROW_BOUNDARY.has(run.slice(-1));
}

/**
 * Whether a node can spell the dashes WITHOUT holding their bytes -
 * an attribute reference, and only that.
 *
 * `NORMAL_SUBS` substitutes attributes before the replacement pass
 * (`[:specialcharacters, :quotes, :attributes, :replacements,
 * :macros, :post_replacements]`, substitutors.rb l.16), so `{d}` is
 * already whatever `:d:` was set to by the time the em-dash row reads
 * its boundaries: with `:d: --` in the header, `See a<TAB>{d}<TAB>b`
 * renders literal dashes and `See a {d} b` renders an em dash. The
 * dashes stand in no text node at all, so no rule over the printer's
 * own runs can see the hazard (issue #149).
 *
 * The answer is therefore about the NEIGHBOUR and not about its
 * value: this tree does not model what a reference expands to, and
 * asking would mean resolving the document's attributes at print
 * time. Refusing the fold beside one costs the author's own bytes
 * where the value spells no dashes, and no render anywhere - the same
 * trade span-edges.ts already makes when it refuses to read a
 * reference inside a span's edge run.
 * @param node - the neighbour, or undefined where there is none.
 * @returns true when the node's rendered bytes are not in the tree.
 */
function hidesItsBytes(node: InlineNode | undefined): boolean {
  return node?.type === "attributeReference";
}

/**
 * Whether the node IS the dashes the row already matched.
 *
 * A character reference whose own bytes are `--` is what the
 * replacement scan (src/parse/inline/replacements.ts) leaves where the
 * row fired, and the row's match is wider than the reference: it ate
 * one boundary character on each side, and those bytes stayed in the
 * text nodes beside it. So the run against such a reference is a run
 * the row has already taken a character out of, and folding what is
 * left to a single space spends that character a second time
 * (issue #155).
 * @param node - the neighbour, or undefined where there is none.
 * @returns true for the reference the em-dash row wrote.
 */
function isEmDashReference(node: InlineNode | undefined): boolean {
  return node?.type === "characterReference" && node.value === EM_DASH;
}

/**
 * Whether this neighbour can stand the row's dashes hard against the
 * run: the reference the row itself wrote ({@link isEmDashReference}),
 * or a reference whose value the printer cannot read
 * ({@link hidesItsBytes}). Either way the character beside the run is
 * a dash, and what the row does with the run is the neighbour's
 * business rather than the node's own words'.
 * @param node - the neighbour, or undefined where there is none.
 * @returns true when the dashes could stand at the run's edge.
 */
function neighbourSpellsTheDashes(node: InlineNode | undefined): boolean {
  return isEmDashReference(node) || hidesItsBytes(node);
}

/**
 * What stands at ONE edge of a run: a word of the text node's own
 * value, or the sibling beyond the node's edge. The two rules below
 * ask the same question of either, and a run has one of each kind at
 * most - a node's leading run has a sibling in front and a word
 * behind, its trailing run the mirror, and a node that is nothing but
 * the run has a sibling on both sides.
 */
type RunEdge =
  | {
      /** A word of the node's own value stands here. */
      readonly at: "word";
      /** That word. */
      readonly word: string;
    }
  | {
      /** The run reaches the node's edge and a sibling stands here. */
      readonly at: "sibling";
      /** That sibling, or undefined where there is none. */
      readonly node: InlineNode | undefined;
    };

/**
 * Whether whatever stands at this edge has already EATEN the run's
 * character there.
 *
 * A row consumes its boundary, so the character is gone from the
 * render and cannot bound a second row: in `a -- -- b` the first
 * pair's match takes the space behind it, and the second pair, left
 * with a dash in front of its own, renders literally.
 *
 * The word arm answers on the SPELLING alone and so over-keeps by one
 * shape: the escape row fires only where the character behind the
 * dashes is a space, a newline or the line end, so a word ending
 * `\--` in front of a TAB ate nothing and needs no refusal. Reading
 * the run to tell the two apart would buy back bytes and no render,
 * which is the trade this module makes the other way everywhere else.
 * @param edge - what stands in front of the run.
 * @returns true when a row on that side took the character.
 */
function eatsTheRunsCharacter(edge: RunEdge): boolean {
  return edge.at === "word"
    ? edge.word.endsWith(ESCAPED_EM_DASH)
    : neighbourSpellsTheDashes(edge.node);
}

/**
 * Whether the dashes at this edge still WANT a boundary - dashes
 * whose row has not fired, and which a boundary appearing beside them
 * would arm.
 *
 * The reference the row already wrote is not one of them: it fired,
 * which means it had its boundary, and a break cannot give it a
 * second. Only a value the printer cannot read and a `--` left
 * standing as a word can be waiting for one.
 * @param edge - what stands behind the run.
 * @returns true when a boundary there would admit the replacement.
 */
function wantsTheRunsCharacter(edge: RunEdge): boolean {
  return edge.at === "word" ? edge.word === EM_DASH : hidesItsBytes(edge.node);
}

/**
 * Whether writing a LINE BREAK in this run's place would arm a row
 * that the run's own bytes leave disarmed.
 *
 * The fold and the packer write different things, and only one of
 * them is a character. A space is consumed by the row that matches
 * it and can therefore bound ONE row and no more; a newline is
 * consumed the same way, but the position BEHIND it is a line start,
 * and the row's `^` alternative (asciidoctor.rb l.498) bounds a row
 * there while consuming nothing. So dashes whose only candidate
 * boundary is a character an earlier row already ate stand literal on
 * one line and render an em dash on two: `w -- {d} y` with `:d: --`
 * renders one em dash and two literal dashes, and the same words
 * broken after the first pair render two em dashes.
 *
 * Keeping the run is what forbids the break, and where the run is
 * already the single space the fold would write that costs no bytes
 * at all - only the break opportunity, which is the whole point.
 *
 * This is the WRITING direction only. A break the source already
 * held, which the fold removes, loses a line start the same way and
 * is open under issue #180; the module docstring says why the remedy
 * is not here.
 * @param inFront - what stands in front of the run.
 * @param behind - what stands behind it.
 * @returns true when a break there would change the render.
 */
function breakArmsARow(inFront: RunEdge, behind: RunEdge): boolean {
  return eatsTheRunsCharacter(inFront) && wantsTheRunsCharacter(behind);
}

/** The inline nodes standing on either side of a text node. */
export interface Neighbours {
  /** The sibling in front of it, or undefined where there is none. */
  readonly inFront: InlineNode | undefined;
  /** The sibling behind it, or undefined where there is none. */
  readonly behind: InlineNode | undefined;
}

// A text node's own EDGE runs: the whitespace in front of its first
// word and the whitespace behind its last. `cutValue`
// (src/print/reflow.ts) drops both, because neither stands BETWEEN
// two words of the node - each stands between the node and the inline
// sibling beside it, where the join is src/print/inline.ts's to make.
const LEADING_RUN = new RegExp(`^${ASCII_WHITESPACE.source}+`, "v");
const TRAILING_RUN = new RegExp(`${ASCII_WHITESPACE.source}+$`, "v");

/** The bytes of a text node's edge runs the printer must keep. */
export interface KeptEdgeRuns {
  /** In front of the first word; empty where the fold is safe. */
  readonly leading: string;
  /** Behind the last word; empty where the fold is safe. */
  readonly trailing: string;
}

/**
 * The edge run at either end of a text node, or the empty string
 * where the node has none the printer can keep.
 *
 * A run carrying a LINE BREAK answers empty as well. Keeping an edge
 * run means riding inside the atom beside it, and an atom is
 * newline-free by construction (src/print/reflow.ts). What that costs
 * is a fold the row still reads, and the remedy for it would be a
 * break the printer HOLDS rather than bytes inside a word - the same
 * answer `runKeepsItsBytes` (src/print/reflow.ts) gives an interior
 * run that carries one.
 * @param value - the node's raw source text.
 * @param edge - which end to read.
 * @returns the run's bytes, or the empty string.
 */
function edgeRun(value: string, edge: RegExp): string {
  const run = edge.exec(value)?.[0] ?? "";
  return run.includes("\n") ? "" : run;
}

/**
 * Whether the dashes the row reads are spelled ACROSS the node's
 * trailing edge: the node's LAST word is a lone dash, nothing of the
 * node stands behind it, and the neighbour there is a reference that
 * can supply the other dash.
 *
 * The run at stake is then the one in FRONT of that dash - the node's
 * leading edge run where the dash is its only word, and the run
 * between its last two words otherwise.
 * @param value - the node's raw source text.
 * @param words - its words, as `splitWords` produced them.
 * @param behind - the sibling behind the node.
 * @returns true when the two spell the pattern between them.
 */
function dashesFuseBehind(
  value: string,
  words: readonly string[],
  behind: InlineNode | undefined,
): boolean {
  return (
    words.at(-1) === LONE_DASH &&
    hidesItsBytes(behind) &&
    !TRAILING_RUN.test(value)
  );
}

/**
 * The word the row reads beside a run: the author's own word, or the
 * whole pattern where that word is a lone dash the reference beside it
 * completes.
 * @param word - the word the node holds there.
 * @param fuses - whether it runs into a reference on its far side.
 * @returns what the row reads there.
 */
function rowWord(word: string, fuses: boolean): string {
  return fuses && word === LONE_DASH ? EM_DASH : word;
}

/**
 * The mirror of {@link dashesFuseBehind}, across the node's LEADING
 * edge.
 * @param value - the node's raw source text.
 * @param words - its words, as `splitWords` produced them.
 * @param inFront - the sibling in front of the node.
 * @returns true when the two spell the pattern between them.
 */
function dashesFuseInFront(
  value: string,
  words: readonly string[],
  inFront: InlineNode | undefined,
): boolean {
  return (
    words.at(0) === LONE_DASH &&
    hidesItsBytes(inFront) &&
    !LEADING_RUN.test(value)
  );
}

/**
 * The bytes of a text node's LEADING run that the em-dash replacement
 * reads, and that the fold would therefore cost it.
 *
 * {@link foldChangesEmDash} sees only the runs BETWEEN two words of
 * one node, so a lone `--` whose deciding character stands on the
 * other side of a node boundary loses it: `https://e.com<TAB>--<TAB>`
 * and then an email address is a text node holding nothing but the
 * dashes, its two tabs both edge runs, and folding them spells the
 * replacement the source refused. What the oracle renders then is not
 * a stray em dash but two destroyed links, because the thin-space
 * entities the replacement writes extend the bare-URL match until the
 * first anchor swallows the second whole (issue #145).
 *
 * The edges are read with the same per-character test the interior
 * runs get, and that is what keeps the rule narrow: where the OTHER
 * side of the dashes is an interior run, `splitWords` has already
 * fused it, so the node's first word is `--<TAB>word` rather than
 * `--` and no edge question arises. Only dashes that reach a node
 * boundary are asked about here.
 *
 * The MIRRORED half of each edge is asked of the NEIGHBOUR, because
 * three nodes can spell the dashes the node's own words do not. A
 * character reference whose value IS `--` (`a -- b` reads as the text
 * `a `, the reference, and the text ` b`) is the row's own output, and
 * the run against it is what the row LEFT: it already ate one
 * character there, so `a --  b` keeps its two-character run and only a
 * run that is already one space folds ({@link isEmDashReference},
 * issue #155). A passthrough is the second, and there Asciidoctor
 * exempts its content from the replacement pass (measured:
 * `a<TAB>+++--+++<TAB>b` and `a +++--+++ b` both render the dashes
 * literally), so it reads as no dashes at all. The third is an
 * ATTRIBUTE REFERENCE, whose value is substituted before the
 * replacement pass runs and is not in this tree at all
 * ({@link hidesItsBytes}, issue #149).
 *
 * The node's own word at the edge is read through {@link rowWord} for
 * the same reason: a lone dash flush against a reference is HALF the
 * pattern, and the row reads the whole of it (issue #154).
 * @param value - the node's raw source text.
 * @param words - its words, as `splitWords` produced them; non-empty.
 * @param gluedInFront - whether the run has anything to ride against:
 *   the join in front of the node is a glue AND something is already
 *   written for it to ride on, which is a previous atom at block
 *   level and the opening mark at the head of a span's content
 *   (issue #147). The printer then writes nothing at all between that
 *   byte and this node's first atom, so the run can stand where the
 *   source put it; under any other join the printer writes its own
 *   space or its own break there and the bytes have nowhere to go.
 * @param neighbours - the inline siblings on either side of the node.
 *   The one in FRONT carries the mirrored half above; the one BEHIND
 *   is read only where the node holds a single word, which is then
 *   the word this run stands against AND the word the neighbour
 *   fuses with.
 * @returns the bytes to keep, or the empty string where the fold is
 *   safe.
 */
export function keptLeadingRun(
  value: string,
  words: readonly string[],
  gluedInFront: boolean,
  neighbours: Neighbours,
): string {
  if (!gluedInFront) {
    return "";
  }
  const run = edgeRun(value, LEADING_RUN);
  const behindTheRun = rowWord(
    words[0],
    words.length === 1 && dashesFuseBehind(value, words, neighbours.behind),
  );
  const inFront: RunEdge = { at: "sibling", node: neighbours.inFront };
  const behind: RunEdge = { at: "word", word: behindTheRun };
  const kept =
    runOpensEmDash(run, behindTheRun) ||
    (neighbourSpellsTheDashes(neighbours.inFront) && foldRewritesTheRun(run)) ||
    breakArmsARow(inFront, behind);
  return kept ? run : "";
}

/**
 * The bytes of a text node's TRAILING run that the em-dash
 * replacement reads. The mirror of {@link keptLeadingRun}, which
 * states the rule.
 * @param value - the node's raw source text.
 * @param words - its words, as `splitWords` produced them; non-empty.
 * @param followed - whether anything stands behind the run that can
 *   carry its bytes: an inline sibling among the node's own siblings,
 *   or the closing mark of the span this node is the last child of
 *   (issue #147), which is written flush onto the content it
 *   encloses. A node with neither ENDS the block, where the run is
 *   the last line's trailing whitespace and the reader's own rstrip
 *   takes it (`prepare_lines`, reader.rb l.582), so the row reads `$`
 *   beside the dashes whether the run folds or not.
 * @param neighbours - the inline siblings on either side of the node,
 *   read the way {@link keptLeadingRun} states them, mirrored.
 * @returns the bytes to keep, or the empty string where the fold is
 *   safe.
 */
export function keptTrailingRun(
  value: string,
  words: readonly string[],
  followed: boolean,
  neighbours: Neighbours,
): string {
  if (!followed) {
    return "";
  }
  const [last] = words.slice(-1);
  const run = edgeRun(value, TRAILING_RUN);
  const inFrontOfTheRun = rowWord(
    last,
    words.length === 1 && dashesFuseInFront(value, words, neighbours.inFront),
  );
  const inFront: RunEdge = { at: "word", word: inFrontOfTheRun };
  const behind: RunEdge = { at: "sibling", node: neighbours.behind };
  const kept =
    runClosesEmDash(inFrontOfTheRun, run) ||
    (neighbourSpellsTheDashes(neighbours.behind) && foldRewritesTheRun(run)) ||
    breakArmsARow(inFront, behind);
  return kept ? run : "";
}

/**
 * The bytes of an ALL-WHITESPACE text node the printer must keep.
 *
 * Such a node has no words, so it has no atom for an edge run to ride
 * inside and neither {@link keptLeadingRun} nor
 * {@link keptTrailingRun} can be asked about it - yet it is exactly a
 * run standing between two siblings, and the dashes on either side of
 * it are the same dashes those two rules read. `--  --  a` holds one:
 * the two-space run between the two references the em-dash row wrote,
 * and folding it to one space leaves the second reference without the
 * boundary character its own row consumed.
 *
 * The whole value is the run, so the rules that read a word beside it
 * have nothing to read: only the neighbours can spell the dashes here.
 * @param value - the node's raw source text, all whitespace.
 * @param glued - whether the run has anything to ride against, the
 *   same fact {@link keptLeadingRun} calls `gluedInFront`.
 * @param followed - whether anything stands behind the run, the same
 *   fact {@link keptTrailingRun} takes under that name. A run with
 *   nothing behind it ENDS the block, where the reader's own rstrip
 *   takes it (`prepare_lines`, reader.rb l.582) before any row reads
 *   a boundary, so its bytes are in no render and keeping them only
 *   widens an atom nothing can break.
 * @param neighbours - the inline siblings on either side of the node.
 * @returns the bytes to keep, or the empty string where the fold is
 *   safe.
 */
export function keptWholeRun(
  value: string,
  glued: boolean,
  followed: boolean,
  neighbours: Neighbours,
): string {
  if (!glued || !followed || value.includes("\n")) {
    return "";
  }
  const inFront: RunEdge = { at: "sibling", node: neighbours.inFront };
  const behind: RunEdge = { at: "sibling", node: neighbours.behind };
  const dashesBeside =
    neighbourSpellsTheDashes(neighbours.inFront) ||
    neighbourSpellsTheDashes(neighbours.behind);
  const kept =
    (dashesBeside && foldRewritesTheRun(value)) ||
    breakArmsARow(inFront, behind);
  return kept ? value : "";
}

// The run standing in front of a value's final dash, and the one
// standing behind its first. Read off the raw value because
// `splitWords` returns only the words: the runs it folded are gone by
// then, and the run this module has to see is one of them.
const RUN_BEFORE_FINAL_DASH = new RegExp(
  `(${ASCII_WHITESPACE.source}+)-$`,
  "v",
);
const RUN_AFTER_OPENING_DASH = new RegExp(
  `^${ASCII_WHITESPACE.source}*-(${ASCII_WHITESPACE.source}+)`,
  "v",
);

// The two words a fuse replaces with one, counted from the end of the
// word list: the dash itself and the word the run separates it from.
const FUSED_PAIR = -2;

/**
 * The words with the run in front of a final lone dash riding inside
 * the word before it.
 *
 * Two refusals ride along, both for the reason `runKeepsItsBytes`
 * (src/print/reflow.ts) states: a run carrying a LINE BREAK cannot
 * ride inside an atom, and nothing fuses across a description-list
 * separator word, which the anchored `DLIST_SEPARATOR_WORD` would
 * stop recognising once it stood inside a longer word.
 * @param value - the node's raw source text.
 * @param words - its words, as `splitWords` produced them.
 * @returns the words, fused where the run is load-bearing.
 */
function fuseFinalDash(
  value: string,
  words: readonly string[],
): readonly string[] {
  const previous = words.at(FUSED_PAIR) ?? "";
  const run = RUN_BEFORE_FINAL_DASH.exec(value)?.[1] ?? "";
  const fuses =
    !run.includes("\n") &&
    !DLIST_SEPARATOR_WORD.test(previous) &&
    foldRewritesTheRun(run);
  return fuses
    ? [...words.slice(0, FUSED_PAIR), `${previous}${run}${LONE_DASH}`]
    : words;
}

/**
 * The mirror of {@link fuseFinalDash}: the run behind an opening lone
 * dash rides inside the word after it.
 * @param value - the node's raw source text.
 * @param words - its words, as `splitWords` produced them.
 * @returns the words, fused where the run is load-bearing.
 */
function fuseOpeningDash(
  value: string,
  words: readonly string[],
): readonly string[] {
  const next = words.at(1) ?? "";
  const run = RUN_AFTER_OPENING_DASH.exec(value)?.[1] ?? "";
  const fuses =
    !run.includes("\n") &&
    !DLIST_SEPARATOR_WORD.test(next) &&
    foldRewritesTheRun(run);
  return fuses ? [`${LONE_DASH}${run}${next}`, ...words.slice(2)] : words;
}

/**
 * The node's words, with the run beside a lone dash kept where the
 * dash spells the row's pattern only because an attribute reference
 * stands flush against it.
 *
 * `splitWords` (src/print/reflow.ts) is asked about ONE value and
 * decides each run from the two words around it, which is enough
 * wherever the pattern is spelled in the node's own bytes. It is not
 * enough where the reference supplies half of it: `a<TAB>-{h} b` with
 * `:h: -` renders an em dash once the tab folds, and the word the
 * splitter saw beside the tab was a single dash. So the answer is
 * amended here, where the neighbours are known, rather than inside a
 * splitter that has no tree to look at.
 *
 * Both ends are asked, because either can be the flush one, and the
 * two never contend: each fuses the run against a DIFFERENT end of the
 * word list, and a one-word node has no run between two words at all.
 * @param value - the node's raw source text.
 * @param words - its words, as `splitWords` produced them.
 * @param neighbours - the inline siblings on either side of the node.
 * @returns the words the printer should write.
 */
export function fuseRunsBesideReferences(
  value: string,
  words: readonly string[],
  neighbours: Neighbours,
): readonly string[] {
  if (words.length < 2) {
    return words;
  }
  const afterBehind = dashesFuseBehind(value, words, neighbours.behind)
    ? fuseFinalDash(value, words)
    : words;
  return dashesFuseInFront(value, afterBehind, neighbours.inFront)
    ? fuseOpeningDash(value, afterBehind)
    : afterBehind;
}

// The bracket spellings a checklist prefix opens with that survive a
// whitespace split as ONE word. `[ ]` does not: its own space cuts it
// into `[` and `]`, which is why the two head shapes below are two
// arms rather than one lookup.
const MARKED_BRACKETS = new Set(["[x]", "[*]"]);

/**
 * Which checklist prefix a value's head would spell once its runs are
 * folded to spaces.
 *
 * Asciidoctor reads a checked or unchecked box off an unordered item's
 * first line, and the test is a literal one:
 * `item_text.start_with?('[ ] ', '[x] ', '[*] ')` (parser.rb l.1330,
 * whose arm sets the list's `checklist` option and slices the four
 * characters off the item's text). The space is the fourth character
 * of each spelling, so `* [x]<TAB>a` is an item whose text is
 * `[x]<TAB>a` while `* [x] a` is a CHECKED item whose text is `a`.
 *
 * Two head shapes reach the prefix's four characters across a
 * whitespace split - `[x]` or `[*]` and then anything, or `[`, `]` and
 * then anything - and nothing past the third word can spell one at
 * all, because the prefix is four characters long.
 *
 * The reader's side of the same line of Ruby spells the three prefixes
 * as a pattern (`CHECKBOX_RE`, src/parse/build/list.ts); the two are
 * readings of one rule, and the oracle binds both.
 * @param words - the value's words, in order. Asked of source words
 *   and of finished atom texts alike, because the prefix is spelled
 *   the same either way.
 * @returns which prefix the head would spell, or undefined for a head
 *   that spells none.
 */
export function checklistHead(
  words: readonly string[],
): "markedBracket" | "splitBracket" | undefined {
  const [first, second] = words;
  if (words.length < 2) {
    return undefined;
  }
  if (MARKED_BRACKETS.has(first)) {
    return "markedBracket";
  }
  if (first === "[" && second === "]" && words.length > 2) {
    return "splitBracket";
  }
  return undefined;
}

/**
 * Whether keeping this run's bytes would spell the prefix's own space
 * anyway.
 *
 * Ruby tests the prefix against `item_text`, which is the item's FIRST
 * line and which the reader has already right-stripped
 * (`prepare_lines`, reader.rb l.582). So a run that opens with a space
 * and stays on the line still reads as the prefix's space whatever
 * stands behind it, while a run carrying a LINE BREAK ends the line,
 * and the strip takes every blank it left in front of the break.
 * @param run - the run, as the source wrote it.
 * @returns true when the prefix's space survives the run's own bytes.
 */
function spellsThePrefixSpace(run: string): boolean {
  return run.startsWith(" ") && !run.includes("\n");
}

/**
 * The one run at a value's head whose fold would spell a checklist
 * prefix the source did not write.
 *
 * At most one run in either head shape needs its bytes: the first run
 * that is not already the prefix's own space is the one that breaks
 * the spelling, and a run after it would only hold bytes nothing
 * reads.
 *
 * The question is asked of every block's text, not only a list item's,
 * because the splitter has no block. Everywhere else the answer costs
 * the author's own bytes and no meaning: a paragraph opening
 * `[x]<TAB>a` keeps its tab instead of folding it, and nothing reads a
 * checklist prefix there.
 * @param words - the value's source words, in order.
 * @param runs - the runs between them: `runs[index]` stands between
 *   `words[index]` and `words[index + 1]`.
 * @returns the index in `runs` of the run that must keep its bytes, or
 *   undefined where no fold at this head spells a prefix.
 */
export function manufacturedChecklistRun(
  words: readonly string[],
  runs: readonly string[],
): number | undefined {
  const head = checklistHead(words);
  if (head === undefined) {
    return undefined;
  }
  // `[x]` or `[*]`, then anything: the fold writes the prefix's space
  // straight after the bracket, and that one run is the whole story.
  if (head === "markedBracket") {
    return spellsThePrefixSpace(runs[0]) ? undefined : 0;
  }
  // `[`, `]`, then anything: the first run spells the prefix's inner
  // space and the second its trailing one, so whichever of the two is
  // not already a lone space is the one to keep.
  if (runs[0] !== " ") {
    return 0;
  }
  return spellsThePrefixSpace(runs[1]) ? undefined : 1;
}

// ── The thematic break a fold would spell ──────────────────

// The marks a thematic break is spelled with, and how many of them
// its line holds. Asciidoctor reads the spelling through two
// patterns - `ExtLayoutBreakRx` (rx.rb l.650,
// `/^(?:'{3,}|<{3,}|([-*_])( *)\1\2\1)$/`) at column 0 and
// `MarkdownThematicBreakRx` (rx.rb l.638, `/^ {0,3}([-*_])( *)\1\2\1$/`)
// behind an indent - and both want THREE identical marks with EQUAL
// runs of spaces between them and nothing else on the line.
const BREAK_MARKS = new Set(["-", "*", "_"]);
const BREAK_MARK_COUNT = 3;

// A gap either pattern accepts between two marks: SPACES, and at
// least one of them. A tab there is not one, which is why a tab in an
// interior run is a fold this module refuses rather than a rule the
// source already had.
const SPACE_RUN = /^ +$/v;

/**
 * The break MARK a prefix the printer writes puts at the head of a
 * block's first line, and how wide the SOURCE's own gap behind it
 * was.
 *
 * Only a `-` or `*` list marker spells one: an ordered marker, a
 * callout, a `NOTE: ` label, a description term and a span's opening
 * mark all write a word no rule reads. The gap travels with it
 * because the printer writes ONE space after a marker whatever the
 * source wrote, so the source's own line and the printed one differ
 * there, and only the source's answers whether the author already
 * had a rule.
 *
 * A WIDTH and not the bytes, which is the one thing this cannot ask
 * the reader for: no node records the run between a marker and its
 * text. A gap holding a TAB therefore reads here as a gap of spaces,
 * and a source line whose marker gap is a tab as wide as the value's
 * run is folded as though it already spelled the rule. That line is
 * text to Asciidoctor and the fold's output is an `<hr>` - the same
 * loss the fold already had there before this rule existed, left
 * where it stood rather than widened.
 */
export interface MarkInFront {
  /** The mark itself, as the printer will write it. */
  readonly mark: string;
  /** Columns between it and the block's first word in the SOURCE. */
  readonly sourceGapWidth: number;
}

/**
 * What of the output line a value holds, which is what decides
 * whether a fold of its runs can spell a whole rule.
 */
export type LineShare =
  | {
      /**
       * Nothing a fold of this value writes can be a rule's whole
       * line: an inline sibling shares the line, or the prefix in
       * front of it spells no mark.
       */
      readonly holds: "noRuleHere";
    }
  | {
      /** The value is the whole line, opening it at column 0. */
      readonly holds: "theWholeLine";
    }
  | ({
      /** The value is the rest of a line a break's mark opens. */
      readonly holds: "behindAMark";
    } & MarkInFront);

/** The one answer with no payload, built once. */
export const NO_RULE_HERE: LineShare = { holds: "noRuleHere" };

// The runs standing BETWEEN a value's words, which is the set
// `cutValue` (src/print/reflow.ts) hands the splitter: a run at either
// EDGE is not between two words and is dropped there, so it is
// dropped here too.
const INTERIOR_RUNS = new RegExp(`${ASCII_WHITESPACE.source}+`, "gv");

/**
 * The runs between a value's words, in order.
 * @param value - the node's raw source text.
 * @returns the runs; `runs[index]` stands between `words[index]` and
 *   `words[index + 1]`.
 */
function interiorRuns(value: string): readonly string[] {
  return (
    value
      .replace(LEADING_RUN, "")
      .replace(TRAILING_RUN, "")
      .match(INTERIOR_RUNS) ?? []
  );
}

/**
 * Whether a run would reach the packed line as anything but the one
 * space the join writes.
 *
 * NARROWER THAN {@link foldRewritesTheRun}, which is asked beside
 * dashes, where a break the packer writes bounds the row as well as a
 * space does and so counts as writing the run back. The question here
 * is about the LINE the marks would share, and a break does not put
 * them on one at all: it is the run this rule most needs to see
 * rewritten.
 * @param run - the run, as the source wrote it.
 * @returns true when the join would not write the run back unchanged.
 */
function joinRewritesTheRun(run: string): boolean {
  return run !== " ";
}

/**
 * Whether the words are a break's marks: identical, one character
 * each, and as many as the line still wants.
 * @param words - the value's words, in order.
 * @param wanted - how many marks the value must supply.
 * @param mark - the mark they must be, or undefined for any of the
 *   three.
 * @returns true when the words spell them.
 */
function areBreakMarks(
  words: readonly string[],
  wanted: number,
  mark: string | undefined,
): boolean {
  return (
    words.length === wanted &&
    BREAK_MARKS.has(words[0]) &&
    (mark === undefined || words[0] === mark) &&
    words.every((word) => word === words[0])
  );
}

/**
 * Whether the source's own line already spelled the rule, so the fold
 * has nothing to take away.
 *
 * Both patterns want gaps of SPACES and want them EQUAL, so the two
 * runs on the line decide it. Behind a marker the first of those runs
 * is the marker's own, which the printer replaces with a single space
 * either way, and the source's width is the only record of it
 * ({@link MarkInFront}).
 * @param runs - the runs between the value's words.
 * @param inFront - the mark the prefix writes, or undefined at column
 *   0, where the value holds every run on the line.
 * @returns true when the source line was already a rule.
 */
function sourceLineSpelledTheRule(
  runs: readonly string[],
  inFront: MarkInFront | undefined,
): boolean {
  const gaps =
    inFront === undefined
      ? runs
      : [" ".repeat(inFront.sourceGapWidth), ...runs];
  return gaps.every((gap) => gap === gaps[0] && SPACE_RUN.test(gap));
}

/**
 * Whether folding this value's runs would spell a THEMATIC BREAK on a
 * line that did not spell one in the source.
 *
 * The fold writes ONE SPACE in a run's place, so the only rule the
 * fold can manufacture is the single-spaced one: a line whose words
 * are the three marks. The source's own gaps therefore decide it - a
 * line whose gaps are already equal spaces IS the rule and has
 * nothing to lose here, and every other spelling of the same three
 * marks is TEXT to Asciidoctor until the fold makes the gaps agree.
 *
 * WIDER THAN THIS READER'S OWN VOCABULARY, and the divergence is the
 * point. `THEMATIC_BREAK` (src/parse/line-shapes.ts) reads the spaced
 * form for `_` and refuses it for `-` and `*`, because a spaced `-`
 * or `*` line is an `UnorderedListRx` marker line that `parse_list`
 * keeps inside its open list (#182). Asciidoctor's own `<hr>` does
 * not care: at a BLOCK START `- - -` and `* * *` are rules to it, so
 * a fold that writes one where the source had item text moves the
 * render. The oracle binds results, so the question asked here is the
 * ORACLE's - all three marks - not this reader's.
 * @param value - the node's raw source text.
 * @param words - its words, as the splitter produced them.
 * @param share - what of the output line the value holds.
 * @returns true when a fold here would write a rule the source's own
 *   line did not spell.
 */
function foldSpellsAThematicBreak(
  value: string,
  words: readonly string[],
  share: LineShare,
): boolean {
  if (share.holds === "noRuleHere") {
    return false;
  }
  const inFront = share.holds === "behindAMark" ? share : undefined;
  const wanted =
    inFront === undefined ? BREAK_MARK_COUNT : BREAK_MARK_COUNT - 1;
  // The WORDS answer first, and they answer for every text node in
  // every document: only a value of two or three lone marks reaches
  // the runs, so the cut below is paid for by the handful of nodes
  // that could spell a rule rather than by all of them.
  if (!areBreakMarks(words, wanted, inFront?.mark)) {
    return false;
  }
  const runs = interiorRuns(value);
  return (
    runs.some((run) => joinRewritesTheRun(run)) &&
    !sourceLineSpelledTheRule(runs, inFront)
  );
}

/**
 * The value's words, with every run kept whose fold would help spell
 * a thematic break the source's line did not.
 *
 * Keeping the bytes is the whole remedy and it is always available:
 * an unequal gap, a tab or a longer run left where the author wrote
 * it is a line Asciidoctor reads exactly as it read the source's. The
 * runs it CANNOT keep this way are the ones carrying a line break,
 * which no atom may hold ({@link runKeepsItsBytes},
 * src/print/reflow.ts); those are {@link breakMarkHeldOnItsLine}'s.
 *
 * BEHIND A MARKER the kept bytes are the value's and not the LINE's:
 * the printer writes one space after a marker whatever the source
 * wrote, so a source line that spelled the rule with WIDER gaps
 * (`-  -  -`) is folded rather than kept - keeping it there would
 * write `- -  -`, which is neither the source's line nor a rule.
 * {@link sourceLineSpelledTheRule} is what separates the two, and the
 * cases it cannot reach are the ones whose FIRST gap the marker owns
 * (`-  - -`): the printer narrows that gap on its own and no refusal
 * of a fold can widen it back. Those are the same reading gap #182
 * records and are unchanged here.
 * @param value - the node's raw source text.
 * @param words - its words, as the splitter produced them.
 * @param share - what of the output line the value holds.
 * @returns the words, fused where a run must keep its bytes.
 */
export function fuseRunsSpellingABreak(
  value: string,
  words: readonly string[],
  share: LineShare,
): readonly string[] {
  if (!foldSpellsAThematicBreak(value, words, share)) {
    return words;
  }
  const runs = interiorRuns(value);
  const packed: string[] = [words[0]];
  // The first word has no run in front of it to keep, so the walk
  // starts at the second and reads the run behind its predecessor.
  for (let index = 1; index < words.length; index += 1) {
    const run = runs[index - 1];
    if (joinRewritesTheRun(run) && !run.includes("\n")) {
      packed[packed.length - 1] += run + words[index];
    } else {
      packed.push(words[index]);
    }
  }
  return packed;
}

/** What {@link breakMarkHeldOnItsLine} answers where no word is held. */
export const NO_HELD_MARK = -1;

/**
 * The word that must open an output line of its own, so the packer's
 * space does not join two source lines into a thematic break.
 *
 * The run carrying the author's line break is the one run
 * {@link fuseRunsSpellingABreak} may not keep inside a word, so this
 * is the same refusal made with the other move the printer has: the
 * break the source wrote stays where the source wrote it, and the
 * marks never share a line. Asked AFTER the fuse, so a value whose
 * other runs were kept no longer spells the marks and holds nothing.
 * @param value - the node's raw source text.
 * @param words - its words, as the fuse left them.
 * @param share - what of the output line the value holds.
 * @returns the word's index, or {@link NO_HELD_MARK}.
 */
export function breakMarkHeldOnItsLine(
  value: string,
  words: readonly string[],
  share: LineShare,
): number {
  if (!foldSpellsAThematicBreak(value, words, share)) {
    return NO_HELD_MARK;
  }
  const broken = interiorRuns(value).findIndex((run) => run.includes("\n"));
  return broken === NO_HELD_MARK ? NO_HELD_MARK : broken + 1;
}
