/**
 * Format tests for AsciiDoc comments.
 *
 * The formatter preserves comments as-is (content is not reformatted).
 * Blank lines around comments are normalized to exactly one, consistent
 * with how the formatter treats other block elements.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("line comment formatting", () => {
  // A canonical line comment must pass through unchanged.
  // This is the baseline — if this fails, the printer is mangling
  // comments rather than preserving them.
  test("line comment preserved as-is", async () => {
    const input = "// this is a comment\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty comments (`//`) are valid and common as section dividers.
  // The printer must emit bare `//` without a trailing space, which
  // would add invisible whitespace that linters flag.
  test("empty line comment preserved", async () => {
    const input = "//\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Comments between paragraphs get the same blank-line treatment as
  // any other block: exactly one blank line on each side. This test
  // verifies the canonical form is already stable.
  test("comment between paragraphs has normalized blank lines", async () => {
    const input = "Before.\n\n// comment\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // The formatter's core blank-line-collapsing opinion applies equally
  // to comments. Multiple blank lines around a comment collapse to one,
  // matching paragraph behavior.
  test("multiple blank lines around comment collapsed", async () => {
    const input = "Before.\n\n\n\n// comment\n\n\n\nAfter.\n";
    const expected = "Before.\n\n// comment\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Consecutive line comments should be joined by single newlines
  // (no blank line between them), preserving the common pattern of
  // stacked `//` lines that form a logical comment block.
  test("consecutive line comments", async () => {
    const input = "// first\n// second\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Comments inside sections must be separated from the heading and
  // from sibling blocks by blank lines, just like paragraphs are.
  test("comment inside a section", async () => {
    const input = "== Title\n\n// remark\n\nText.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("block comment formatting", () => {
  // Round-trip baseline for block comments: `////` delimiters and
  // content pass through the printer unchanged. Content is verbatim
  // and must never be reflowed or trimmed.
  test("block comment preserved as-is", async () => {
    const input = "////\nblock content\n////\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty block comments are valid (authors use them as placeholders).
  // The printer must emit both delimiters with nothing between them.
  test("empty block comment preserved", async () => {
    const input = "////\n////\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Internal newlines within block comment content must be preserved
  // exactly — the formatter must not reflow, join, or trim lines
  // inside a verbatim block.
  test("multi-line block comment preserved", async () => {
    const input = "////\nline one\nline two\n////\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Block comments between paragraphs follow the same blank-line
  // normalization as all other block types.
  test("block comment between paragraphs", async () => {
    const input = "Before.\n\n////\nhidden\n////\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // AsciiDoc allows extended delimiters (`//////`), but the formatter
  // normalizes to the canonical 4-slash form. This is a formatting
  // opinion — similar to how we normalize heading whitespace.
  test("extended delimiter normalized to 4 slashes", async () => {
    const input = "//////\ncontent\n//////\n";
    const expected = "////\ncontent\n////\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Block comments with internal blank lines must survive formatting
  // intact. The content between delimiters is verbatim — the formatter
  // must not collapse or remove internal blank lines.
  test("block comment with internal blank lines preserved", async () => {
    const input = "////\nline one\n\nline three\n////\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Same collapsing behavior as line comments: extra blank lines
  // around a block comment are normalized to exactly one.
  test("multiple blank lines around block comment collapsed", async () => {
    const input = "Before.\n\n\n\n////\nhidden\n////\n\n\n\nAfter.\n";
    const expected = "Before.\n\n////\nhidden\n////\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Regression: whitespace-only content in a block comment is
  // dropped. Prettier trims trailing whitespace, so "     "
  // would become a blank line that re-parses differently.
  test("whitespace-only content treated as empty", async () => {
    const input = "_____\n****\n/////\n     ";
    expect(await formatAdoc(input)).toBe(
      "____\n****\n////\n////\n****\n____\n",
    );
  });
});

// An unterminated comment block runs to end of input; the closer the
// printer synthesises sits directly under the last content line, not
// under an extra blank one (the source's final newline is a line
// terminator, not content).
test("an unterminated comment block closes directly after its content", async () => {
  const input = "////\ncontent\n//////\n";
  const out = await formatAdoc(input);
  expect(out).toBe("////\ncontent\n//////\n////\n");
  expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  expect(await formatAdoc(out)).toBe(out);
});

// A reader-eaten line directly after a block keeps its place: the
// reader removes it before block parsing, so a blank line inserted
// between them lands inside the run of lines the parser is still
// reading. Pinned for both kinds of reader-eaten line.
describe("a reader-eaten line directly after a block", () => {
  test.each([
    "----\nx\n----\n// c\n",
    "----\nx\n----\nendif::[]\n",
    "____\na\n____\n// c\n",
    "[verse]\n____\na\n____\nendif::[]\n",
    "[NOTE]\n====\ntext\n====\n// c\n",
    "* a\n* b\n// c\n",
  ])("%j round-trips byte for byte", async (input) => {
    expect(await formatAdoc(input)).toBe(input);
  });
});
