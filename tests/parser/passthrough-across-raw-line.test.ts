/**
 * A PASSTHROUGH SPANS A LINE THE READER DROPS (issue #194).
 *
 * `extract_passthroughs` (substitutors.rb l.1018) runs over a block's
 * KEPT lines joined with `\n`, the same text the quote pass reads, and
 * every one of its content groups crosses a newline. So `+**a` /
 * `// c` / `b**+ d` is ONE passthrough to Asciidoctor, whose text
 * renders literally: `**a\nb** d`, no `<strong>` anywhere.
 *
 * We built a bold span instead. The four whole-text scans were taken
 * over the joined text with nothing removed from it first, so the two
 * `**` paired across the comment exactly as they would have with no
 * passthrough around them, and the widened scan made that pairing
 * MORE confident than it had been: an unconstrained span where the
 * narrower reading had produced a constrained one. Twelve of the
 * sixteen rows below failed before the passthrough scan existed. Row
 * 1 read `"+"`, `boldu["a",rawLine,"b"]`, `"+ d"`, and rows 2, 4 to
 * 7, 9, 10 and 12 to 14 read that same shape behind their own opener
 * or with their own interior. Row 11 needs no dropped line at all and
 * failed the other way round, with a span MISSING: the doubled row's
 * gsub paired the outer `**` with the one inside the passthrough,
 * consumed both, and left the pair the oracle really makes unformed.
 * Bytes round-tripped and the render matched throughout, which is why
 * no gate caught any of it; what was wrong was the tree.
 *
 * Rows 3, 8 and 15 read correctly before the change and are here as
 * controls: a passthrough that never closes, a `pass:[]` one line
 * holds whole, and an opening `+` with nothing behind it. A fix that
 * suppressed marks wherever a `+` stands would break all three.
 *
 * A passthrough cut in two by a dropped line reaches the tree as two
 * `Passthrough` tokens with the raw line between them. That is what a
 * token can be: every token's image is a verbatim source slice, and
 * no slice spells bytes from both sides of a line that is not in the
 * pass text. What matters is that neither half's delimiters mean
 * anything any more, which is the reading the oracle has.
 *
 * Each row asserts three things: the oracle's own HTML (pinned here
 * rather than quoted in a comment, so the expectation cannot drift
 * from what `@asciidoctor/core` does), the inline shape the parser
 * builds, and - through `expectFormatted` - the formatted bytes,
 * render equality against the input, and idempotence.
 *
 * The sibling suite is tests/parser/span-across-raw-line.test.ts,
 * which pins the pairing this one has to stop.
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
    name: "the issue's witness: a comment inside a constrained passthrough",
    input: "+**a\n// c\nb**+ d\n",
    output: "+**a\n// c\nb**+ d\n",
    shape: ['pass("+**a")', "rawLine", 'pass("b**+")', '" d"'],
    html: '<div class="paragraph">\n<p>**a\nb** d</p>\n</div>',
  },
  {
    // The same document with single marks. Worth its own row because
    // the two readings the bug could reach differ here: the doubled
    // scan is not involved at all, and what paired was the
    // constrained row.
    name: "constrained marks inside the passthrough",
    input: "+*a\n// c\nb*+ d\n",
    output: "+*a\n// c\nb*+ d\n",
    shape: ['pass("+*a")', "rawLine", 'pass("b*+")', '" d"'],
    html: '<div class="paragraph">\n<p>*a\nb* d</p>\n</div>',
  },
  {
    // The passthrough is the CLOSING delimiter's doing, so a document
    // that never closes one is still a span. This row is what keeps
    // the fix from being "a `+` suppresses the marks behind it".
    name: "a passthrough that never closes leaves the pair alone",
    input: "+**a\n// c\nb** d\n",
    output: "+**a\n// c\nb** d\n",
    shape: ['"+"', 'boldu["a",rawLine,"b"]', '" d"'],
    html: '<div class="paragraph">\n<p>+<strong>a\nb</strong> d</p>\n</div>',
  },
  {
    // `+++` gives its content `subs: []`, so its newlines are bytes
    // the backend copies out. The half that ends at the dropped line
    // stops short of the fragment's own newline, or the output
    // carries that break twice (`passthroughTokenWidth`,
    // src/parse/inline/passthrough.ts).
    name: "the triple-plus boundary",
    input: "+++**a\n// c\nb**+++ d\n",
    output: "+++**a\n// c\nb**+++ d\n",
    shape: ['pass("+++**a")', "rawLine", 'pass("b**+++")', '" d"'],
    html: '<div class="paragraph">\n<p>**a\nb** d</p>\n</div>',
  },
  {
    name: "the double-plus boundary",
    input: "++**a\n// c\nb**++ d\n",
    output: "++**a\n// c\nb**++ d\n",
    shape: ['pass("++**a")', "rawLine", 'pass("b**++")', '" d"'],
    html: '<div class="paragraph">\n<p>**a\nb** d</p>\n</div>',
  },
  {
    name: "the dollar boundary",
    input: "$$**a\n// c\nb**$$ d\n",
    output: "$$**a\n// c\nb**$$ d\n",
    shape: ['pass("$$**a")', "rawLine", 'pass("b**$$")', '" d"'],
    html: '<div class="paragraph">\n<p>**a\nb** d</p>\n</div>',
  },
  {
    // The `pass:` arm of the same Ruby pattern. Its content group
    // crosses a newline too, so a dropped line between the bracket
    // and its closer is one macro to the oracle and no macro any rule
    // row here can match: the halves are bytes.
    name: "a pass macro that closes past the dropped line",
    input: "pass:[**a\n// c\nb**] d\n",
    output: "pass:[**a\n// c\nb**] d\n",
    shape: ['pass("pass:[**a")', "rawLine", 'pass("b**]")', '" d"'],
    html: '<div class="paragraph">\n<p>**a\nb** d</p>\n</div>',
  },
  {
    // The same macro closed on its own line stays the InlineMacro
    // row's, which is what keeps one macro's extent decided in one
    // place. The scan records it only so the mask covers its content.
    name: "a pass macro one line holds whole is still a macro",
    input: "pass:[**a]\n// c\nb** d\n",
    output: "pass:[**a]\n// c\nb** d\n",
    shape: ["inlineMacro", "rawLine", '"b** d"'],
    html: '<div class="paragraph">\n<p>**a\nb** d</p>\n</div>',
  },
  {
    name: "a passthrough across the comment, then a real pair across another",
    input: "+**a\n// c\nb**+ **c\n// d\ne** f\n",
    output: "+**a\n// c\nb**+ **c\n// d\ne** f\n",
    shape: [
      'pass("+**a")',
      "rawLine",
      'pass("b**+")',
      '" "',
      'boldu["c",rawLine,"e"]',
      '" f"',
    ],
    html: '<div class="paragraph">\n<p>**a\nb** <strong>c\ne</strong> f</p>\n</div>',
  },
  {
    name: "a real pair across the comment, then a passthrough across another",
    input: "**a\n// c\nb** +**x\n// d\ny**+ f\n",
    output: "**a\n// c\nb** +**x\n// d\ny**+ f\n",
    shape: [
      'boldu["a",rawLine,"b"]',
      '" "',
      'pass("+**x")',
      "rawLine",
      'pass("y**+")',
      '" f"',
    ],
    html: '<div class="paragraph">\n<p><strong>a\nb</strong> **x\ny** f</p>\n</div>',
  },
  {
    // NO dropped line at all: the mask the other rows rest on is a
    // fact about the whole pass text, and it was missing on one line
    // for the same reason it was missing across three. The doubled
    // row's own gsub CONSUMES what it pairs, so the opening `**` here
    // paired with the one inside the passthrough and the pair the
    // oracle makes never formed - the scan recorded a delimiter at an
    // offset no token stands at, and the span vanished. Masking the
    // passthrough leaves the outer pair the only one there is.
    name: "a delimiter inside a passthrough does not consume one outside",
    input: "**a +**b+ c** d\n",
    output: "**a +**b+ c** d\n",
    shape: ['boldu["a ",pass("+**b+")," c"]', '" d"'],
    html: '<div class="paragraph">\n<p><strong>a **b c</strong> d</p>\n</div>',
  },
  {
    name: "a curved-quote pair inside the passthrough",
    input: '+"`a`"\n// c\nb+ d\n',
    output: '+"`a`"\n// c\nb+ d\n',
    shape: ['pass("+\\"`a`\\"")', "rawLine", 'pass("b+")', '" d"'],
    html: '<div class="paragraph">\n<p>"`a`"\nb d</p>\n</div>',
  },
  {
    name: "a character reference inside the passthrough",
    input: "+(C)\n// c\nb+ d\n",
    output: "+(C)\n// c\nb+ d\n",
    shape: ['pass("+(C)")', "rawLine", 'pass("b+")', '" d"'],
    html: '<div class="paragraph">\n<p>(C)\nb d</p>\n</div>',
  },
  {
    // The attrlist both pass patterns take. `[x-]` is Ruby's legacy
    // monospaced spelling, whose content it DOES substitute into -
    // the render below carries a real `<strong>` - and refusing to
    // look inside is the divergence passthrough.ts's note 2 already
    // records for the one-line spelling. The row is here to say the
    // reading across a dropped line is the same reading, and that the
    // bytes it prints render what the author's did.
    name: "an attrlist in front of the passthrough",
    input: "[x-]+**a\n// c\nb**+ d\n",
    output: "[x-]+**a\n// c\nb**+ d\n",
    shape: ['pass("[x-]+**a")', "rawLine", 'pass("b**+")', '" d"'],
    html: '<div class="paragraph">\n<p><code><strong>a\nb</strong></code> d</p>\n</div>',
  },
  {
    // The constrained content group is `\S|\S[\s\S]*?\S`, so a `+`
    // with a newline right behind it opens nothing. Without this row
    // the suite would not say that the scan still applies the
    // boundary tests it always did.
    name: "a dropped line right behind the opening delimiter opens nothing",
    input: "+\n// c\nb**+ d\n",
    output: "+\n// c\nb**+ d\n",
    shape: ['"+"', "rawLine", '"b**+ d"'],
    html: '<div class="paragraph">\n<p>+\nb**+ d</p>\n</div>',
  },
  {
    // Two dropped lines, and content on both sides of the passthrough
    // on the lines it does reach. The halves are the runs' own bytes,
    // so a run holding more than the passthrough still tokenizes the
    // rest of itself.
    name: "two dropped lines, with text on both sides",
    input: "x +**a y\n// c\n// e\nb**+ d\n",
    output: "x +**a y\n// c\n// e\nb**+ d\n",
    shape: [
      '"x "',
      'pass("+**a y")',
      "rawLine",
      "rawLine",
      'pass("b**+")',
      '" d"',
    ],
    html: '<div class="paragraph">\n<p>x **a y\nb** d</p>\n</div>',
  },
];

describe("a passthrough spans a line the reader drops (#194)", () => {
  test.each(ROWS)("$name", async (row: Row) => {
    expect(await oracleHtml(row.input)).toBe(row.html);
    expect(shapes(row.input)).toEqual([...row.shape]);
    await expectFormatted(row.input, row.output);
  });
});
