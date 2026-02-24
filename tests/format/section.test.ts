import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("section formatting", () => {
  // A canonical heading should pass through unchanged.
  test("heading preserved as-is", async () => {
    const input = "== Title\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // The formatter normalizes heading whitespace: extra spaces between
  // the == marker and the title text, and any trailing whitespace, are
  // collapsed to a single space. This is a core formatting opinion.
  test("heading marker spacing normalized", async () => {
    const input = "==  Extra Spaces  \n";
    const expected = "== Extra Spaces\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Heading and its body content are separated by exactly one blank line.
  test("one blank line between heading and paragraph", async () => {
    const input = "== Title\n\nSome text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Adjacent sections are separated by exactly one blank line.
  test("one blank line between sections", async () => {
    const input = "== First\n\n== Second\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Full scenario: section with content followed by another section.
  // Validates that the blank-line join works across the section boundary.
  test("section with paragraph and next section", async () => {
    const input = "== First\n\nParagraph.\n\n== Second\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multiple blank lines between sections are collapsed, same as paragraphs.
  test("multiple blank lines before section collapsed", async () => {
    const input = "== First\n\n\n\n== Second\n";
    const expected = "== First\n\n== Second\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // The formatter must not change heading levels — that would alter document
  // semantics. We only normalize whitespace, not structure.
  test("heading levels are not changed", async () => {
    const input = "=== Level 2\n\n==== Level 3\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});
