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
 * the author never wrote.
 *
 * This module holds those rules so the splitter that walks a value's
 * words (`splitWords`, src/print/reflow.ts) asks about a run rather
 * than deciding for itself, and so the printer can ask the same
 * question about the runs at a text node's EDGES, which no splitter
 * sees ({@link keptLeadingRun} and {@link keptTrailingRun}).
 */
import type { InlineNode } from "../ast.js";
import { ASCII_WHITESPACE } from "../parse/line-shapes.js";

// The em-dash replacement row, `(?: |\n|^|\\)--(?: |\n|$)`
// (asciidoctor.rb l.498). Of what whitespace can spell, BOTH boundary
// classes hold the literal space and the literal newline and nothing
// else - never a tab - and each side matches ONE character, so it is
// the character ADJACENT to the dashes that decides the row and never
// the rest of the run. `--` is very nearly the only row in that table
// whose boundary is spelled that way; the others bound themselves with
// word characters or with nothing at all.
const EM_DASH = "--";

// The same dashes behind the backslash the row's left class also
// accepts. A word ENDING this way carries its own left boundary, so
// only the run after it decides the match.
const ESCAPED_EM_DASH = String.raw`\--`;

// What the fold writes in a run's place: one space, or the line break
// the packer puts there instead. The row accepts either, so a run whose
// adjacent character is already one of them is a fixed point.
const ROW_BOUNDARY = new Set([" ", "\n"]);

/**
 * Whether folding the run between `previous` and `next` would change
 * what the em-dash replacement matches.
 *
 * A tab beside a lone `--` refuses the match at the input and permits
 * it once folded: `a<TAB>--<TAB>b` renders the dashes literally and
 * `a -- b` renders a thin space, an em dash and a thin space. Which END
 * of the run is read depends on which side of it the dashes stand, and
 * only that one character matters - `a  --<TAB>` still folds to
 * `a --`, because what refused the row there was the tab at the line's
 * end, which is not part of any run BETWEEN two words and which
 * keeping the two spaces would not bring back.
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
 * three nodes can spell the bare dashes and only two of them are
 * fixed points. A character reference whose value IS `--` (`a -- b`
 * reads as the text `a `, the reference, and the text ` b`) exists
 * only where the row ALREADY matched, and the row matches only over a
 * space or a newline - so the character the fold would rewrite on
 * that side is already one of them, and rewriting it can neither arm
 * the row nor disarm it. `a  --  b` keeps a two-character run whose
 * adjacent character is a space either way. A passthrough is the
 * second, and there Asciidoctor exempts its content from the
 * replacement pass (measured: `a<TAB>+++--+++<TAB>b` and
 * `a +++--+++ b` both render the dashes literally). The third is an
 * ATTRIBUTE REFERENCE, which is neither: its value is substituted
 * before the replacement pass runs and is not in this tree at all
 * ({@link hidesItsBytes}, issue #149).
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
 * @param inFront - the inline sibling standing in front of the node,
 *   or undefined where there is none. Read for the mirrored half
 *   above, and for nothing else.
 * @returns the bytes to keep, or the empty string where the fold is
 *   safe.
 */
export function keptLeadingRun(
  value: string,
  words: readonly string[],
  gluedInFront: boolean,
  inFront: InlineNode | undefined,
): string {
  if (!gluedInFront) {
    return "";
  }
  const run = edgeRun(value, LEADING_RUN);
  const kept =
    runOpensEmDash(run, words[0]) ||
    (hidesItsBytes(inFront) && runClosesEmDash(EM_DASH, run));
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
 * @param behind - the inline sibling standing behind the node, or
 *   undefined where there is none. Read for the mirrored half
 *   {@link keptLeadingRun} states, and for nothing else.
 * @returns the bytes to keep, or the empty string where the fold is
 *   safe.
 */
export function keptTrailingRun(
  value: string,
  words: readonly string[],
  followed: boolean,
  behind: InlineNode | undefined,
): string {
  if (!followed) {
    return "";
  }
  const [last] = words.slice(-1);
  const run = edgeRun(value, TRAILING_RUN);
  const kept =
    runClosesEmDash(last, run) ||
    (hidesItsBytes(behind) && runOpensEmDash(run, EM_DASH));
  return kept ? run : "";
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
