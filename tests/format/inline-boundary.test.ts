/**
 * The constrained-mark boundary set, mark by mark and character by
 * character, at FORMAT level - the killing table for
 * src/parse/inline/quote-boundaries.ts (issue #36).
 *
 * Every row's span-or-text expectation was measured against the
 * oracle (`@asciidoctor/core`), not imagined: the LEFT frame
 * `x{c}*b* y` makes a span exactly when `c` is outside Ruby's
 * excluded-left class for the mark (`QUOTE_SUBS`,
 * asciidoctor.rb l.448-464), and the RIGHT frame
 * `x *b*{c}y` exactly when `c` fails the right lookahead
 * `(?!\p{Word})`. The two sides are DIFFERENT sets - `;` `:` `}` are
 * excluded on the left only - and monospace adds the curved-quote
 * characters on both of its sides. `<` `>` `&` are excluded on the
 * left because `sub_specialchars` has already rewritten them to
 * entities ending in `;` when the quote pass runs.
 *
 * Each row asserts three things: the parse reads span-vs-text the way
 * the oracle renders it, the formatted bytes are pinned (every frame
 * here is a fixed point), and the output is render-equal and
 * idempotent. The agreement controls (word characters, ordinary
 * punctuation, whitespace) are in the table on purpose: they kill
 * mutants of the OTHER clause of each predicate.
 */
import { describe, expect, test } from "vitest";
import { asParagraph, formatAdoc, renderedHtml } from "../helpers.js";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";

/** The four constrained marks and the span kind each one spells. */
const MARKS = [
  ["*", "bold"],
  ["_", "italic"],
  ["`", "monospace"],
  ["#", "highlight"],
] as const;

/**
 * Whether any node in an inline tree is a span of the given kind.
 * @param nodes - inline nodes to scan
 * @param type - the span kind to look for
 * @returns true when a span of that kind appears at any depth
 */
function hasSpan(nodes: readonly InlineNode[], type: string): boolean {
  return nodes.some(
    (node) =>
      node.type === type ||
      ("children" in node && hasSpan(node.children, type)),
  );
}

/**
 * The inline nodes of a one-paragraph document.
 * @param input - the document source
 * @returns the paragraph's inline children
 */
function paragraphInline(input: string): InlineNode[] {
  const document = parse(input);
  const [block] = document.children;
  return asParagraph(block).children;
}

/**
 * Characters the oracle accepts in FRONT of every constrained mark
 * (outside the excluded-left class), and word-adjacent controls it
 * rejects. `"` and `'` sit in neither list: they are per-mark
 * (monospace excludes them, the other three do not).
 */
const LEFT_OPENS = [
  ",",
  "!",
  "?",
  ".",
  "(",
  ")",
  "[",
  "]",
  "{",
  "/",
  "-",
  "=",
  "~",
  "|",
  "@",
  "^",
  "+",
  " ",
];
// Superscript two (U+00B2) and one half (U+00BD) are `\p{No}`: word
// characters to the ORACLE's class (CC_WORD,
// `@asciidoctor/core/build/node/index.cjs` l.54, which spells it
// `\p{N}`) and not to Ruby's `\p{Word}` (`\p{Nd}`). Ordinary prose
// carries them ("m2", "1/2 cup"), and reading them Ruby's way
// destroys spans - the unconstrained rows at the end of this file.
const LEFT_STAYS_TEXT = [
  ";",
  ":",
  "}",
  "_",
  "<",
  ">",
  "&",
  "a",
  "0",
  "\u00E9",
  "\u00B2",
  "\u00BD",
];

/**
 * Characters the oracle accepts BEHIND a closing mark (they fail the
 * `(?!\p{Word})` lookahead's class), and the word characters it does
 * not. `;` `:` `}` appear in the span list deliberately: the left
 * exclusions do NOT apply on the right.
 */
const RIGHT_CLOSES = [
  ";",
  ":",
  "}",
  "&",
  "-",
  "=",
  "~",
  "|",
  "@",
  "\\",
  ",",
  ".",
  "(",
  ")",
  " ",
];
const RIGHT_STAYS_TEXT = ["a", "0", "_", "\u00E9", "\u00B2", "\u00BD"];

/**
 * One row's full verdict: parse shape, byte fixpoint, render
 * equality, idempotence.
 * @param input - the row's document
 * @param type - the span kind under test
 * @param spans - whether the oracle makes a span of that kind here
 */
async function expectRow(
  input: string,
  type: string,
  spans: boolean,
): Promise<void> {
  expect(hasSpan(paragraphInline(input), type)).toBe(spans);
  const out = await formatAdoc(input);
  expect(out).toBe(input);
  expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  expect(await formatAdoc(out)).toBe(out);
}

for (const [mark, type] of MARKS) {
  describe(`${type} (${mark}) and the boundary classes`, () => {
    test.each(LEFT_OPENS.filter((character) => character !== mark))(
      `"x%s${mark}b${mark} y" is a span`,
      async (character) => {
        await expectRow(`x${character}${mark}b${mark} y\n`, type, true);
      },
    );

    test.each(LEFT_STAYS_TEXT.filter((character) => character !== mark))(
      `"x%s${mark}b${mark} y" stays text`,
      async (character) => {
        await expectRow(`x${character}${mark}b${mark} y\n`, type, false);
      },
    );

    test.each(RIGHT_CLOSES.filter((character) => character !== mark))(
      `"x ${mark}b${mark}%sy" is a span`,
      async (character) => {
        await expectRow(`x ${mark}b${mark}${character}y\n`, type, true);
      },
    );

    test.each(RIGHT_STAYS_TEXT.filter((character) => character !== mark))(
      `"x ${mark}b${mark}%sy" stays text`,
      async (character) => {
        await expectRow(`x ${mark}b${mark}${character}y\n`, type, false);
      },
    );
  });
}

describe("monospace's per-mark extras: the curved-quote characters", () => {
  // `"` and `'` join monospace's excluded-left class and its right
  // lookahead because they are the two curved-quote rows this parser
  // MODELS (curved-quotes.ts: `"\`` opens the double row, `` \`' ``
  // closes the single one), while the other marks treat them as
  // ordinary punctuation. Neither frame below matches either row
  // itself - `x"\`b\` y` opens no curved pair (nothing closes it) and
  // `` x \`b\`"y `` closes none (nothing opened it) - so these rows
  // stay about monospace's own excluded classes; the derived boundary
  // a curved row's own rewrite creates is the next block's question.
  // One pair of rows per side, both marks compared.
  test.each(['"', "'"])(
    "left %s: mono stays text, bold spans",
    async (character) => {
      await expectRow(`x${character}\`b\` y\n`, "monospace", false);
      await expectRow(`x${character}*b* y\n`, "bold", true);
    },
  );
  test.each(['"', "'"])(
    "right %s: mono stays text, bold spans",
    async (character) => {
      await expectRow(`x \`b\`${character}y\n`, "monospace", false);
      await expectRow(`x *b*${character}y\n`, "bold", true);
    },
  );
});

describe("the derived boundary: a mark reading its curved-quote neighbour", () => {
  // Each row's mark stands right beside a curved-quote delimiter.
  // Whether that neighbour reads as the source bytes (`"`, a
  // backtick) or as the curved row's own rewrite (`&`, `;`) decides
  // whether the mark's excluded classes refuse it - `seesCurvedRewrite`
  // (quote-boundaries.ts). Measured against the oracle; `<p>` contents
  // shown in each comment.
  test.each<[string, string, boolean]>([
    // <p>x <code>b</code>&#8220;a&#8221; y</p> - the monospace CLOSE
    // at offset 4 reads the character after it through the rewrite:
    // unmasked, the source `"` there would refuse the close (the bug
    // this task fixes), though the oracle still makes the span.
    ['x `b`"`a`" y\n', "monospace", true],
    // <p>x &#8220;a&#8221;#b# y</p> - highlight's own row runs after
    // the curved rows, so the `;` the curved close already wrote
    // stands in front of the `#`, which its excluded-left class
    // refuses.
    ['x "`a`"#b# y\n', "highlight", false],
    // <p>x &#8220;a&#8221;`b` y</p> - a control: monospace's own
    // excluded-left class already carries `"` (MONOSPACE_EXTRA), so
    // the source byte and the rewrite's `;` refuse this open alike,
    // and the pair stays literal backticks under either reading.
    ['x "`a`"`b` y\n', "monospace", false],
    // <p>x &#8220;a&#8221;<strong>b</strong> y</p> - bold's rows run
    // BEFORE the two curved rows (indices 0-1 of QUOTE_SUBS), so its
    // open reads the SOURCE `"` in front of it - an ordinary,
    // unexcluded character - where the three later marks read the
    // rewrite's `;` instead.
    ['x "`a`"*b* y\n', "bold", true],
    // <p>x &#8220;<strong>a</strong>&#8221; y</p> - the same
    // exemption inside the pair: bold's open sits right against the
    // curved OPEN's own backtick and still spans, because it reads
    // the source byte, not the rewrite.
    ['x "`*a*`" y\n', "bold", true],
  ])("%j", async (input, type, spans) => {
    await expectRow(input, type, spans);
  });
});

describe("the backslash escape stays an escape", () => {
  // `\*` is BackslashEscape, not a mark: the constrained pattern's
  // escape arm (convert_quoted_text, substitutors.rb l.1419-1424)
  // emits the match literally.
  test("an escaped open mark makes no span", async () => {
    const input = "x \\*b* y\n";
    expect(hasSpan(paragraphInline(input), "bold")).toBe(false);
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("direction rows: open and close are different questions", () => {
  // The oracle's opener needs a non-space AFTER the mark, its closer
  // a non-space BEFORE it - `(\S|\S.*?\S)` - so the same character in
  // the same neighbourhood answers differently by side.
  test.each<[string, string, boolean]>([
    // A mark with whitespace on its content side can do nothing.
    ["x * b * c\n", "bold", false],
    // The closing mark against a following word character dissolves
    // the WHOLE span, not just the closer.
    ["x *b*y z\n", "bold", false],
    // The same shape with the closer freed is a span again.
    ["x *b* yz\n", "bold", true],
  ])("%j", async (input, type, spans) => {
    await expectRow(input, type, spans);
  });

  test("*a*#b# keeps both spans", async () => {
    const input = "*a*#b# y\n";
    expect(hasSpan(paragraphInline(input), "bold")).toBe(true);
    expect(hasSpan(paragraphInline(input), "highlight")).toBe(true);
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the word class is the oracle's, not Ruby's", () => {
  // The UNCONSTRAINED spelling beside a `\p{No}` neighbour. Ruby's
  // `\p{Word}` carries `\p{Nd}` only, so a Ruby reading calls the
  // superscript no word character, shortens the span, and the
  // oracle then renders the marks literally - the `<strong>` gone.
  // The oracle's own class (`\p{N}`) keeps the doubled marks. Each
  // row is a byte fixpoint AND render-equal, which is what the
  // shortened spelling could not be.
  test.each(["\u00B2", "\u00BD", "\u00B3"])(
    "%s in front keeps the doubled marks",
    async (character) => {
      const input = `x${character}**b c** y\n`;
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    },
  );

  test("a superscript behind keeps the doubled marks", async () => {
    const input = "x **b c**\u00B2y\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the derived boundary at print time: a mark reading a SPAN sibling", () => {
  // Two unconstrained spans standing shoulder to shoulder, with no
  // text between them at all. The neighbour beside the second span is
  // not a text node - it is the FIRST span itself - so a check that
  // only ever read `previous?.type === "text"` could never see past
  // it and always refused. Reading the sibling's row-derived edge
  // (edgeTail/edgeHead, src/print/span-edges.ts) answers correctly
  // instead: once the first span's own row has resolved, what stands
  // beside the second is that row's element boundary (`>`), which
  // none of the four marks excludes, so the second span may still
  // shorten despite having no text neighbour of its own.
  test.each<[string, string]>([
    ["**a**__b__ c", "**a**_b_ c"],
    ["**a**##b## c", "*a*#b# c"],
    ["x ##a##__b__ c", "x #a#_b_ c"],
  ])("%s shortens to %s", async (source, expected) => {
    const input = `${source}\n`;
    const expectedOut = `${expected}\n`;
    const out = await formatAdoc(input);
    expect(out).toBe(expectedOut);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the shortening is refused where it would move a same mark (issue #72)", () => {
  // Shortening an unconstrained span removes two mark characters from
  // the line, and the rows read the whole line. Two neighbourhoods make
  // that unsafe, and each row below is a shape where the shorter
  // spelling reads DIFFERENTLY - asserted here against the oracle, so
  // the refusal is pinned as necessary and not merely cautious.
  //
  // ABUTMENT. Ruby's boundary clauses admit a mark character beside a
  // constrained delimiter, but the UNCONSTRAINED row of the same mark
  // runs in front of the constrained one and pairs a DOUBLED
  // delimiter, so two single marks written flush against each other
  // are a `**` that row takes. `[**a***]**c*` is `[` + `**a**` +
  // `*]*` + `*c*`, and the first span's close abuts the second span's
  // open.
  //
  // AN ATTRLIST IN FRONT. Every row carries an optional
  // `(?:\[([^\]]+)\])?` group in front of its delimiter
  // (asciidoctor.rb l.446-464), so a bracketed run flush against a
  // span belongs to whichever row resolves it; shortening hands the
  // run to the constrained row, which consumes the marks inside it
  // that the unconstrained spelling left for that row to re-read.
  //
  // Issue #83's own witnesses (`**a****b**`, `##a####b##`) are the
  // abutment rule between two UNCONSTRAINED spans and are in the table
  // for that reason.
  test.each<[string, string]>([
    ["[**a***]**c*", "[*a**]**c*"],
    ["[**a***]**cc*", "[*a**]**cc*"],
    ["[**a***]c**c*", "[*a**]c**c*"],
    ["[**a***a]**c*", "[*a**a]**c*"],
    ["[**aa***]**c*", "[*aa**]**c*"],
    ["[##a###]c##c#", "[#a##]c##c#"],
    ["[*a**a*]**c**", "[*a**a*]*c*"],
    ["**a****b**", "*a**b*"],
    ["##a####b##", "#a##b#"],
    // A backtick standing LATER in the run: the `"` the run is written
    // behind guards only its first character, and a space or a hyphen
    // opens monospaced's constrained row like any other non-word
    // character.
    ["[a `b` c]``d``", "[a `b` c]`d`"],
    ["[a-`b`-c]``d``", "[a-`b`-c]`d`"],
    ["x[`a`]``c``", "x[`a`]`c`"],
    // The one mark whose attrlist this parser PARSES: it rides on the
    // span as a role rather than standing in the siblings, so the run
    // is read from there.
    ["[##a#]##c##", "[##a#]#c#"],
    ["[####]##c##", "[####]#c#"],
    ["[a #b# c]##d##", "[a #b# c]#d#"],
    // A word character in front of the BRACKET. The constrained row's
    // left clause is tested where the match starts, so the run the
    // wider spelling took as a role is no role to the narrower one.
    ["x[a]**c**", "x[a]*c*"],
    ["x[a]__c__", "x[a]_c_"],
    ["x[a]``c``", "x[a]`c`"],
  ])(
    "%s keeps its bytes, because %s reads differently",
    async (source, shorter) => {
      const input = `${source}\n`;
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(await formatAdoc(out)).toBe(out);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      // The refusal is necessary: the spelling the printer would
      // otherwise have written is a different document to the oracle.
      expect(await renderedHtml(`${shorter}\n`)).not.toBe(
        await renderedHtml(input),
      );
    },
  );

  // The other side of every clause, so none is a blanket refusal. A
  // same-mark span elsewhere on the line is fine as long as nothing
  // abuts (row 3); an attrlist in front is fine as long as it carries
  // no mark AND no word character stands in front of its bracket
  // (row 2); and row 4 is the abutment of two DIFFERENT marks, which
  // the abutment clause leaves alone.
  test.each<[string, string]>([
    ["**c**", "*c*"],
    ["[ab]**c**", "[ab]*c*"],
    ["*a* **a**", "*a* *a*"],
    ["**a**##b## c", "*a*#b# c"],
  ])("%s still shortens to %s", async (source, expected) => {
    const input = `${source}\n`;
    const out = await formatAdoc(input);
    expect(out).toBe(`${expected}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The conservative edge of the same two clauses: shapes where the
  // shorter spelling happens to survive the oracle, and the clause
  // refuses anyway because it reads the run and not the whole line.
  // The trade is the file's own: a refusal prints the author's bytes,
  // which costs bytes and no meaning, and the same clause is what
  // keeps `[##a#]##c##` and `[a `b` c]``d`` from corrupting.
  test.each<[string, string]>([
    ["[`a`]``c``", "[`a`]`c`"],
    ["[a##b]##c##", "[a##b]#c#"],
  ])(
    "%s is refused conservatively, and the shorter spelling %s would have survived",
    async (source, shorter) => {
      const input = `${source}\n`;
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(await formatAdoc(out)).toBe(out);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      expect(await renderedHtml(`${shorter}\n`)).toBe(
        await renderedHtml(input),
      );
    },
  );

  // A span the scan newly finds brings the block's existing
  // break-keeping with it (issue #55's rule, reached by a corrected
  // tree): `***` on the second line is a constrained span here, and
  // the author's own break survives where it used to be reflowed into
  // a space. Render-equal either way; the bytes are now the input's.
  test("a newly-found span keeps the author's line break", async () => {
    const input = "[a\n]***\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the shortening reads the attrlist's own left context (issues #85, #88)", () => {
  // Two more things about the bytes in FRONT of an attrlist's `[`
  // decide whether the run is still that run to the narrower row.
  //
  // A MARK CHARACTER (issue #85). The constrained row's left clause
  // `(^|[^\p{Word};:}])` CONSUMES a character, and a match of that
  // same row standing in front of the bracket ends with the mark it
  // closed - so the character the second match needed is already
  // spent and its `[` is read as the boundary character instead, the
  // attributes group gone. `[a]**c**[b]**d**` renders two roles;
  // shortening BOTH spans keeps only the first, and it chains.
  //
  // The same hazard has a second direction, and the refusal has to
  // reach both: where the span BEHIND is already spelled constrained
  // in the source, nothing is asked about it and the damage is done
  // by shortening the span in FRONT onto its row. Only a span behind
  // on that same row can lose the character - one on any other row is
  // matched in a pass of its own, by which time the span in front is
  // an element and the byte before its bracket is a boundary
  // character nothing has spent.
  //
  // A BACKSLASH (issue #88). Only the UNCONSTRAINED rows carry a
  // `\\?` in front of their attributes group (`QUOTE_SUBS`,
  // asciidoctor.rb l.439-468); on those the escape returns the whole match as
  // literal text, which the constrained row of the same mark then
  // re-reads. The constrained rows have no `\\?` at all and take the
  // backslash through the left clause instead, where an escaped
  // match keeps its brackets and drops only the escape
  // (`convert_quoted_text`, substitutors.rb l.1419-1426). So the two
  // spellings read the escape differently and the shorter one may
  // not stand in for the wider one.
  test.each<[string, string, string]>([
    // issue #85
    ["[a]**c**[b]**d**", "[a]*c*[b]**d**", "[a]*c*[b]*d*"],
    ["[a]*c*[b]**d**", "[a]*c*[b]**d**", "[a]*c*[b]*d*"],
    [
      "[a]**c**[b]**d**[e]**f**",
      "[a]*c*[b]**d**[e]**f**",
      "[a]*c*[b]*d*[e]*f*",
    ],
    // issue #85, the span behind already constrained in the source
    ["[a]**c**[b]*d*", "[a]**c**[b]*d*", "[a]*c*[b]*d*"],
    ["[a]__c__[b]_d_", "[a]__c__[b]_d_", "[a]_c_[b]_d_"],
    ["[a]``c``[b]`d`", "[a]``c``[b]`d`", "[a]`c`[b]`d`"],
    ["[a]##c##[b]#d#", "[a]##c##[b]#d#", "[a]#c#[b]#d#"],
    ["**c**[b]*d*", "**c**[b]*d*", "*c*[b]*d*"],
    // issue #88
    [
      String.raw`x \[red]**c** y`,
      String.raw`x \[red]**c** y`,
      String.raw`x \[red]*c* y`,
    ],
    [
      String.raw`x \[red]__c__ y`,
      String.raw`x \[red]__c__ y`,
      String.raw`x \[red]_c_ y`,
    ],
    ["x \\[red]``c`` y", "x \\[red]``c`` y", "x \\[red]`c` y"],
    [
      String.raw`x \[red]##c## y`,
      String.raw`x \[red]##c## y`,
      String.raw`x \[red]#c# y`,
    ],
  ])(
    "%s formats to %s, because %s reads differently",
    async (source, expected, shorter) => {
      const input = `${source}\n`;
      const out = await formatAdoc(input);
      expect(out).toBe(`${expected}\n`);
      expect(await formatAdoc(out)).toBe(out);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      // The refusal is necessary: the spelling the printer would
      // otherwise have written is a different document to the oracle.
      expect(await renderedHtml(`${shorter}\n`)).not.toBe(
        await renderedHtml(input),
      );
    },
  );

  // The other side of both clauses, so neither is a blanket refusal:
  // a span behind on ANOTHER row cannot take the character, a run
  // that does not open flush against this span's closing delimiter
  // never needed it, and an ordinary attrlist with neither a mark nor
  // a backslash in front of its bracket still shortens.
  test.each<[string, string]>([
    ["[a]**c**[b]__d__", "[a]*c*[b]_d_"],
    ["[a]**c** [b]*d*", "[a]*c* [b]*d*"],
    ["[a]**c**][b]*d*", "[a]*c*][b]*d*"],
    ["x [red]**c** y", "x [red]*c* y"],
  ])("%s still shortens to %s", async (source, expected) => {
    const input = `${source}\n`;
    const out = await formatAdoc(input);
    expect(out).toBe(`${expected}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("a span inside another span's attrlist keeps its spelling (issue #86)", () => {
  // The mirror of the run in FRONT of a span: here the span being
  // respelled stands INSIDE the bracketed run that a span behind it
  // takes as its attributes group. The run is that span's attribute
  // VALUE and the value goes through the quote pass, so the class
  // holds a rewrite of the author's bytes and not the bytes: which
  // row reads the inner span decides what the class says.
  test.each<[string, string]>([
    ["[**a**]*c*", "[*a*]*c*"],
    ["[ **a**]*c*", "[ *a*]*c*"],
    ["[**a** b]*c*", "[*a* b]*c*"],
    ["[__a__]_c_", "[_a_]_c_"],
    ["[``a``]`c`", "[`a`]`c`"],
  ])(
    "%s keeps its bytes, because %s reads differently",
    async (source, shorter) => {
      const input = `${source}\n`;
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(await formatAdoc(out)).toBe(out);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      expect(await renderedHtml(`${shorter}\n`)).not.toBe(
        await renderedHtml(input),
      );
    },
  );

  // The other side of the clause: a run that does not close flush
  // against a span is no attributes group, and a span standing in
  // one still shortens.
  test.each<[string, string]>([
    ["[**a**] *c*", "[*a*] *c*"],
    ["[**a**]x", "[*a*]x"],
  ])("%s still shortens to %s", async (source, expected) => {
    const input = `${source}\n`;
    const out = await formatAdoc(input);
    expect(out).toBe(`${expected}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The conservative edge: the run in these shapes is not the inner
  // span's hazard at all - the inner mark's rows run in front of the
  // row that consumes the run either way, so the class reads the
  // same - and the clause refuses them with the rest because it asks
  // where the bytes stand, not which row will read them. A refusal
  // prints the author's bytes, which costs bytes and no meaning.
  test.each<[string, string]>([
    ["[**a**]`c`", "[*a*]`c`"],
    ["x[**a**]*c*", "x[*a*]*c*"],
  ])(
    "%s is refused conservatively, and the shorter spelling %s would have survived",
    async (source, shorter) => {
      const input = `${source}\n`;
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(await formatAdoc(out)).toBe(out);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      expect(await renderedHtml(`${shorter}\n`)).toBe(
        await renderedHtml(input),
      );
    },
  );
});
