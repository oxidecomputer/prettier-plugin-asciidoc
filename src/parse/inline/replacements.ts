/**
 * Where the `REPLACEMENTS` table (asciidoctor.rb l.489-516) puts a
 * character reference in one fragment - `(C)`, `(R)`, `(TM)`, the two
 * em-dash spellings, the ellipsis, the four arrows and a named or
 * numeric entity. Rows are numbered here by their position in that
 * table, which is the only handle a single row has: `REPLACEMENTS` is
 * one array literal and its rows carry no names of their own.
 *
 * WHY THIS IS A SCAN AND NOT A RULE, twice over.
 *
 * ROW ORDER decides which reference stands where two spellings share a
 * character. `sub_replacements` (substitutors.rb l.282-286) runs one
 * gsub per row over the whole text, in the table's order, and each row
 * sees what the earlier rows already wrote. So `x <-> y` renders
 * `x &lt;&#8594; y`: the right-arrow row runs first and takes the `->`
 * out of the middle, leaving the left-arrow row nothing to match. A
 * left-to-right walk that tried `<-` at its own offset first would
 * answer the other way.
 *
 * CONSUMPTION decides how many references a run holds. A gsub moves
 * past the WHOLE match, and the spaced em-dash row consumes the spaces
 * around its dashes, so `x -- -- y` renders `x&#8201;&#8212;&#8201;-- y`
 * - one reference, not two, because the second pair's leading space is
 * inside the first pair's match. A per-offset lookbehind cannot see
 * that.
 *
 * Both facts are reproduced the same way: each row is run as its own
 * gsub over the fragment, in the table's order, and a match overlapping
 * a region an earlier row already consumed is refused. Nothing an
 * earlier row WRITES can be matched by a later one: every replacement
 * is a bare `&#...;` entity, and the only row that could look at one is
 * the entity row, whose pattern demands `&amp;` (the author's own `&`
 * after `sub_specialchars`) where a replacement has written a plain
 * `&`. So the source text is what every row reads.
 *
 * THE PATTERNS ARE SPELLED IN THE AUTHOR'S BYTES. Ruby's rows run
 * after `sub_specialchars`, which is why four of them are written
 * `-&gt;`, `=&gt;`, `&lt;-`, `&lt;=` and the entity row `(&)amp;`.
 * That pass rewrites `<`, `>` and `&` and nothing else, so the
 * correspondence is exact in both directions: a source `->` is the only
 * thing that can become `-&gt;`, and an author who writes `&lt;-`
 * himself has it rewritten to `&amp;lt;-`, where no arrow row matches
 * and the entity row does. The tokenizer reads the author's bytes, so
 * the rows are transcribed into them.
 *
 * TWO ROWS ARE NOT MODELLED, both deliberately: rows 7 and 8, the
 * right single quote and the in-word apostrophe
 * (`(#{CG_ALNUM})\?'(?=#{CG_ALPHA})`, asciidoctor.rb l.503-506).
 * They are the only rows whose bytes are also `QUOTE_SUBS`
 * delimiters - a backtick and an apostrophe - and this tokenizer
 * decides a mark's identity from its own offset, before pairing, so a
 * reference row at the same offset would have to be settled after the
 * pairing rather than beside it. Leaving them as text costs nothing
 * measurable: neither can hold whitespace, so neither is a break
 * decision, and the printer replays the author's bytes for both. They
 * cannot disturb this scan's own consumption either - the rows that run
 * after them match `-`, `=`, `<` and `&`, none of which either one
 * consumes.
 *
 * ESCAPES ARE CONSUMED, NOT RECORDED. `do_replacement`
 * (substitutors.rb l.1450-1453) answers a match holding a backslash by
 * writing the captured text back with the backslash removed, so
 * `x \(C) y` renders `x (C) y` - literal text, no reference at all.
 * The match still consumed its characters, which is what the refusal
 * below records, but no node is made for it: a `characterReference`
 * node that renders as its own source bytes would be a lie the printer
 * has no use for.
 */
import { ORACLE_WORD_CLASS } from "./quote-boundaries.js";

/** Ruby's `\\?`, and the character it makes optional. */
const ESCAPE = "\\";

// Both em-dash rows spell the same two characters; only their context
// clauses differ.
const EM_DASH = "--";

/**
 * One row of the table, and where the reference's OWN bytes sit inside
 * the match it makes.
 *
 * The two are separate because a row's match is wider than its
 * reference: the spaced em-dash row consumes the whitespace on either
 * side of its dashes and the word em-dash row the word character in
 * front of them, and neither of those bytes belongs to the node the
 * builder makes. Not exported: {@link scanReplacements} is the only
 * consumer and it builds the table itself.
 */
interface ReplacementRow {
  /**
   * The row's pattern, transcribed into the author's bytes and made
   * global so `exec` walks it the way `gsub` does - each call resuming
   * behind the previous match, which is the consumption the header
   * describes.
   */
  readonly pattern: RegExp;
  /**
   * Where the reference itself stands inside a match, or undefined
   * when the match is escaped and stands for no reference at all.
   */
  readonly site: (match: RegExpExecArray) => Site | undefined;
}

/** One recorded reference: its first offset and how many bytes it is. */
interface Site {
  /** Offset of the reference's first character in the fragment. */
  readonly offset: number;
  /** How many characters it spells. */
  readonly length: number;
}

/**
 * A row whose reference is a fixed string with an optional backslash in
 * front - `\\?\(C\)` and its six siblings, which is every row of the
 * table but the two em-dashes and the entity.
 *
 * The pattern is built from the literal rather than written twice, so
 * the bytes the row matches and the bytes the node carries are the same
 * string by construction.
 * @param literal - the reference's own characters
 * @param source - the same characters as a regex body, with the ones
 *   `v` mode gives meaning to escaped
 * @returns the row
 */
function literalRow(literal: string, source: string): ReplacementRow {
  return {
    pattern: new RegExp(String.raw`\\?${source}`, "gv"),
    site: (match: RegExpExecArray): Site | undefined =>
      match[0].length > literal.length
        ? undefined
        : { offset: match.index, length: literal.length },
  };
}

// Row 4, `foo -- bar` (asciidoctor.rb l.498):
// `/(?: |\n|^|\\)--(?: |\n|$)/`. Unlike row 5 next door it carries no
// `CG_WORD` clause at all - what stands beside the dashes here is a
// space, a newline, a line start or a backslash, and nothing else.
// Ruby's `^` and `$` are LINE anchors with no flag needed, which the
// `m` flag spells in JavaScript. Only the SPACE character is admitted,
// never a tab: `x\t--\tx` renders its dashes literally.
//
// The leading alternative is one character wide except for `^`, and the
// dashes are the only two characters the node carries, so the
// reference's offset is the match's own start plus one unless the match
// begins on a dash.
const SPACED_EM_DASH: ReplacementRow = {
  pattern: /(?: |\n|^|\\)--(?: |\n|$)/gmv,
  site: (match: RegExpExecArray): Site | undefined => {
    const [whole] = match;
    if (whole.startsWith(ESCAPE)) return undefined;
    const lead = whole.startsWith(EM_DASH) ? 0 : ESCAPE.length;
    return { offset: match.index + lead, length: EM_DASH.length };
  },
};

// Row 5, `foo--bar` (asciidoctor.rb l.500):
// `/(#{CG_WORD})\\?--(?=#{CG_WORD})/`, whose `:leading` restore writes
// the captured word character back in front of the em dash. The word
// class is the ORACLE's ({@link ORACLE_WORD_CLASS}), for the reason
// quote-boundaries.ts gives: the transpile the render assertions
// measure against spells Ruby's `\p{Word}` as
// `\p{Alphabetic}\p{N}\p{Pc}`.
//
// The trailing word character is a LOOKAHEAD, so the match ends at the
// dashes and the reference is always the match's last two characters -
// which is also what makes the escape test read `at(-3)` rather than a
// length comparison, since an astral word character is two UTF-16 units
// wide and a length test would call it an escape.
const WORD_EM_DASH: ReplacementRow = {
  pattern: new RegExp(
    String.raw`[${ORACLE_WORD_CLASS}]\\?${EM_DASH}(?=[${ORACLE_WORD_CLASS}])`,
    "gv",
  ),
  site: (match: RegExpExecArray): Site | undefined => {
    const [whole] = match;
    return whole.at(-EM_DASH.length - 1) === ESCAPE
      ? undefined
      : {
          offset: match.index + whole.length - EM_DASH.length,
          length: EM_DASH.length,
        };
  },
};

// Row 13, the last of the table this file's header cites, the entity
// restore:
// `/\\?(&)amp;((?:[a-zA-Z][a-zA-Z]+\d{0,2}|#\d\d\d{0,4}|#x[\da-fA-F][\da-fA-F][\da-fA-F]{0,3});)/`,
// whose `:bounding` restore writes the `&` and the name back around an
// empty replacement - so `x &copy; y` renders `x &copy; y` and the
// browser, not Asciidoctor, resolves it. The `&amp;` is the author's
// own `&` after `sub_specialchars`, so the source spelling is a bare
// `&`. The row tests SHAPE and not validity: `x &notanentity; y`
// renders `&notanentity;` too.
const ENTITY: ReplacementRow = {
  pattern:
    /\\?&(?:[a-zA-Z][a-zA-Z]+\d{0,2}|#\d\d\d{0,4}|#x[\da-fA-F][\da-fA-F][\da-fA-F]{0,3});/gv,
  site: (match: RegExpExecArray): Site | undefined => {
    const [whole] = match;
    return whole.startsWith(ESCAPE)
      ? undefined
      : { offset: match.index, length: whole.length };
  },
};

/**
 * The table, in `REPLACEMENTS`' own order (asciidoctor.rb l.489-516),
 * with the two apostrophe rows left out for the reason the header
 * gives. The order is the specification: it is what makes the
 * right-arrow row take the `->` out of `<->` before the left-arrow row
 * looks at it.
 */
const REPLACEMENT_ROWS: readonly ReplacementRow[] = [
  literalRow("(C)", String.raw`\(C\)`),
  literalRow("(R)", String.raw`\(R\)`),
  literalRow("(TM)", String.raw`\(TM\)`),
  SPACED_EM_DASH,
  WORD_EM_DASH,
  literalRow("...", String.raw`\.\.\.`),
  literalRow("->", "->"),
  literalRow("=>", "=>"),
  literalRow("<-", "<-"),
  literalRow("<=", "<="),
  ENTITY,
];

/**
 * What one fragment's rows have consumed so far, and the references
 * they recorded.
 *
 * The consumed region is a flag per character rather than a list of
 * intervals: every row asks about a match it has just made, so the
 * question is always "is any character of `[from, to)` already gone",
 * and a flag answers it in the match's own width.
 */
interface RowScan {
  /** One flag per character of the fragment: consumed by some row. */
  readonly consumed: Uint8Array;
  /** Each recorded reference's first offset and length. */
  readonly references: Map<number, number>;
}

/**
 * Whether every character of `[from, to)` is still there for a row to
 * match.
 * @param scan - what the earlier rows consumed
 * @param from - the match's first offset
 * @param to - one past the match's last offset
 * @returns true when no earlier row took any of it
 */
function isFree(scan: RowScan, from: number, to: number): boolean {
  for (let index = from; index < to; index += 1) {
    if (scan.consumed[index] === 1) return false;
  }
  return true;
}

/**
 * Run one row over `text`, recording what it matches.
 *
 * `exec` on a global pattern is the gsub's own walk: each call resumes
 * behind the previous match, so a row can never take the same character
 * twice. A match an EARLIER row already consumed is refused and the
 * walk goes on, which is what reproduces `x <-> y`.
 * @param text - the fragment, exactly as the source spells it
 * @param row - the table row to run
 * @param scan - the consumed flags and the reference map, both mutated
 */
function runRow(text: string, row: ReplacementRow, scan: RowScan): void {
  row.pattern.lastIndex = 0;
  let match = row.pattern.exec(text);
  while (match !== null) {
    const end = match.index + match[0].length;
    if (isFree(scan, match.index, end)) {
      scan.consumed.fill(1, match.index, end);
      const site = row.site(match);
      if (site !== undefined) scan.references.set(site.offset, site.length);
    }
    match = row.pattern.exec(text);
  }
}

/**
 * Every character reference in `text`, by the offset of its first
 * character.
 * @param text - one paragraph body, exactly as the source spells it
 * @returns each reference's offset mapped to how many characters it
 *   spells; a character reference is a token at these offsets and
 *   nowhere else
 */
export function scanReplacements(text: string): ReadonlyMap<number, number> {
  const scan: RowScan = {
    consumed: new Uint8Array(text.length),
    references: new Map<number, number>(),
  };
  for (const row of REPLACEMENT_ROWS) runRow(text, row, scan);
  return scan.references;
}
