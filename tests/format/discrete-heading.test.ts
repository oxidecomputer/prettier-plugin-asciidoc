/**
 * Format tests for discrete headings.
 *
 * A `[discrete]` attribute list before a heading produces a
 * standalone heading that does not create a section. The formatter
 * preserves the `[discrete]` attribute list on its own line,
 * stacked with the heading (no blank line between them).
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { expectFormatted, formatAdoc, narrow } from "../helpers.js";

describe("discrete heading formatting", () => {
  // Canonical discrete heading passes through unchanged.
  test("discrete heading preserved as-is", async () => {
    const input = "[discrete]\n== Heading\n";
    await expectFormatted(input, input);
    // A `[discrete]` attribute list followed by a heading line
    // produces a DiscreteHeadingNode instead of an ordinary heading.
    // Discrete headings are standalone — they don't create sections.
    // Note: levels are zero-indexed, so `==` is level 1 (not 0 or 2),
    // matching the HeadingNode.level convention.
    const { children } = parse(input);
    // The attribute list is kept as a separate block (for stacking),
    // and the heading becomes a discreteHeading node.
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const [, child1] = children;
    narrow(child1, "discreteHeading");
    expect(child1.level).toBe(1);
    expect(child1.title).toBe("Heading");
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
    await expectFormatted(input, input);
  });

  // Discrete headings at various levels.
  test("discrete heading at level 2", async () => {
    const input = "[discrete]\n=== Subtitle\n";
    await expectFormatted(input, input);
  });

  test("discrete heading at level 3", async () => {
    const input = "[discrete]\n==== Deep Heading\n";
    await expectFormatted(input, input);
  });

  // Level 0 is valid for a discrete heading: `=` is a depth here,
  // not a document title, because the heading is style rather than
  // structure. The whole marker range round-trips byte-stably.
  test("discrete heading at level 0", async () => {
    const input = "[discrete]\n= T\n";
    await expectFormatted(input, input);
    // Level 0 (`=`) is VALID for a discrete heading: the marker that
    // would be a document title on an ordinary heading is only a depth
    // here, because a discrete heading is style, not structure. One
    // derivation classifies and builds the marker, so the whole
    // `=`-through-`======` range reaches the node.
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const [, child1] = children;
    narrow(child1, "discreteHeading");
    expect(child1.level).toBe(0);
    expect(child1.title).toBe("T");
  });

  // Discrete heading inside a section.
  test("discrete heading inside a section", async () => {
    const input = "== Section\n\n[discrete]\n=== Standalone\n\nParagraph.\n";
    await expectFormatted(input, input);
  });

  // Multiple discrete headings in sequence.
  test("consecutive discrete headings", async () => {
    const input = "[discrete]\n== First\n\n[discrete]\n== Second\n";
    await expectFormatted(input, input);
  });

  // A block anchor stacks with following metadata ([discrete]
  // attribute list), which itself stacks with the heading.
  test("anchor + discrete + heading", async () => {
    const input = "[[my-id]]\n[discrete]\n== Heading\n";
    await expectFormatted(input, input);
  });
});
