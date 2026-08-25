/**
 * Printer-level format tests for inline formatting.
 *
 * These tests exercise the full pipeline (parse → AST → print)
 * and verify that the printer re-emits correct AsciiDoc source.
 * They are complementary to `tests/parser/inline-formatting.test.ts`,
 * which tests AST shape only. Tests here cover:
 *
 *   - Round-trip preservation: the printer emits valid AsciiDoc
 *     that re-parses to an equivalent AST.
 *   - Reflow: the printer respects `printWidth` by breaking
 *     paragraph text with Prettier's fill() builder, including
 *     inside inline formatting spans.
 *   - Edge cases: stray marks, backslash escapes, cross-line
 *     spans, and other inputs where the printer must not corrupt
 *     the source semantics.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

// Basic preservation: each constrained and unconstrained form of
// every formatting mark must survive a format round-trip unchanged
// when the paragraph fits within printWidth (default 80).
describe("inline formatting — format output", () => {
  test("*bold* is preserved", async () => {
    const input = "*bold*\n";
    expect(await formatAdoc(input)).toBe("*bold*\n");
  });

  test("_italic_ is preserved", async () => {
    const input = "_italic_\n";
    expect(await formatAdoc(input)).toBe("_italic_\n");
  });

  test("`mono` is preserved", async () => {
    const input = "`mono`\n";
    expect(await formatAdoc(input)).toBe("`mono`\n");
  });

  test("#highlight# is preserved", async () => {
    const input = "#highlight#\n";
    expect(await formatAdoc(input)).toBe("#highlight#\n");
  });

  test("mixed inline formatting is preserved", async () => {
    const input = "This is *bold* and _italic_ text.\n";
    expect(await formatAdoc(input)).toBe("This is *bold* and _italic_ text.\n");
  });

  test("unconstrained **bold** is preserved", async () => {
    const input = "un**bold**ed\n";
    expect(await formatAdoc(input)).toBe("un**bold**ed\n");
  });

  test("unconstrained __italic__ is preserved", async () => {
    const input = "un__italic__ed\n";
    expect(await formatAdoc(input)).toBe("un__italic__ed\n");
  });

  test("unconstrained ``mono`` is preserved", async () => {
    const input = "un``mono``ed\n";
    expect(await formatAdoc(input)).toBe("un``mono``ed\n");
  });

  test("unconstrained ##highlight## is preserved", async () => {
    const input = "un##highlight##ed\n";
    expect(await formatAdoc(input)).toBe("un##highlight##ed\n");
  });

  test("nested *_bold italic_* is preserved", async () => {
    const input = "*_bold italic_*\n";
    expect(await formatAdoc(input)).toBe("*_bold italic_*\n");
  });

  test("backslash-escaped bold is preserved", async () => {
    // String.raw preserves the backslash literally. The `\n` at
    // the end is outside the raw template, so it is a real newline
    // (the paragraph terminator), not a literal backslash-n.
    const input = `${String.raw`\*not bold*`}\n`;
    expect(await formatAdoc(input)).toBe(`${String.raw`\*not bold*`}\n`);
  });

  test("{name} attribute reference is preserved", async () => {
    const input = "{name}\n";
    expect(await formatAdoc(input)).toBe("{name}\n");
  });

  test("attribute reference in text is preserved", async () => {
    const input = "See {project-name} for details.\n";
    expect(await formatAdoc(input)).toBe("See {project-name} for details.\n");
  });

  test("[red]#styled text# with role is preserved", async () => {
    const input = "[red]#styled text#\n";
    expect(await formatAdoc(input)).toBe("[red]#styled text#\n");
  });

  test("[.role]#text# with dot-prefixed role is preserved", async () => {
    const input = "[.role]#text#\n";
    expect(await formatAdoc(input)).toBe("[.role]#text#\n");
  });

  test("{counter:name} is preserved", async () => {
    const input = "{counter:name}\n";
    expect(await formatAdoc(input)).toBe("{counter:name}\n");
  });

  // Round-trip: formatting already-formatted input must produce
  // the same output — a core Prettier contract. Without this,
  // a printer bug might trigger a different reflow on the second
  // pass, causing an infinite diff loop.
  test("formatting round-trips", async () => {
    const input = "This is *bold* and _italic_ with `mono` and {attr}.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

// Reflow exercises the fill()-based printer path. The printer
// emits formatting marks as array elements inside the fill group
// (e.g. ["*", ...words, "*"]), so the opening mark attaches to
// the first word and the closing mark attaches to the last word.
// This means reflow can split text inside a span across lines
// while keeping the marks with their adjacent words.
describe("inline formatting — reflow with inline marks", () => {
  test("reflow splits bold span across lines", async () => {
    // printWidth: 10 forces a break inside the span. The marks
    // are fused with the first/last words so fill() packs
    // greedily: "*bold text" (10 chars) fits, then "here*"
    // goes on the next line.
    const input = "*bold text here*\n";
    const result = await formatAdoc(input, { printWidth: 10 });
    expect(result).toBe("*bold text\nhere*\n");
  });

  test("reflow wraps around inline marks", async () => {
    // Verifies that a line break can appear immediately after a
    // closing mark (*bold*) when the line overflows. The space
    // after *bold* is the break point; the mark itself must not
    // be orphaned on its own line.
    const input = "Some text before *bold* and after bold text here.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    expect(result).toBe("Some text before *bold* and\nafter bold text here.\n");
  });

  test("attribute reference is not broken by reflow", async () => {
    // Attribute references are emitted as a single Doc string
    // token ({...}), not split into fill words. Reflow can place
    // a line break before or after the reference at a word
    // boundary, but never inside it.
    const input =
      "This is a long paragraph with {attribute-name} in the middle of it.\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    expect(result).toBe(
      "This is a long paragraph with\n{attribute-name} in the middle\nof it.\n",
    );
  });
});

// Inputs that exercise parser fallback paths or printer edge
// cases. Each test verifies the full round-trip: parse does not
// crash, and the printer re-emits byte-identical source.
describe("inline formatting — edge case round-trips", () => {
  test("lone * in text is preserved", async () => {
    const input = "a * b\n";
    expect(await formatAdoc(input)).toBe("a * b\n");
  });

  test("adjacent *bold*_italic_ round-trips", async () => {
    const input = "*bold*_italic_\n";
    expect(await formatAdoc(input)).toBe("*bold*_italic_\n");
  });

  test("deeply nested *_`code`_* round-trips", async () => {
    const input = "*_`code`_*\n";
    expect(await formatAdoc(input)).toBe("*_`code`_*\n");
  });

  // The role rides the mark either way; at a word boundary the two
  // spellings render the same `<span class="role">`, so the shorter
  // one is what comes back.
  test("[role]##text## shortens to [role]#text#", async () => {
    const input = "[role]##text##\n";
    const out = await formatAdoc(input);
    expect(out).toBe("[role]#text#\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  test("backslash-escaped unconstrained bold is preserved", async () => {
    // Same String.raw / \n construction as the constrained escape
    // test above: the backslash is literal, the trailing \n is a
    // real newline.
    const input = `${String.raw`\**not bold**`}\n`;
    expect(await formatAdoc(input)).toBe(`${String.raw`\**not bold**`}\n`);
  });

  test("cross-line bold span is joined by reflow", async () => {
    // The parser merges inline tokens across source lines before
    // pairing marks, so *bold\ntext* is a single bold span whose
    // text child contains the newline as whitespace. The printer
    // then reflowing treats that newline as a word separator, and
    // since the paragraph fits in 80 cols, the words are joined
    // on one line with a space.
    const input = "*bold\ntext* here.\n";
    expect(await formatAdoc(input)).toBe("*bold text* here.\n");
  });

  test("stray [ in text round-trips", async () => {
    const input = "text [ more text\n";
    expect(await formatAdoc(input)).toBe("text [ more text\n");
  });

  test("stray { in text round-trips", async () => {
    const input = "text { more text\n";
    expect(await formatAdoc(input)).toBe("text { more text\n");
  });
});

// Runs of consecutive mark characters that don't pair cleanly.
// The tokenizer tries the longer mark first (`__` before `_`, in
// INLINE_RULES order), which can create empty formatting nodes. The
// formatter preserves the source text unchanged.
describe("inline formatting — odd-count marks", () => {
  test("five underscores in paragraph", async () => {
    const input = "some _____ text\n";
    expect(await formatAdoc(input)).toBe("some _____ text\n");
  });

  test("five hashes in paragraph", async () => {
    const input = "some ##### text\n";
    expect(await formatAdoc(input)).toBe("some ##### text\n");
  });

  test("five backticks in paragraph", async () => {
    const input = "some ````` text\n";
    expect(await formatAdoc(input)).toBe("some ````` text\n");
  });

  test("five stars in paragraph", async () => {
    const input = "some ***** text\n";
    expect(await formatAdoc(input)).toBe("some ***** text\n");
  });

  test("four underscores in paragraph", async () => {
    const input = "some ____ text\n";
    expect(await formatAdoc(input)).toBe("some ____ text\n");
  });

  // `_# #_` is italic wrapping highlight with space content.
  // The formatter must preserve the space between marks.
  test("nested marks with space content", async () => {
    const input = "some _# #_ text\n";
    expect(await formatAdoc(input)).toBe("some _# #_ text\n");
  });
});

// Blank-line normalisation: the printer must emit exactly one blank
// line between a section heading and its first paragraph, regardless
// of how many blank lines appear in the source.
describe("inline formatting — blank line normalisation", () => {
  test("multiple blank lines between heading and text are collapsed", async () => {
    // AsciiDoc requires exactly one blank line to separate a
    // section heading from its first paragraph. The printer must
    // normalise two consecutive blank lines (\n\n\n = heading +
    // two newlines) down to one, so re-parsing produces the same
    // section structure.
    const input = "== Section\n\n\nSome text.\n";
    const result = await formatAdoc(input);
    expect(result).toBe("== Section\n\nSome text.\n");
  });
});

// Where BOTH spellings are legal they render the same, so the printer
// writes the constrained one — the rule docs/architecture.md has promised
// since the beginning. Legality is Ruby's own: the constrained quote
// patterns (`QUOTE_SUBS`, asciidoctor.rb l.448-464) are
// `(^|[^\w;:}])(?:\[…\])?\*(\S|\S.*?\S)\*(?!\w)`.
describe("an unconstrained span shortens where the constrained one is legal", () => {
  test.each([
    ["bold at word boundaries", "a **b** c\n", "a *b* c\n"],
    ["italic", "a __b__ c\n", "a _b_ c\n"],
    ["monospace", "a ``b`` c\n", "a `b` c\n"],
    ["highlight", "a ##b## c\n", "a #b# c\n"],
    ["a role rides along", "a [.red]##b## c\n", "a [.red]#b# c\n"],
    ["at the start of the block", "**b** c\n", "*b* c\n"],
    ["at the end of the block", "a **b**\n", "a *b*\n"],
    ["punctuation on both sides", "(**b**)\n", "(*b*)\n"],
    ["before a comma", "a **b**, c\n", "a *b*, c\n"],
    [
      "two spans in one paragraph",
      "a **b** and **c** d\n",
      "a *b* and *c* d\n",
    ],
    ["a constrained child inside", "a **_b_** c\n", "a *_b_* c\n"],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The negative controls, one per clause of the predicate. Every row
  // was measured against the oracle FIRST: shortening the span here
  // renders a DIFFERENT document, which is why the author's spelling
  // stands.
  test.each([
    ["mid-word — the whole reason unconstrained exists", "a**b**c\n"],
    ["a word character in front", "ab**c** d\n"],
    ["a semicolon in front — one of Ruby's three", "a;**b** c\n"],
    ["a colon in front", "a:**b** c\n"],
    ["a closing brace in front", "a}**b** c\n"],
    ["a word character behind", "a **b**c\n"],
    ["content flush against neither mark", "a ** b ** c\n"],
    ["a neighbour that is not plain text", "a **b**__c__ d\n"],
    ["nested inside another span", "_**Release date:** x_\n"],
    ["a stray mark elsewhere in the paragraph", "a **b** and * stray\n"],
    // The corpus row this predicate was tightened for: the `_` inside
    // the bibliography anchor becomes an opening mark the moment the
    // emphasis shortens.
    [
      "a stray mark inside a neighbouring anchor",
      "- [[[_1984]]] George Orwell. __1984__. 1950.\n",
    ],
    // A hard break and a verbatim line are the two neighbours the
    // predicate refuses without asking: one is a `+` the reflow
    // places, the other is arbitrary source bytes.
    ["a hard break in the paragraph", "a **b** c +\nd\n"],
    ["a comment line in the paragraph", "a **b** c\n// note\nmore\n"],
    // The NEIGHBOUR CLASSES, one row per exclusion Asciidoctor's own
    // constrained patterns carry (QUOTE_SUBS, asciidoctor.rb
    // l.448-464). `sub_specialchars` runs before the quote pass, so
    // `<`, `>` and `&` are `;`-final entities by the time the pattern
    // is matched and land in the `[^…;:}]` exclusion; `\p{Word}` is
    // UNICODE, not ASCII; and a backtick beside a straight quote is a
    // curved-quote mark, not a monospace one. Every row renders
    // DIFFERENTLY once the mark shortens — measured, all four kinds
    // swept across 41 left and 33 right neighbour characters.
    ["a `<` in front becomes `&lt;`", "p <**b c** q\n"],
    ["a `>` in front becomes `&gt;`", "p >**b c** q\n"],
    ["an `&` in front becomes `&amp;`", "p &**b c** q\n"],
    ["a `<` in front of an italic", "p <__b c__ q\n"],
    ["a `<` in front of a monospace", "p <``b c`` q\n"],
    ["a `<` in front of a highlight", "p <##b c## q\n"],
    ["a straight double quote in front of a monospace", 'p "``b c``" q\n'],
    ["a straight single quote behind a monospace", "p ``b c``' q\n"],
    ["a backtick in front of a monospace", "p ```b c`` q\n"],
    ["a NON-ASCII word character behind", "p **b c**\u00E9q\n"],
    ["a non-ASCII word character in front", "p\u00E9**b c** q\n"],
  ])("%s keeps the author's marks", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });
});
