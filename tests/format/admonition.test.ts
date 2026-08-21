/**
 * Format tests for admonition blocks.
 *
 * Tests both paragraph-form (`NOTE: text`) and block-form
 * (`[NOTE]\n====\n...\n====`) admonitions. Paragraph-form
 * admonitions reflow text to printWidth with hanging indent.
 * Block-form admonitions preserve their delimiter structure.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("paragraph-form admonition formatting", () => {
  // An admonition's content is reflowed like a paragraph, so it
  // needs the same dlist guard: joining these two lines would put
  // `term::` on the block's first line and Asciidoctor would render
  // a description list instead of the admonition.
  test("keeps a `::` word off the first line", async () => {
    const input = "NOTE: a line\nterm:: x\n";
    const out = await formatAdoc(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  test("NOTE: text round-trips", async () => {
    const input = "NOTE: This is a note.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("TIP: text round-trips", async () => {
    const input = "TIP: Here is a tip.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("IMPORTANT: text round-trips", async () => {
    const input = "IMPORTANT: Do not forget.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("CAUTION: text round-trips", async () => {
    const input = "CAUTION: Watch out.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("WARNING: text round-trips", async () => {
    const input = "WARNING: Be careful.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("long text reflows to printWidth", async () => {
    const input =
      "NOTE: This is a very long note that should be reflowed when it exceeds the print width boundary.\n";
    const expected =
      "NOTE: This is a very long note that should be reflowed when it exceeds the print\nwidth boundary.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  test("continuation lines start at column 0", async () => {
    // Leading spaces in AsciiDoc denote an indented literal
    // block, so continuation lines must start at column 0.
    const input =
      "WARNING: First word second word third word fourth word fifth word sixth word.\n";
    const result = await formatAdoc(input, { printWidth: 40 });
    const lines = result.trimEnd().split("\n");
    expect(lines.length).toBeGreaterThan(1);
    for (const continuationLine of lines.slice(1)) {
      expect(continuationLine).toMatch(/^\S/v);
    }
  });

  test("multi-line paragraph-form text is reflowed", async () => {
    const input = "NOTE: First line\nsecond line\nthird line\n";
    const expected = "NOTE: First line second line third line\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // An admonition's content is read by read_paragraph_lines like any
  // paragraph, so a `.word` on a later line is TEXT there too — the
  // block-title shape only means anything on a block's first line.
  // Reflow may therefore wrap in front of it, and the rendering must
  // not move when it does.
  test("admonition reflow may wrap before a .word", async () => {
    const input = "NOTE: aaa bbb .title\n";
    const options = { printWidth: 16 };
    const out = await formatAdoc(input, options);
    expect(out).toBe("NOTE: aaa bbb\n.title\n");
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out, options)).toBe(out);
  });
});

describe("block-form admonition formatting (example block)", () => {
  test("[NOTE] + example block round-trips", async () => {
    const input = "[NOTE]\n====\nContent.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("[TIP] + example block round-trips", async () => {
    const input = "[TIP]\n====\nA tip.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("[IMPORTANT] + example block round-trips", async () => {
    const input = "[IMPORTANT]\n====\nDo not forget.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("[CAUTION] + example block round-trips", async () => {
    const input = "[CAUTION]\n====\nWatch out.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("[WARNING] + example block round-trips", async () => {
    const input = "[WARNING]\n====\nBe careful.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("block-form with multiple paragraphs round-trips", async () => {
    const input = "[NOTE]\n====\nFirst paragraph.\n\nSecond paragraph.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("block-form admonition formatting (open block)", () => {
  test("[CAUTION] + open block round-trips", async () => {
    const input = "[CAUTION]\n--\nContent.\n--\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("[NOTE] + open block round-trips", async () => {
    const input = "[NOTE]\n--\nA note in an open block.\n--\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("open block with multiple paragraphs round-trips", async () => {
    const input = "[WARNING]\n--\nFirst.\n\nSecond.\n--\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("admonition formatting in context", () => {
  test("paragraph-form admonition between paragraphs", async () => {
    const input = "Before.\n\nNOTE: A note.\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("block-form admonition between paragraphs", async () => {
    const input = "Before.\n\n[NOTE]\n====\nA note.\n====\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("block title + block-form admonition stacks", async () => {
    const input = ".My Note\n[NOTE]\n====\nContent.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("anchor + block-form admonition", async () => {
    const input = "[[my-note]]\n[TIP]\n====\nContent.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Block title stacks with paragraph-form admonition.
  test("block title + paragraph-form admonition", async () => {
    const input = ".My Note\nNOTE: This is a note.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Anchor paragraph gets blank-line separation from
  // paragraph-form admonition.
  test("anchor + paragraph-form admonition", async () => {
    const input = "[[my-note]]\nNOTE: This is a note.\n";
    const expected = "[[my-note]]\n\nNOTE: This is a note.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Custom admonition type round-trips.
  test("custom admonition [EXERCISE] round-trips", async () => {
    const input = "[EXERCISE]\n====\nDo this exercise.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Regression: a delimited admonition wrapping a same-variant
  // parent block must use a longer delimiter to preserve nesting.
  // Without this, both delimiters normalize to `****`, collapsing
  // the nesting on re-parse.
  test("admonition delimiter longer than nested same-variant block", async () => {
    const input = "[M]\n\n******\n****\n//////\n///////\n//////";
    expect(await formatAdoc(input)).toBe(
      "[M]\n*****\n****\n////\n////\n\n////\n////\n****\n*****\n",
    );
  });
});

// An admonition body is one reflowable string, but a comment or
// preprocessor line inside it is not text: Asciidoctor drops a
// comment and CONSUMES a directive while reading. Deleting them
// (which the first version of the paragraph lexer mode did) loses
// the author's bytes and — for a conditional — renders guarded text
// unconditionally. The printer keeps each on its own line at column
// 0 and reflows the runs around it.
describe("raw lines inside a paragraph-form admonition", () => {
  const cases: Array<[string, string]> = [
    ["a comment line", "NOTE: a\n// c\nb\n"],
    [
      "a conditional directive",
      "NOTE: a\nifdef::flag[]\nhidden\nendif::[]\nb\n",
    ],
    ["an include directive", "NOTE: a\ninclude::nope.adoc[]\nb\n"],
  ];
  for (const [name, input] of cases) {
    test(`${name} survives verbatim`, async () => {
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(renderedHtml(out)).toBe(renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    });
  }

  test("text on both sides of a raw line still reflows", async () => {
    const words = "word ".repeat(20);
    const input = `NOTE: ${words}\n// c\n${words}\n`;
    const out = await formatAdoc(input);
    // The comment owns a line of its own, at column 0, with
    // reflowed text above and below it.
    const lines = out.split("\n");
    expect(lines).toContain("// c");
    expect(lines.filter((l) => l.length > 0).length).toBeGreaterThan(3);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
