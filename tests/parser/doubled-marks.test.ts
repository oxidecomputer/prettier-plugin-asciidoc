/**
 * WHERE AN UNCONSTRAINED DELIMITER STANDS, measured against the oracle
 * (issue #72).
 *
 * Two adjacent marks are a doubled delimiter only where the
 * unconstrained row's own gsub pairs them. That row is
 * `\\?(?:\[([^\]]+)\])?XX(#{CC_ALL}+?)XX` over the whole text
 * (asciidoctor.rb l.446 and its three siblings, run one row at a time
 * by `sub_quotes`, substitutors.rb l.189-196), and
 * `src/parse/inline/doubled-marks.ts`
 * replays it once per fragment. Two facts about that row decide every
 * row below, and neither is visible from a mark's own neighbourhood:
 *
 * - where the row makes NO match, the CONSTRAINED row that comes next
 *   gets the single mark instead, so `####` is a constrained highlight
 *   around a literal `#` with a fourth `#` left over, not plain text;
 * - the row's optional prefix takes characters in FRONT of the opening
 *   delimiter, and `gsub` anchors at the leftmost match START, so a
 *   bracketed run holding the pair swallows it and the opener is the
 *   delimiter behind the `]`.
 *
 * Every row carries the oracle's own HTML, asserted here rather than
 * quoted in a comment, so the expectation cannot drift away from what
 * `@asciidoctor/core` actually does. Which of these spans survives
 * where two overlap is a different question, and
 * tests/parser/inline-resolution-order.test.ts asks it.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";
import { shapes } from "./inline-shape.js";
import { scanCurvedQuotes } from "../../src/parse/inline/curved-quotes.js";
import { scanDoubledMarks } from "../../src/parse/inline/doubled-marks.js";

/**
 * The scan's delimiter offsets for one source, ascending.
 *
 * A named comparator rather than an inline one, because the sort sits
 * inside a `test` inside a `describe.each` inside a `describe` and the
 * callback nesting is capped at three.
 * @param left - one offset
 * @param right - another
 * @returns the usual sort contract
 */
function ascending(left: number, right: number): number {
  return left - right;
}

/**
 * Where the scan says an unconstrained delimiter begins in `source`.
 * @param source - the fragment, exactly as a row spells it
 * @returns the offsets, ascending
 */
function doubledOffsets(source: string): number[] {
  return [...scanDoubledMarks(source, scanCurvedQuotes(source))].toSorted(
    ascending,
  );
}

describe("doubled marks inside a run of marks (issue #72)", () => {
  // Two adjacent marks are a doubled delimiter only where the
  // UNCONSTRAINED row's own gsub pairs them (asciidoctor.rb l.446 and
  // its three siblings, run by substitutors.rb l.189-196). Where it
  // does not, the CONSTRAINED row that comes next gets the single mark
  // instead, and that is the whole of issue #72: `####` is a
  // constrained highlight around a literal `#` with a fourth `#` left
  // over, not plain text.
  //
  // The rows cover all four marks, runs of three to five, doubled
  // opens with no doubled close in both directions, a role in front, a
  // run beside word characters (where the constrained row refuses),
  // and a mixed constrained/unconstrained opening. Every
  // `renders` was measured against the oracle before writing
  // it, per this file's own convention.
  //
  // `[r]####` carries a second job: a role token in front of a run must
  // reach the printer attached to a span that HAS content, never as a
  // childless one.
  interface RunRow {
    /** What this row demonstrates. */
    readonly name: string;
    /** The source line. */
    readonly source: string;
    /**
     * A substring of the oracle's rendered paragraph body, read
     * through the comparison lens: these rows claim which span the
     * oracle RESOLVED, so a numeric character reference would be
     * written here as the character it names.
     */
    readonly renders: string;
    /** The expected top-level shape. */
    readonly shape: readonly string[];
  }

  const RUN_ROWS: readonly RunRow[] = [
    {
      name: "four marks: the constrained row pairs inside the run and the fourth mark is left over",
      source: "####",
      renders: "<mark>#</mark>#",
      shape: ['highlightc["#"]', '"#"'],
    },
    {
      name: "four marks with a role in front",
      source: "[r]####",
      renders: '<span class="r">#</span>#',
      shape: ['highlightc(r)["#"]', '"#"'],
    },
    {
      name: "five marks: the unconstrained row pairs the outer two pairs around the middle mark",
      source: "#####",
      renders: "<mark>#</mark>",
      shape: ['highlightu["#"]'],
    },
    {
      name: "five marks with a role in front",
      source: "[r]#####",
      renders: '<span class="r">#</span>',
      shape: ['highlightu(r)["#"]'],
    },
    {
      name: "three bold marks mid-line",
      source: "a *** b",
      renders: "a <strong>*</strong> b",
      shape: ['"a "', 'boldc["*"]', '" b"'],
    },
    {
      name: "five bold marks mid-line",
      source: "a ***** b",
      renders: "a <strong>*</strong> b",
      shape: ['"a "', 'boldu["*"]', '" b"'],
    },
    {
      // Emphasis excludes `_` on the right (`(?!\p{Word})`, and `_` is
      // a word character), so the constrained close is the LAST mark of
      // the run rather than the second.
      name: "four italic marks mid-line, whose close cannot stand in front of another underscore",
      source: "a ____ b",
      renders: "a <em>__</em> b",
      shape: ['"a "', 'italicc["__"]', '" b"'],
    },
    {
      // Monospace excludes a backtick on the right for the same reason
      // (asciidoctor.rb l.456's `(?![\p{Word}"'`])`).
      name: "four monospace marks mid-line",
      source: "a ```` b",
      renders: "a <code>``</code> b",
      shape: ['"a "', 'monospacec["``"]', '" b"'],
    },
    {
      name: "a doubled open with a single close pairs as one constrained span",
      source: "**x*",
      renders: "<strong>*x</strong>",
      shape: ['boldc["*x"]'],
    },
    {
      name: "a single open with a doubled close pairs and leaves the last mark over",
      source: "*x**",
      renders: "<strong>x</strong>*",
      shape: ['boldc["x"]', '"*"'],
    },
    {
      name: "a doubled highlight open with a single close",
      source: "##x#",
      renders: "<mark>#x</mark>",
      shape: ['highlightc["#x"]'],
    },
    {
      name: "a run flanked by word characters pairs nothing: the constrained row refuses both ends",
      source: "w####w",
      renders: "w####w",
      shape: ['"w####w"'],
    },
    {
      name: "a mixed opening: the constrained bold takes the whole run and the emphasis nests inside it",
      source: "**_x_*",
      renders: "<strong>*<em>x</em></strong>",
      shape: ['boldc["*",italicc["x"]]'],
    },
    {
      name: "a doubled open with no close of either width stays literal text",
      source: "a **b c",
      renders: "a **b c",
      shape: ['"a **b c"'],
    },
  ];

  describe.each(RUN_ROWS)("$name", (row) => {
    test("the oracle's render", async () => {
      expect(await renderedHtml(row.source)).toContain(row.renders);
    });

    test("the parser builds this shape", () => {
      expect(shapes(row.source)).toEqual(row.shape);
    });

    test("the bytes are pinned, render-equal and idempotent", async () => {
      const out = await formatAdoc(row.source);
      expect(out).toBe(`${row.source}\n`);
      expect(await renderedHtml(out)).toBe(await renderedHtml(row.source));
      expect(await formatAdoc(out)).toBe(out);
    });
  });
});

describe("an attrlist in front of a doubled mark (issue #72)", () => {
  // Every unconstrained row carries an optional
  // `\\?(?:\[([^\]]+)\])?` prefix in front of its opening delimiter
  // (asciidoctor.rb l.446 and its three siblings), and `gsub` anchors
  // at the leftmost match START rather than at the leftmost delimiter.
  // The attrlist's own `[^\]]+` excludes only `]`, so a bracketed run
  // that HOLDS the pair swallows it and the opener is the delimiter
  // behind the `]`. A walk over delimiters answers `[a**b]**c**` with
  // the pair inside the brackets; the oracle answers with the pair
  // after them.
  //
  // The rows cover the attrlist present and absent, holding a pair and
  // not, at the fragment start and away from it, the escaped spelling,
  // the `[]` that is no attrlist at all, a failed attrlist start that
  // must NOT end the row, a resume behind a closer, and all four
  // marks. Every `renders` was measured against the oracle
  // before writing it, per this file's own convention.
  interface AttrlistRow {
    /** What this row demonstrates. */
    readonly name: string;
    /** The source line. */
    readonly source: string;
    /**
     * A substring of the oracle's rendered paragraph body, read
     * through the comparison lens: these rows claim which span the
     * oracle RESOLVED, so a numeric character reference would be
     * written here as the character it names.
     */
    readonly renders: string;
    /**
     * Where the scan says an unconstrained delimiter BEGINS, ascending.
     * These are the offsets Ruby's own match consumes, which is what
     * the prefix replay is for.
     */
    readonly doubled: readonly number[];
    /** The expected top-level shape. */
    readonly shape: readonly string[];
    /**
     * The formatted bytes, always spelled out rather than defaulted to
     * the source: several of these shapes hold an unconstrained span
     * the printer writes in its shorter constrained spelling, which is
     * the formatter's canonical form and no part of what this table
     * pins.
     */
    readonly formatted: string;
  }

  const ATTRLIST_ROWS: readonly AttrlistRow[] = [
    {
      name: "an attrlist holding the pair swallows it, and the opener is the delimiter behind the bracket",
      source: "[a**b]**c**",
      renders: '<strong class="a**b">c</strong>',
      doubled: [6, 9],
      shape: ['boldu(a**b)["c"]'],
      formatted: "[a**b]**c**",
    },
    {
      name: "the same, with the attrlist away from the fragment start",
      source: "x[a**b]**c**",
      renders: 'x<strong class="a**b">c</strong>',
      doubled: [7, 10],
      shape: ['"x"', 'boldu(a**b)["c"]'],
      formatted: "x[a**b]**c**",
    },
    {
      name: "the same, mid-line between two words",
      source: "a [b**c]**d** e",
      renders: 'a <strong class="b**c">d</strong> e',
      doubled: [8, 11],
      shape: ['"a "', 'boldu(b**c)["d"]', '" e"'],
      formatted: "a [b**c]**d** e",
    },
    {
      name: "an attrlist with no pair inside moves nothing",
      source: "[ab]**c**",
      renders: '<strong class="ab">c</strong>',
      doubled: [4, 7],
      shape: ['boldu(ab)["c"]'],
      formatted: "[ab]*c*",
    },
    {
      name: "no attrlist at all: the delimiter stands at the match start",
      source: "**c**",
      renders: "<strong>c</strong>",
      doubled: [0, 3],
      shape: ['boldu["c"]'],
      formatted: "*c*",
    },
    {
      // The escape is RECORDED and not resolved: Ruby's escaped match
      // consumes these same two delimiters, then writes the text back
      // unescaped for the constrained row to re-read, which is why the
      // oracle's own render carries a `*c` this parser does not build.
      // Re-reading a row's own output is outside the one coordinate
      // space this parser works in (docs/architecture.md).
      name: "the escaped spelling consumes the same two delimiters",
      source: String.raw`\[a**b]**c**`,
      renders: '<strong class="a**b">*c</strong>*',
      doubled: [7, 10],
      shape: [String.raw`"\\"`, 'boldu(a**b)["c"]'],
      formatted: String.raw`\[a**b]**c**`,
    },
    {
      name: "`[]` is no attrlist: the group's own run demands a character",
      source: "[]**c**",
      renders: "[]<strong>c</strong>",
      doubled: [2, 5],
      shape: ['"[]"', 'boldu["c"]'],
      formatted: "[]*c*",
    },
    {
      // The witness that a failed start may not end the row: the SCAN
      // still answers [2, 6], the pair the oracle takes, at a start
      // the row had not reached when the start at 0 failed.
      //
      // The parse then diverges, byte-neutrally, and this row is where
      // that is recorded. The `RoleAttribute` rule (rules.ts) fires on
      // a LOOKAHEAD - a bracketed run with a mark behind it - and a
      // lookahead cannot know whether anything closes that mark, so
      // here the token takes `[a**b]` and the delimiter at 2 is inside
      // it, never emitted. Ruby's row backtracks instead: its attrlist
      // group is optional, so the match that fails at 0 is retried
      // from 2 and pairs there. Nothing reaches the printer either
      // way - no span is built, the bytes are one text run - so the
      // output is the source and the render of the output is the
      // render of the source, which the rows below assert.
      name: "a start whose attrlist leaves the delimiter unclosed does not end the row",
      source: "[a**b]**",
      renders: "[a<strong>b]</strong>",
      doubled: [2, 6],
      shape: ['"[a**b]**"'],
      formatted: "[a**b]**",
    },
    {
      name: "the walk resumes behind a closer and then reads an attrlist",
      source: "**a**[b**c]**d**",
      renders: '<strong>a</strong><strong class="b**c">d</strong>',
      doubled: [0, 3, 11, 14],
      shape: ['boldu["a"]', 'boldu(b**c)["d"]'],
      // NEITHER span shortens, and the two refusals are different
      // questions about the same run. The SECOND owns it as its role,
      // and a run holding the mark is one the constrained row would
      // match instead of writing into the class
      // (span-edges.ts's attrlistAllowsIt). The FIRST has no run in
      // front of it at all, and is refused by the block-wide scan
      // (`carriesMark`, src/print/inline.ts) precisely because the
      // role BEHIND it puts `**` on the line: shortened, those bytes
      // pair with the single marks left standing and the render moves.
      formatted: "**a**[b**c]**d**",
    },
    {
      name: "the highlight row",
      source: "[a##b]##c##",
      renders: '<span class="a##b">c</span>',
      doubled: [6, 9],
      shape: ['highlightu(a##b)["c"]'],
      // Not shortened: the role carries the mark, and the printer
      // refuses the constrained spelling wherever the run in front of
      // a span holds it (span-edges.ts's attrlistAllowsIt).
      formatted: "[a##b]##c##",
    },
    {
      name: "the emphasis row",
      source: "[a__b]__c__",
      renders: '<em class="a__b">c</em>',
      doubled: [6, 9],
      shape: ['italicu(a__b)["c"]'],
      formatted: "[a__b]__c__",
    },
    {
      name: "the monospaced row",
      source: "[a``b]``c``",
      renders: '<code class="a``b">c</code>',
      doubled: [6, 9],
      shape: ['monospaceu(a``b)["c"]'],
      formatted: "[a``b]``c``",
    },
  ];

  describe.each(ATTRLIST_ROWS)("$name", (row) => {
    test("the oracle's render", async () => {
      expect(await renderedHtml(row.source)).toContain(row.renders);
    });

    test("the scan names these delimiters", () => {
      expect(doubledOffsets(row.source)).toEqual(row.doubled);
    });

    test("the parser builds this shape", () => {
      expect(shapes(row.source)).toEqual(row.shape);
    });

    test("the bytes are pinned, render-equal and idempotent", async () => {
      const out = await formatAdoc(row.source);
      expect(out).toBe(`${row.formatted}\n`);
      expect(await renderedHtml(out)).toBe(await renderedHtml(row.source));
      expect(await formatAdoc(out)).toBe(out);
    });
  });
});
