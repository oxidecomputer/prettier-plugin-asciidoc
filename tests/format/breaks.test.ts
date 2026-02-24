import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("thematic break formatting", () => {
  // Basic thematic break preserved.
  test("basic thematic break preserved", async () => {
    const input = "'''\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended thematic break normalized to three quotes.
  test("extended thematic break normalized", async () => {
    expect(await formatAdoc("''''\n")).toBe("'''\n");
    expect(await formatAdoc("'''''\n")).toBe("'''\n");
  });

  // Thematic break with surrounding paragraphs has blank
  // line separation.
  test("thematic break between paragraphs", async () => {
    const input = "Before.\n\n'''\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("page break formatting", () => {
  // Basic page break preserved.
  test("basic page break preserved", async () => {
    const input = "<<<\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended page break normalized to three less-than signs.
  test("extended page break normalized", async () => {
    expect(await formatAdoc("<<<<\n")).toBe("<<<\n");
    expect(await formatAdoc("<<<<<\n")).toBe("<<<\n");
  });

  // Page break with surrounding paragraphs has blank
  // line separation.
  test("page break between paragraphs", async () => {
    const input = "Before.\n\n<<<\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("hard line break formatting", () => {
  // A hard line break (` +` at end of line) in a paragraph
  // must survive formatting. The ` +\n` is semantic — it
  // forces a line break in the rendered output.
  test("hard line break in paragraph is preserved", async () => {
    const input = "First line +\nsecond line.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Hard line break in a list item must also be preserved.
  test("hard line break in list item is preserved", async () => {
    const input = "* First line +\nsecond line.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multiple hard line breaks in sequence.
  test("multiple hard line breaks preserved", async () => {
    const input = "Line one +\nline two +\nline three.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});
