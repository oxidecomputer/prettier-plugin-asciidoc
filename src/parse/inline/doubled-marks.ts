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
 * THE WALK IS OVER DELIMITERS. Ruby's row carries an optional
 * `\\?(?:\[([^\]]+)\])?` in front of its delimiter, and `gsub` takes
 * the leftmost match START, so an attrlist whose own value holds the
 * row's pair swallows it and the opener is the `XX` behind the `]`:
 * `[a**b]**c**` renders `<strong class="a**b">c</strong>` there,
 * opening at offset 6. This scan opens at the 2, which is where the
 * first pair stands. NOT PROTECTED BY DESIGN: an attrlist value
 * holding the very mark the row doubles is a shape no author writes,
 * and a walk over match starts costs a candidate at every `[` and
 * every backslash in the fragment. The backslash half of the prefix
 * needs no candidate of its own here: it only ever moves the opener
 * onto the delimiter this walk finds anyway. Ruby writes an escaped
 * match back unescaped for the later rows to re-read, and re-reading a
 * row own output is outside this parser one-coordinate-space model, so
 * an escaped doubled match records its delimiters like any other.
 *
 * Deciding which of these spans survive is span-pairing.ts's job, the
 * way it is for the curved-quote scan next door.
 */
import { MARK_ROW, seesCurvedRewrite } from "./quote-boundaries.js";
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

/**
 * Run one unconstrained row over `source`, recording the offset of
 * each delimiter's FIRST character.
 *
 * Take the leftmost pair, close it with the nearest pair the lazy
 * content group allows, and resume behind that closer so each pair is
 * consumed exactly once. An opener with no closer ends the row: a
 * later pair would have BEEN that closer.
 * @param source - the fragment as this row reads it
 * @param mark - the character the row's delimiter doubles
 * @param delimiters - the set being built, shared across the four rows
 */
function scanRow(source: string, mark: string, delimiters: Set<number>): void {
  const pair = mark + mark;
  let open = source.indexOf(pair);
  while (open !== -1) {
    const close = source.indexOf(
      pair,
      open + UNCONSTRAINED_WIDTH + SHORTEST_CONTENT,
    );
    if (close === -1) {
      return;
    }
    delimiters.add(open);
    delimiters.add(close);
    open = source.indexOf(pair, close + UNCONSTRAINED_WIDTH);
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
  // One pass per unconstrained row. The order is immaterial to the
  // result: the four characters are distinct, so no row can claim an
  // offset another row wants.
  for (const { kind, mark } of Object.values(MARK_ROW)) {
    scanRow(seesCurvedRewrite(kind) ? curved.view : text, mark, delimiters);
  }
  return delimiters;
}
