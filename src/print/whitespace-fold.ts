/**
 * The runs a printed LINE reads as syntax: the checklist prefix a
 * marker line would spell, and the thematic break a packed line
 * would.
 *
 * Both questions are about the whole OUTPUT LINE rather than about
 * one run's own bytes, which is why they are here and not in the
 * whitespace record (src/whitespace-fact.ts): a record row states
 * what one run means where the source wrote it, and neither of these
 * rules can be stated that way. Asciidoctor reads a checkbox off the
 * first four characters of an item's TEXT (parser.rb l.1330), and it
 * reads `<hr>` off a line whose gaps agree - so what is dangerous is
 * the LINE the packer would write, not the run the author wrote.
 *
 * The remedy both use is the same: keep the run's bytes, riding
 * inside the word beside it, so the line the reader sees back is the
 * line the author wrote. The one run that cannot ride that way is a
 * run carrying a LINE BREAK, which no atom may hold; there the
 * remedy is the break itself, held where the source put it
 * ({@link breakMarkHeldOnItsLine}).
 */
import { THEMATIC_BREAK } from "../parse/line-shapes.js";
import { cutValue } from "../whitespace-runs.js";

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

// ── The thematic break a fold would spell ──────────────────

// A gap the rule accepts between two marks: SPACES, and at
// least one of them. A tab there is not one, which is why a tab in an
// interior run is a fold this module refuses rather than a rule the
// source already had.
const SPACE_RUN = /^ +$/v;

/**
 * The break MARK a prefix the printer writes puts at the head of a
 * block's first line.
 *
 * Only a `-` or `*` list marker spells one: an ordered marker, a
 * callout, a `NOTE: ` label, a description term and a span's opening
 * mark all write a word no rule reads.
 *
 * ONE FIELD, and it used to be two: the source's gap behind the mark
 * travelled here as a WIDTH, because the printer normalized that gap
 * to one space and only the source's own record could say what the
 * author's line had spelled. `ListItemNode.markerGap` (src/ast.ts) is
 * that record, and the printer writes it back, so the gap on the
 * printed line IS the gap on the source line and the question this
 * value existed to answer has no asker left (#191).
 */
export interface MarkInFront {
  /** The mark itself, as the printer will write it. */
  readonly mark: string;
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

/**
 * Whether a run would reach the packed line as anything but the one
 * space the join writes.
 *
 * NARROWER THAN the record's own width question (`noWidthToRead`,
 * src/whitespace-fact.ts), which is asked beside dashes, where a
 * break the packer writes bounds the row as well as a space does and
 * so counts as writing the run back. The question here is about the
 * LINE the marks would share, and a break does not put them on one at
 * all: it is the run this rule most needs to see rewritten.
 * @param run - the run, as the source wrote it.
 * @returns true when the join would not write the run back unchanged.
 */
function joinRewritesTheRun(run: string): boolean {
  return run !== " ";
}

/**
 * Whether the LINE the fold would write is one the reader reads as a
 * thematic break.
 *
 * Asked of the READER'S OWN ROW ({@link THEMATIC_BREAK},
 * src/parse/line-shapes.ts) rather than of a mark set of this
 * module's: the row reads all three marks in their spaced form, and
 * the two questions - which marks, how many of them, identical, one
 * character each, equal gaps - are all its pattern's already. A
 * second spelling here would be a second chance to disagree with the
 * reader about what a rule is.
 *
 * The line is spelled with ONE SPACE between the words because that
 * is what the fold writes; the source's own gaps are
 * {@link sourceLineSpelledTheRule}'s question, not this one.
 * @param words - the value's words, in order.
 * @param mark - the mark a printed prefix already put on the line, or
 *   undefined where the value holds the whole of it.
 * @returns true when the folded line reads as a break.
 */
function foldWritesABreakLine(
  words: readonly string[],
  mark: string | undefined,
): boolean {
  return THEMATIC_BREAK.test(
    (mark === undefined ? words : [mark, ...words]).join(" "),
  );
}

/**
 * Whether the source's own line already spelled the rule, so the fold
 * has nothing to take away.
 *
 * Both patterns want gaps of SPACES and want them EQUAL, so the runs
 * on the line decide it. Asked at COLUMN 0 only, where the value holds
 * every run the line has and the fold therefore decides the whole
 * spelling. Behind a MARK the line has one run the value does not hold
 * - the marker's own - and the printer writes that one back verbatim
 * ({@link ListItemNode.markerGap}, src/ast.ts), so there the answer
 * that keeps the reading is not "was it a rule" but "write the line
 * the author wrote"; see {@link foldSpellsAThematicBreak}.
 * @param runs - the runs between the value's words.
 * @returns true when the source line was already a rule.
 */
function sourceLineSpelledTheRule(runs: readonly string[]): boolean {
  return runs.every((gap) => gap === runs[0] && SPACE_RUN.test(gap));
}

/**
 * Whether folding this value's runs would spell a THEMATIC BREAK on a
 * line that did not spell one in the source.
 *
 * The fold writes ONE SPACE in a run's place, so the only rule the
 * fold can manufacture is the single-spaced one: a line whose words
 * are the three marks. AT COLUMN 0 the source's own gaps decide it - a
 * line whose gaps are already equal spaces IS the rule and has
 * nothing to lose here, and every other spelling of the same three
 * marks is TEXT to Asciidoctor until the fold makes the gaps agree.
 *
 * BEHIND A MARK the answer is simply YES, and that is the narrower
 * question paying for itself. The line there is the marker's gap plus
 * the value's runs, and the printer writes the gap back verbatim
 * (`ListItemNode.markerGap`, src/ast.ts): keeping the value's runs too
 * reproduces the author's line exactly, which is a rule when it was
 * one and prose when it was not.
 *
 * THIS ARM IS BYTE PRESERVATION STANDING IN FOR A READING WE GET
 * WRONG, which is issue #313: both programs read `t:: d` over
 * `-  -  -` as an `<hr>` inside the description and our reader reads
 * a nested one-item list, so the line's own verdict cannot be asked
 * about it. Keeping the bytes keeps the render; the reading is #313's
 * to fix, and this arm leaves with it.
 *
 * WHY NOT weigh the two halves, which is what this asked before the
 * gap was replayed. A PROSPECTIVE argument about the design as it now
 * stands, not a bug that was ever observed: with the gap written back,
 * answering "the source already spelled the rule, so there is nothing
 * to lose" would let the fold narrow the VALUE's half alone, and
 * `-  -  -` would print `-  - -`, whose gaps no longer agree and which
 * is therefore no rule. The old spelling never printed that, because
 * it narrowed both halves at once (`-  -  -` printed `- - -`, still an
 * `<hr>`); it is the replay that makes the two halves independent, and
 * this is the answer that keeps them in step.
 *
 * ONE VOCABULARY, the reader's. `THEMATIC_BREAK`
 * (src/parse/line-shapes.ts) reads the spaced form for all three
 * marks, and the classifier holds the row off at the positions where
 * an open list claims the line instead - which is a question about
 * WHERE the line stands, not about what it spells. So the marks, the
 * count and the equal gaps are asked of that row and of nothing
 * else.
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
  // The WORDS answer first, and they answer for every text node in
  // every document: only a value of two or three lone marks reaches
  // the runs, so the cut below is paid for by the handful of nodes
  // that could spell a rule rather than by all of them.
  if (!foldWritesABreakLine(words, inFront?.mark)) {
    return false;
  }
  const { runs } = cutValue(value);
  return (
    runs.some((run) => joinRewritesTheRun(run)) &&
    (inFront !== undefined || !sourceLineSpelledTheRule(runs))
  );
}

/**
 * The interior runs whose BYTES the printed line reads, so the packer
 * may not write its own space in their place.
 *
 * The rule is about the LINE, and keeping a run's bytes inside the
 * word beside it reproduces the author's line, which Asciidoctor
 * reads exactly as it read the source's: every run of a line whose
 * fold would spell a thematic break is held.
 *
 * The runs it CANNOT hold this way are the ones carrying a LINE
 * BREAK, which no atom may hold; those are
 * {@link breakMarkHeldOnItsLine}'s.
 * @param value - the node's raw source text.
 * @param words - its words, as the shared cut produced them.
 * @param runs - the runs between those words, in order.
 * @param share - what of the output line the value holds.
 * @returns the indices, into `runs`, of the runs the line reads.
 */
export function runsTheLineReads(
  value: string,
  words: readonly string[],
  runs: readonly string[],
  share: LineShare,
): ReadonlySet<number> {
  const held = new Set<number>();
  if (foldSpellsAThematicBreak(value, words, share)) {
    for (const [index, run] of runs.entries()) {
      if (joinRewritesTheRun(run)) {
        held.add(index);
      }
    }
  }
  return held;
}

/** What {@link breakMarkHeldOnItsLine} answers where no word is held. */
export const NO_HELD_MARK = -1;

/**
 * The word that must open an output line of its own, so the packer's
 * space does not join two source lines into a thematic break.
 *
 * The run carrying the author's line break is the one run
 * {@link runsTheLineReads} names but no word may keep inside it, so this
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
  const broken = cutValue(value).runs.findIndex((run) => run.includes("\n"));
  return broken === NO_HELD_MARK ? NO_HELD_MARK : broken + 1;
}
