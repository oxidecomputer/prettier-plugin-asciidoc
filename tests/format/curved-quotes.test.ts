/**
 * The printer's derived edge and the block-wide stray-mark scan
 * (issue #74): whether an UNCONSTRAINED span beside a curved-quote
 * pair may respell constrained, read off what the neighbour actually
 * presents to the row that resolves the asking span rather than off
 * its raw source bytes or a blanket "inside any span" refusal.
 *
 * Four groups of rows, all measured against the oracle
 * (`@asciidoctor/core`):
 *
 * (a) the CORRUPTION WITNESSES - shapes a naive respelling would get
 *     wrong, pinned as fixed points (formatted bytes equal the input,
 *     the render matches the given oracle HTML, and a second format
 *     is stable);
 * (b) the shapes an earlier, over-broad refusal used to leave
 *     unnecessarily long, now correctly shortened;
 * (c) the stray-mark witness: a span nested inside a curved quote may
 *     not shorten when doing so would expose a MARK CHARACTER
 *     standing elsewhere in the block, however far from its siblings;
 * (d) near-miss and nesting rows: shapes that look like a curved pair,
 *     or nest one inside another construct, without actually forming
 *     one - or forming one somewhere unexpected - pinned as fixed
 *     points with their renders.
 */
import { describe, expect, test } from "vitest";
import { asParagraph, formatAdoc, renderedHtml } from "../helpers.js";
import { parse } from "../../src/parser.js";
import { serializedKeys } from "../parser/reader-helpers.js";

/**
 * One row's full verdict for a FIXED POINT: formatted bytes equal the
 * source plus a trailing newline, the oracle's render contains the
 * given element, and a second format is stable.
 *
 * The element is read through the comparison lens, so a curly quote
 * is written as the character it is rather than as the numeric
 * reference the oracle spells it with: these rows claim which span
 * resolved where, never how Asciidoctor serializes a character.
 * Inside a verbatim region the lens changes nothing, so the one row
 * whose quotes land in a `<code>` element spells them as references.
 * @param source - the row's document, without its trailing newline
 * @param oracleElement - the paragraph element the oracle renders
 */
async function expectFixedPoint(
  source: string,
  oracleElement: string,
): Promise<void> {
  const input = `${source}\n`;
  const out = await formatAdoc(input);
  expect(out).toBe(input);
  expect(await renderedHtml(input)).toContain(oracleElement);
  expect(await formatAdoc(out)).toBe(out);
}

describe("the twelve corruption witnesses", () => {
  // Ten of these are matrix cells of the sweep (curved-quote-sweep.ts);
  // two are hand shapes the matrix does not generate. All twelve answer
  // no to `neighboursAllowIt` because the neighbour beside the asking
  // span - whether a sibling or the enclosing curved quote's own edge -
  // is the curved row's OWN entity, whose `;` (or, for the mark that
  // crosses the CLOSE side in the fifth and tenth rows, whose `<`/`>`)
  // the front or behind exclusion class refuses. Eleven of the twelve
  // are byte fixed points; the twelfth is not (see the row below the
  // table) and is asserted separately.
  test.each<[string, string]>([
    ['x "`__a__`" y', "<p>x \u201C<em>a</em>\u201D y</p>"],
    ['x "`__a__ b`" y', "<p>x \u201C<em>a</em> b\u201D y</p>"],
    ['x "`##a##`" y', "<p>x \u201C<mark>a</mark>\u201D y</p>"],
    ['x "`##a## b`" y', "<p>x \u201C<mark>a</mark> b\u201D y</p>"],
    ['x "`##a`"## y', "<p>x \u201C<mark>a\u201D</mark> y</p>"],
    ["x '`__a__`' y", "<p>x \u2018<em>a</em>\u2019 y</p>"],
    ["x '`__a__ b`' y", "<p>x \u2018<em>a</em> b\u2019 y</p>"],
    ["x '`##a##`' y", "<p>x \u2018<mark>a</mark>\u2019 y</p>"],
    ["x '`##a## b`' y", "<p>x \u2018<mark>a</mark> b\u2019 y</p>"],
    ["x '`##a`'## y", "<p>x \u2018<mark>a\u2019</mark> y</p>"],
    ["'`__a__`'", "<p>\u2018<em>a</em>\u2019</p>"],
  ])("%s", async (source, oracleElement) => {
    await expectFixedPoint(source, oracleElement);
  });

  // The twelfth witness holds TWO unconstrained spans in the same
  // curved quote: the first (front, index 0) still answers no for the
  // same reason as every row above, but the second (behind, last
  // index) sits at the curved quote's CLOSE side, where neither
  // character the enclosing's row could have left behind (`&` or `;`)
  // is ever excluded - `behindNeighbour`'s doc comment
  // (src/print/inline.ts) spells out why the check cannot discriminate
  // there. Measured: `x "`__a__ and _b_`" y` renders IDENTICALLY to
  // the source and is idempotent, so this row is pinned as render-equal
  // and stable rather than byte-identical.
  test("the second mark of two, at the curved quote's close side, shortens; the render and idempotence still hold", async () => {
    const source = 'x "`__a__ and __b__`" y';
    const input = `${source}\n`;
    const oracleElement = "<p>x \u201C<em>a</em> and <em>b</em>\u201D y</p>";
    expect(await renderedHtml(input)).toContain(oracleElement);
    const out = await formatAdoc(input);
    expect(out).toBe('x "`__a__ and _b_`" y\n');
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("shapes an over-broad refusal used to lengthen", () => {
  // Before the derived edge, the printer refused the constrained
  // spelling anywhere inside a span, leaving these longer than they
  // need to be. Each row's constrained spelling renders the same
  // element the oracle already made from the unconstrained one.
  test.each<[string, string]>([
    ['x "`b __a__`" y', 'x "`b _a_`" y'],
    ["x '`b __a__`' y", "x '`b _a_`' y"],
    ['x "`a`"**b** y', 'x "`a`"*b* y'],
    ['x "`**a**`" y', 'x "`*a*`" y'],
  ])("%s shortens to %s", async (source, expected) => {
    const input = `${source}\n`;
    const expectedOut = `${expected}\n`;
    const out = await formatAdoc(input);
    expect(out).toBe(expectedOut);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the stray-mark witness: a block-wide scan, not a sibling scan", () => {
  // A span nested inside a curved quote has only the curved quote's
  // OWN content as siblings, so a sibling-only scan cannot see the
  // bibliography anchor's stray `_` standing outside it. Shortening the
  // emphasis would make that `_` an opening mark and destroy the
  // anchor - a render corruption this task's widened, block-wide scan
  // must refuse.
  test("a bibliography anchor's mark survives a nested span's shortening decision", async () => {
    const input = 'x [[[_a]]] "`b __c__`" y\n';
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(input)).toContain(
      '<p>x [<a id="_a"></a>] \u201Cb <em>c</em>\u201D y</p>',
    );
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("near-miss and nesting rows", () => {
  test.each<[string, string]>([
    // A stray `"` beside an unconstrained monospace pair: no curved
    // quote opens (nothing closes it), so the monospace stands alone.
    ['x "``a`` y', '<p>x "<code>a</code> y</p>'],
    // Straight quotes on both sides of a double-backtick run: the
    // curved pair's own non-greedy content search still finds a valid
    // close past the doubled backticks, and the leftover backticks
    // stay literal (monospace's own front class excludes the `;` the
    // curved row's entity leaves behind).
    ['x "``a``" y', "<p>x \u201C`a`\u201D y</p>"],
    // The same shape with no surrounding text.
    ['"``a``"', "<p>\u201C`a`\u201D</p>"],
    // A monospace pair HOLDING a curved quote: the outer backticks pair
    // first (monospace's row runs before the curved rows), so the
    // curved pair inside is content, not a sibling construct.
    ['x `"`a`"` y', "<p>x <code>&#8220;a&#8221;</code> y</p>"],
    // Two candidate curved-double opens; the first's non-greedy content
    // search closes at the FIRST `` `" `` it finds, leaving the second
    // pair's marks as ordinary content.
    ['x "`a "`b`" c`" y', '<p>x \u201Ca "`b\u201D c`" y</p>'],
    // A double pair holding a nested single pair as content: the
    // single pair's own row runs after the double's, resolving inside
    // the content the double row already carried through unprocessed.
    ["x \"`a '`b`' c`\" y", "<p>x \u201Ca \u2018b\u2019 c\u201D y</p>"],
    // An inline attribute list beside a curved pair: `[.foo]` is not a
    // role a curved quote takes (only highlight's `#...#` reads one),
    // so it converts on its own and the curved pair still forms.
    ['x [.foo]"`a`" y', '<p>x <span class="foo">\u201Ca\u201D</span> y</p>'],
    // A backslash escapes the straight quote itself: the curved pair
    // cannot open, but the monospace pair beside it is unaffected.
    ['x \\"`a`" y', '<p>x "`a`" y</p>'],
    // An opening quote and a monospace pair with nothing to close the
    // quote: it stays literal.
    ['x "`a`', '<p>x "`a`</p>'],
    // The bare open spelling alone, nothing even resembling a close:
    // literal to the end of the line.
    ['x "`a', '<p>x "`a</p>'],
    // Whitespace directly inside the delimiters refuses to open (the
    // content may not begin or end with a space).
    ['x "` a `" y', '<p>x "` a `" y</p>'],
    // `;` immediately in front of the opening quote is excluded, the
    // same class every constrained row excludes.
    ['x ;"`a`" y', '<p>x ;"`a`" y</p>'],
    // A word character immediately in front is excluded the same way.
    ['x a"`a`" y', '<p>x a"`a`" y</p>'],
    // A word character immediately behind the close refuses the whole
    // pair, not just the closing mark.
    ['x "`a`"b y', '<p>x "`a`"b y</p>'],
    // Parentheses on both sides are ordinary punctuation: the pair
    // forms normally.
    ['x ("`a`") y', "<p>x (\u201Ca\u201D) y</p>"],
    // `;` immediately BEHIND the close is not excluded - only the
    // front clause excludes it - so the pair still forms.
    ['x "`a`";b y', "<p>x \u201Ca\u201D;b y</p>"],
    // A constrained italic immediately behind the close, with no space
    // between: both spans form independently.
    ['x "`a`"_b_ y', '<p>x "`a`"<em>b</em> y</p>'],
    // The single curved quote's own possessive/contraction guard: a
    // letter immediately behind the close refuses the pair, leaving an
    // ordinary apostrophe-s.
    ["x '`a`'s y", "<p>x '`a\u2019s y</p>"],
    // The single-quote analogue of the monospace-holding-a-curved-pair
    // row above.
    ["x `'`a`' y", "<p>x \u2019`a\u2019 y</p>"],
  ])("%s", async (source, oracleElement) => {
    await expectFixedPoint(source, oracleElement);
  });
});

describe("curvedQuote's serialized key order", () => {
  // The declaration order in ast.ts (`type, quote, children, position`)
  // is a first-class contract: parity's flatten fold emits the same
  // canonical order, so a drift here is a parity break waiting to
  // happen.
  test("a curved-quote node's serialized key order is the canonical one", () => {
    const document = parse('x "`a`" y\n');
    const [block] = document.children;
    const [, curved] = asParagraph(block).children;
    expect(curved.type).toBe("curvedQuote");
    expect(serializedKeys(curved)).toEqual([
      "type",
      "quote",
      "children",
      "position",
    ]);
  });
});
