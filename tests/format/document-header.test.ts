/**
 * Format tests for AsciiDoc document title and header.
 *
 * The formatter outputs `= Title` with normalized whitespace. In the
 * document header pattern (title followed by attribute entries), the
 * elements are joined by single newlines (no blank line between them).
 * A blank line separates the header from the document body.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("document title formatting", () => {
  // A canonical document title should pass through unchanged.
  test("document title preserved as-is", async () => {
    const input = "= My Document\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extra whitespace between the `=` marker and the title, and trailing
  // whitespace, should be normalized to a single space. Same formatting
  // opinion as section headings.
  test("document title whitespace normalized", async () => {
    const input = "=  Extra Spaces  \n";
    const expected = "= Extra Spaces\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Document header: title followed by attribute entries with no blank
  // line between them. This is the idiomatic AsciiDoc header style.
  test("title and attribute entries have no blank line between them", async () => {
    const input = "= My Document\n:toc:\n:source-highlighter: rouge\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // A blank line separates the header from the body. The formatter
  // should preserve this separation.
  test("blank line between title and body paragraph", async () => {
    const input = "= My Document\n\nBody text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Full header (title + attributes) followed by body content. The
  // blank line must appear between the last attribute entry and the
  // body, not between the title and the attributes.
  test("full header then body", async () => {
    const input = "= My Document\n:toc:\n\nBody text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multiple blank lines between header and body should be collapsed
  // to exactly one blank line.
  test("multiple blank lines after header collapsed", async () => {
    const input = "= My Document\n\n\n\nBody text.\n";
    const expected = "= My Document\n\nBody text.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Document title followed by a section. The blank line between them
  // should be preserved.
  test("title then section separated by blank line", async () => {
    const input = "= My Document\n\n== First Section\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Document title with attributes, then a section. Attributes are
  // stacked with the title, then a blank line before the section.
  test("title with attributes then section", async () => {
    const input = "= My Document\n:toc:\n\n== First Section\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});
