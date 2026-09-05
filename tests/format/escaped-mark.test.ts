/**
 * The escaped formatting mark, read as its own node (issue #84).
 *
 * A backslash in front of `*`, `_`, `` ` `` or `#` escapes a
 * `QUOTE_SUBS` row that WOULD otherwise resolve a span there - and is
 * ordinary text where no row would, which is the `a\*b` row's whole
 * point. The two scopes reach the escape by different routes and the
 * difference is worth stating, because it is what makes the family
 * look inconsistent from outside: each of the six UNCONSTRAINED rows
 * opens with a bare optional `\\?`, a literal outside every group that
 * captures nothing (asciidoctor.rb l.446-468), while the CONSTRAINED
 * rows have no such literal and take the backslash through their left
 * boundary class instead (`(^|[^#{CC_WORD};:}])`, asciidoctor.rb
 * l.448), which admits it because a backslash is no word character.
 * Where a row matches, `convert_quoted_text` sees a match that begins
 * with the backslash and writes the match back with the backslash
 * removed (substitutors.rb l.1419-1425); where none does, both bytes
 * stand.
 *
 * FOUR of the six rows have a node. `\^` and `\~` (asciidoctor.rb
 * l.466, l.468) have no tokenizer rule and stay in the text run,
 * printing the same bytes; the two rows at the end of the oracle
 * table below hold that.
 *
 * Nothing here was corrupted before the node existed - a text run
 * carrying `\*` printed the same bytes a node does - so every row
 * below that pins BYTES passed already. What did not exist was the
 * distinction: the printer could not tell an escape from the mark it
 * escapes, and the rules that reason about pairing had nothing in the
 * tree to read. The AST rows are the ones that moved.
 *
 * Every expectation was measured against the oracle
 * (`@asciidoctor/core`) rather than imagined.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, oracleHtml, renderedHtml } from "../helpers.js";
import { parse } from "../../src/parser.js";
import { shapes } from "../parser/inline-shape.js";

/**
 * The verbatim bytes of every escaped-mark node in a parsed document,
 * at any depth and under any field name.
 *
 * A generic walk rather than a paragraph's `children`, because the
 * tables below put the construct inside a monospace span and inside a
 * list item as well as at block level, and the point of those rows is
 * that the node comes out the same in all three.
 * @param value - anything reachable from the parsed document
 * @returns each escape's source, in document order
 */
function escapedMarks(value: unknown): string[] {
  if (Array.isArray(value)) {
    return (value as unknown[]).flatMap((item) => escapedMarks(item));
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  const node: Record<string, unknown> = { ...value };
  if (node.type === "escapedMark" && typeof node.value === "string") {
    return [node.value];
  }
  return Object.values(node).flatMap((field) => escapedMarks(field));
}

/**
 * Format twice and render both sides: the facts every row asserts,
 * gathered in one place so a row is a table entry rather than a
 * script.
 * @param source - the document source
 * @returns the formatted output, the second pass, and both renderings
 */
async function measure(source: string): Promise<{
  formatted: string;
  again: string;
  before: string;
  after: string;
}> {
  const formatted = await formatAdoc(source);
  return {
    formatted,
    again: await formatAdoc(formatted),
    before: await renderedHtml(source),
    after: await renderedHtml(formatted),
  };
}

// The four marks, spelled once so a row that means "all four" is not
// four rows that could drift apart.
const MARKS = ["*", "_", "`", "#"] as const;

// A monospace span wrapped around an escape, assembled rather than
// written out: a literal holding a backtick AND a backslash can be
// spelled neither as a template (the backtick ends it) nor as a plain
// string the lint rules accept.
const TICK = "`";
const BACKSLASH = "\\";
const ESCAPE_IN_MONOSPACE = `${TICK}${String.raw`\*a*`}${TICK}`;

/**
 * The shapes that carry an escape, each with the escape bytes the
 * parse must produce and the formatted output - every one a fixed
 * point, because the escape is re-emitted exactly as written.
 */
const ESCAPES: Array<[string, string[], string]> = [
  // The CONSTRAINED escape, at the head of the fragment and behind a
  // space: `\*a*` renders `*a*`, marks and all, with no span.
  [String.raw`\*a*`, [String.raw`\*`], `${String.raw`\*a*`}\n`],
  [String.raw`x \*a* y`, [String.raw`\*`], `${String.raw`x \*a* y`}\n`],
  [String.raw`\_a_`, [String.raw`\_`], `${String.raw`\_a_`}\n`],
  ["\\`a`", ["\\`"], "\\`a`\n"],
  [String.raw`\#a#`, [String.raw`\#`], `${String.raw`\#a#`}\n`],
  // BOTH ends escaped, which is how an author usually writes it. The
  // second escape is a second node: `x \*not em\* y` renders
  // `x *not em\* y`, the closing backslash surviving into the output
  // because the match ended before it.
  [
    String.raw`x \*not em\* y`,
    [String.raw`\*`, String.raw`\*`],
    `${String.raw`x \*not em\* y`}\n`,
  ],
  // Mid-word, where no boundary clause admits a span and so no row
  // matches at all. Nothing is escaped here and NOTHING IS STRIPPED:
  // the oracle consumes neither byte and renders `a\*b` as itself,
  // where `x \*a* y` above loses its backslash to a row that did
  // match. The tokenizer classifies a backslash in front of a mark
  // uniformly, so the node is the same node; which of the two
  // readings applies is a fact about the rest of the line.
  [String.raw`a\*b`, [String.raw`\*`], `${String.raw`a\*b`}\n`],
  // The UNCONSTRAINED spellings. The rule matches ONE character behind
  // the backslash, so `\**` is the escape plus a mark the doubled scan
  // did not claim. What the oracle does with the rest is NOT what this
  // tree says - see the oracle rows below - and the bytes are the
  // author's either way.
  [String.raw`\**a**`, [String.raw`\*`], `${String.raw`\**a**`}\n`],
  [String.raw`\__a__`, [String.raw`\_`], `${String.raw`\__a__`}\n`],
  ["\\``a``", ["\\`"], "\\``a``\n"],
  [String.raw`\##a##`, [String.raw`\#`], `${String.raw`\##a##`}\n`],
  // A backslash in front of the escape. The first one is not an
  // escape - the rule wants a MARK behind the backslash and finds
  // another backslash - so it stays text and only the second is a
  // node.
  [String.raw`\\**a**`, [String.raw`\*`], `${String.raw`\\**a**`}\n`],
  // Inside the three block bodies whose inline content is read by a
  // different caller than a plain paragraph's, and inside a span.
  [String.raw`* item \*a*`, [String.raw`\*`], `${String.raw`* item \*a*`}\n`],
  [String.raw`NOTE: \*a*`, [String.raw`\*`], `${String.raw`NOTE: \*a*`}\n`],
  [ESCAPE_IN_MONOSPACE, [String.raw`\*`], `${ESCAPE_IN_MONOSPACE}\n`],
];

describe.each(ESCAPES)("%j", (source, values, formatted) => {
  test("parses as escaped marks carrying their own bytes", () => {
    expect(escapedMarks(parse(source))).toEqual(values);
  });

  test("formats to pinned bytes, render-equal and idempotent", async () => {
    const result = await measure(source);
    expect(result.formatted).toBe(formatted);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });
});

/**
 * The shapes that carry NO escape, and which must therefore build no
 * node. A backslash is only an escape in front of one of the four
 * marks; everywhere else it is a character the author wrote, and
 * building a node for it would claim a meaning Asciidoctor does not
 * give it.
 */
const NOT_ESCAPES: Array<[string, string]> = [
  // A backslash in front of a NON-mark. Asciidoctor prints all of
  // these literally, backslash included.
  [String.raw`a\b`, `${String.raw`a\b`}\n`],
  [String.raw`a\9`, `${String.raw`a\9`}\n`],
  [String.raw`a\ b`, `${String.raw`a\ b`}\n`],
  // The passthrough delimiter is not a `QUOTE_SUBS` mark, so the
  // backslash in front of one is not this rule's: the passthrough
  // parser has its own reading of it (src/parse/inline/passthrough.ts
  // names the branches it declines and why the bytes still come back).
  [String.raw`\+a+`, `${String.raw`\+a+`}\n`],
  // Inside a passthrough, both spellings: the construct is out of the
  // line before the quote pass runs, so its interior holds no marks
  // for a backslash to escape and no escape node is built.
  [String.raw`+\*a*+`, `${String.raw`+\*a*+`}\n`],
  [String.raw`$$\*a*$$`, `${String.raw`$$\*a*$$`}\n`],
  // A backslash in front of an ATTRLIST, not in front of a mark. The
  // rule wants a mark behind the backslash and finds `[`, so the
  // backslash stays text - and the span behind the brackets still
  // forms, which is what the oracle does too (it prints the brackets
  // literally and builds an unclassed span).
  [String.raw`\[r]*a*`, `${String.raw`\[r]*a*`}\n`],
];

describe.each(NOT_ESCAPES)("%j is no escape", (source, output) => {
  test("parses without one", () => {
    expect(escapedMarks(parse(source))).toEqual([]);
  });

  test("formats to pinned bytes, render-equal and idempotent", async () => {
    const result = await measure(source);
    expect(result.formatted).toBe(output);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });
});

/**
 * What the oracle actually renders, in its own bytes.
 *
 * These rows are the reading the node is named for, and two of them
 * are the reason issue #84 was filed: the escaped UNCONSTRAINED match
 * writes its text back WITHOUT the backslash, and the constrained row
 * that runs next pairs what is left, so `\**a**` is a real strong span
 * whose content is `*a` with a literal `*` behind it - not the plain
 * text the spelling suggests. The tree does not model that span
 * (src/ast.ts's EscapedMarkNode says why, and
 * src/parse/inline/doubled-marks.ts says what re-reading a row's own
 * output would cost); the bytes are the author's either way, which is
 * what the rows above hold. Pinned here so the reading is recorded
 * where the next rule that needs it will look.
 */
describe("the oracle's own reading", () => {
  test.each([
    // Escaped CONSTRAINED: no span at all, marks literal.
    [String.raw`\*a*`, "<p>*a*</p>"],
    [String.raw`x \*a* y`, "<p>x *a* y</p>"],
    // Escaped UNCONSTRAINED: a span the tree does not build.
    [String.raw`\**a**`, "<p><strong>*a</strong>*</p>"],
    [String.raw`\__a__`, "<p><em>_a_</em></p>"],
    [String.raw`\##a##`, "<p><mark>#a</mark>#</p>"],
    // Two backslashes: the escape's own escape, so the marks come
    // back literal and one backslash is consumed.
    [String.raw`\\**a**`, "<p>**a**</p>"],
    // A backslash in front of a non-mark is not an escape and is not
    // removed.
    [String.raw`a\b`, String.raw`<p>a\b</p>`],
    // Nor is one in front of a mark that no row can pair: mid-word
    // both bytes survive, which is what separates this row from the
    // `x \*a* y` one above.
    [String.raw`a\*b`, String.raw`<p>a\*b</p>`],
    // The two unconstrained rows with no node of their own. The bytes
    // and the render are still right; only the tree is silent.
    [String.raw`x \^a^ y`, "<p>x ^a^ y</p>"],
    [String.raw`x \~a~ y`, "<p>x ~a~ y</p>"],
  ])("%j renders %j", async (source, html) => {
    expect(await oracleHtml(source)).toContain(html);
  });
});

/**
 * The escape and its mark are ONE atom: the node holds no whitespace,
 * so the packer measures one string and no width can put a line break
 * between the backslash and the character it escapes. Splitting them
 * would leave a bare mark at the head of a line - which is a list
 * marker where the mark is `*` - and a backslash at the end of the
 * line before it.
 *
 * Each row names the width it is measured at, because that is the
 * variable: the widths here are the ones where the break WANTS to
 * fall inside the construct, found by walking the paragraph's own
 * length.
 */
describe("a wrap never falls between the escape and its mark", () => {
  const SOURCE = String.raw`padx padx padx \*alphabet beta* tail`;
  test.each([13, 14, 15, 16, 17, 18, 20, 24, 30])(
    "at width %i",
    async (printWidth) => {
      const formatted = await formatAdoc(SOURCE, { printWidth });
      expect(formatted).toContain(String.raw`\*alphabet`);
      expect(await renderedHtml(formatted)).toBe(await renderedHtml(SOURCE));
      expect(await formatAdoc(formatted, { printWidth })).toBe(formatted);
    },
  );
});

/**
 * A wrap INSIDE the escaped run is safe, and that is a claim about
 * the oracle rather than about the packer: the constrained rows match
 * under `/m`, so a newline between two of the run's words leaves the
 * same match, still escaped, still literal. The rows measure it
 * rather than assume it.
 */
describe("a wrap inside the escaped run keeps the reading", () => {
  const SOURCE = String.raw`pad pad pad \*alpha beta gamma delta epsilon* tail`;
  test.each([12, 20, 24, 30])("at width %i", async (printWidth) => {
    const formatted = await formatAdoc(SOURCE, { printWidth });
    expect(formatted.split("\n").length).toBeGreaterThan(2);
    expect(await renderedHtml(formatted)).toBe(await renderedHtml(SOURCE));
    expect(await formatAdoc(formatted, { printWidth })).toBe(formatted);
  });
});

/**
 * The whole family, one row per mark, so a rule that ever treats the
 * four differently fails here rather than in whichever of them the
 * next test happened to name.
 */
describe.each(MARKS)("the escape of %j", (mark) => {
  test("is one node in the constrained spelling", () => {
    expect(escapedMarks(parse(`x \\${mark}a${mark} y`))).toEqual([`\\${mark}`]);
  });

  test("is one node in the unconstrained spelling", () => {
    expect(escapedMarks(parse(`x \\${mark}${mark}a${mark}${mark} y`))).toEqual([
      `\\${mark}`,
    ]);
  });

  test.each([`x \\${mark}a${mark} y`, `x \\${mark}${mark}a${mark}${mark} y`])(
    "%j round-trips render-equal and idempotent",
    async (source) => {
      const result = await measure(source);
      expect(result.formatted).toBe(`${source}\n`);
      expect(result.after).toBe(result.before);
      expect(result.again).toBe(result.formatted);
    },
  );
});

/**
 * The backslash in front of a CLOSING delimiter is content, not an
 * escape (issue #150).
 *
 * `convert_quoted_text` asks `match[0].start_with? RS`
 * (substitutors.rb l.1420), and `match[0]` begins at the OPENING
 * delimiter - the constrained rows admit the backslash through their
 * left boundary class, `(^|[^#{CC_WORD};:}])` (asciidoctor.rb l.448),
 * and the unconstrained rows through the bare `\\?` in front of the
 * same delimiter (asciidoctor.rb l.446). Neither row looks at what
 * stands in front of the CLOSER, so a mark behind a backslash still
 * closes the span an earlier delimiter opened, and the backslash
 * lands in the content.
 *
 * Reading an escape there instead took the closing delimiter out of
 * the stream, and with it the whole span: the tab in the monospace
 * row below then stood in ordinary prose, where the packer folds it -
 * the tier-1 corruption issue #150 reports. The contrast is
 * `x \*not em\* y` in the first table of this file: there the OPENER
 * is escaped too, so the match is written back literally and both
 * backslashes stay escapes.
 */
describe("a mark behind a backslash still closes a span", () => {
  // A TAB inside the span, because that is what makes the missing
  // span visible: `<code>` is whitespace-significant, so a folded tab
  // is a rendering change and not a byte the reader never sees.
  const TABBED_MONOSPACE = `${TICK}a\tb${BACKSLASH}${TICK}`;
  // The shortest content `(\S|\S#{CC_ALL}*?\S)` takes, one character
  // wide, and that character is the backslash itself.
  const LONE_BACKSLASH = `${TICK}${BACKSLASH}${TICK}`;

  test.each([
    [TABBED_MONOSPACE, String.raw`monospacec["a\tb\\"]`],
    [String.raw`*a b\*`, String.raw`boldc["a b\\"]`],
    [String.raw`_a b\_`, String.raw`italicc["a b\\"]`],
    [String.raw`#a b\#`, String.raw`highlightc["a b\\"]`],
    [LONE_BACKSLASH, String.raw`monospacec["\\"]`],
  ])("%j is one span whose content ends in the backslash", (source, shape) => {
    expect(shapes(source)).toEqual([shape]);
  });

  test.each([
    [TABBED_MONOSPACE, `<code>a\tb${BACKSLASH}</code>`],
    [String.raw`*a b\*`, `<strong>a b${BACKSLASH}</strong>`],
    [String.raw`_a b\_`, `<em>a b${BACKSLASH}</em>`],
    [String.raw`#a b\#`, `<mark>a b${BACKSLASH}</mark>`],
    [LONE_BACKSLASH, `<code>${BACKSLASH}</code>`],
  ])("%j is what the oracle renders", async (source, html) => {
    expect(await oracleHtml(source)).toContain(html);
  });

  test("the sheltered tab survives the round trip", async () => {
    const result = await measure(TABBED_MONOSPACE);
    expect(result.formatted).toBe(`${TABBED_MONOSPACE}\n`);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });

  // The narrowness, and it is the row's own lookahead that draws it.
  // A CONSTRAINED row may not close where a word character follows
  // (`(?!\w)`, asciidoctor.rb l.448), and the only offset a match
  // measured that at is its own end (`trailingDelimiterFlags`,
  // rules.ts). So the escape here closes nothing, the tab stands in
  // ordinary prose, and the oracle writes no element at all - which is
  // what the shape holds. Reading the delimiter without the flag
  // invents `<code>a<TAB>b\</code>c` instead.
  test("a word character behind the escape closes nothing", async () => {
    const source = `${TICK}a\tb${BACKSLASH}${TICK}c`;
    expect(shapes(source)).toEqual(['"`a\\tb"', "escapedMark", '"c"']);
    expect(await oracleHtml(source)).not.toContain("<code>");
    const result = await measure(source);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });
});

/**
 * The DOUBLED closer, whose two characters no single token carries
 * (issue #153).
 *
 * The same Ruby as the section above, one delimiter wider: the
 * backslash is content because the match begins at the OPENING
 * delimiter and not at the escape. What is new is the SPELLING. An
 * escape is exactly two characters, so an unconstrained row's closing
 * `` `` `` is written with the escape's own mark and the one behind
 * it, and no single token of ours carries both - `` ``a b\`` ``
 * matches the monospace row `\\?``(.+?)``` (asciidoctor.rb l.446)
 * with the content `a b\`.
 *
 * Red before the fix, measured: no span at all. A close had to be
 * carried by ONE token, and neither of these two carries both
 * characters, so the monospace row's tab stood in ordinary prose and
 * folded to a space - the same tier-1 shape as #150, one width up.
 * The other three marks lose the span the same way and only monospace
 * makes it render-visible.
 */
describe("a doubled closer split across an escape and a mark", () => {
  const TABBED_MONOSPACE = `${TICK}${TICK}a\tb${BACKSLASH}${TICK}${TICK}`;

  test.each([
    [TABBED_MONOSPACE, String.raw`monospaceu["a\tb\\"]`],
    [String.raw`**a b\**`, String.raw`boldu["a b\\"]`],
    [String.raw`__a b\__`, String.raw`italicu["a b\\"]`],
    [String.raw`##a b\##`, String.raw`highlightu["a b\\"]`],
  ])("%j is one span whose content ends in the backslash", (source, shape) => {
    expect(shapes(source)).toEqual([shape]);
  });

  test.each([
    [TABBED_MONOSPACE, `<code>a\tb${BACKSLASH}</code>`],
    [String.raw`**a b\**`, `<strong>a b${BACKSLASH}</strong>`],
    [String.raw`__a b\__`, `<em>a b${BACKSLASH}</em>`],
    [String.raw`##a b\##`, `<mark>a b${BACKSLASH}</mark>`],
  ])("%j is what the oracle renders", async (source, html) => {
    expect(await oracleHtml(source)).toContain(html);
  });

  // The doubled spelling is residue once the span exists: the printer
  // respells it constrained where that is legal, which is why this row
  // claims a RENDER and not the bytes. What it does claim about bytes
  // is the tab, which is inside `<code>` in both spellings.
  test("the sheltered tab survives the round trip", async () => {
    const result = await measure(TABBED_MONOSPACE);
    expect(result.formatted).toContain("a\tb");
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });

  // The delimiter's second character reaches the stream as whatever
  // rule claimed it, and both spellings are the same byte: a bare
  // mark where a row could pair one there, and the plain character
  // otherwise. A third backtick makes the second one plain, and the
  // span still closes - the leftover mark stands outside it, exactly
  // as the oracle leaves it.
  test("the character behind the escape closes it whatever claimed it", async () => {
    const source = `${TABBED_MONOSPACE}${TICK}`;
    expect(shapes(source)).toEqual([String.raw`monospaceu["a\tb\\"]`, '"`"']);
    expect(await oracleHtml(source)).toContain(`<code>a\tb${BACKSLASH}</code>`);
    const result = await measure(source);
    expect(result.formatted).toBe(`${source}\n`);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });

  // The narrowness, three rows of it, and every row reaches the arm:
  // each has a DOUBLED opener, so the width-2 row is live and the
  // seam behind the escape is the only thing that can answer it. What
  // stands there is too wide to be the delimiter's other half, or is
  // one character that is not it, or is it while the escape's own mark
  // is another kind - and each row keeps the escape an escape, with
  // the span closing where the source's own doubled mark does.
  //
  // The shape assertions are the point. Without them the guard that
  // reads the escape's own mark can be deleted and every row still
  // passes, while ``a b\*`c`` comes out ``a b\``c`` - the author's
  // asterisk rewritten to a backtick.
  test.each([
    [
      `${TICK}${TICK}a b${BACKSLASH}${TICK}xy${TICK}${TICK}`,
      String.raw`monospaceu["a b",escapedMark,"xy"]`,
    ],
    [
      `${TICK}${TICK}a b${BACKSLASH}${TICK}x${TICK}${TICK}`,
      String.raw`monospaceu["a b",escapedMark,"x"]`,
    ],
    [
      `${TICK}${TICK}a b${BACKSLASH}*${TICK}c${TICK}${TICK}`,
      'monospaceu["a b",escapedMark,"`c"]',
    ],
  ])("%j leaves the seam alone", async (source, shape) => {
    expect(shapes(source)).toEqual([shape]);
    const result = await measure(source);
    expect(result.formatted).toBe(`${source}\n`);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });

  // The same close one level down, where the recursion has to rebase
  // it: the bold row resolves first, so the code span and the seam it
  // closes on are INSIDE it, at indices the slice shifts.
  test("a seam close survives being nested", async () => {
    const source = `**x ${TABBED_MONOSPACE} y**`;
    expect(shapes(source)).toEqual([
      String.raw`boldu["x ",monospaceu["a\tb\\"]," y"]`,
    ]);
    const result = await measure(source);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });

  // A span already standing inside the content does not take the
  // escape's mark away from the closer: the doubled row resolves
  // first, so the inner constrained candidate crosses it and is
  // dropped, exactly as Ruby's later row finds nothing left to pair.
  test("an inner constrained mark stays literal", async () => {
    const source = `${TICK}${TICK}a ${TICK}b${BACKSLASH}${TICK}${TICK}`;
    expect(shapes(source)).toEqual(['monospaceu["a `b\\\\"]']);
    const result = await measure(source);
    expect(result.formatted).toBe(`${source}\n`);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });
});

/**
 * The seam close, and the two things that stop it.
 *
 * An across close is a close the stream does not carry as a token, so
 * taking it can only ever ADD a span - and where the added span would
 * cost a LATER row one of its own, it is not worth taking. The row
 * whose delimiter the span would enclose runs after this one and may
 * want a partner standing in front of this span's opener; the two
 * would then cross, and a crossing candidate is dropped, taking with
 * it whatever the lost span sheltered.
 *
 * `` ``a<TAB>**``\\** `` is that document. The oracle writes both
 * elements over each other - `<code>a<TAB><strong></code>\\</strong>` -
 * and monospace is the one that shelters the tab, so pairing the bold
 * across the seam would leave the tab in prose where the packer folds
 * it. The bold declines, the bytes come back as the source wrote them,
 * and the render holds.
 *
 * The last row holds the OTHER refusal: a cut may not fall in a match
 * an accepted span's own close is spelled with, because the head that
 * close kept would be repeated by the pieces. Without it `***\\**`
 * comes out `***\\\\**`, an author's backslash doubled.
 */
describe("a seam close the row declines", () => {
  test("a delimiter that would cross declines the close", async () => {
    const source = `${TICK}${TICK}a\t**${TICK}${TICK}${BACKSLASH}**`;
    expect(shapes(source)).toEqual([
      String.raw`monospaceu["a\t**"]`,
      "escapedMark",
      '"*"',
    ]);
    const result = await measure(source);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });

  // The narrowness: a foreign delimiter with NO partner in front of
  // this opener crosses nothing, so the close is taken and the span
  // shelters its tab. The bold mark inside the content here is alone.
  test("a delimiter with no partner in front does not decline it", async () => {
    const source = `${TICK}${TICK}\t**${BACKSLASH}${TICK}${TICK}`;
    expect(shapes(source)).toEqual([String.raw`monospaceu["\t**\\"]`]);
    const result = await measure(source);
    expect(result.formatted).toBe(`${source}\n`);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });

  test("a cut may not fall in a match a close is spelled with", async () => {
    const source = `***${BACKSLASH}**`;
    const result = await measure(source);
    expect(result.formatted).toBe(`${source}\n`);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });

  // The seam has nothing behind it at all: the match ENDS the stream,
  // so there is no token to spell the delimiter's other half.
  test("a match that ends the stream closes no seam", async () => {
    const source = `${TICK}${TICK}a b${BACKSLASH}${TICK}`;
    const result = await measure(source);
    expect(result.formatted).toBe(`${source}\n`);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });
});

/**
 * The guard asks about PAIRING, not spelling.
 *
 * The printer respells an unconstrained span with the constrained mark
 * wherever the two render alike, so the same document read a second
 * time offers the same pairing in a narrower spelling. A guard that
 * asked whether the partner in front was DOUBLED would fire on the
 * first reading and not on the second, and the two readings would
 * disagree about which spans exist.
 *
 * Here the bold's seam close would enclose a monospace delimiter whose
 * partner is the code span in front, so the close is declined and the
 * author's doubled bold stands. Asserted through TWO passes.
 */
describe("the crossing guard survives a respelling", () => {
  test.each(["``x``\t**`\\**", "``x`` a\t**`\\**", "``x``a\t**``\\**"])(
    "%j declines the close on both passes",
    async (source) => {
      const first = await formatAdoc(source);
      expect(first).toContain("**");
      expect(await renderedHtml(first)).toBe(await renderedHtml(source));
      expect(await formatAdoc(first)).toBe(first);
    },
  );
});

/**
 * The delimiter the guard could not see: the SAME MARK, the other
 * width.
 *
 * The seam close is an unconstrained row's, and the constrained row of
 * the same mark runs behind it, so a single mark standing in the
 * content is a delimiter that row may still want. Reading only the
 * KIND hid exactly that: a constrained monospace span holding an
 * address and a tab is closed by the first mark of a three-mark run,
 * and a doubled row pairing the rest of that run across the seam
 * behind it takes the span away - leaving the tab in prose, where the
 * packer folds it, while the oracle keeps it inside `<code>`.
 *
 * Red before the fix, measured: both rows came out a tab short.
 */
describe("a same-kind delimiter of the other width declines the close", () => {
  test.each([
    [
      "a three-mark run",
      `${TICK}a http://e.com\t${TICK}${TICK}${TICK}${BACKSLASH}${TICK}${TICK}`,
    ],
    [
      "a four-mark run",
      `${TICK}a http://e.com\t${TICK}${TICK}${TICK}${TICK}${BACKSLASH}${TICK}${TICK}`,
    ],
  ])("%s", async (_name, source) => {
    const result = await measure(source);
    expect(result.formatted).toBe(`${source}\n`);
    expect(result.after).toBe(result.before);
    expect(result.again).toBe(result.formatted);
  });
});

/**
 * A CHARACTERIZATION of issue #190, not a fix. Delete this whole
 * describe when #190 closes.
 *
 * The seam guard and the printer's respelling both read this document,
 * and they settle on the same answer from either end - but not in one
 * pass. The first writes the constrained spelling of the monospace
 * span in front; the second reads that narrower spelling back and
 * shortens the bold span behind it, which the first pass could not see
 * because the guard was still reading a doubled partner. Every step is
 * render-equal, so nothing here is a corruption; what #190 records is
 * WHEN the answer settles.
 *
 * The bytes are what tells the two documents apart, so both are here.
 * With the trailing pair the fixed point is the SECOND pass; without
 * it, the first pass already reaches it. That boundary is the whole
 * shape of the issue, and a tree that moved it either way would fail
 * one of these rows.
 */
describe("a doubled span in front of a seam close, as it settles (#190)", () => {
  test("the trailing pair defers the fixed point to the second pass", async () => {
    const source = `${TICK}${TICK}x${TICK}${TICK} **a\t${TICK}${TICK}${BACKSLASH}**${TICK}${TICK}`;
    const first = await formatAdoc(source);
    expect(first).toBe(`${TICK}x${TICK} **a ${TICK}${BACKSLASH}**${TICK}\n`);
    expect(await renderedHtml(first)).toBe(await renderedHtml(source));
    const second = await formatAdoc(first);
    expect(second).toBe(`${TICK}x${TICK} *a ${TICK}${BACKSLASH}*${TICK}\n`);
    expect(await renderedHtml(second)).toBe(await renderedHtml(first));
    // The true fixed point: the third pass moves nothing.
    expect(await formatAdoc(second)).toBe(second);
  });

  // The boundary, and it is two bytes wide: the same document without
  // the trailing pair settles on the FIRST pass.
  test("without the trailing pair the first pass reaches it", async () => {
    const source = `${TICK}${TICK}x${TICK}${TICK} **a\t${TICK}${TICK}${BACKSLASH}**`;
    const first = await formatAdoc(source);
    expect(first).toBe(
      `${TICK}${TICK}x${TICK}${TICK} **a ${TICK}${TICK}${BACKSLASH}**\n`,
    );
    expect(await renderedHtml(first)).toBe(await renderedHtml(source));
    expect(await formatAdoc(first)).toBe(first);
  });
});
