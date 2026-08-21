import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Decode the numeric entity Asciidoctor emits for `{plus}` so it can
 * be compared with a literal `+` from the same source character.
 * @param html - rendered HTML from the oracle
 * @returns the HTML with `&#43;` decoded
 */
function decodePlusEntity(html: string): string {
  return html.replaceAll("&#43;", "+");
}

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

  // A ` +` ALONE on its line is still a hard line break:
  // `LineBreakRx` (`^(.*)[ \t]\+$`) only needs a space before the
  // `+`, and an empty capture is a legal one. Asciidoctor takes the
  // break away in exactly one shape — see the literal-plus test
  // below — and the formatter used to lose it in all of them,
  // joining the lines into `text + more`.
  test.each([
    ["a paragraph", "text\n +\nmore\n"],
    ["a list item", ". item\n +\nmore\n"],
    ["a dlist description", "t:: desc\n +\nmore\n"],
    ["the block's last line", "text\nfoo\n +\nbar\n"],
  ])("a ` +` alone on its line breaks in %s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(out.includes(" +\n")).toBe(true);
    expect(await formatAdoc(out)).toBe(out);
  });

  // "Alone on its line" is a WHITESPACE-only prefix, not column 1:
  // the ` +` token starts at the space, so an extra indent moves it
  // right without giving the line any content. Both spellings render
  // the same `<br>`, and both must keep the ` +` on its own output
  // line — joining it onto the text above renders `text<br>` where
  // the source renders `text <br>`.
  test.each([
    ["one leading space", "text\n +\nmore\n"],
    ["a deeper indent", "text\n  +\nmore\n"],
    ["a preceding formatting span", "*b*\n +\nmore\n"],
  ])("a ` +` after %s owns its line", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(out.split("\n")).toContain(" +");
    expect(await formatAdoc(out)).toBe(out);
  });

  // Where it is NOT a break: `adjust_indentation!` strips the common
  // indent of a list item's continuation block BEFORE `LineBreakRx`
  // runs, so a ` +` no less indented than every other line of that
  // block loses its space and becomes a bare `+` — plain text. The
  // three cases below share one source shape and differ only in what
  // follows the ` +`, which is what decides the common indent.
  test.each([
    // Nothing follows: the block is the ` +` line, indent 1.
    [". item\n +\n", true],
    // `more` is unindented, so the common indent is 0 and the space
    // survives.
    [". item\n +\nmore\n", false],
    // `  more` is indented further, so the common indent is still 1.
    [". item\n +\n  more\n", true],
  ])("%j reads its ` +` as literal: %s", async (input, literal) => {
    const out = await formatAdoc(input);
    // `{plus}` is the formatter's escape for a trailing literal `+`,
    // and Asciidoctor renders it as the numeric entity for the very
    // same character, so the comparison decodes it.
    expect(decodePlusEntity(renderedHtml(out))).toBe(
      decodePlusEntity(renderedHtml(input)),
    );
    expect(renderedHtml(out).includes("<br>")).toBe(!literal);
    expect(await formatAdoc(out)).toBe(out);
  });
});
