import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { ParagraphNode } from "../../src/ast.js";
import { asParagraph, narrow } from "../helpers.js";

/**
 * Extracts the raw text value from a paragraph's first
 * (and only) text child. Throws if the child is not a
 * text node, surfacing unexpected inline structures.
 * @param node - paragraph node with a single text child
 * @returns the text value string
 */
function paragraphText(node: ParagraphNode): string {
  const {
    children: [child],
  } = node;
  narrow(child, "text");
  return child.value;
}

describe("paragraph parsing", () => {
  // Baseline: the simplest possible input produces the expected AST shape.
  test("single paragraph", () => {
    const document = parse("Hello world.\n");
    expect(document.children).toHaveLength(1);
    expect(document.children[0].type).toBe("paragraph");
  });

  // Blank lines are the primary paragraph separator in AsciiDoc. The
  // BlankLine token (/\n(?:[ \t]*\n)+/) splits the input into two blocks.
  test("two paragraphs separated by blank line", () => {
    const document = parse("First paragraph.\n\nSecond paragraph.\n");
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("paragraph");
    expect(document.children[1].type).toBe("paragraph");
  });

  // The BlankLine token pattern /\n(?:[ \t]*\n)+/ is greedy and absorbs
  // consecutive empty lines. Multiple blank lines should still produce
  // exactly two paragraphs, not extra empty nodes.
  test("two paragraphs separated by multiple blank lines", () => {
    const document = parse("First.\n\n\n\nSecond.\n");
    expect(document.children).toHaveLength(2);
  });

  // Verify the text content survives the tokenization round-trip. The
  // reader lexes a paragraph's lines as one inline fragment, so they
  // arrive separated by InlineNewline tokens and the AST builder joins
  // them with "\\n" in the text value.
  test("paragraph text content is correct", () => {
    const document = parse("First para.\n\nSecond para.\n");
    expect(paragraphText(asParagraph(document.children[0]))).toBe(
      "First para.",
    );
    expect(paragraphText(asParagraph(document.children[1]))).toBe(
      "Second para.",
    );
  });

  // Consecutive non-blank lines form a single paragraph: the reader
  // keeps reading until a line interrupts, then tokenizes the whole
  // run at once (`ParagraphReader.tokenizeRun`).
  // Lines are joined with "\\n" in the text node value to preserve the
  // original line structure for the printer.
  test("multi-line paragraph has lines joined by newline", () => {
    const document = parse("Line one.\nLine two.\nLine three.\n");
    expect(document.children).toHaveLength(1);
    expect(paragraphText(asParagraph(document.children[0]))).toBe(
      "Line one.\nLine two.\nLine three.",
    );
  });

  // Prettier uses node positions for change tracking and range formatting.
  // Positions must be accurate down to offset/line/column.
  test("paragraph position starts at first character", () => {
    const document = parse("Hello.\n\nWorld.\n");
    const {
      children: [first],
    } = document;
    expect(first.position.start.offset).toBe(0);
    expect(first.position.start.line).toBe(1);
    expect(first.position.start.column).toBe(1);
  });

  // The second paragraph starts after the blank line separator.
  // "Hello.\n\n" is 8 characters, so "World." starts at offset 8, line 3.
  // This validates that BlankLine token consumption doesn't shift offsets.
  test("second paragraph has correct start position", () => {
    const document = parse("Hello.\n\nWorld.\n");
    const {
      children: [, second],
    } = document;
    expect(second.position.start.offset).toBe(8);
    expect(second.position.start.line).toBe(3);
    expect(second.position.start.column).toBe(1);
  });

  // End offset is exclusive (one past the last character of text content).
  // The trailing InlineNewline token is NOT included — it belongs to the
  // line separator, not the paragraph content. This matters for Prettier's
  // locEnd().
  test("paragraph end offset is end of last text content", () => {
    const document = parse("Hello.\n");
    const {
      children: [first],
    } = document;
    expect(first.position.end.offset).toBe(6);
  });

  // Empty input must not crash and must produce a valid empty document.
  test("empty input produces empty document", () => {
    const document = parse("");
    expect(document.children).toHaveLength(0);
  });

  // Whitespace-only input is semantically empty. The BlankLine token
  // absorbs all the newlines; the document rule's MANY loop sees only
  // BlankLine tokens and produces no blocks.
  test("only blank lines produce empty document", () => {
    const document = parse("\n\n\n");
    expect(document.children).toHaveLength(0);
  });

  // Leading blank lines before the first block should be discarded.
  // The document rule consumes them as BlankLine tokens at the top level.
  test("leading blank lines are ignored", () => {
    const document = parse("\n\nHello.\n");
    expect(document.children).toHaveLength(1);
    expect(paragraphText(asParagraph(document.children[0]))).toBe("Hello.");
  });

  // Trailing blank lines after the last block should be discarded,
  // same as leading — the document rule absorbs them.
  test("trailing blank lines are ignored", () => {
    const document = parse("Hello.\n\n\n");
    expect(document.children).toHaveLength(1);
  });

  // Real-world files may lack a final newline. The reader appends the
  // document's newline to a text run only when the source has one
  // there (`ParagraphReader.tokenizeRun`), so its absence must not
  // change the paragraph.
  test("text without trailing newline still parses", () => {
    const document = parse("No trailing newline");
    expect(document.children).toHaveLength(1);
    expect(paragraphText(asParagraph(document.children[0]))).toBe(
      "No trailing newline",
    );
  });
});

// A lone `\r` is a LINE BREAK to `@asciidoctor/core` 4.0.11's
// `prepareSourceString` (see the JSDoc on nextLineBreak,
// src/parse/positions.ts), and splitLines has read it as one since
// issue #68. The two facts the paragraph builder measures off the
// SOURCE rather than off the lines it was handed answered with a
// `\n` scan of their own until issue #159, so a paragraph whose
// first line ended in a lone CR was read as one long line:
// `firstWordEndsItsLine` was false where the line really does end
// after its first word, and `secondLineIndent` was empty where a
// second line really does stand under it with an indent of its own.
//
// Only a DIRECT parse can witness this - Prettier's own entry point
// rewrites `\r\n?` to `\n` before any plugin parser runs
// (prettier/index.mjs, normalizeEndOfLine), so no formatAdoc round
// trip has a CR left to observe - which is why these are tree pins
// and not format rows. The `\n` twin of each row is there to show
// that the two spellings answer alike.
describe("a lone carriage return ends the line the builder measures", () => {
  test.each([
    ["a lone CR", "word\rmore\n"],
    ["a newline", "word\nmore\n"],
  ])("%s: the first line ends after its first word", (_name, source) => {
    expect(asParagraph(parse(source).children[0]).firstWordEndsItsLine).toBe(
      true,
    );
  });

  test.each([
    ["a lone CR", "word\r  more\n"],
    ["a newline", "word\n  more\n"],
  ])("%s: the second line keeps its indent", (_name, source) => {
    expect(asParagraph(parse(source).children[0]).secondLineIndent).toBe("  ");
  });
});
