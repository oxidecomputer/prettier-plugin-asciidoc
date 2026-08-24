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
import { astShape } from "../parser/reader-helpers.js";

describe("paragraph-form admonition formatting", () => {
  // An admonition's content is reflowed like a paragraph, so it
  // needs the same dlist guard: joining these two lines would put
  // `term::` on the block's first line and Asciidoctor would render
  // a description list instead of the admonition.
  test("keeps a `::` word off the first line", async () => {
    const input = "NOTE: a line\nterm:: x\n";
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
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
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
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

  // A block anchor gets blank-line separation from a paragraph-form
  // admonition: stacked, the label line would be absorbed into the
  // anchor's paragraph on re-parse (wouldMergeWithAnchor).
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
    // The 7-slash line is CONTENT of the 6-slash comment block, not a
    // delimiter: `read_lines_until terminator:` matches whole lines
    // against the opening delimiter, so only `//////` closes it. The
    // comment block normalises to `////`, which its content cannot
    // close either.
    const out = await formatAdoc(input);
    expect(out).toBe("[M]\n*****\n****\n////\n///////\n////\n****\n*****\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
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
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
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
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// Pinned BEFORE the admonition printer rewrite: the
// BASELINE render-broke both shapes (it
// invented a blank line and pulled the [NOTE] line out of the
// listing), while the current tree reads `foo\n[NOTE]\nbar` as ONE
// three-line listing — byte-faithful, idempotent and oracle-matching.
// That rewrite is adjacent to this territory, so
// the tree, the bytes, render-equality and idempotence are pinned
// here first and must stay green through it.
describe("a [source] paragraph keeps a [NOTE] line as content", () => {
  test.each([
    [
      "inside an example block",
      "====\n[source]\nfoo\n[NOTE]\nbar\n====\n",
      "example(attrs listing[3])",
    ],
    [
      "inside a section",
      "== S\n\n[source]\nfoo\n[NOTE]\nbar\n",
      "h1 attrs listing[3]",
    ],
  ])("%s stays one nested listing", async (_name, input, shape) => {
    expect(astShape(input)).toBe(shape);
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the admonition body rides the paragraph engine", () => {
  test("a body reflows exactly as a paragraph body does", async () => {
    const input = `NOTE: ${"word ".repeat(30)}end\n`;
    const output = await formatAdoc(input);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });

  test("the dlist first-line guard has one home and still holds", async () => {
    const input = "NOTE: a line\nterm:: x\n";
    const output = await formatAdoc(input);
    // The `term::` word must not land at the start of an output line.
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });

  test("raw lines keep their own output lines through the shared engine", async () => {
    const input = "NOTE: alpha\nifdef::x[]\nbeta\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });
});

// The hard-line-break body classes the engine swap repaired (the
// admonition body moved onto the shared block-body engine): the
// string engine word-split ` +`, so it joined a label-line break away
// (`NOTE: alpha + beta`), dropped a mid-body break's `+` to column 0
// (a list-continuation line), and rewrote a trailing break to
// `{plus}` — all three render-corrupting at the baseline. The shared
// inline engine prints the break as the atom it is; these rows turn
// that accidental repair into a guarded one (F1).
describe("hard line breaks in a paragraph-form admonition body", () => {
  test.each([
    ["on the label line", "NOTE: alpha +\nbeta\n"],
    ["mid-body", "NOTE: one two three alpha +\nbeta four five six\n"],
    ["trailing", "NOTE: alpha beta +\n"],
  ])("a %s ` +` survives verbatim", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
