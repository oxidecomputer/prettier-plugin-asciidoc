/**
 * WHERE A SUPERSCRIPT OR SUBSCRIPT DELIMITER STANDS, measured against
 * the oracle (issue #14).
 *
 * The last two rows of `QUOTE_SUBS` are
 * `\\?(?:\[([^\]]+)\])?\^(\S+?)\^` and its tilde twin
 * (asciidoctor.rb l.465-468), run one row at a time by `sub_quotes`
 * (substitutors.rb l.189-196), and `src/parse/inline/super-sub.ts`
 * replays each of them once per fragment. Three facts about those rows
 * decide every row below, and none of them is visible from a
 * delimiter's own neighbourhood:
 *
 * - the content group is `(\S+?)`, so a pair can hold no whitespace at
 *   all and a caret with a space before its partner is plain text;
 * - `gsub` consumes the whole match, so `x ^a^b^ y` pairs the FIRST
 *   two carets and leaves the third standing;
 * - the optional prefix takes characters in FRONT of the opening
 *   delimiter, so a bracketed run holding a caret swallows it and the
 *   opener is the caret behind the `]`.
 *
 * Every row carries the oracle's own HTML, asserted here rather than
 * quoted in a comment, so the expectation cannot drift away from what
 * `@asciidoctor/core` actually does. Nearly every row asks whether
 * the oracle PAIRED, which is content, so the tables read the
 * comparison lens; the one row whose claim is a line break the oracle
 * keeps reads the oracle's bytes and is pinned outside its table.
 * Which span survives where two of them overlap is a different
 * question, asked at the bottom of this file and in
 * tests/parser/inline-resolution-order.test.ts.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, oracleHtml, renderedHtml } from "../helpers.js";
import { shapes } from "./inline-shape.js";
import { scanSuperSubMarks } from "../../src/parse/inline/super-sub.js";

/**
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
 * Where the scan says a superscript or subscript delimiter stands.
 * @param source - the fragment, exactly as a row spells it
 * @returns the offsets, ascending
 */
function superSubOffsets(source: string): number[] {
  return [...scanSuperSubMarks(source)].toSorted(ascending);
}

/** One measured row: a source and everything it must produce. */
interface Row {
  /** What the row is about, as the test name. */
  readonly name: string;
  /** The document, without its trailing newline. */
  readonly source: string;
  /**
   * A fragment the oracle renders, read through the comparison lens:
   * every row here asks whether the oracle PAIRED, which is content,
   * so a numeric character reference is written as the character it
   * names. A claim the lens would erase reads the bytes instead and
   * is pinned outside this table.
   */
  readonly renders: string;
  /** The delimiter offsets the scan must name. */
  readonly delimiters: number[];
  /** The inline shape the parser must build (inline-shape.ts). */
  readonly shape: string[];
}

/**
 * The four assertions every row makes: the oracle's render, the scan's
 * offsets, the parsed shape, and a byte fixed point that is
 * render-equal and idempotent. Every row of every table here IS a
 * fixed point: the superscript and subscript delimiters have one
 * spelling apiece, so the printer has nothing to choose. The one line
 * reflow moves is pinned on its own, outside the tables.
 * @param row - the row to assert
 */
function checkRow(row: Row): void {
  test("the oracle's render", async () => {
    expect(await renderedHtml(row.source)).toContain(row.renders);
  });

  test("the scan names these delimiters", () => {
    expect(superSubOffsets(row.source)).toEqual(row.delimiters);
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
}

describe("the superscript and subscript rows", () => {
  // The two rows are twins - one pattern with the delimiter character
  // swapped - so the shapes are measured in pairs, and the rows that
  // matter (whitespace refusal, consumption, the prefix) are asked of
  // both.
  const ROWS: readonly Row[] = [
    {
      name: "a superscript pair",
      source: "x ^a^ y",
      renders: "x <sup>a</sup> y",
      delimiters: [2, 4],
      shape: ['"x "', 'superscript["a"]', '" y"'],
    },
    {
      name: "a subscript pair",
      source: "x ~a~ y",
      renders: "x <sub>a</sub> y",
      delimiters: [2, 4],
      shape: ['"x "', 'subscript["a"]', '" y"'],
    },
    {
      name: "the pair is unconstrained: it pairs mid-word too",
      source: "x^a^y",
      renders: "x<sup>a</sup>y",
      delimiters: [1, 3],
      shape: ['"x"', 'superscript["a"]', '"y"'],
    },
    {
      name: "content holding a space is no pair at all",
      source: "x ^a b^ y",
      renders: "x ^a b^ y",
      delimiters: [],
      shape: ['"x ^a b^ y"'],
    },
    {
      name: "the gsub consumes its match: a third caret stays text",
      source: "x ^a^b^ y",
      renders: "x <sup>a</sup>b^ y",
      delimiters: [2, 4],
      shape: ['"x "', 'superscript["a"]', '"b^ y"'],
    },
    {
      name: "two pairs, back to back",
      source: "x ^a^^b^ y",
      renders: "x <sup>a</sup><sup>b</sup> y",
      delimiters: [2, 4, 5, 7],
      shape: ['"x "', 'superscript["a"]', 'superscript["b"]', '" y"'],
    },
    {
      name: "the content group demands a character, so `^^a^` holds `^a`",
      source: "x ^^a^ y",
      renders: "x <sup>^a</sup> y",
      delimiters: [2, 5],
      shape: ['"x "', 'superscript["^a"]', '" y"'],
    },
    {
      name: "three carets are a pair around one",
      source: "x ^^^ y",
      renders: "x <sup>^</sup> y",
      delimiters: [2, 4],
      shape: ['"x "', 'superscript["^"]', '" y"'],
    },
    {
      name: "an empty pair is no pair",
      source: "x ^^ y",
      renders: "x ^^ y",
      delimiters: [],
      shape: ['"x ^^ y"'],
    },
    {
      name: "a subscript pair consumes its match the same way",
      source: "x ~a~b~ y",
      renders: "x <sub>a</sub>b~ y",
      delimiters: [2, 4],
      shape: ['"x "', 'subscript["a"]', '"b~ y"'],
    },
  ];

  describe.each(ROWS)("$name", (row) => {
    checkRow(row);
  });

  // Content may not cross a line either, and this row is pinned apart
  // from the table because the LINE BREAK is its claim: the oracle
  // keeps the source's own, where a pair would have replaced it with a
  // `<sup>`. The comparison lens folds a break to a space, which would
  // leave this row saying no more than the space row above it, so the
  // claim reads the oracle's own bytes. The formatted line is the one
  // in this file reflow moves: no pair holds the break, so the lines
  // join as they would for any other prose.
  test("content may not cross a line either", async () => {
    const source = "x ^a\nb^ y";
    expect(await oracleHtml(source)).toContain("x ^a\nb^ y");
    expect(superSubOffsets(source)).toEqual([]);
    expect(shapes(source)).toEqual([String.raw`"x ^a\nb^ y"`]);
    const out = await formatAdoc(source);
    expect(out).toBe("x ^a b^ y\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(source));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the optional prefix in front of the delimiter", () => {
  // `\\?(?:\[([^\]]+)\])?` sits in front of the opening delimiter, and
  // `gsub` anchors at the leftmost match START - so a bracketed run
  // holding a caret swallows it and the opener is the one behind the
  // `]`. The escape half is the other way round: for an UNCONSTRAINED
  // scope `convert_quoted_text` returns the match with the backslash
  // stripped and nothing else (substitutors.rb l.1419-1425), attrlist
  // or no attrlist, so the delimiters are consumed and no span is
  // built.
  const ROWS: readonly Row[] = [
    {
      name: "an attrlist moves the opening delimiter",
      source: "x [a^b]^c^ y",
      renders: '<sup class="a^b">c</sup>',
      delimiters: [7, 9],
      shape: ['"x [a^b]"', 'superscript["c"]', '" y"'],
    },
    {
      name: "a role in front is our text and the oracle's class",
      source: "x [red]^a^ y",
      renders: '<sup class="red">a</sup>',
      delimiters: [7, 9],
      shape: ['"x [red]"', 'superscript["a"]', '" y"'],
    },
    {
      name: "an EMPTY attrlist is no attrlist",
      source: "x []^a^ y",
      renders: "x []<sup>a</sup> y",
      delimiters: [4, 6],
      shape: ['"x []"', 'superscript["a"]', '" y"'],
    },
    {
      // The `[]` is empty, so the prefix takes no attrlist and the
      // BACKSLASH in front of it is left standing on ordinary text
      // rather than escaping a match. Read the other way - `[]` taken
      // as an attrlist - the prefix would reach the caret FROM the
      // backslash, the escape arm would fire, and the pair would be
      // gone. That is the whole of `attrlistEnd`'s `close > at + 1`,
      // and this is the row that holds it.
      name: "an empty attrlist behind a backslash still leaves the pair",
      source: String.raw`x \[]^a^ y`,
      renders: String.raw`x \[]<sup>a</sup> y`,
      delimiters: [5, 7],
      shape: [String.raw`"x \\[]"`, 'superscript["a"]', '" y"'],
    },
    {
      name: "an escaped pair is consumed and builds nothing",
      source: String.raw`x \^a^ y`,
      renders: "x ^a^ y",
      delimiters: [],
      shape: [String.raw`"x \\^a^ y"`],
    },
    {
      name: "an escaped pair with an attrlist builds nothing either",
      source: String.raw`x \[a]^b^ y`,
      renders: "x [a]^b^ y",
      delimiters: [],
      shape: [String.raw`"x \\[a]^b^ y"`],
    },
    {
      name: "an escaped subscript pair, the same answer",
      source: String.raw`x \~a~ y`,
      renders: "x ~a~ y",
      delimiters: [],
      shape: [String.raw`"x \\~a~ y"`],
    },
  ];

  describe.each(ROWS)("$name", (row) => {
    checkRow(row);
  });
});

describe("the two rows against the rest of the vocabulary", () => {
  // These rows run LAST, so every other quote row has already matched
  // by the time they do. Two consequences: a span nested inside a pair
  // is resolved first and the pair reads what it wrote (no whitespace
  // is added or removed by that rewrite, which is why the scan can read
  // the source), and a pair that CROSSES an earlier row's span is
  // dropped by span-pairing.ts - the oracle emits overlapping elements
  // there and no tree holds them.
  const ROWS: readonly Row[] = [
    {
      name: "a constrained span inside a superscript",
      source: "x ^*a*^ y",
      renders: "x <sup><strong>a</strong></sup> y",
      delimiters: [2, 6],
      shape: ['"x "', 'superscript[boldc["a"]]', '" y"'],
    },
    {
      name: "a highlight inside a superscript",
      source: "x ^#a#^ y",
      renders: "x <sup><mark>a</mark></sup> y",
      delimiters: [2, 6],
      shape: ['"x "', 'superscript[highlightc["a"]]', '" y"'],
    },
    {
      name: "a superscript inside a bold span",
      source: "x *^a^* y",
      renders: "x <strong><sup>a</sup></strong> y",
      delimiters: [3, 5],
      shape: ['"x "', 'boldc[superscript["a"]]', '" y"'],
    },
    {
      name: "a nested span holding a space refuses the pair",
      source: "x ^*a b*^ y",
      renders: "x ^<strong>a b</strong>^ y",
      delimiters: [],
      shape: ['"x ^"', 'boldc["a b"]', '"^ y"'],
    },
    {
      name: "a subscript inside a superscript",
      source: "x ^a~b~c^ y",
      renders: "x <sup>a<sub>b</sub>c</sup> y",
      delimiters: [2, 4, 6, 8],
      shape: ['"x "', 'superscript["a",subscript["b"],"c"]', '" y"'],
    },
    {
      name: "a character reference inside a superscript",
      source: "x ^(C)^ y",
      renders: "x <sup>\u00A9</sup> y",
      delimiters: [2, 6],
      shape: ['"x "', 'superscript[ref("(C)")]', '" y"'],
    },
  ];

  describe.each(ROWS)("$name", (row) => {
    checkRow(row);
  });

  // The crossing case, kept apart because its assertion is about what
  // the tree CANNOT hold. Ruby's superscript row matches `^a~b^` and
  // its subscript row then matches `~b^c~` across it, so the oracle
  // emits `<sup>a<sub>b</sup>c</sub>` - two elements that overlap
  // without either containing the other. The scan names all four
  // delimiters; span-pairing.ts drops the later row's candidate, so the
  // superscript stands and the tildes stay literal text. The bytes are
  // untouched either way, which is what the fixed point holds.
  test("a crossing pair is dropped, its delimiters left as text", async () => {
    const source = "x ^a~b^c~ y";
    expect(await renderedHtml(source)).toContain(
      "x <sup>a<sub>b</sup>c</sub> y",
    );
    expect(superSubOffsets(source)).toEqual([2, 4, 6, 8]);
    expect(shapes(source)).toEqual(['"x "', 'superscript["a~b"]', '"c~ y"']);
    const out = await formatAdoc(source);
    expect(out).toBe(`${source}\n`);
    expect(await formatAdoc(out)).toBe(out);
  });

  // The DIVERGENCE the rule table declares: `sub_quotes` runs before
  // `sub_macros`, so a pair inside a bare URL truncates the link. Our
  // table gives the URL the position instead, which costs no byte -
  // the link node replays the author's characters and a URL is one atom
  // the packer never breaks.
  test("a subscript inside a bare URL is the URL's, not the row's", async () => {
    const source = "https://a.com/~u~/p and x";
    expect(await renderedHtml(source)).toContain("<sub>u</sub>");
    expect(shapes(source)).toEqual(["link", '" and x"']);
    const out = await formatAdoc(source);
    expect(out).toBe(`${source}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(source));
    expect(await formatAdoc(out)).toBe(out);
  });
});

/**
 * One row of the attrlist divergence family: a source, what the oracle
 * renders, the shape this parser builds, and the bytes the formatter
 * writes when they are not the source's own.
 */
interface DivergenceRow {
  /** The document, without its trailing newline. */
  readonly source: string;
  /**
   * A fragment the oracle renders, read through the comparison lens:
   * every row here claims whether the oracle PAIRED, which is content.
   */
  readonly renders: string;
  /** The inline shape the parser builds (inline-shape.ts). */
  readonly shape: string[];
  /**
   * The formatted bytes, when the printer respells something INSIDE the
   * pair. Four of the rows below hold an unconstrained span that
   * shortens; the pair's own carets never move.
   */
  readonly formatted?: string;
}

/**
 * Whether an inline shape holds one of the two pair kinds - the fact
 * every row below compares against the oracle's own `<sup>`/`<sub>`.
 * @param shape - one document's inline shape (inline-shape.ts)
 * @returns true when a superscript or subscript node is in it
 */
function hasPair(shape: readonly string[]): boolean {
  return shape.some((node) => /superscript|subscript/v.test(node));
}

/**
 * One divergence row's verdict: the oracle's render, this parser's
 * shape, whether the two disagree about the pair, and the byte /
 * render / idempotence facts that make the disagreement cost nothing.
 * @param row - the row to assert
 * @param oraclePairs - whether the ORACLE emits a `<sup>`/`<sub>` here
 */
function checkDivergence(row: DivergenceRow, oraclePairs: boolean): void {
  test("the oracle's render, and whether it pairs", async () => {
    const html = await renderedHtml(row.source);
    expect(html).toContain(row.renders);
    expect(/<su[pb]>/v.test(html)).toBe(oraclePairs);
  });

  test("this parser's shape, and whether IT pairs", () => {
    expect(shapes(row.source)).toEqual(row.shape);
    expect(hasPair(row.shape)).toBe(!oraclePairs);
  });

  test("the bytes hold, the render is equal, the format is stable", async () => {
    const out = await formatAdoc(row.source);
    expect(out).toBe(`${row.formatted ?? row.source}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(row.source));
    expect(await formatAdoc(out)).toBe(out);
  });
}

describe("the attrlist divergence family (issue #14, known and byte-neutral)", () => {
  // The scan reads the SOURCE, and the two rows run over what the ten
  // earlier rows WROTE. Those two texts differ in exactly one place:
  // the attrlist group `(?:\[([^\]]+)\])?` that every row carries.
  // Where a row takes one and it yields an HTML attribute, the source's
  // `[red]` becomes ` class="red"` and the rewrite has a space the
  // source never had - so the oracle's `(\S+?)` refuses a pair this
  // scan finds. super-sub.ts's header states the divergence and the
  // four things modelling it would need; these rows are its witnesses,
  // one for each of the ten earlier rows and both markers, each
  // proving the cost is
  // nothing but a node: the bytes are the author's, the render is
  // equal, and a second format is stable.
  const ORACLE_REFUSES: readonly DivergenceRow[] = [
    {
      source: "x ^[red]#c#^ y",
      renders: 'x ^<span class="red">c</span>^ y',
      shape: ['"x "', 'superscript[highlightc(red)["c"]]', '" y"'],
    },
    {
      source: "x ~[red]#c#~ y",
      renders: 'x ~<span class="red">c</span>~ y',
      shape: ['"x "', 'subscript[highlightc(red)["c"]]', '" y"'],
    },
    {
      source: "x ^[red]*c*^ y",
      renders: 'x ^<strong class="red">c</strong>^ y',
      shape: ['"x "', 'superscript[boldc(red)["c"]]', '" y"'],
    },
    {
      source: "x ^[red]_c_^ y",
      renders: 'x ^<em class="red">c</em>^ y',
      shape: ['"x "', 'superscript[italicc(red)["c"]]', '" y"'],
    },
    {
      source: "x ^[red]`c`^ y",
      renders: 'x ^<code class="red">c</code>^ y',
      shape: ['"x "', 'superscript[monospacec(red)["c"]]', '" y"'],
    },
    {
      source: "x ^[red]**c**^ y",
      renders: 'x ^<strong class="red">c</strong>^ y',
      shape: ['"x "', 'superscript[boldu(red)["c"]]', '" y"'],
      formatted: "x ^[red]*c*^ y",
    },
    {
      source: "x ^[red]__c__^ y",
      renders: 'x ^<em class="red">c</em>^ y',
      shape: ['"x "', 'superscript[italicu(red)["c"]]', '" y"'],
      formatted: "x ^[red]_c_^ y",
    },
    {
      source: "x ^[red]``c``^ y",
      renders: 'x ^<code class="red">c</code>^ y',
      shape: ['"x "', 'superscript[monospaceu(red)["c"]]', '" y"'],
      formatted: "x ^[red]`c`^ y",
    },
    {
      source: "x ^[red]##c##^ y",
      renders: 'x ^<span class="red">c</span>^ y',
      shape: ['"x "', 'superscript[highlightu(red)["c"]]', '" y"'],
      formatted: "x ^[red]#c#^ y",
    },
    {
      source: 'x ^[red]"`c`"^ y',
      renders: 'x ^<span class="red">\u201Cc\u201D</span>^ y',
      shape: ['"x "', 'superscript["[red]",curvedd["c"]]', '" y"'],
    },
    {
      source: "x ^[red]'`c`'^ y",
      renders: 'x ^<span class="red">\u2018c\u2019</span>^ y',
      shape: ['"x "', 'superscript["[red]",curveds["c"]]', '" y"'],
    },
    {
      source: "x ^[.a.b]#c#^ y",
      renders: 'x ^<span class="a b">c</span>^ y',
      shape: ['"x "', 'superscript[highlightc(.a.b)["c"]]', '" y"'],
    },
    {
      source: "x ^[#i]*c*^ y",
      renders: 'x ^<strong id="i">c</strong>^ y',
      shape: ['"x "', 'superscript[boldc(#i)["c"]]', '" y"'],
    },
  ];

  describe.each(ORACLE_REFUSES)("$source", (row) => {
    checkDivergence(row, false);
  });
});

describe("the same divergence the other way round", () => {
  // A taken attrlist that yields NO attribute has its own bytes
  // deleted, whitespace included, so the REWRITE loses a space the
  // source has and the oracle pairs where this scan refuses. These
  // three rows are why "refuse wherever an attrlist stands" would be a
  // different bug rather than a fix: each of them is a taken attrlist,
  // and each still pairs. `parse_quoted_text_attributes`
  // (substitutors.rb l.1475-1502) truncates at the first comma and
  // strips to empty; `convert_quoted_text`'s escaped-constrained fork
  // (substitutors.rb l.1420-1425) prints the brackets and writes no
  // class at all.
  const ORACLE_PAIRS: readonly DivergenceRow[] = [
    {
      source: "x ^[ ]*c*^ y",
      renders: "x <sup><strong>c</strong></sup> y",
      shape: ['"x ^"', 'boldc( )["c"]', '"^ y"'],
    },
  ];

  describe.each(ORACLE_PAIRS)("$source", (row) => {
    checkDivergence(row, true);
  });

  // The other two are NOT disagreements - this scan pairs them too -
  // so they are pinned as agreements, which is what makes the row
  // above a real finding rather than a coincidence of the alphabet.
  const AGREE: readonly DivergenceRow[] = [
    {
      source: "x ^[,]*c*^ y",
      renders: "x <sup><strong>c</strong></sup> y",
      shape: ['"x "', 'superscript[boldc(,)["c"]]', '" y"'],
    },
    {
      source: String.raw`x ^\[red]*c*^ y`,
      renders: "x <sup>[red]<strong>c</strong></sup> y",
      shape: ['"x "', String.raw`superscript["\\",boldc(red)["c"]]`, '" y"'],
    },
  ];

  describe.each(AGREE)("$source", (row) => {
    test("the oracle pairs and so do we", async () => {
      const html = await renderedHtml(row.source);
      expect(html).toContain(row.renders);
      expect(/<su[pb]>/v.test(html)).toBe(true);
      expect(shapes(row.source)).toEqual(row.shape);
      expect(hasPair(row.shape)).toBe(true);
    });

    test("the agreeing row's bytes, render and second format", async () => {
      const out = await formatAdoc(row.source);
      expect(out).toBe(`${row.formatted ?? row.source}\n`);
      expect(await renderedHtml(out)).toBe(await renderedHtml(row.source));
      expect(await formatAdoc(out)).toBe(out);
    });
  });
});

describe("where no attrlist is taken, the scan and the oracle agree", () => {
  // The controls. Each one puts a `[...]` inside a pair and gets a
  // `<sup>` from the oracle, because no earlier row takes it: nothing
  // follows the `]` that could open one, the run is empty, the row that
  // could take it finds no closing mark, its right lookahead refuses,
  // or its LEFT clause refuses at the `[`. Without these the family
  // above would look like "any bracket refuses", which is not what the
  // oracle does.
  const ROWS: readonly DivergenceRow[] = [
    {
      source: "x ^[red]c^ y",
      renders: "x <sup>[red]c</sup> y",
      shape: ['"x "', 'superscript["[red]c"]', '" y"'],
    },
    {
      source: "x ^[]#c#^ y",
      renders: "x <sup>[]<mark>c</mark></sup> y",
      shape: ['"x "', 'superscript["[]",highlightc["c"]]', '" y"'],
    },
    {
      source: "x ^[red]*c^ y",
      renders: "x <sup>[red]*c</sup> y",
      shape: ['"x "', 'superscript["[red]*c"]', '" y"'],
    },
    {
      source: "x ^[red]#c#a^ y",
      renders: "x <sup>[red]#c#a</sup> y",
      shape: ['"x "', 'superscript["[red]#c#a"]', '" y"'],
    },
    {
      source: "x ^a[red]#c#^ y",
      renders: "x <sup>a[red]<mark>c</mark></sup> y",
      shape: ['"x "', 'superscript["a",highlightc(red)["c"]]', '" y"'],
    },
  ];

  describe.each(ROWS)("$source", (row) => {
    test("both pair", async () => {
      const html = await renderedHtml(row.source);
      expect(html).toContain(row.renders);
      expect(/<su[pb]>/v.test(html)).toBe(true);
      expect(shapes(row.source)).toEqual(row.shape);
      expect(hasPair(row.shape)).toBe(true);
    });

    test("the control's bytes, render and second format", async () => {
      const out = await formatAdoc(row.source);
      expect(out).toBe(`${row.formatted ?? row.source}\n`);
      expect(await renderedHtml(out)).toBe(await renderedHtml(row.source));
      expect(await formatAdoc(out)).toBe(out);
    });
  });

  // The gsub keeps walking when a candidate fails, which is what makes
  // a LATER pair on the same line reachable: the oracle refuses the
  // first caret (the rewritten `<span class="red">` has a space) and
  // then pairs the two carets behind it. This scan takes the first pair
  // instead. One shape, one node, no byte.
  test("a refused candidate leaves a later pair for the oracle", async () => {
    const source = "x ^[red]#c#^a^ y";
    expect(await renderedHtml(source)).toContain(
      'x ^<span class="red">c</span><sup>a</sup> y',
    );
    expect(shapes(source)).toEqual([
      '"x "',
      'superscript[highlightc(red)["c"]]',
      '"a^ y"',
    ]);
    const out = await formatAdoc(source);
    expect(out).toBe(`${source}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(source));
    expect(await formatAdoc(out)).toBe(out);
  });
});
