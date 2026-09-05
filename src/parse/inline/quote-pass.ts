/**
 * The text Asciidoctor's substitution pass runs over, and the window
 * one fragment reads of the scans taken across it.
 *
 * WHY THE PASS TEXT IS NOT THE FRAGMENT. `sub_quotes` is one gsub per
 * row over a block's whole text (substitutors.rb l.189-196), and that
 * text is the block's KEPT lines joined with `\n`: a `//` line is gone
 * before the parser ever sees it (`Reader#skip_line_comments`,
 * reader.rb l.331-345) and a conditional or include directive is gone
 * before that (`PreprocessorReader#process_line`, reader.rb
 * l.824-845). So a row's delimiters pair across a line the reader
 * dropped - `**a` / `// c` / `b** d` renders `<strong>a\nb</strong> d`
 * - and a scan confined to the text between two dropped lines cannot
 * find that pair (issue #112).
 *
 * WHY TOKENIZING IS STILL PER FRAGMENT. Every token's image is a
 * verbatim slice of the source, which the joined text is not: the
 * dropped lines' bytes are missing from it, so a token cut out of it
 * across a join would have an image no source range spells. The
 * tokenizer therefore still walks one fragment at a time, and only
 * the SCANS - the four whole-text questions no neighbourhood can
 * answer - move to the joined text. Each fragment reads its own
 * window of the result, which is the same set of answers it would
 * have computed alone plus the pairs that reach past it.
 *
 * The window is a plain shift because every scan is offset-preserving:
 * the curved rows' masked view replaces a delimiter with `&;`, the
 * same width, and the other three record offsets into the text they
 * were handed.
 *
 * NOTHING STRADDLES A WINDOW EDGE, and the reason is about what each
 * scan RECORDS rather than about what its rows MATCH. A fragment ends
 * with the newline of its own last line, so a construct can only
 * straddle an edge by spelling a newline. The three delimiter scans
 * record a fixed-width run of one delimiter character, and none of the
 * eight characters is a newline. The replacements scan records a SITE,
 * which is narrower than the match: several rows match their
 * surrounding context and the spaced em-dash row spells `\n`
 * explicitly on both sides (`SPACED_EM_DASH`, replacements.ts), but
 * every row's `site` callback records the reference's own characters
 * alone, and no reference spells a newline. That is the load-bearing
 * half, so it is held by a test rather than by this paragraph:
 * tests/parser/character-reference.test.ts's "every recorded site lies
 * within one line" drives the scan over each spelling at every
 * position around a newline and fails the day a row records its
 * context. Were a site ever to straddle, {@link windowOf} would drop
 * the reference silently and a node would vanish with the bytes still
 * round-tripping.
 */
import {
  scanCurvedQuotes,
  CURVED_WIDTH,
  type CurvedDelimiter,
  type CurvedScan,
} from "./curved-quotes.js";
import { scanDoubledMarks, UNCONSTRAINED_WIDTH } from "./doubled-marks.js";
import { scanSuperSubMarks } from "./super-sub.js";
import { scanReplacements } from "./replacements.js";
import { DELIM_WIDTH } from "../../constants.js";

/**
 * The four whole-text scans every inline rule is handed.
 *
 * All four exist because their construct is not decidable from a
 * neighbourhood: a curved-quote pair (curved-quotes.ts), a doubled
 * mark (doubled-marks.ts), a super/sub pair (super-sub.ts) and a
 * character reference (replacements.ts) each answer to text
 * arbitrarily far away. Taken over the pass text by
 * {@link scanQuotePass} and read through {@link windowOf}, so what a
 * rule sees is a fact about its own fragment's offsets while the
 * pairing behind it is the whole block's.
 */
export interface InlineScan {
  /**
   * Where the two curved-quote rows matched. The two curved rules read
   * it to find their own delimiters, and `InlineText`'s own rule reads
   * it to cut its run before one, the way it already cuts before an
   * email address.
   */
  readonly curved: CurvedScan;
  /**
   * Every offset where an unconstrained (doubled) delimiter BEGINS.
   * `markMatcher` (rules.ts) reads it to decide the doubled spelling;
   * every other rule ignores it.
   */
  readonly doubled: ReadonlySet<number>;
  /**
   * Every offset where a superscript or subscript delimiter stands
   * (super-sub.ts). `superSubMatcher` (rules.ts) reads it, and
   * `InlineText`'s own rule reads it to cut its run before one, the
   * way it already cuts before a curved delimiter.
   */
  readonly superSub: ReadonlySet<number>;
  /**
   * Every character reference, by its first offset and its width
   * (replacements.ts). The `CharacterReference` rule reads it, and
   * `InlineText` cuts its run before one.
   */
  readonly replacements: ReadonlyMap<number, number>;
}

/**
 * Run the four scans over one block's pass text.
 *
 * The curved rows are taken FIRST and handed to the doubled scan,
 * because three of the four doubled rows run after them and read what
 * they wrote (`seesCurvedRewrite`, quote-boundaries.ts): in that view
 * a backtick the curved rows took is the `;` of the entity they write,
 * so no doubled pair stands there, and `x "``a``" y` keeps its curved
 * span. The last two `QUOTE_SUBS` rows and the replacements table read
 * the source instead; their own modules' headers say why that is
 * faithful.
 *
 * Each of the four answers to text arbitrarily far away, which is why
 * none of them is a rule: `**a**` pairs and `**a*` does not, `x "``a``
 * y` and `x "``a``" y` start with the same four characters and diverge
 * later, `^a^b^` pairs the first two carets and leaves the third, and
 * a character reference answers to the ROW ORDER and to what an
 * earlier row already consumed (`<->` is one right arrow, `-- --` one
 * em dash).
 * @param text - the block's kept lines joined, exactly as the source
 *   spells them
 * @returns the four scans, in that text's coordinates
 */
export function scanQuotePass(text: string): InlineScan {
  const curved = scanCurvedQuotes(text);
  return {
    curved,
    doubled: scanDoubledMarks(text, curved),
    superSub: scanSuperSubMarks(text),
    replacements: scanReplacements(text),
  };
}

/** A fragment's half-open range in pass coordinates. */
interface Window {
  /** Where the fragment begins. */
  readonly start: number;
  /** Just past where it ends. */
  readonly end: number;
}

/**
 * Whether a construct recorded at `offset` and spelling `width`
 * characters lies wholly inside the window.
 *
 * `width` is the RECORDED construct's, never its match's: a row may
 * match context it does not record (the module header says which), and
 * it is the recorded bytes that become a token. Nothing a scan records
 * spells a newline, so this test never actually refuses one - it is
 * the definition of the window, not a filter with a population.
 * @param offset - the construct's first character, in pass coordinates
 * @param width - how many characters it spells
 * @param window - the fragment's range
 * @returns true when the fragment spells the whole construct
 */
function inside(offset: number, width: number, window: Window): boolean {
  return offset >= window.start && offset + width <= window.end;
}

/**
 * The offsets of `source` that lie inside the window, moved into its
 * own coordinates.
 * @param source - offsets in pass coordinates
 * @param width - how many characters the construct at an offset spells
 * @param window - the fragment's range
 * @returns the surviving offsets, rebased to the fragment
 */
function shifted(
  source: Iterable<number>,
  width: number,
  window: Window,
): Set<number> {
  const kept = new Set<number>();
  for (const offset of source) {
    if (inside(offset, width, window)) {
      kept.add(offset - window.start);
    }
  }
  return kept;
}

/**
 * The curved delimiters inside the window, rebased.
 * @param delimiters - the pass text's curved delimiters
 * @param window - the fragment's range
 * @returns the surviving delimiters, keyed by fragment offset
 */
function shiftedCurved(
  delimiters: ReadonlyMap<number, CurvedDelimiter>,
  window: Window,
): Map<number, CurvedDelimiter> {
  const kept = new Map<number, CurvedDelimiter>();
  for (const [offset, delimiter] of delimiters) {
    if (inside(offset, CURVED_WIDTH, window)) {
      kept.set(offset - window.start, delimiter);
    }
  }
  return kept;
}

/**
 * The character references inside the window, rebased. Each carries
 * its own width, so the window test is per entry rather than per
 * table.
 * @param references - the pass text's references
 * @param window - the fragment's range
 * @returns the surviving references, keyed by fragment offset
 */
function shiftedReferences(
  references: ReadonlyMap<number, number>,
  window: Window,
): Map<number, number> {
  const kept = new Map<number, number>();
  for (const [offset, width] of references) {
    if (inside(offset, width, window)) {
      kept.set(offset - window.start, width);
    }
  }
  return kept;
}

/**
 * One fragment's view of a pass-wide scan: the answers that fall
 * inside it, in its own coordinates.
 *
 * A pair whose other half sits in another fragment still shows here as
 * the delimiter it is - which is the point, since that is the pair the
 * oracle made across a dropped line. Its partner reaches the span
 * pairing from the other fragment's tokens, and the pairing walk
 * already runs over the block's whole token stream (`resolveSpans`,
 * span-pairing.ts).
 * @param pass - the scans over the whole pass text
 * @param start - where this fragment begins in the pass text
 * @param length - how many characters it spells
 * @returns the same four scans, restricted and rebased
 */
export function windowOf(
  pass: InlineScan,
  start: number,
  length: number,
): InlineScan {
  const window = { start, end: start + length };
  return {
    curved: {
      delimiters: shiftedCurved(pass.curved.delimiters, window),
      view: pass.curved.view.slice(window.start, window.end),
    },
    doubled: shifted(pass.doubled, UNCONSTRAINED_WIDTH, window),
    superSub: shifted(pass.superSub, DELIM_WIDTH, window),
    replacements: shiftedReferences(pass.replacements, window),
  };
}
