/**
 * WHERE A CHARACTER REFERENCE STANDS, measured against the oracle
 * (issue #14).
 *
 * `sub_replacements` (substitutors.rb l.282-286) runs the
 * `REPLACEMENTS` table one row at a time, each row a gsub over the
 * whole text, and `src/parse/inline/replacements.ts` replays that walk
 * once per fragment. Two facts about it decide most of the rows below,
 * and neither is visible from a reference's own offset:
 *
 * - ROW ORDER settles an overlap. `x <-> y` is one right arrow,
 *   because the right-arrow row runs before the left-arrow row and
 *   takes the `->` out of the middle;
 * - CONSUMPTION settles a repeat. `x -- -- y` is one em dash, because
 *   the spaced row eats the spaces around its dashes and the second
 *   pair's leading space is inside the first pair's match.
 *
 * Ruby spells four of the rows against `sub_specialchars`' output
 * (`-&gt;`, `&lt;-`, and the entity row's `(&)amp;`); the tokenizer
 * reads the author's bytes, so the rows are transcribed into them and
 * the rows below measure that the correspondence holds in both
 * directions.
 *
 * Every row carries the oracle's own render, so no expectation here can
 * drift away from what `@asciidoctor/core` does. A row asks WHICH
 * CHARACTER a replacement produced, which is content, so the rows read
 * the comparison lens and name the character itself; only the tab row,
 * whose claim is about a whitespace class, reads the oracle's bytes,
 * where no fold of the lens's can reach it.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, oracleHtml, renderedHtml } from "../helpers.js";
import { shapes } from "./inline-shape.js";
import { scanReplacements } from "../../src/parse/inline/replacements.js";

/**
 * A named comparator rather than an inline one, because the sort sits
 * inside a `test` inside a `describe.each` inside a `describe` and the
 * callback nesting is capped at three.
 * @param left - one entry
 * @param right - another
 * @returns the usual sort contract
 */
function byOffset(left: [number, number], right: [number, number]): number {
  return left[0] - right[0];
}

/**
 * What the scan found in `source`, as `offset:bytes` pairs - the bytes
 * rather than the width, so a failing row prints what it claimed
 * instead of a number the reader has to index by hand.
 * @param source - the fragment, exactly as a row spells it
 * @returns one entry per reference, offset-ascending
 */
function references(source: string): string[] {
  return [...scanReplacements(source)]
    .toSorted(byOffset)
    .map(
      ([offset, length]) =>
        `${offset}:${source.slice(offset, offset + length)}`,
    );
}

/** One measured row. */
interface Row {
  /** What the row is about, as the test name. */
  readonly name: string;
  /** The document, without its trailing newline. */
  readonly source: string;
  /**
   * A fragment the oracle renders, read through the comparison lens.
   * What a row claims is WHICH CHARACTER the replacement produced,
   * not how Asciidoctor serializes it, so the expectation names the
   * character (as a `\u` escape, since most of them are invisible on
   * the page) rather than the numeric reference the oracle writes.
   */
  readonly renders: string;
  /** The references the scan must find, `offset:bytes`. */
  readonly found: string[];
}

/**
 * The three assertions every row makes: the oracle's render, the
 * scan's references, and a byte fixed point that is render-equal and
 * idempotent. A reference has one spelling - its own - so every row
 * here is a fixed point.
 * @param row - the row to assert
 */
function checkRow(row: Row): void {
  test("the oracle's render", async () => {
    expect(await renderedHtml(row.source)).toContain(row.renders);
  });

  test("the scan finds these references", () => {
    expect(references(row.source)).toEqual(row.found);
  });

  test("the bytes are pinned, render-equal and idempotent", async () => {
    const out = await formatAdoc(row.source);
    expect(out).toBe(`${row.source}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(row.source));
    expect(await formatAdoc(out)).toBe(out);
  });
}

describe("the eleven modelled rows of REPLACEMENTS", () => {
  const ROWS: readonly Row[] = [
    {
      name: "(C)",
      source: "x (C) y",
      renders: "x \u00A9 y",
      found: ["2:(C)"],
    },
    {
      name: "(R)",
      source: "x (R) y",
      renders: "x \u00AE y",
      found: ["2:(R)"],
    },
    {
      name: "(TM), the one four-character reference",
      source: "x (TM) y",
      renders: "x \u2122 y",
      found: ["2:(TM)"],
    },
    {
      name: "the spaced em dash, whose match eats both spaces",
      source: "x -- y",
      renders: "x\u2009\u2014\u2009y",
      found: ["2:--"],
    },
    {
      name: "the word em dash, whose match eats the word in front",
      source: "x--y",
      renders: "x\u2014\u200By",
      found: ["1:--"],
    },
    {
      name: "the ellipsis",
      source: "x ... y",
      renders: "x \u2026\u200B y",
      found: ["2:..."],
    },
    {
      name: "the right arrow",
      source: "x -> y",
      renders: "x \u2192 y",
      found: ["2:->"],
    },
    {
      name: "the right double arrow",
      source: "x => y",
      renders: "x \u21D2 y",
      found: ["2:=>"],
    },
    {
      name: "the left arrow",
      source: "x <- y",
      renders: "x \u2190 y",
      found: ["2:<-"],
    },
    {
      name: "the left double arrow",
      source: "x <= y",
      renders: "x \u21D0 y",
      found: ["2:<="],
    },
    {
      name: "a named entity, restored rather than replaced",
      source: "x &copy; y",
      renders: "x &copy; y",
      found: ["2:&copy;"],
    },
    {
      name: "a numeric entity",
      source: "x &#169; y",
      renders: "x \u00A9 y",
      found: ["2:&#169;"],
    },
  ];

  describe.each(ROWS)("$name", (row) => {
    checkRow(row);
  });
});

describe("what the rows refuse", () => {
  // Each row's boundary clause, asked at the place it says no. The
  // entity row tests SHAPE and not validity - `&notanentity;` is a
  // reference to the oracle too - so the refusals there are the ones
  // its character classes really make: two letters minimum, and two to
  // six digits after a `#`.
  const ROWS: readonly Row[] = [
    {
      name: "the copyright row is case-sensitive",
      source: "x (c) y",
      renders: "x (c) y",
      found: [],
    },
    {
      name: "the spaced em dash needs a space BEHIND the dashes",
      source: "x --y",
      renders: "x --y",
      found: [],
    },
    {
      name: "and a space in FRONT of them",
      source: "x-- y",
      renders: "x-- y",
      found: [],
    },
    {
      name: "four dashes are neither row's",
      source: "a ---- b",
      renders: "a ---- b",
      found: [],
    },
    {
      name: "an entity name is two letters or more",
      source: "x &a; y",
      renders: "x &amp;a; y",
      found: [],
    },
    {
      name: "a numeric entity is at most six digits",
      source: "x &#1234567; y",
      renders: "x &amp;#1234567; y",
      found: [],
    },
    {
      name: "an entity needs its semicolon",
      source: "x a&b y",
      renders: "x a&amp;b y",
      found: [],
    },
  ];

  describe.each(ROWS)("$name", (row) => {
    checkRow(row);
  });

  // The space class, pinned apart from the fixed-point rows because
  // this shape is NOT one. Ruby's spaced row admits the space
  // character, a newline and a line boundary, never a tab, so
  // `a<TAB>--<TAB>b` renders its dashes literally and the scan finds
  // nothing. The formatter's own whitespace normalisation then rewrites
  // the tabs to spaces and the output DOES carry an em dash - a
  // pre-existing reflow decision (the parent revision writes the same
  // bytes), which this vocabulary is the first thing to name. Recorded
  // here rather than hidden: the row this file is about is right, and
  // the whitespace rewrite above it is a separate question.
  //
  // The TABS are the claim, so this row reads the oracle's own bytes.
  // The comparison lens happens to carry a lone tab through today (its
  // run rule wants two adjacent blanks), but which whitespace that lens
  // folds is its own decision to revisit; a claim ABOUT a whitespace
  // class should not rest on it.
  test("a tab is not the space the spaced row admits", async () => {
    expect(references("a\t--\tb")).toEqual([]);
    expect(await oracleHtml("a\t--\tb")).toContain("a\t--\tb");
    expect(await formatAdoc("a\t--\tb")).toBe("a -- b\n");
    expect(references("a -- b")).toEqual(["2:--"]);
  });
});

describe("row order and consumption", () => {
  // The two facts a per-offset test cannot reach, each with the row
  // that measures it.
  const ROWS: readonly Row[] = [
    {
      name: "`<->` is the right arrow, because its row runs first",
      source: "a <-> b",
      renders: "a &lt;\u2192 b",
      found: ["3:->"],
    },
    {
      name: "`<=>` is the right DOUBLE arrow, for the same reason",
      source: "a <=> b",
      renders: "a &lt;\u21D2 b",
      found: ["3:=>"],
    },
    {
      name: "`<==` leaves the left double arrow, nothing having taken it",
      source: "a <== b",
      renders: "a \u21D0= b",
      found: ["2:<="],
    },
    {
      name: "`-->` is one dash and one arrow",
      source: "a --> b",
      renders: "a -\u2192 b",
      found: ["3:->"],
    },
    {
      name: "`-- --` is ONE em dash: the second pair's space is eaten",
      source: "a -- -- b",
      renders: "a\u2009\u2014\u2009-- b",
      found: ["2:--"],
    },
    {
      name: "the word row resumes behind its own match, so both pair",
      source: "a--b--c",
      renders: "a\u2014\u200Bb\u2014\u200Bc",
      found: ["1:--", "4:--"],
    },
    {
      name: "five dots are one ellipsis and two dots",
      source: "a ..... b",
      renders: "a \u2026\u200B.. b",
      found: ["2:..."],
    },
    {
      name: "two arrows run together are two references",
      source: "a ->-> b",
      renders: "a \u2192\u2192 b",
      found: ["2:->", "4:->"],
    },
  ];

  describe.each(ROWS)("$name", (row) => {
    checkRow(row);
  });
});

describe("escapes are consumed and record nothing", () => {
  // `do_replacement` (substitutors.rb l.1450-1453) writes the captured
  // text back with the backslash stripped, so the render is the
  // author's own characters and there is no reference to record. The
  // arrow row's escape is the one that shows what "the captured text"
  // means: `\->` renders `-&gt;`, the entity `sub_specialchars` wrote,
  // which is a literal `->` on the page.
  const ROWS: readonly Row[] = [
    {
      name: "an escaped copyright",
      source: String.raw`x \(C) y`,
      renders: "x (C) y",
      found: [],
    },
    {
      name: "an escaped em dash",
      source: String.raw`x \-- y`,
      renders: "x -- y",
      found: [],
    },
    {
      name: "an escaped word em dash",
      source: String.raw`x\--y`,
      renders: "x--y",
      found: [],
    },
    {
      name: "an escaped ellipsis",
      source: String.raw`x \... y`,
      renders: "x ... y",
      found: [],
    },
    {
      name: "an escaped arrow",
      source: String.raw`x \-> y`,
      renders: "x -&gt; y",
      found: [],
    },
    {
      name: "an escaped entity",
      source: String.raw`x \&copy; y`,
      renders: "x &amp;copy; y",
      found: [],
    },
  ];

  describe.each(ROWS)("$name", (row) => {
    checkRow(row);
  });
});

describe("the two rows this parser does not model", () => {
  // The right single quote and the in-word apostrophe are the only
  // REPLACEMENTS rows whose bytes are also QUOTE_SUBS delimiters, so
  // they are left as text (replacements.ts's header says why). The rows
  // below pin that decision as a fact rather than an accident: the
  // oracle DOES replace them, the scan finds nothing, and the bytes and
  // the render are untouched all the same.
  const ROWS: readonly Row[] = [
    {
      name: "the right single quote renders and is still text to us",
      source: "x `' y",
      renders: "x \u2019 y",
      found: [],
    },
    {
      name: "the in-word apostrophe, the same",
      source: "dont x'y z",
      renders: "dont x\u2019y z",
      found: [],
    },
  ];

  describe.each(ROWS)("$name", (row) => {
    checkRow(row);
  });
});

describe("references against the rest of the vocabulary", () => {
  // The scan runs over the whole fragment, but a reference only becomes
  // a TOKEN where the rule table reaches its offset - so a construct an
  // earlier rule claims outright keeps its own bytes whole. Ruby
  // reaches the same answer a different way for the passthrough (it is
  // extracted before any substitution) and the opposite one for the URL
  // (replacements run BEFORE macros, so the dashes inside a bare link
  // really are replaced). Both cost no byte, which is what these rows
  // hold.
  test("a passthrough keeps its own dashes", async () => {
    const source = "x +a -- b+ c -- d y";
    expect(await renderedHtml(source)).toContain(
      "x a -- b c\u2009\u2014\u2009d y",
    );
    expect(shapes(source)).toEqual([
      '"x "',
      "passthrough",
      '" c "',
      'ref("--")',
      '" d y"',
    ]);
    const out = await formatAdoc(source);
    expect(out).toBe(`${source}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(source));
  });

  test("a bare URL keeps its own dashes, and the oracle replaces them", async () => {
    const source = "https://a.com/x--y and -- z";
    expect(await renderedHtml(source)).toContain(
      "https://a.com/x\u2014\u200By",
    );
    expect(shapes(source)).toEqual(["link", '" and "', 'ref("--")', '" z"']);
    const out = await formatAdoc(source);
    expect(out).toBe(`${source}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(source));
  });

  // The one row here whose expectation keeps the reference spelling:
  // the replacement lands inside a `<code>` element, and the
  // comparison lens hands a verbatim region back exactly as the
  // oracle wrote it.
  test("a reference inside a monospace span is a child of it", async () => {
    const source = "x `a--b` c";
    expect(await renderedHtml(source)).toContain(
      "<code>a&#8212;&#8203;b</code>",
    );
    expect(shapes(source)).toEqual([
      '"x "',
      'monospacec["a",ref("--"),"b"]',
      '" c"',
    ]);
    const out = await formatAdoc(source);
    expect(out).toBe(`${source}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(source));
  });

  // The neighbour question the printer asks before shortening an
  // unconstrained span reads a reference's own bytes (edgeHead and
  // edgeTail, src/print/span-edges.ts), exactly as it read them when
  // they were part of a text run - so a `(C)` on either side of a
  // `**b**` still permits the shorter spelling. Both sides are asked,
  // because the two edges are two functions and a reference that went
  // opaque to one of them would keep the wide spelling on that side
  // alone.
  test.each([
    ["behind the span", "aaaa **bb**(C) dddd", "aaaa *bb*(C) dddd"],
    ["in front of the span", "aaaa (C)**bb** dddd", "aaaa (C)*bb* dddd"],
  ])(
    "a reference %s leaves its respelling alone",
    async (_side, source, expected) => {
      const out = await formatAdoc(source);
      expect(out).toBe(`${expected}\n`);
      expect(await renderedHtml(out)).toBe(await renderedHtml(source));
      expect(await formatAdoc(out)).toBe(out);
    },
  );
});
