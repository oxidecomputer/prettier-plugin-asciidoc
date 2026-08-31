/**
 * `QUOTE_SUBS` rows 3 and 4 - the curved double and single quote pairs
 * (asciidoctor.rb l.449-452) - and where they put their delimiters in
 * one fragment.
 *
 * WHY THIS IS A SCAN AND NOT A RULE. Every other formatting mark is one
 * character and answers "am I a delimiter" from its neighbourhood
 * (quote-boundaries.ts). These two are TWO characters of which one is a
 * BACKTICK, the same character the two monospaced rows spell
 * (asciidoctor.rb l.453-456), and they run BEFORE both of them. So the
 * question is not local, and the same four characters answer it two
 * ways depending on what stands four characters later - measured:
 *
 *   x "``a`` y    renders  x "<code>a</code> y
 *   x "``a``" y   renders  x &#8220;`a`&#8221; y
 *
 * A tokenizer that consumed a quote plus a backtick unconditionally
 * would lose the first span. This module runs the two patterns as
 * `sub_quotes` runs them (substitutors.rb l.189-196: one gsub per row,
 * over the whole text, the later row seeing what the earlier one wrote)
 * and reports the offsets; deciding which spans survive is
 * span-pairing.ts's job.
 *
 * The compat table (asciidoctor.rb l.471-486) replaces these rows with
 * ``quoted'' and `quoted'. It is not modelled: it is selected by a
 * document attribute this parser does not track, and its delimiters
 * collide with the passthrough rule's.
 */
import {
  ORACLE_WORD_CLASS,
  type CurvedQuoteSpelling,
} from "./quote-boundaries.js";
import { DELIM_WIDTH } from "../../constants.js";

/**
 * A curved delimiter is a quote character and a backtick, not a
 * doubled mark; the numeric agreement with UNCONSTRAINED_WIDTH is a
 * coincidence.
 */
export const CURVED_WIDTH = DELIM_WIDTH + DELIM_WIDTH;

/**
 * Which pair a delimiter belongs to, and which end of it it is.
 * Exported for its unit test (tests/parser/curved-quote-scan.test.ts);
 * no src consumer yet - `curvedMatcher` and `markFlags` (rules.ts) read
 * a delimiter's fields off {@link CurvedScan#delimiters} directly,
 * without naming this type.
 * @internal
 */
export interface CurvedDelimiter {
  /** Which pair this delimiter belongs to. */
  readonly quote: CurvedQuoteSpelling;
  /** Which end of the pair this delimiter is. */
  readonly side: "open" | "close";
}

/** What one fragment's curved-quote rows produce. */
export interface CurvedScan {
  /**
   * Offset of each delimiter's FIRST character. Every delimiter is
   * {@link CURVED_WIDTH} characters wide, so the last one is at
   * `offset + CURVED_WIDTH - 1`.
   */
  readonly delimiters: ReadonlyMap<number, CurvedDelimiter>;
  /**
   * The fragment as the rows AFTER these two read it: every curved
   * delimiter replaced by `&;`, which carries the first and last
   * character of the entity the row writes and the same width, so every
   * offset is preserved. Equal to the fragment itself when no row
   * matched.
   */
  readonly view: string;
}

// A template literal cannot hold a bare backtick: the character has to
// be escaped in the SOURCE so the literal does not end early, and
// `String.raw` preserves that escaping backslash rather than stripping
// it (`` String.raw`\`` `` is two characters, not one) - which is a
// literal backslash the `v` flag then refuses as an escape of an
// ordinary character. Spliced in through `${}` instead, the backtick
// reaches the pattern as itself.
const BACKTICK = "`";

// (^|[^\p{Word};:}])(?:\[([^\]]+)\])?"`(\S|\S.*?\S)`"(?!\p{Word})
// asciidoctor.rb l.450, CC_WORD and CG_WORD replaced by the oracle's
// word class. The three groups are NAMED (`boundary`, `attributes`,
// `content`) rather than numbered: a dynamically built pattern gives
// TypeScript no way to know which numbered groups are optional, so
// `match.groups?.attributes` types as the `string | undefined` it
// really is instead of the `string` `match[2]` would falsely claim.
const CURVED_DOUBLE = new RegExp(
  String.raw`(?<boundary>^|[^${ORACLE_WORD_CLASS};:\}])(?<attributes>\[[^\]]+\])?"${BACKTICK}(?<content>\S|\S.*?\S)${BACKTICK}"(?![${ORACLE_WORD_CLASS}])`,
  "gmsv",
);
// (^|[^\p{Word};:`}])(?:\[([^\]]+)\])?'`(\S|\S.*?\S)`'(?!\p{Word})
// asciidoctor.rb l.452. The extra backtick exclusion is this row's alone:
// a backtick in front of `'` is the closing half of another single pair.
const CURVED_SINGLE = new RegExp(
  String.raw`(?<boundary>^|[^${ORACLE_WORD_CLASS};:${BACKTICK}\}])(?<attributes>\[[^\]]+\])?'${BACKTICK}(?<content>\S|\S.*?\S)${BACKTICK}'(?![${ORACLE_WORD_CLASS}])`,
  "gmsv",
);

// The escape arm every constrained row shares (`convert_quoted_text`,
// substitutors.rb l.1420-1426): a match whose captured boundary
// character is itself a backslash is the escaped spelling. What
// happens next forks on whether an attrlist was ALSO captured
// (l.1421-1423, `if scope == :constrained && (attrs = match[2])`):
//
// - no attrlist: l.1423-1424's `else` returns `match[0].slice 1,
//   match[0].length` - the backslash stripped, everything else
//   literal, no entity ever written. The match still consumes the
//   span (Ruby's `gsub` moves past the whole of it), so a delimiter is
//   refused here too, and a later match starting past this one is
//   still found;
// - an attrlist IS present: l.1422's `unescaped_attrs = "[#{attrs}]"`
//   falls through to the ordinary conversion below it - the bracket
//   text prints literally, but the curved pair still converts to its
//   entity around it. Measured: `x \[.foo]"\`a\`" y` renders
//   `x [.foo]&#8220;a&#8221; y`. So this refusal is scoped to the
//   no-attrlist case; the delimiter is recorded when an attrlist
//   stands between the escape and the quote, because the pair still
//   converts there.
const ESCAPE = "\\";

/**
 * Run one curved-quote row's pattern over `text` and record every
 * delimiter it matches into `delimiters`, keyed by the delimiter's own
 * first-character offset.
 * @param pattern - `CURVED_DOUBLE` or `CURVED_SINGLE`, its own `lastIndex` owned entirely by this call
 * @param quote - which pair `pattern` spells
 * @param text - the fragment, or an earlier row's masked view of it
 * @param delimiters - the map being built, shared across both rows
 */
function scanRow(
  pattern: RegExp,
  quote: CurvedQuoteSpelling,
  text: string,
  delimiters: Map<number, CurvedDelimiter>,
): void {
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    const boundary = match.groups?.boundary ?? "";
    const attributes = match.groups?.attributes ?? "";
    const content = match.groups?.content ?? "";
    const openOffset = match.index + boundary.length + attributes.length;
    const closeOffset = openOffset + CURVED_WIDTH + content.length;
    // The escape refuses the pair only in the no-attrlist branch
    // (substitutors.rb l.1423-1424 above): with an attrlist present
    // Ruby's escape arm still converts (l.1422 above), so the
    // delimiter is recorded there too.
    if (boundary !== ESCAPE || attributes !== "") {
      delimiters.set(openOffset, { quote, side: "open" });
      delimiters.set(closeOffset, { quote, side: "close" });
    }
    match = pattern.exec(text);
  }
}

/**
 * `base` with every delimiter in `delimiters` replaced by `&;` - the
 * masking {@link CurvedScan#view} documents: offset-preserving because
 * `&;` is exactly {@link CURVED_WIDTH} characters wide.
 * @param base - the text to mask
 * @param delimiters - offsets to replace, from either or both rows
 * @returns the masked text
 */
function maskDelimiters(
  base: string,
  delimiters: ReadonlyMap<number, CurvedDelimiter>,
): string {
  const offsets = [...delimiters.keys()].toSorted(
    (left, right) => left - right,
  );
  let masked = "";
  let cursor = 0;
  for (const offset of offsets) {
    masked += `${base.slice(cursor, offset)}&;`;
    cursor = offset + CURVED_WIDTH;
  }
  return masked + base.slice(cursor);
}

/**
 * Where the two curved-quote rows put their delimiters in this fragment,
 * and the fragment as the later rows read it.
 *
 * STAGED, because the single row's own left clause must see what the
 * double row already wrote (its `;` blocks a single open the same way
 * it blocks any other constrained row's): the double row runs over
 * `text` first, its delimiters are masked into a view, and the single
 * row runs over THAT. Measured:
 *
 *   x "`a`"'`b`' y  ->  x &#8220;a&#8221;'`b&#8217; y
 *
 * (the single row does not match: the `;` the double row wrote stands
 * where its left clause is tested, so the leftover backtick-apostrophe
 * falls to the right-single-quote replacement instead,
 * asciidoctor.rb l.503-504, which runs after the quote pass).
 * @param text - one paragraph body, exactly as the source spells it
 * @returns the delimiter offsets and the masked view; both empty and
 *   identical to `text` when neither row matches
 */
export function scanCurvedQuotes(text: string): CurvedScan {
  const delimiters = new Map<number, CurvedDelimiter>();
  scanRow(CURVED_DOUBLE, "double", text, delimiters);
  const doubleView = maskDelimiters(text, delimiters);
  scanRow(CURVED_SINGLE, "single", doubleView, delimiters);
  return { delimiters, view: maskDelimiters(text, delimiters) };
}
