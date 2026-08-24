import { describe, test, expect } from "vitest";
import {
  asParagraph,
  firstList,
  formatAdoc,
  renderedHtml,
} from "../helpers.js";
import { parse } from "../../src/parser.js";

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
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
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
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(out.split("\n")).toContain(" +");
    expect(await formatAdoc(out)).toBe(out);
  });

  // Where it is NOT a break: `adjust_indentation!` strips the common
  // indent of a list item's continuation block BEFORE `LineBreakRx`
  // runs, so a ` +` no less indented than every other line of that
  // block loses its space and becomes a bare `+` — plain text. The
  // four cases below share one source shape and differ only in what
  // follows the ` +`, which is what decides the common indent.
  test.each([
    // Nothing follows: the block is the ` +` line, indent 1.
    [". item\n +\n", true],
    // `more` is unindented, so the common indent is 0 and the space
    // survives.
    [". item\n +\nmore\n", false],
    // ` more` is indented EXACTLY as much as the ` +` line, so the
    // common indent is 1 and the space goes: the boundary case, and
    // the one that says the comparison is `>=` and not `>`.
    [". item\n +\n more\n", true],
    // `  more` is indented further, so the common indent is still 1.
    [". item\n +\n  more\n", true],
  ])("%j reads its ` +` as literal: %s", async (input, literal) => {
    const out = await formatAdoc(input);
    // `{plus}` is the formatter's escape for a trailing literal `+`,
    // and Asciidoctor renders it as the numeric entity for the very
    // same character, so the comparison decodes it.
    expect(decodePlusEntity(await renderedHtml(out))).toBe(
      decodePlusEntity(await renderedHtml(input)),
    );
    const html = await renderedHtml(out);
    expect(html.includes("<br>")).toBe(!literal);
    expect(await formatAdoc(out)).toBe(out);
  });

  // The reader's literal-plus decision retypes the ` +` token as
  // text. The newline that ENDS that line must stay a newline: retype
  // it too and it lands inside the item's text value, where nothing
  // downstream can tell it from content. Only the AST shows it — the
  // printer drops a trailing newline, so every rendering check above
  // passes either way.
  test("a literal ` +` leaves its newline out of the item's text", () => {
    const { children } = parse(". item\n +\n");
    const {
      children: [item],
    } = firstList(children);
    const {
      text: [text],
    } = item;
    expect(text).toMatchObject({ type: "text", value: "item\n +" });
  });

  // And it belongs to the FIRST line after the marker alone. `next_block`
  // hands `parse_list_item` the marker line plus the lines adjacent to
  // it, and `adjust_indentation!` runs over that buffer once; a ` +`
  // that arrives on a LATER line of the item's text is past the point
  // where the common indent is taken, so it stays an ordinary hard
  // break. Asserted on the AST rather than on formatted bytes: the
  // reflow that joins `a` and `a` moves the ` +` onto the first rest
  // line, where a second format pass reads it as literal — a
  // round-trip wobble that predates this suite and is not pinned
  // here.
  test("a ` +` on a LATER line of the item's text is still a hard break", () => {
    const { children } = parse("* a\na\n +\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.text.map(({ type }) => type)).toEqual([
      "text",
      "hardLineBreak",
    ]);
  });

  // The literal reading belongs to ITEM TEXT alone: `adjust_indentation!`
  // runs on a list item's lines and on nothing else, so the very same
  // shape — a ` +` line with nothing after it — is an ordinary hard
  // break in a plain paragraph.
  test("the same trailing ` +` in a PLAIN paragraph is a hard break", () => {
    const { children } = parse("a\n +\n");
    expect(asParagraph(children[0]).children.map(({ type }) => type)).toEqual([
      "text",
      "hardLineBreak",
    ]);
  });
});
