/**
 * A DELIMITER PAIR SPANS A LINE THE READER DROPS (issue #112).
 *
 * Asciidoctor's substitution pass runs over a block's KEPT lines
 * joined with `\n` (`sub_quotes`, substitutors.rb l.189-196), and a
 * `//` line is gone before the parser sees it while a preprocessor
 * directive is gone before that. So `**a` / `// c` / `b** d` renders
 * `<strong>a\nb</strong> d`: the two doubled marks pair ACROSS the
 * comment, which is not in the text the row reads.
 *
 * Before `scanQuotePass` (src/parse/inline/quote-pass.ts) the four
 * whole-text scans were taken over one reflowable RUN each, so no
 * pair could reach past a raw line. Every row's shape assertion below
 * failed then: row 1 read `boldc["*a",rawLine,"b"]` followed by
 * `"* d"` - a CONSTRAINED single-mark span whose content carried the
 * leftover mark, and a leftover mark in the text behind it. Bytes
 * round-tripped and the render matched even so, which is why no gate
 * caught it; what was wrong was the tree.
 *
 * Each row asserts four things: the oracle's own HTML (pinned here
 * rather than quoted in a comment, so the expectation cannot drift
 * from what `@asciidoctor/core` does), the inline shape the parser
 * builds, and - through `expectFormatted` - the formatted bytes,
 * render equality against the input, and idempotence.
 *
 * The PRINTER's half of the same change is
 * tests/format/inline-span-break.test.ts's "a raw line at a span edge"
 * rows: once a pair can span a raw line, a mark may stand beside one,
 * and fusing it onto that line hands it to the comment.
 */
import { describe, expect, test } from "vitest";
import { expectFormatted, oracleHtml } from "../helpers.js";
import { shapes } from "./inline-shape.js";

/** One witness: what it is, what the oracle does, what we build. */
interface Row {
  /** What the row is a witness for. */
  readonly name: string;
  /** The document. */
  readonly input: string;
  /** The bytes the formatter must write for it. */
  readonly output: string;
  /** The inline shapes of the one paragraph it holds. */
  readonly shape: readonly string[];
  /** Asciidoctor's own HTML for `input`. */
  readonly html: string;
}

const ROWS: readonly Row[] = [
  {
    name: "the issue's witness: a comment between the two marks",
    input: "**a\n// c\nb** d\n",
    output: "**a\n// c\nb** d\n",
    shape: ['boldu["a",rawLine,"b"]', '" d"'],
    html: '<div class="paragraph">\n<p><strong>a\nb</strong> d</p>\n</div>',
  },
  {
    name: "a raw line adjacent to the OPENING marks",
    input: "**\n// c\nb** d\n",
    output: "**\n// c\nb** d\n",
    shape: ['boldu[rawLine,"b"]', '" d"'],
    html: '<div class="paragraph">\n<p><strong>\nb</strong> d</p>\n</div>',
  },
  {
    name: "a raw line adjacent to the CLOSING marks",
    input: "a **b\n// c\n** d\n",
    output: "a **b\n// c\n** d\n",
    shape: ['"a "', 'boldu["b",rawLine]', '" d"'],
    html: '<div class="paragraph">\n<p>a <strong>b\n</strong> d</p>\n</div>',
  },
  {
    name: "two raw lines inside one span",
    input: "a **b\n// c\n// e\nd** f\n",
    output: "a **b\n// c\n// e\nd** f\n",
    shape: ['"a "', 'boldu["b",rawLine,rawLine,"d"]', '" f"'],
    html: '<div class="paragraph">\n<p>a <strong>b\nd</strong> f</p>\n</div>',
  },
  {
    name: "a span holding a raw line, and a doubled pair after it",
    input: "a **b\n// c\nd** e **f** g\n",
    output: "a **b\n// c\nd** e **f** g\n",
    shape: ['"a "', 'boldu["b",rawLine,"d"]', '" e "', 'boldu["f"]', '" g"'],
    html: '<div class="paragraph">\n<p>a <strong>b\nd</strong> e <strong>f</strong> g</p>\n</div>',
  },
  {
    // The gsub takes the LEFTMOST match and resumes behind it, and it
    // does that over the joined text too: the opener at the head pairs
    // with the first `**` of the third line, and the pair that would
    // have stood inside that line alone never forms.
    name: "the row's own consumption order holds across the raw line",
    input: "**a\n// c\n**b** d\n",
    output: "**a\n// c\n**b** d\n",
    shape: ['boldu["a",rawLine]', '"b** d"'],
    html: '<div class="paragraph">\n<p><strong>a\n</strong>b** d</p>\n</div>',
  },
  {
    // Content whitespace between the raw line and the closing mark is
    // a JOIN and produces no atom of its own, so the raw line's atom
    // is still the one the close would fuse onto: the mark placement
    // asks the ATOM, not the span's last child (span-marks.ts).
    name: "whitespace stands between the raw line and the closing mark",
    input: "para\n  ** z\n// c\n  ** z\n",
    output: "para ** z\n// c\n** z\n",
    shape: [String.raw`"para\n  "`, 'boldu[" z",rawLine,"  "]', '" z"'],
    html: '<div class="paragraph">\n<p>para\n  <strong> z\n  </strong> z</p>\n</div>',
  },
  {
    // Not every raw line is a comment. An include this parser leaves
    // unresolved is one the oracle's preprocessor REPLACES with a
    // flush-left message, so the oracle's joined text carries that
    // message where our joined text carries nothing - and the pair is
    // the same either way, because the message spells no delimiter.
    name: "an unresolved include line",
    input: "**a\ninclude::x[]\nb** d\n",
    output: "**a\ninclude::x[]\nb** d\n",
    shape: ['boldu["a",rawLine,"b"]', '" d"'],
    html:
      '<div class="paragraph">\n<p><strong>a\nUnresolved directive in ' +
      "&lt;stdin&gt; - include::x[]\nb</strong> d</p>\n</div>",
  },
  {
    name: "the emphasis row",
    input: "__a\n// c\nb__ d\n",
    output: "__a\n// c\nb__ d\n",
    shape: ['italicu["a",rawLine,"b"]', '" d"'],
    html: '<div class="paragraph">\n<p><em>a\nb</em> d</p>\n</div>',
  },
  {
    name: "the highlight row",
    input: "##a\n// c\nb## d\n",
    output: "##a\n// c\nb## d\n",
    shape: ['highlightu["a",rawLine,"b"]', '" d"'],
    html: '<div class="paragraph">\n<p><mark>a\nb</mark> d</p>\n</div>',
  },
  {
    name: "the monospace row",
    input: "``a\n// c\nb`` d\n",
    output: "``a\n// c\nb`` d\n",
    shape: ['monospaceu["a",rawLine,"b"]', '" d"'],
    html: '<div class="paragraph">\n<p><code>a\nb</code> d</p>\n</div>',
  },
  {
    // NESTED: the raw line sits inside the INNER span, so the outer
    // span's direct children hold none. Both keep the wide spelling,
    // because the refusal is about the span's EXTENT in the source and
    // not about its child list (`holdsARawLine`, src/print/inline.ts).
    // A direct-children test shortened the outer span here and not in
    // row 1, which is the same document one level down.
    name: "a raw line inside a nested span keeps both wide spellings",
    input: "**a __b\n// c\nc__ d** e\n",
    output: "**a __b\n// c\nc__ d** e\n",
    shape: ['boldu["a ",italicu["b",rawLine,"c"]," d"]', '" e"'],
    html: '<div class="paragraph">\n<p><strong>a <em>b\nc</em> d</strong> e</p>\n</div>',
  },
  {
    name: "the same nesting the other way round",
    input: "__a **b\n// c\nc** d__ e\n",
    output: "__a **b\n// c\nc** d__ e\n",
    shape: ['italicu["a ",boldu["b",rawLine,"c"]," d"]', '" e"'],
    html: '<div class="paragraph">\n<p><em>a <strong>b\nc</strong> d</em> e</p>\n</div>',
  },
  {
    // The curved rows read the same joined text, and their content
    // group carries `/m`, so they reach across a dropped line for the
    // same reason the doubled rows do.
    name: "a curved-quote pair",
    input: 'x "`a\n// c\nb`" y\n',
    output: 'x "`a\n// c\nb`" y\n',
    shape: ['"x "', 'curvedd["a",rawLine,"b"]', '" y"'],
    html: '<div class="paragraph">\n<p>x &#8220;a\nb&#8221; y</p>\n</div>',
  },
];

describe("a delimiter pair spans a line the reader drops (#112)", () => {
  test.each(ROWS)("$name", async (row: Row) => {
    expect(await oracleHtml(row.input)).toBe(row.html);
    expect(shapes(row.input)).toEqual([...row.shape]);
    await expectFormatted(row.input, row.output);
  });
});
