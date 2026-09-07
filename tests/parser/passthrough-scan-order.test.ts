/**
 * WHERE THE PASSTHROUGH WALK AND ASCIIDOCTOR'S TWO PASSES DISAGREE.
 *
 * CHARACTERIZATION, NOT A FIX. Every row here records what
 * {@link scanPassthroughs} does today beside what Asciidoctor's
 * `extract_passthroughs` does, on text where the two differ. None of
 * the rows is a bug being pinned closed: the bytes are identical
 * either way, the formatted output is the input, and both programs
 * render it the same. What the suite exists for is that the difference
 * is REAL and easy to assume away, and a consumer that computes an
 * exclusion from these spans rather than a mask inherits it.
 *
 * The walk goes over the text ONCE, trying the unconstrained
 * delimiters, then the `pass:` macro, then the constrained `+` at each
 * position. Asciidoctor runs the whole macro alternation over the
 * WHOLE text first, replacing each match with a placeholder
 * (substitutors.rb l.1018), and only then runs the constrained
 * pattern over the result (l.1075). The two therefore disagree exactly
 * where the second pass would read bytes the first pass rewrote:
 * where two passthroughs ABUT, and where a constrained pair OVERLAPS
 * a macro.
 *
 * `ruby` in each row was measured by driving Asciidoctor 2.0.26's own
 * `InlinePassMacroRx` and `InlinePassRx[false]` in that order, each
 * match replaced by an equal-length run of `PASS_START` so the second
 * pass's offsets stay in the original text's coordinates. It is data,
 * not a computation the suite repeats, which is why every row also
 * asserts that the two lists DIFFER: a row that stopped being a
 * witness would otherwise pass silently.
 *
 * Systematically, over 5995 pass texts from a `+`/`$`/`pass:`-heavy
 * corpus, the two disagree about which bytes are masked in 48 (0.8%).
 */
import { describe, expect, test } from "vitest";
import { expectFormatted, oracleHtml } from "../helpers.js";
import { scanPassthroughs } from "../../src/parse/inline/passthrough.js";
import { shapes } from "./inline-shape.js";

/** One text the two orders read differently. */
interface Row {
  /** What the row is a witness for. */
  readonly name: string;
  /** The text, which is also the document once a newline is added. */
  readonly text: string;
  /** The passthroughs the walk records, by their bytes. */
  readonly walk: readonly string[];
  /** The passthroughs Asciidoctor's two passes claim, by their bytes. */
  readonly ruby: readonly string[];
  /** The inline shapes of the one paragraph the document holds. */
  readonly shape: readonly string[];
  /** Asciidoctor's own HTML for the document. */
  readonly html: string;
}

const ROWS: readonly Row[] = [
  {
    // The macro pass replaces `pass:[b]` before the constrained pass
    // runs, so the closing `+`'s `(?!CG_WORD)` lookahead reads a
    // placeholder where the walk reads the `p` of `pass:`, a word
    // character that refuses the span. The walk finds FEWER.
    name: "a constrained pair abutting a macro, which Ruby takes and we do not",
    text: "x +a+pass:[b]c d",
    walk: ["pass:[b]"],
    ruby: ["+a+", "pass:[b]"],
    shape: ['"x +a+"', "inlineMacro", '"c d"'],
    html: '<div class="paragraph">\n<p>x abc d</p>\n</div>',
  },
  {
    // The same cause with the three-plus spelling: to Ruby `+++` here
    // is a constrained passthrough holding one `+`, which is why its
    // render carries a `+` the walk's reading leaves as text.
    name: "a bare triple-plus abutting a macro",
    text: "x +++pass:[a]b c",
    walk: ["pass:[a]"],
    ruby: ["+++", "pass:[a]"],
    shape: ['"x +++"', "inlineMacro", '"b c"'],
    html: '<div class="paragraph">\n<p>x +ab c</p>\n</div>',
  },
  {
    // The OTHER direction, and the one that makes "the walk can only
    // narrow" false. Ruby's constrained pattern consumes the character
    // in FRONT of a passthrough, so after `+cc+` its gsub resumes past
    // the character `+de+` would need for its own front clause and no
    // second match starts. The walk tests the front character without
    // consuming it, so it finds MORE.
    name: "two constrained pairs abutting, where the walk finds one more",
    text: "x +cc++de+ f",
    walk: ["+cc+", "+de+"],
    ruby: ["+cc+"],
    shape: ['"x "', 'pass("+cc+")', 'pass("+de+")', '" f"'],
    html: '<div class="paragraph">\n<p>x cc+de+ f</p>\n</div>',
  },
  {
    // Overlap rather than abutment: Ruby's macro pass claims the whole
    // `pass:[a+ b]` before any `+` is looked at, while the walk reaches
    // the `+` first and closes it on the one inside the macro.
    name: "a constrained pair overlapping a macro",
    text: "x +pass:[a+ b] c",
    walk: ["+pass:[a+"],
    ruby: ["pass:[a+ b]"],
    shape: ['"x "', 'pass("+pass:[a+")', '" b] c"'],
    html: '<div class="paragraph">\n<p>x +a+ b c</p>\n</div>',
  },
];

/**
 * The bytes each recorded span covers, which is the only part of a
 * span the two orders can be compared on: Ruby records no `emit`.
 * @param text - the text the spans were taken over
 * @returns one string per span, in source order
 */
function spanBytes(text: string): string[] {
  return scanPassthroughs(text).map((span) => text.slice(span.start, span.end));
}

describe("the passthrough walk against Asciidoctor's two passes", () => {
  test.each(ROWS)("$name", async (row: Row) => {
    const document = `${row.text}\n`;
    expect(spanBytes(row.text)).toEqual([...row.walk]);
    expect(row.walk).not.toEqual(row.ruby);
    expect(await oracleHtml(document)).toBe(row.html);
    expect(shapes(document)).toEqual([...row.shape]);
    // The divergence costs no byte, which is the whole reason it is
    // recorded rather than fixed.
    await expectFormatted(document, document);
  });
});
