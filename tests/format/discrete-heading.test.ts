/**
 * Format tests for discrete headings.
 *
 * A `[discrete]` attribute list before a heading produces a
 * standalone heading that does not create a section. The formatter
 * preserves the `[discrete]` attribute list on its own line,
 * stacked with the heading (no blank line between them).
 */
import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("discrete heading formatting", () => {
  // Canonical discrete heading passes through unchanged.
  test("discrete heading preserved as-is", async () => {
    const input = "[discrete]\n== Heading\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // The heading marker spacing is normalized, just like sections.
  test("discrete heading marker spacing normalized", async () => {
    const input = "[discrete]\n==  Extra Spaces  \n";
    const expected = "[discrete]\n== Extra Spaces\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Discrete heading does not nest — paragraph after it gets a
  // blank line separator, not section-style nesting.
  test("paragraph after discrete heading gets blank line", async () => {
    const input = "[discrete]\n== Heading\n\nSome text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Discrete headings at various levels.
  test("discrete heading at level 2", async () => {
    const input = "[discrete]\n=== Subtitle\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("discrete heading at level 3", async () => {
    const input = "[discrete]\n==== Deep Heading\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Discrete heading inside a section.
  test("discrete heading inside a section", async () => {
    const input = "== Section\n\n[discrete]\n=== Standalone\n\nParagraph.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multiple discrete headings in sequence.
  test("consecutive discrete headings", async () => {
    const input = "[discrete]\n== First\n\n[discrete]\n== Second\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Anchor paragraph is blank-line separated from the
  // [discrete] attribute list, which itself stacks with
  // the heading.
  // Anchor paragraph stacks with following metadata ([discrete]
  // attribute list), which itself stacks with the heading.
  test("anchor + discrete + heading", async () => {
    const input = "[[my-id]]\n[discrete]\n== Heading\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});
