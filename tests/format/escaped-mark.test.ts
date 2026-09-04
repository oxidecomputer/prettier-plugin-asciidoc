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
});
