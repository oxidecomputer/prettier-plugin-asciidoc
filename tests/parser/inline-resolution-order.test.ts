/**
 * The ORDER formatting marks are resolved in, measured against the
 * oracle (issue #66).
 *
 * Asciidoctor does not walk a line once. `sub_quotes`
 * (substitutors.rb l.189-196) runs every row of the `QUOTE_SUBS`
 * table (asciidoctor.rb l.448-470) as its own gsub over the WHOLE
 * text, one row after the next, so the row order decides which span
 * wins where two of them overlap: strong, then monospaced, then
 * emphasis, then mark, and within each the unconstrained spelling
 * before the constrained one.
 *
 * Every row below carries the oracle's own HTML, asserted here rather
 * than quoted in a comment, so the expectation cannot drift away from
 * what `@asciidoctor/core` actually does.
 *
 * WHERE A TREE RUNS OUT. The later rows match ACROSS the tags an
 * earlier row already wrote, so the oracle emits genuinely
 * OVERLAPPING elements: `_a *b_ c*` renders
 * `<em>a <strong>b</em> c</strong>`, whose `</em>` sits inside the
 * strong. No tree holds that. What a tree CAN hold exactly is the
 * span the earlier row resolved - here the strong, source extent
 * `*b_ c*`, content `b_ c` - so that is the one this parser builds,
 * and the loser's marks stay literal text. The rows assert the
 * winner's content against the oracle's own element to keep the two
 * readings tied together.
 */
import { describe, expect, test } from "vitest";
import { asParagraph, formatAdoc, renderedHtml } from "../helpers.js";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";

/**
 * A one-line spelling of an inline tree: `bold[…]` for a span,
 * `"…"` for a text run, `u`/`c` for unconstrained/constrained. Tests
 * compare whole shapes rather than probing node by node, because what
 * changed in issue #66 is which span exists at all, not one field of
 * one node.
 * @param node - an inline node
 * @returns its shape, with children nested inside the brackets
 */
function shapeOf(node: InlineNode): string {
  if (node.type === "text") return JSON.stringify(node.value);
  if (!("children" in node)) return node.type;
  const spelling = "constrained" in node && node.constrained ? "c" : "u";
  return `${node.type}${spelling}[${node.children.map(shapeOf).join(",")}]`;
}

/**
 * The shape of a one-paragraph document's inline content.
 * @param input - the document source
 * @returns one shape string per top-level inline node
 */
function shapes(input: string): string[] {
  const document = parse(input);
  const [block] = document.children;
  return asParagraph(block).children.map(shapeOf);
}

/**
 * One overlap: two marks whose spans cross in the source.
 *
 * `oracleSpan` is the HTML element the EARLIER `QUOTE_SUBS` row
 * produced, spelled whole so the assertion pins the winner's content
 * and not just its tag name.
 */
interface Overlap {
  /** The source line. */
  readonly source: string;
  /** The complete element the winning row wrote. */
  readonly oracleSpan: string;
  /** The expected inline shape, node by node. */
  readonly shape: readonly string[];
  /**
   * The formatted bytes, when they are not the source's own. Only
   * one row moves: an unconstrained mark that could be written
   * constrained is, which is this formatter's canonical spelling and
   * not a resolution-order fact.
   */
  readonly formatted?: string;
}

// Crossings, in two groups: every pair of different MARKS first,
// then one row per adjacent pair of modelled QUOTE_SUBS ROWS. The
// winner is always the earlier row, never the mark that opens first
// in the source - which is the whole of issue #66. Row numbers in
// the comments are positions in the full QUOTE_SUBS table, the same
// numbering src/parse/inline/span-pairing.ts uses.
const OVERLAPS: readonly Overlap[] = [
  {
    // strong (row 2) beats emphasis (row 8) though `_` opens first.
    source: "_a *b_ c*",
    oracleSpan: "<strong>b</em> c</strong>",
    shape: ['"_a "', 'boldc["b_ c"]'],
  },
  {
    // strong (row 2) beats monospaced (row 6).
    source: "`a *b` c*",
    oracleSpan: "<strong>b</code> c</strong>",
    shape: ['"`a "', 'boldc["b` c"]'],
  },
  {
    // strong (row 2) beats mark (row 10).
    source: "#a *b# c*",
    oracleSpan: "<strong>b</mark> c</strong>",
    shape: ['"#a "', 'boldc["b# c"]'],
  },
  {
    // monospaced (row 6) beats emphasis (row 8).
    source: "_a `b_ c`",
    oracleSpan: "<code>b</em> c</code>",
    shape: ['"_a "', 'monospacec["b_ c"]'],
  },
  {
    // monospaced (row 6) beats mark (row 10).
    source: "#a `b# c`",
    oracleSpan: "<code>b</mark> c</code>",
    shape: ['"#a "', 'monospacec["b# c"]'],
  },
  {
    // emphasis (row 8) beats mark (row 10).
    source: "#a _b# c_",
    oracleSpan: "<em>b</mark> c</em>",
    shape: ['"#a "', 'italicc["b# c"]'],
  },
  {
    // The UNCONSTRAINED strong row (row 1) runs before the
    // constrained emphasis row (row 8) just the same.
    source: "_a **b_ c**",
    oracleSpan: "<strong>b</em> c</strong>",
    shape: ['"_a "', 'boldu["b_ c"]'],
    formatted: "_a *b_ c*",
  },
  {
    // ...and the constrained strong row (row 2) before the
    // unconstrained emphasis row (row 7): the mark, not the width,
    // is what orders the two.
    source: "__a *b__ c*",
    oracleSpan: "<strong>b</em> c</strong>",
    shape: ['"__a "', 'boldc["b__ c"]'],
  },
  // The rows above pin the constrained chain 2 < 6 < 8 < 10 and two
  // cross-width facts, which is enough to say that the MARK orders
  // the table and the width does not. It is not enough to pin the
  // table itself: swapping any two ADJACENT modelled rows leaves
  // every row above green. The six below close that - one per
  // adjacent pair, each naming the two rows it separates, and
  // together with `***bold***` (rows 1 and 2, further down this file)
  // they cover all seven pairs.
  {
    // Rows 2 and 5: the constrained strong before the unconstrained
    // monospaced.
    source: "x ``p *q`` r*",
    oracleSpan: "<strong>q</code> r</strong>",
    shape: ['"x ``p "', 'boldc["q`` r"]'],
  },
  {
    // Rows 5 and 6: within monospaced, unconstrained before
    // constrained.
    source: "`a ``b` c``",
    oracleSpan: "<code>b</code> c</code>",
    shape: ['"`a "', 'monospaceu["b` c"]'],
  },
  {
    // Rows 6 and 7: the constrained monospaced before the
    // unconstrained emphasis.
    source: "x __p `q__ r`",
    oracleSpan: "<code>q</em> r</code>",
    shape: ['"x __p "', 'monospacec["q__ r"]'],
  },
  {
    // Rows 7 and 8: within emphasis, unconstrained before
    // constrained.
    source: "_a __b_ c__",
    oracleSpan: "<em>b</em> c</em>",
    shape: ['"_a "', 'italicu["b_ c"]'],
  },
  {
    // Rows 8 and 9: the constrained emphasis before the unconstrained
    // mark.
    source: "x ##p _q## r_",
    oracleSpan: "<em>q</mark> r</em>",
    shape: ['"x ##p "', 'italicc["q## r"]'],
  },
  {
    // Rows 9 and 10: within mark, unconstrained before constrained.
    source: "#a ##b# c##",
    oracleSpan: "<mark>b</mark> c</mark>",
    shape: ['"#a "', 'highlightu["b# c"]'],
  },
];

describe.each(OVERLAPS)("crossed marks: $source", (overlap) => {
  const { source, oracleSpan, shape, formatted } = overlap;

  test("the oracle resolves the earlier QUOTE_SUBS row first", async () => {
    expect(await renderedHtml(source)).toContain(oracleSpan);
  });

  test("the parser builds that span and leaves the loser literal", () => {
    expect(shapes(source)).toEqual(shape);
  });

  test("the bytes are pinned, render-equal and idempotent", async () => {
    const out = await formatAdoc(source);
    expect(out).toBe(`${formatted ?? source}\n`);
    expect(await renderedHtml(out)).toBe(await renderedHtml(source));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("resolution order leaves proper nesting alone", () => {
  // The winner CONTAINS the loser here instead of crossing it, so
  // both spans survive and nest - resolving the strong first does not
  // cost the emphasis around it.
  test("_a *b* c_ nests the strong inside the emphasis", async () => {
    expect(await renderedHtml("_a *b* c_")).toContain(
      "<em>a <strong>b</strong> c</em>",
    );
    expect(shapes("_a *b* c_")).toEqual(['italicc["a ",boldc["b"]," c"]']);
  });

  // Same, with the role-carrying highlight: the mark row is last, so
  // the strong is resolved first, and the `[r]#…#` inside it is still
  // found when the mark row comes round.
  test("*a [r]#b#* keeps the role highlight inside the strong", async () => {
    expect(await renderedHtml("*a [r]#b#*")).toContain(
      '<strong>a <span class="r">b</span></strong>',
    );
    expect(shapes("*a [r]#b#*")).toEqual(['boldc["a ",highlightc["b"]]']);
  });

  // A role highlight that CROSSES an emphasis loses, because the mark
  // row is the later one: the oracle's own `<span>` closes outside the
  // `</em>`.
  test("_a [r]#b_ c# keeps the emphasis and drops the crossing mark", async () => {
    expect(await renderedHtml("_a [r]#b_ c#")).toContain(
      '<em>a <span class="r">b</em> c</span>',
    );
    expect(shapes("_a [r]#b_ c#")).toEqual(['italicc["a [r]#b"]', '" c#"']);
  });
});

describe("a dropped candidate still consumes its marks", () => {
  // Ruby's gsub replaced `_a *b_` whether or not a tree can hold the
  // result, and went on scanning BEHIND its closing mark - so the two
  // later underscores never pair, and the oracle prints them
  // literally. A row that retried the opening `_` against the later
  // `_` would find `_a *b_ c* d_`, which properly contains the strong
  // and would be kept: that emphasis is exactly what the oracle does
  // NOT have.
  test("_a *b_ c* d_ e_ leaves both later underscores literal", async () => {
    expect(await renderedHtml("_a *b_ c* d_ e_")).toContain(
      "<em>a <strong>b</em> c</strong> d_ e_",
    );
    expect(shapes("_a *b_ c* d_ e_")).toEqual([
      '"_a "',
      'boldc["b_ c"]',
      '" d_ e_"',
    ]);
  });
});

describe("marks with nothing between them", () => {
  // Every QUOTE_SUBS content group demands at least one character, so
  // the adjacent close is skipped and no span is resolved. What the
  // oracle then does is out of a tree's reach for a different reason:
  // its CONSTRAINED mark row pairs the second `#` with the third and
  // leaves the fourth over, while our tokenizer reads `####` as two
  // doubled marks and never offers it a single one. The bytes are
  // left exactly as written, which is the safe answer either way -
  // and `[r]####` used to reach the printer as a childless span and
  // crash it.
  test.each(["####", "[r]####"])(
    "%s is left alone rather than built as an empty span",
    async (source) => {
      expect(shapes(source)).toEqual([JSON.stringify(source)]);
      expect(await formatAdoc(source)).toBe(`${source}\n`);
    },
  );
});

describe("a mark repeated three times", () => {
  // `***bold***` is the same crossing in one mark: the UNCONSTRAINED
  // row runs first and takes `**` + `*bold` + `**`, leaving a single
  // `*` behind. The oracle's constrained row then matches from inside
  // that span to the leftover `*` outside it - its content is
  // `bold</strong>`, so the second `<strong>` crosses the first one's
  // closing tag and no tree holds it.
  test("***bold*** is one unconstrained strong holding a literal mark", async () => {
    expect(await renderedHtml("***bold***")).toContain(
      "<strong><strong>bold</strong></strong>",
    );
    expect(shapes("***bold***")).toEqual(['boldu["*bold"]', '"*"']);
  });

  // No crossing at all here: the unconstrained row's non-greedy
  // content stops at the first `**`, and the inner `*` has a word
  // character on both sides so it is no mark to begin with.
  test("**a*b** is one unconstrained strong holding a literal mark", async () => {
    expect(await renderedHtml("**a*b**")).toContain("<strong>a*b</strong>");
    expect(shapes("**a*b**")).toEqual(['boldu["a*b"]']);
  });
});
