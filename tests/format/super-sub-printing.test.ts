/**
 * Issue #14: what the PRINTER does once a superscript, a subscript or
 * a character reference is a node of its own rather than part of a
 * text run.
 *
 * The three questions this file asks are the ones the vocabulary change
 * could have moved, and nothing else - the parser rows live in
 * tests/parser/super-sub.test.ts and
 * tests/parser/character-reference.test.ts.
 *
 * ATOMICITY. A super/sub pair can hold no whitespace at all
 * (`(\S+?)`, asciidoctor.rb l.465-468) and neither can a reference, so
 * each is exactly one atom and no packer decision may open one. That
 * is a property of the construct rather than of a rule, and the rows
 * below hold it at widths far below the construct's own length, where
 * a packer with any freedom left would take it.
 *
 * THE BLOCK-START NET. `...` is a level-3 ordered-list marker at
 * column 0, and before this vocabulary it was the first WORD of the
 * block's first text node, where `keepBlockStartBreak`
 * (src/print/block-start-hazard.ts) read it. Carving those three bytes
 * into a node of their own had to leave the net's reach exactly where
 * it was, or `...` then `b c` packs to `... b c` - an ordered list the
 * source never had.
 *
 * THE DERIVED EDGE. An unconstrained span decides its spelling from
 * what stands beside it AS ITS OWN `QUOTE_SUBS` ROW SEES IT
 * (src/print/span-edges.ts), and these two rows are the last of the
 * twelve - so a super/sub span beside or around a mark span always
 * presents its own delimiter, never a rewrite of it, and the mark span
 * may still shorten.
 *
 * Every row is asserted for RENDER equality against its source (never
 * byte identity, since reflow moves breaks by design) and for
 * stability under a second format at the same width. Test inputs are
 * checked in and inlined, never generated.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

// The widths every atomicity row is packed at. The narrowest is below
// the length of every construct here, which is the point: a packer
// that could break one would have to.
const WIDTHS = [4, 8, 12, 20, 40, 80];

/**
 * One row's verdict at one width: the formatted output renders
 * identically to the source, formatting it again changes nothing, and
 * the construct appears in the output on ONE line, unbroken.
 * @param source - the row's document, without its trailing newline
 * @param atom - the construct that must survive whole on one line
 * @param printWidth - the column budget to format at
 */
async function expectAtomic(
  source: string,
  atom: string,
  printWidth: number,
): Promise<void> {
  const input = `${source}\n`;
  const out = await formatAdoc(input, { printWidth });
  expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  expect(await formatAdoc(out, { printWidth })).toBe(out);
  expect(out.split("\n").some((line) => line.includes(atom))).toBe(true);
}

describe("a construct with no whitespace in it is one atom", () => {
  // Long enough that the two narrowest widths cannot hold the
  // construct at all, and surrounded by words of two different lengths
  // so the greedy packer has a real decision to make on either side.
  const ROWS: ReadonlyArray<[string, string]> = [
    ["aaaa bbbbbb ^superscript^ cc dddddd", "^superscript^"],
    ["aaaa bbbbbb ~subscript~ cc dddddd", "~subscript~"],
    ["aaaa bbbbbb ^*bold-inside*^ cc dddddd", "^*bold-inside*^"],
    ["aaaa bbbbbb ~#marked#~ cc dddddd", "~#marked#~"],
    ["aaaa bbbbbb ^link:t[c]^ cc dddddd", "^link:t[c]^"],
    ["aaaa bbbbbb (TM) cc dddddd", "(TM)"],
    ["aaaa bbbbbb &copy; cc dddddd", "&copy;"],
    ["aaaa bbbbbb ... cc dddddd", "..."],
    ["aaaa bbbbbb -> cc dddddd", "->"],
    ["aaaa bbbbbb <= cc dddddd", "<="],
    ["aaaa bbbbbb -- cc dddddd", "--"],
  ];

  describe.each(ROWS)("%s", (source, atom) => {
    test.each(WIDTHS)("at width %i", async (printWidth) => {
      await expectAtomic(source, atom, printWidth);
    });
  });
});

describe("the spaced em dash survives the break reflow may put beside it", () => {
  // The one reference whose row reads its NEIGHBOURS
  // (`(?: |\n|^|\\)--(?: |\n|$)`, asciidoctor.rb l.498), so it is the
  // one a break decision could change. It cannot: the row admits a
  // newline and a line boundary wherever it admits a space, so moving
  // the break from one side of the dashes to the other, or onto them,
  // leaves the same match. The rows pack the same document at eight
  // widths and assert the render is the source's at every one.
  const SOURCES = [
    "aaaa bbbb -- cccc dddd",
    "aaaaaaaaaaaa -- bbbbbbbbbbbb",
    "a -- b -- c -- d",
    "aaaa bbbb -- cccc\ndddd -- eeee",
  ];

  describe.each(SOURCES)("%j", (source) => {
    test.each([4, 6, 8, 10, 12, 20, 40, 80])(
      "at width %i",
      async (printWidth) => {
        const input = `${source}\n`;
        const out = await formatAdoc(input, { printWidth });
        expect(await renderedHtml(out)).toBe(await renderedHtml(input));
        expect(await formatAdoc(out, { printWidth })).toBe(out);
      },
    );
  });
});

describe("the block-start hazard net still reaches a reference", () => {
  // `... b c` at column 0 is an ordered list item, so the net keeps
  // the source's own break behind the block's first word rather than
  // packing the two onto one line. The bytes are pinned here, not just
  // the render: what the net buys IS the break, and a render assertion
  // alone would not see it (a list and a paragraph render differently,
  // so this would fail either way - the byte pin is what says WHICH
  // repair happened).
  test("`...` keeps the break the source put behind it", async () => {
    const input = "...\nb c\n";
    const out = await formatAdoc(input);
    expect(out).toBe("...\nb c\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  test("and does so inside a list item's attached paragraph", async () => {
    const input = "* item\n+\n...\nb c\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The other direction, so the row above is not passing by accident:
  // a reference that is NOT block syntax at a line start has no break
  // to keep, and the two lines join like any other prose.
  test("a reference that is no marker joins its next line", async () => {
    const input = "(C)\nb c\n";
    const out = await formatAdoc(input);
    expect(out).toBe("(C) b c\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("an unconstrained span beside or inside a pair still shortens", () => {
  // The two rows run LAST, so whichever mark span asks, its own row has
  // already run when a super/sub delimiter is read - and what stands
  // beside it is the caret or tilde itself, which no boundary class
  // excludes. Both directions and both nestings are asked, because
  // `edgeTail`, `edgeHead` and `headContext` (src/print/inline.ts,
  // src/print/span-edges.ts) are three call sites of the same row
  // lookup and a pair that went opaque to one of them would keep the
  // wide spelling on that side alone.
  test.each([
    ["a pair in front", "x ^a^**b** y", "x ^a^*b* y"],
    ["a pair behind", "x **b**^a^ y", "x *b*^a^ y"],
    ["a superscript around it", "x ^**a**^ y", "x ^*a*^ y"],
    ["a subscript in front", "x ~a~__b__ y", "x ~a~_b_ y"],
  ])("%s", async (_where, source, expected) => {
    const input = `${source}\n`;
    const out = await formatAdoc(input);
    expect(out).toBe(`${expected}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
