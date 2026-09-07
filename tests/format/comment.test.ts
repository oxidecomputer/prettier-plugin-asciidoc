/**
 * Format tests for AsciiDoc comments.
 *
 * The formatter preserves comments as-is (content is not reformatted).
 * Blank lines around comments are normalized to exactly one, consistent
 * with how the formatter treats other block elements.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  expectFormatted,
  formatAdoc,
  narrow,
  renderedHtml,
} from "../helpers.js";

describe("line comment formatting", () => {
  // A canonical line comment must pass through unchanged.
  // This is the baseline — if this fails, the printer is mangling
  // comments rather than preserving them.
  test("line comment preserved as-is", async () => {
    const input = "// this is a comment\n";
    await expectFormatted(input, input);
    // Verifies the fundamental contract: `// text` becomes a comment node,
    // not a paragraph. Without this, comments would be treated as prose.
    const document = parse(input);
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("line");
    expect(child0.value).toBe("this is a comment");
  });

  // Empty comments (`//`) are valid and common as section dividers.
  // The printer must emit bare `//` without a trailing space, which
  // would add invisible whitespace that linters flag.
  test("empty line comment preserved", async () => {
    const input = "//\n";
    await expectFormatted(input, input);
    // `//` alone is a valid empty comment in AsciiDoc. The classifier's
    // line-comment shape must accept end-of-line after the slashes, not
    // just space-then-text.
    const document = parse(input);
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("line");
    expect(child0.value).toBe("");
  });

  // Comments between paragraphs get the same blank-line treatment as
  // any other block: exactly one blank line on each side. This test
  // verifies the canonical form is already stable.
  test("comment between paragraphs has normalized blank lines", async () => {
    const input = "Before.\n\n// comment\n\nAfter.\n";
    await expectFormatted(input, input);
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
    await expectFormatted(input, input);
    // Authors often stack line comments. Each must be its own AST node so
    // the printer can emit them individually — merging would lose the
    // per-line `//` markers and change the document's meaning.
    const document = parse(input);
    expect(document.children).toHaveLength(2);
    const {
      children: [child0, child1],
    } = document;
    narrow(child0, "comment");
    narrow(child1, "comment");
    expect(child0.value).toBe("first");
    expect(child1.value).toBe("second");
  });

  // Comments inside sections must be separated from the heading and
  // from sibling blocks by blank lines, just like paragraphs are.
  test("comment inside a section", async () => {
    const input = "== Title\n\n// remark\n\nText.\n";
    await expectFormatted(input, input);
    // Flat model, sections not modeled: the comment and the paragraph are the
    // heading's SIBLINGS; source order is all there is to keep.
    const { children } = parse(input);
    expect(children.map((child) => child.type)).toEqual([
      "heading",
      "comment",
      "paragraph",
    ]);
  });
});

describe("block comment formatting", () => {
  // Round-trip baseline for block comments: `////` delimiters and
  // content pass through the printer unchanged. Content is verbatim
  // and must never be reflowed or trimmed.
  test("block comment preserved as-is", async () => {
    const input = "////\nblock content\n////\n";
    await expectFormatted(input, input);
    // The core block comment contract: `////` delimiters wrap verbatim
    // content that must not be parsed as AsciiDoc. If the `push_mode`
    // on BlockCommentDelimiter fails, the content falls through to
    // default-mode tokenization (headings, inline text, etc.).
    const document = parse(input);
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("block content");
  });

  // Empty block comments are valid (authors use them as placeholders).
  // The printer must emit both delimiters with nothing between them.
  test("empty block comment preserved", async () => {
    const input = "////\n////\n";
    await expectFormatted(input, input);
    // Empty block comments (`////\n////`) are valid: the extent scan
    // starts at the opening line and finds its terminator on the very
    // next one, with no content lines in between.
    const document = parse(input);
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("");
  });

  // Internal newlines within block comment content must be preserved
  // exactly — the formatter must not reflow, join, or trim lines
  // inside a verbatim block.
  test("multi-line block comment preserved", async () => {
    const input = "////\nline one\nline two\n////\n";
    await expectFormatted(input, input);
  });

  // Block comments between paragraphs follow the same blank-line
  // normalization as all other block types.
  test("block comment between paragraphs", async () => {
    const input = "Before.\n\n////\nhidden\n////\n\nAfter.\n";
    await expectFormatted(input, input);
    // Same structural test as for line comments: block comments between
    // paragraphs must appear as their own block-level nodes, not get
    // absorbed into the adjacent paragraphs.
    const document = parse(input);
    expect(document.children).toHaveLength(3);
    expect(document.children[0].type).toBe("paragraph");
    expect(document.children[1].type).toBe("comment");
    expect(document.children[2].type).toBe("paragraph");
  });

  // AsciiDoc allows extended delimiters (`//////`), but the formatter
  // normalizes to the canonical 4-slash form. This is a formatting
  // opinion — similar to how we normalize heading whitespace.
  test("extended delimiter normalized to 4 slashes", async () => {
    const input = "//////\ncontent\n//////\n";
    const expected = "////\ncontent\n////\n";
    expect(await formatAdoc(input)).toBe(expected);
    // AsciiDoc allows delimiters longer than 4 slashes (`//////`).
    // The classifier's comment-delimiter shape (`/{4,}`) must accept
    // these without creating a mismatch between open and close
    // delimiter lengths.
    const document = parse(input);
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("content");
  });

  // Block comments with internal blank lines must survive formatting
  // intact. The content between delimiters is verbatim — the formatter
  // must not collapse or remove internal blank lines.
  test("block comment with internal blank lines preserved", async () => {
    const input = "////\nline one\n\nline three\n////\n";
    await expectFormatted(input, input);
    // Block comments can contain blank lines (e.g. separating paragraphs
    // of commented-out prose). The verbatim content extraction must
    // preserve internal blank lines exactly — losing them would silently
    // alter the commented-out content when formatting.
    const document = parse(input);
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("line one\n\nline three");
  });

  // Same collapsing behavior as line comments: extra blank lines
  // around a block comment are normalized to exactly one.
  test("multiple blank lines around block comment collapsed", async () => {
    const input = "Before.\n\n\n\n////\nhidden\n////\n\n\n\nAfter.\n";
    const expected = "Before.\n\n////\nhidden\n////\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Regression: the delimiter is spelled off the interior about to be
  // written, the way every other block's is. A `////` line inside a
  // `//////` comment used to print as "////\n////\n////\n", whose
  // second line closes the block its first line opened: the result is
  // not a fixed point (it re-formats to "////\n////\n\n////\n////\n"),
  // and anything standing after the conflicting line leaves the
  // comment. A comment block renders to nothing only while it stays a
  // comment, which is what the corruption ends: the second row's
  // `secret` reached the oracle as a paragraph before this fix, so
  // render-equality is a real assertion here and not a trivial one.
  test.each([
    ["//////\n////\n//////\n", "/////\n////\n/////\n"],
    [
      "//////\n////\nsecret\n////\n//////\n",
      "/////\n////\nsecret\n////\n/////\n",
    ],
  ])("%j keeps its interior inside the comment", async (input, expected) => {
    await expectFormatted(input, expected);
  });

  // The minimum spelling is kept where nothing collides: an interior
  // line LONGER than the delimiter is content to the reader, which
  // closes on an equality (`read_lines_until`, reader.rb:396-438), so
  // it constrains nothing.
  test("an interior line longer than the delimiter leaves it at four", async () => {
    const input = "////\ncontent\n//////\n////\n";
    await expectFormatted(input, input);
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
  await expectFormatted(input, "////\ncontent\n//////\n////\n");
  // Mismatched delimiter lengths do NOT close a block: `read_lines_until
  // terminator:` compares whole lines against the opening delimiter, so
  // a 6-slash line inside a 4-slash comment block is content and the
  // block runs on to end of input (Asciidoctor warns "unterminated
  // comment block"). ORACLE: nothing of it renders either way.
  expect(await renderedHtml(input)).not.toContain("content");
  const document = parse(input);
  expect(document.children).toHaveLength(1);
  const {
    children: [child0],
  } = document;
  narrow(child0, "comment");
  expect(child0.commentType).toBe("block");
  expect(child0.value).toBe("content\n//////");
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
    await expectFormatted(input, input);
  });
});
