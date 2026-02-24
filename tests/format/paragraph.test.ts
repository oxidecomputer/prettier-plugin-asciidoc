import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("paragraph formatting", () => {
  // Round-trip baseline: well-formed input should not be changed.
  test("single paragraph preserved", async () => {
    expect(await formatAdoc("Hello world.\n")).toBe("Hello world.\n");
  });

  // AsciiDoc uses exactly one blank line to separate blocks. Multiple
  // consecutive blank lines are visual noise — the formatter collapses
  // them. This is the core formatting opinion for paragraph separation.
  test("multiple blank lines between paragraphs collapsed to one", async () => {
    const input = "First.\n\n\n\nSecond.\n";
    const expected = "First.\n\nSecond.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Trailing blank lines serve no purpose and should be stripped.
  // The document printer emits exactly one trailing hardline after content.
  test("trailing blank lines removed", async () => {
    const input = "Hello.\n\n\n";
    const expected = "Hello.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Leading blank lines before content should be stripped — the parser
  // absorbs them as BlankLine tokens that don't produce AST nodes.
  test("leading blank lines removed", async () => {
    const input = "\n\nHello.\n";
    const expected = "Hello.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Complement to the "collapsed" test: verify that a single blank line
  // between paragraphs is already canonical and is preserved unchanged.
  test("two paragraphs separated by single blank line", async () => {
    const input = "First.\n\nSecond.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Line breaks within a paragraph are reflowed — the formatter joins
  // lines and re-wraps to printWidth. Short lines that fit together
  // on one line are merged.
  test("multi-line paragraph lines reflowed", async () => {
    const input = "Line one.\nLine two.\n";
    const expected = "Line one. Line two.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Trailing whitespace is invisible and should be stripped.
  // The text printer splits on /\s+/, so trailing spaces are
  // naturally discarded during word extraction.
  test("trailing whitespace on lines removed", async () => {
    const input = "Hello world.   \n";
    const expected = "Hello world.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Edge case: empty input must produce empty output, not a lone newline.
  // The document printer returns "" when there are no children.
  test("empty input stays empty", async () => {
    expect(await formatAdoc("")).toBe("");
  });

  // Regression: a whitespace-only first line was tokenized as
  // InlineModeStart and became a paragraph. The printer rendered it
  // as empty content plus a blank-line separator, producing
  // spurious leading newlines. Now it is dropped.
  test("whitespace-only line before list item is dropped", async () => {
    const input = " \n. item";
    expect(await formatAdoc(input)).toBe(". item\n");
  });
});
