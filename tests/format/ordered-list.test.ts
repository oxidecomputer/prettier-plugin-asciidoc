import { describe, test, expect } from "vitest";
import { expectFormatted, formatAdoc } from "../helpers.js";

describe("ordered list formatting", () => {
  // Canonical single-item list passes through unchanged.
  test("single item preserved", async () => {
    const input = ". Item one\n";
    await expectFormatted(input, input);
  });

  // Multi-item list preserved.
  test("multi-item list preserved", async () => {
    const input = ". First\n. Second\n. Third\n";
    await expectFormatted(input, input);
  });

  // Nested list preserved with correct markers.
  test("nested list preserved", async () => {
    const input = ". Parent\n.. Child\n";
    await expectFormatted(input, input);
  });

  // One blank line before a list when preceded by a paragraph.
  test("blank line between paragraph and list", async () => {
    const input = "Some text.\n\n. Item\n";
    await expectFormatted(input, input);
  });

  // One blank line after a list when followed by a paragraph.
  test("blank line between list and paragraph", async () => {
    const input = ". Item\n\nSome text.\n";
    await expectFormatted(input, input);
  });

  // Multiple blank lines between a paragraph and list are
  // collapsed.
  test("multiple blank lines collapsed", async () => {
    const input = "Some text.\n\n\n\n. Item\n";
    const expected = "Some text.\n\n. Item\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Three-level nesting preserved.
  test("three-level nesting preserved", async () => {
    const input = ". Level 1\n.. Level 2\n... Level 3\n";
    await expectFormatted(input, input);
  });

  // All 5 nesting levels preserved through formatting.
  test("five-level nesting preserved", async () => {
    const input = ". L1\n.. L2\n... L3\n.... L4\n..... L5\n";
    await expectFormatted(input, input);
  });

  // Multiple siblings at nested level.
  test("sibling items at nested level", async () => {
    const input = ". Parent\n.. Child A\n.. Child B\n";
    await expectFormatted(input, input);
  });

  // Back to parent level after nesting.
  test("return to parent level after nesting", async () => {
    const input = ". First\n.. Nested\n. Second\n";
    await expectFormatted(input, input);
  });

  // List item text is reflowed within printWidth.
  test("long list item text is reflowed", async () => {
    const input =
      ". This is a very long list item that should be reflowed because it exceeds the default print width of eighty characters in total\n";
    const result = await formatAdoc(input);
    // Should be reflowed (wrapped) — verify it contains a
    // newline within the item.
    const lines = result.split("\n");
    // First line starts with ., continuation lines are indented
    expect(lines[0].startsWith(". ")).toBe(true);
    // At least 2 lines + trailing newline
    expect(lines.length).toBeGreaterThan(2);
  });
});
