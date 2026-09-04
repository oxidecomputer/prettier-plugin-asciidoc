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
 * than deciding for itself.
 */

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
  // Dashes in front of the run: the run is the row's RIGHT boundary,
  // and its FIRST character is the one the row would read.
  const closes = previous === EM_DASH || previous.endsWith(ESCAPED_EM_DASH);
  // Dashes behind it: the run is the LEFT boundary, and its LAST
  // character is the one the row would read.
  const opens = next === EM_DASH;
  return (
    (closes && !ROW_BOUNDARY.has(run.slice(0, 1))) ||
    (opens && !ROW_BOUNDARY.has(run.slice(-1)))
  );
}
