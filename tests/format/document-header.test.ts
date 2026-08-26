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
import { parse } from "../../src/parser.js";

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

  // A blank line between the title and an attribute entry is the
  // author saying the entry is NOT header material, and it survives.
  // The old rule stacked a level-0 heading with any attribute entry
  // below it and deleted that blank, which moved a body attribute
  // entry into the header; now the header OWNS its own entries, so
  // an entry outside it is left where it was written. Four corpus
  // documents change bytes on this, all render-equal.
  test("a blank line between title and attribute entry survives", async () => {
    const input = "= My Document\n\n:!numbered:\n\n== First Section\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // The same blank, with a header attribute entry ABOVE it: the
  // header keeps `:toc:` adjacent and the body entry keeps its blank.
  test("a header entry stacks while a body entry keeps its blank", async () => {
    const input = "= My Document\n:toc:\n\n:!numbered:\n\nBody.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

// Issue #60's document, in the shape the corpus carries it: a
// byte-order mark, a document header, a body. The oracle's
// prepare_source drops one leading mark before reading a line, so the
// first line is a document title and not a paragraph; the reader does
// the same in src/parse/lines/split.ts.
//
// Prettier takes a U+FEFF off the text before any plugin sees it and
// puts it back on the formatted output (normalizeInputAndOptions), so
// the end-to-end rows below say what the FILE does and the parse row
// says what the READER does with the mark still attached. The
// misdecoded spelling is the one Prettier does not know, which is why
// it is the row that fails if the reader stops stripping.
//
// Stripping the mark is how the first line is READ, never an edit to
// the file: whatever the reader takes off the head the printer puts
// back, so the head bytes round-trip for every spelling and every
// count. A doubled mark is the row that would notice otherwise -
// delete one copy and the mark left behind is stripped by the next
// read, so a paragraph would turn into a title one format at a time.
describe("a leading byte-order mark", () => {
  const BOM = "\u{FEFF}";
  const MISDECODED_BOM = "\u{EF}\u{BB}\u{BF}";
  const document = "= Title\n:attribute: value\n\nBody text.\n";
  // A one-line document for the doubled rows: with a second mark left
  // in front of it the first line is a PARAGRAPH, and a paragraph next
  // to more header lines would be reflowed together with them, which
  // would make the row about reflow rather than about the mark.
  const title = "= Title\n";

  test("the reader reads a title through the mark", () => {
    const [block] = parse(`${BOM}${document}`).children;
    expect(block.type).toBe("documentHeader");
  });

  test("the reader records the mark it stripped", () => {
    expect(parse(`${BOM}${document}`).byteOrderMark).toBe(BOM);
    expect(parse(`${MISDECODED_BOM}${document}`).byteOrderMark).toBe(
      MISDECODED_BOM,
    );
    expect(parse(document).byteOrderMark).toBeUndefined();
  });

  test("the misdecoded spelling comes back on the output", async () => {
    expect(await formatAdoc(`${MISDECODED_BOM}${document}`)).toBe(
      `${MISDECODED_BOM}${document}`,
    );
  });

  test("a doubled misdecoded spelling comes back doubled", async () => {
    expect(await formatAdoc(`${MISDECODED_BOM}${MISDECODED_BOM}${title}`)).toBe(
      `${MISDECODED_BOM}${MISDECODED_BOM}${title}`,
    );
  });

  test("Prettier hands its own mark back on the output", async () => {
    expect(await formatAdoc(`${BOM}${document}`)).toBe(`${BOM}${document}`);
  });

  test("a doubled mark comes back doubled", async () => {
    expect(await formatAdoc(`${BOM}${BOM}${title}`)).toBe(
      `${BOM}${BOM}${title}`,
    );
  });

  test("formatting a marked document is idempotent", async () => {
    const once = await formatAdoc(`${BOM}${document}`);
    expect(await formatAdoc(once)).toBe(once);
  });

  test("the mark costs the title one column and nothing else", () => {
    const [heading] = parse(`${BOM}${document}`).children;
    expect(heading.position.start).toEqual({
      offset: 1,
      line: 1,
      column: 2,
    });
    const [plain] = parse(document).children;
    expect(heading.position.end.line).toBe(plain.position.end.line);
  });
});
