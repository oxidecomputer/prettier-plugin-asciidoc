/**
 * Where the four UNCONSTRAINED (doubled) rows of `QUOTE_SUBS` put
 * their delimiters in one fragment: `**` (asciidoctor.rb l.446),
 * `` `` `` (asciidoctor.rb l.454), `__` (asciidoctor.rb l.458) and
 * `##` (asciidoctor.rb l.462), four rows of the table at
 * asciidoctor.rb l.439-469.
 *
 * WHY THIS IS A SCAN AND NOT A RULE. A doubled mark is not decidable
 * from its own neighbourhood. Each unconstrained row is one gsub of
 * `\\?(?:\[([^\]]+)\])?XX(#{CC_ALL}+?)XX` over the WHOLE text
 * (`sub_quotes`, substitutors.rb l.189-196), so the same two
 * characters are a delimiter or ordinary text depending on what stands
 * arbitrarily far away: `**a**` pairs, `**a*` does not, and the two
 * differ only in their last character. A tokenizer that took every
 * adjacent pair as a doubled mark answers the second one wrongly, and
 * the CONSTRAINED row that runs next (asciidoctor.rb l.448 and its
 * three siblings) never gets offered the single mark the oracle pairs
 * there - `####` renders `<mark>#</mark>#`, not the plain text a
 * greedy reading leaves.
 *
 * WHAT THE ROW MATCHES, transcribed rather than generalized. The
 * content group `(#{CC_ALL}+?)` is lazy and demands at least one
 * character, and `CC_ALL` is `.` under `/m`, so it takes newlines too:
 * the closing delimiter is the FIRST `XX` at or after `open + 3`, and
 * nothing between the two is excluded.
 *
 * THE WALK IS OVER MATCH STARTS, NOT OVER DELIMITERS, because the
 * optional `\\?(?:\[([^\]]+)\])?` prefix CAN move the opening
 * delimiter. `gsub` takes the leftmost match START, and the attrlist
 * group's `[^\]]+` excludes only `]`, so a bracketed run that holds
 * the pair swallows it and the opener is the `XX` behind the `]`:
 * `[a**b]**c**` renders `<strong class="a**b">c</strong>`, opening at
 * offset 6 and not at the 2 a search for the first `XX` would answer.
 * So each start is tried in turn, and a start that fails does NOT end
 * the row: an attrlist-derived opener stands to the RIGHT of starts
 * still to come, so a later start can succeed where it failed -
 * `[a**b]**` renders `[a<strong>b]</strong>`, whose delimiters are the
 * 2 and 6 that the failed start at 0 skipped past.
 *
 * The escape half of that prefix is recorded but NOT resolved. Ruby's
 * escaped match still consumes its delimiters, which is what this scan
 * records, but it then writes the text back unescaped for the later
 * rows to re-read, and re-reading a row's own output is outside this
 * parser's one-coordinate-space model: `\[a**b]**c**` renders
 * `<strong class="a**b">*c</strong>*`, where the constrained row
 * matched the unconstrained row's literal output.
 *
 * Deciding which of these spans survive is span-pairing.ts's job, the
 * way it is for the curved-quote scan next door.
 */
import { seesCurvedRewrite, type MarkKind } from "./quote-boundaries.js";
import type { CurvedScan } from "./curved-quotes.js";
import { DELIM_WIDTH } from "../../constants.js";

/**
 * An unconstrained delimiter is the constrained mark written twice.
 * Shared with span-pairing.ts, which pairs tokens of this width.
 */
export const UNCONSTRAINED_WIDTH = DELIM_WIDTH + DELIM_WIDTH;

// `(#{CC_ALL}+?)` demands at least one character, so a closing
// delimiter never abuts its opener.
const SHORTEST_CONTENT = 1;

// The shortest text an unconstrained row can match, measured from the
// OPENING DELIMITER: two delimiters and the content between them. The
// optional prefix only ever puts the delimiter further right, so a
// start with less than this much text behind it cannot match either.
const SHORTEST_MATCH =
  UNCONSTRAINED_WIDTH + SHORTEST_CONTENT + UNCONSTRAINED_WIDTH;

// Ruby's `\\?`: one optional backslash in front of the whole match.
const ESCAPE = "\\";

// The attrlist group's own brackets, `\[([^\]]+)\])?`.
const ATTRLIST_OPEN = "[";
const ATTRLIST_CLOSE = "]";

/**
 * The four unconstrained rows, in the table's own order, each with the
 * character its delimiter doubles. The order is immaterial to the
 * result - the four characters are distinct, so no row can claim an
 * offset another row wants - and is kept only so the table reads
 * against `QUOTE_SUBS` itself (asciidoctor.rb l.446-462).
 */
const UNCONSTRAINED_ROWS: ReadonlyArray<{
  readonly kind: MarkKind;
  readonly mark: string;
}> = [
  { kind: "bold", mark: "*" },
  { kind: "monospace", mark: "`" },
  { kind: "italic", mark: "_" },
  { kind: "highlight", mark: "#" },
];

/**
 * The next offset at or after `from` where a match could BEGIN.
 *
 * Only three characters can begin one: the delimiter's own mark, with
 * neither optional group taken; a backslash, which `\\?` takes; and the
 * `[` the attrlist group opens with. Anywhere else both optional groups
 * match empty and the delimiter is then required where it does not
 * stand. Skipping the rest is what keeps the walk linear in the
 * fragment rather than quadratic in it.
 * @param source - the fragment as this row reads it
 * @param mark - the character the row's delimiter doubles
 * @param from - the first offset to consider
 * @returns the offset, or -1 when no start is left
 */
function nextStart(source: string, mark: string, from: number): number {
  for (let index = from; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (
      character === mark ||
      character === ESCAPE ||
      character === ATTRLIST_OPEN
    ) {
      return index;
    }
  }
  return -1;
}

/**
 * Where `\[([^\]]+)\]` ends when it stands at `at`, or -1 when it does
 * not stand there.
 *
 * The group's own `\]` is the FIRST `]` at or after `at + 1`, and no
 * other one can be: `[^\]]+` cannot cross a `]`, so shortening it would
 * leave the `\]` to match a character the class already refused. The
 * run in front of that `]` must be at least one character wide, which
 * is why `[]` is no attrlist and `[]**c**` renders `[]<strong>c</strong>`.
 * @param source - the fragment as this row reads it
 * @param at - the offset the group would begin at
 * @returns the first offset behind the group, or -1
 */
function attrlistEnd(source: string, at: number): number {
  if (source.charAt(at) !== ATTRLIST_OPEN) {
    return -1;
  }
  const close = source.indexOf(ATTRLIST_CLOSE, at + 1);
  return close > at + 1 ? close + 1 : -1;
}

/**
 * Where the opening DELIMITER has to stand for a match beginning at
 * `start` - `start` itself, or behind whichever optional groups take
 * characters there.
 *
 * ONE candidate and not two, because both optional groups are greedy:
 * the engine takes the backslash and the attrlist where they stand,
 * and the arm that declines the attrlist can never match in its place,
 * since its delimiter would have to stand on the `[` the attrlist
 * begins with. So a failed attrlist arm costs this row nothing but the
 * start it was tried at.
 * @param source - the fragment as this row reads it
 * @param start - the offset the match would begin at
 * @returns the offset the delimiter must stand at
 */
function delimiterFor(source: string, start: number): number {
  const afterEscape = source.charAt(start) === ESCAPE ? start + 1 : start;
  const afterAttrlist = attrlistEnd(source, afterEscape);
  return afterAttrlist === -1 ? afterEscape : afterAttrlist;
}

/**
 * Run one unconstrained row over `source`, recording the offset of
 * each delimiter's FIRST character.
 *
 * The walk is the gsub's own: take the leftmost START that matches,
 * pair its delimiter with the nearest closer the lazy content group
 * allows, and resume behind that closer so the pair is consumed
 * exactly once. A start that finds no delimiter, or a delimiter with
 * no closer, advances to the next start rather than ending the row.
 * @param source - the fragment as this row reads it
 * @param mark - the character the row's delimiter doubles
 * @param delimiters - the set being built, shared across the four rows
 */
function scanRow(source: string, mark: string, delimiters: Set<number>): void {
  const pair = mark + mark;
  let start = nextStart(source, mark, 0);
  while (start !== -1 && start + SHORTEST_MATCH <= source.length) {
    const open = delimiterFor(source, start);
    const close = source.startsWith(pair, open)
      ? source.indexOf(pair, open + UNCONSTRAINED_WIDTH + SHORTEST_CONTENT)
      : -1;
    if (close === -1) {
      start = nextStart(source, mark, start + 1);
      continue;
    }
    delimiters.add(open);
    delimiters.add(close);
    start = nextStart(source, mark, close + UNCONSTRAINED_WIDTH);
  }
}

/**
 * Every offset in `text` where an unconstrained delimiter BEGINS.
 *
 * A row reads the fragment the way `canOpenAt` and `canCloseAt` read
 * a neighbour: through the curved-quote view when this mark's rows run
 * after the two curved rows ({@link seesCurvedRewrite}), through the
 * source otherwise. That is what keeps a doubled monospace mark off a
 * backtick the curved rows already took - in the view that backtick is
 * the `;` of the entity the curved row writes, so no pair stands there
 * to be found, and `x "``a``" y` keeps its curved span.
 * @param text - one paragraph body, exactly as the source spells it
 * @param curved - the fragment's curved-quote scan, whose view the
 *   three later marks read instead of `text`
 * @returns the delimiter offsets; a doubled mark is a token at these
 *   offsets and nowhere else
 */
export function scanDoubledMarks(
  text: string,
  curved: CurvedScan,
): ReadonlySet<number> {
  const delimiters = new Set<number>();
  for (const { kind, mark } of UNCONSTRAINED_ROWS) {
    scanRow(seesCurvedRewrite(kind) ? curved.view : text, mark, delimiters);
  }
  return delimiters;
}
