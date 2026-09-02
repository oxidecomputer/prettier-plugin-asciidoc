/**
 * Where the last two rows of `QUOTE_SUBS` put their delimiters in one
 * fragment: `^superscript^` (asciidoctor.rb l.466) and `~subscript~`
 * (asciidoctor.rb l.468), the eleventh and twelfth rows of the table at
 * asciidoctor.rb l.439-469.
 *
 * WHY THIS IS A SCAN AND NOT A RULE, the same reason doubled-marks.ts
 * gives for the four doubled rows next door. Each row is one gsub of
 * `\\?(?:\[([^\]]+)\])?X(\S+?)X` over the WHOLE text (`sub_quotes`,
 * substitutors.rb l.189-196), so the same character is a delimiter or
 * ordinary text depending on what stands arbitrarily far away:
 * `x ^a^b^ y` renders `x <sup>a</sup>b^ y`, where the third caret is
 * text because the gsub had already consumed the pair in front of it.
 *
 * WHAT THE ROW MATCHES, transcribed rather than generalized. The
 * content group `(\S+?)` is lazy, demands at least one character and
 * admits no whitespace at all - a newline included, since these two
 * rows carry no `/m` and `\S` refuses one anyway. So the closing
 * delimiter is the first `X` at or after `open + 2` with no whitespace
 * between, and a row can never match across a line: `x ^a b^ y` and
 * `x ^a` + newline + `b^ y` both render their carets literally.
 *
 * THE WALK IS OVER MATCH STARTS, NOT OVER DELIMITERS, because the
 * optional `\\?(?:\[([^\]]+)\])?` prefix CAN move the opening
 * delimiter - the same prefix, and the same consequence,
 * doubled-marks.ts's own header spells out: `x [a^b]^c^ y` renders
 * `x <sup class="a^b">c</sup> y`, opening at the caret behind the `]`
 * and not at the one inside the brackets. An empty attrlist is no
 * attrlist, so `x []^a^ y` renders `x []<sup>a</sup> y`.
 *
 * THE ESCAPE IS CONSUMED AND NOTHING IS RECORDED, which is where this
 * scan parts company with doubled-marks.ts. Both rows escape the same
 * way - `convert_quoted_text` returns `match[0].slice 1` for an
 * unconstrained scope, attrlist or no attrlist (substitutors.rb
 * l.1419-1425), so `x \^a^ y` and `x \[a]^b^ y` both render their
 * delimiters literally. What differs is what happens to that literal
 * output: a doubled row's is re-read by the CONSTRAINED row of the
 * same mark, which still runs after it, and doubled-marks.ts records
 * its delimiters because it cannot model that second reading. These
 * are the LAST TWO rows of the table, and no later row spells `^` or
 * `~` - the replacements pass that runs next has no row for either -
 * so an escaped match here means nothing but the characters it ate.
 * Recording it would put a superscript node where the oracle renders
 * plain text and buy nothing at all.
 *
 * THE SCAN READS THE SOURCE, not a view of what the ten earlier rows
 * wrote. One fact makes the DELIMITERS faithful: no earlier row's
 * delimiter or replacement is a `^` or a `~`, so the characters this
 * scan looks for stand exactly where the source put them. The CONTENT
 * test is a different matter, and this is where the scan is known to
 * diverge.
 *
 * WHERE IT DIVERGES. A row's rewrite deletes non-space delimiters and
 * wraps the content it already had, so for most text the `\S+?` test
 * answers the same over the source and over the rewrite:
 * `x ^*a b*^ y` renders `x ^<strong>a b</strong>^ y`, the superscript
 * refused over both spellings alike. The exception is the ATTRLIST
 * GROUP, `(?:\[([^\]]+)\])?`, which every one of the ten rows carries
 * in front of its delimiter: where a row takes one AND it yields an
 * HTML attribute, the source's `[red]` becomes ` class="red"` and the
 * rewrite has a space the source never had. Measured, both markers and
 * every earlier row (each renders with NO `<sup>`/`<sub>`, and this
 * scan finds one):
 *
 *   x ^[red]#c#^ y     x ^<span class="red">c</span>^ y
 *   x ~[red]#c#~ y     x ~<span class="red">c</span>~ y
 *   x ^[red]*c*^ y     x ^<strong class="red">c</strong>^ y
 *   x ^[red]_c_^ y     x ^<em class="red">c</em>^ y
 *   x ^[red]`c`^ y     x ^<code class="red">c</code>^ y
 *   x ^[red]**c**^ y   x ^<strong class="red">c</strong>^ y
 *   x ^[red]__c__^ y   x ^<em class="red">c</em>^ y
 *   x ^[red]``c``^ y   x ^<code class="red">c</code>^ y
 *   x ^[red]##c##^ y   x ^<span class="red">c</span>^ y
 *   x ^[red]"`c`"^ y   x ^<span class="red">&#8220;c&#8221;</span>^ y
 *   x ^[red]'`c`'^ y   x ^<span class="red">&#8216;c&#8217;</span>^ y
 *   x ^[.a.b]#c#^ y    x ^<span class="a b">c</span>^ y
 *
 * AND IT DIVERGES THE OTHER WAY TOO, which is why a "refuse where an
 * attrlist stands" patch would not be a fix. A taken attrlist that
 * yields NO attribute has its own bytes DELETED, whitespace included,
 * so the rewrite loses a space the source has:
 *
 *   x ^[ ]*c*^ y       x <sup><strong>c</strong></sup> y   (we refuse)
 *   x ^[,]*c*^ y       x <sup><strong>c</strong></sup> y   (we accept)
 *   x ^\[red]*c*^ y    x <sup>[red]<strong>c</strong></sup> y
 *
 * WHY IT IS NOT MODELLED HERE. Answering it needs four things this
 * scan cannot reach, and the last two are the ones that make it a
 * different piece of work rather than a bigger one:
 *
 * - which attrlists the four UNCONSTRAINED rows take, which
 *   doubled-marks.ts's own prefix replay already knows, and which the
 *   two CURVED rows take, which curved-quotes.ts's `attributes` group
 *   already captures (measured: it returns the attrlist-moved offsets
 *   for both curved witnesses above) - the cheap half, SIX of the
 *   twelve witnesses;
 * - which attrlists the four CONSTRAINED rows take - the other six -
 *   which needs their pairing, and that pairing is span-pairing.ts's,
 *   over TOKENS this scan runs before. Deriving it here a second time
 *   is the second source of truth the coding standard forbids;
 * - whether a taken attrlist yields an ATTRIBUTE at all, which is
 *   `parse_quoted_text_attributes` (substitutors.rb l.1475-1502: comma
 *   truncation, strip-to-empty, the `.`/`#` shorthand) plus
 *   `convert_quoted_text`'s escaped-constrained fork
 *   (substitutors.rb l.1420-1425,
 *   which prints the brackets and writes no class) - the three rows
 *   above;
 * - and the ORACLE'S own attrlist class, which is not the vendored
 *   Ruby's: `x [re[d]*c*^ y` renders `x [re[d]<strong>c</strong>^ y`,
 *   the run refused outright, where 2.0.26's `[^\]]+` accepts `re[d`.
 *
 * What it costs is BYTES: nothing. The printer replays the carets and
 * the neighbour's own spelling unchanged, so every shape above is a
 * byte fixed point that renders equal and is idempotent - measured
 * over a directed sweep whose alphabet spells attrlists in front of
 * every mark row (tests/parser/super-sub.test.ts pins the family, both
 * directions and the controls that agree). It is an AST divergence,
 * recorded here as one.
 *
 * Deciding which of these spans survive is span-pairing.ts's job, the
 * way it is for the two scans next door; a candidate that CROSSES a
 * span an earlier row already resolved is dropped there, which is what
 * `x ^a~b^c~ y` needs (the oracle emits genuinely overlapping
 * `<sup>a<sub>b</sup>c</sub>`, and no tree holds that).
 */
import { DELIM_WIDTH } from "../../constants.js";

/**
 * Which of the two rows a delimiter belongs to. The character alone
 * decides it - `^` is never the subscript row's and `~` never the
 * superscript's - so the scan reports a bare set of offsets and each
 * rule tests its own character, the way `markMatcher` (rules.ts) reads
 * the doubled set.
 */
const SUPER_SUB_ROWS: ReadonlyArray<{ readonly mark: string }> = [
  { mark: "^" },
  { mark: "~" },
];

// `(\S+?)` demands at least one character, so a closing delimiter
// never abuts its opener: in `x ^^a^ y` the second caret is CONTENT
// and the third is the close, which is why the oracle renders
// `<sup>^a</sup>`.
const SHORTEST_CONTENT = 1;

// The shortest text one of these rows can match, measured from the
// OPENING DELIMITER. The optional prefix only ever puts the delimiter
// further right, so a start with less than this much text behind it
// cannot match either.
const SHORTEST_MATCH = DELIM_WIDTH + SHORTEST_CONTENT + DELIM_WIDTH;

// Ruby's `\\?`: one optional backslash in front of the whole match.
const ESCAPE = "\\";

// The attrlist group's own brackets, `\[([^\]]+)\])?`.
const ATTRLIST_OPEN = "[";
const ATTRLIST_CLOSE = "]";

// `\S`: what the content group refuses. Written as the complement so
// the test reads as the pattern does.
const WHITESPACE = /\s/v;

/**
 * The next offset at or after `from` where a match could BEGIN.
 *
 * Only three characters can begin one: the row's own mark, with
 * neither optional group taken; a backslash, which `\\?` takes; and the
 * `[` the attrlist group opens with. Anywhere else both optional groups
 * match empty and the delimiter is then required where it does not
 * stand. Skipping the rest keeps the walk linear in the fragment.
 * @param source - the fragment this row reads
 * @param mark - the row's delimiter character
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
 * is why `x []^a^ y` renders `x []<sup>a</sup> y`.
 * @param source - the fragment this row reads
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
 * the engine takes the backslash and the attrlist where they stand, and
 * the arm that declines the attrlist can never match in its place,
 * since its delimiter would have to stand on the `[` the attrlist
 * begins with.
 * @param source - the fragment this row reads
 * @param start - the offset the match would begin at
 * @returns the offset the delimiter must stand at
 */
function delimiterFor(source: string, start: number): number {
  const afterEscape = source.charAt(start) === ESCAPE ? start + 1 : start;
  const afterAttrlist = attrlistEnd(source, afterEscape);
  return afterAttrlist === -1 ? afterEscape : afterAttrlist;
}

/**
 * The closing delimiter for an opener at `open`, or -1 when the lazy
 * `(\S+?)` group can reach none.
 *
 * The walk stops at the first whitespace because the content group
 * refuses it outright, and the first mark it reaches past the
 * one-character minimum is the close, because the group is lazy.
 * @param source - the fragment this row reads
 * @param mark - the row's delimiter character
 * @param open - the opening delimiter's offset
 * @returns the closing delimiter's offset, or -1
 */
function closeFor(source: string, mark: string, open: number): number {
  const first = open + DELIM_WIDTH + SHORTEST_CONTENT;
  for (let index = open + DELIM_WIDTH; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (WHITESPACE.test(character)) {
      return -1;
    }
    if (character === mark && index >= first) {
      return index;
    }
  }
  return -1;
}

/**
 * Run one row over `source`, recording the offset of each delimiter.
 *
 * The walk is the gsub's own: take the leftmost START that matches,
 * pair its delimiter with the nearest closer the lazy content group
 * allows, and resume behind that closer so the pair is consumed exactly
 * once. A start that finds no delimiter, or a delimiter with no closer,
 * advances to the next start rather than ending the row - an
 * attrlist-derived opener stands to the RIGHT of starts still to come,
 * so a later start can succeed where an earlier one failed.
 * @param source - the fragment this row reads
 * @param mark - the row's delimiter character
 * @param delimiters - the set being built, shared across both rows
 */
function scanRow(source: string, mark: string, delimiters: Set<number>): void {
  let start = nextStart(source, mark, 0);
  while (start !== -1 && start + SHORTEST_MATCH <= source.length) {
    const open = delimiterFor(source, start);
    const close =
      source.charAt(open) === mark ? closeFor(source, mark, open) : -1;
    if (close === -1) {
      start = nextStart(source, mark, start + 1);
      continue;
    }
    // An escaped match consumes its delimiters and records none: the
    // header says why these two rows can afford what doubled-marks.ts
    // cannot.
    if (source.charAt(start) !== ESCAPE) {
      delimiters.add(open);
      delimiters.add(close);
    }
    start = nextStart(source, mark, close + DELIM_WIDTH);
  }
}

/**
 * Every offset in `text` where a superscript or subscript delimiter
 * stands.
 * @param text - one paragraph body, exactly as the source spells it
 * @returns the delimiter offsets; a `^` or `~` is a delimiter token at
 *   these offsets and nowhere else
 */
export function scanSuperSubMarks(text: string): ReadonlySet<number> {
  const delimiters = new Set<number>();
  for (const { mark } of SUPER_SUB_ROWS) {
    scanRow(text, mark, delimiters);
  }
  return delimiters;
}
