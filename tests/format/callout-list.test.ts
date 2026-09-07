import { describe, test, expect } from "vitest";
import { expectFormatted, formatAdoc } from "../helpers.js";

describe("callout list formatting", () => {
  // Canonical single-item callout list passes through unchanged.
  test("single callout item preserved", async () => {
    const input = "<1> First item\n";
    await expectFormatted(input, input);
  });

  // Multi-item callout list preserved.
  test("multi-item callout list preserved", async () => {
    const input = "<1> First\n<2> Second\n<3> Third\n";
    await expectFormatted(input, input);
  });

  // Auto-numbered `<.>` marker preserved.
  test("auto-numbered callout preserved", async () => {
    const input = "<.> Auto item\n";
    await expectFormatted(input, input);
  });

  // The formatter preserves callout numbers exactly — it does
  // not renumber them sequentially.
  test("callout number preserved (not renumbered)", async () => {
    const input = "<3> Third\n<7> Seventh\n";
    await expectFormatted(input, input);
  });

  // One blank line before a callout list when preceded by a
  // paragraph.
  test("blank line between paragraph and callout list", async () => {
    const input = "Some text.\n\n<1> Item\n";
    await expectFormatted(input, input);
  });

  // One blank line after a callout list when followed by a
  // paragraph.
  test("blank line between callout list and paragraph", async () => {
    const input = "<1> Item\n\nSome text.\n";
    await expectFormatted(input, input);
  });

  // Multiple blank lines between a paragraph and callout list
  // are collapsed to one.
  test("multiple blank lines collapsed", async () => {
    const input = "Some text.\n\n\n\n<1> Item\n";
    const expected = "Some text.\n\n<1> Item\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Multi-digit callout numbers preserved.
  test("multi-digit callout number preserved", async () => {
    const input = "<12> Twelfth item\n";
    await expectFormatted(input, input);
  });

  // A callout list can mix explicit numbers and auto-numbered
  // `<.>` markers.
  test("mixed numbered and auto-numbered callout items", async () => {
    const input = "<1> First\n<.> Auto\n<3> Third\n";
    await expectFormatted(input, input);
  });

  // Long callout item text is reflowed within printWidth.
  test("long callout item text reflowed", async () => {
    const input =
      "<1> This is a very long callout list item that should be reflowed because it exceeds the default print width of eighty characters in total\n";
    const result = await formatAdoc(input);
    const lines = result.split("\n");
    expect(lines[0].startsWith("<1> ")).toBe(true);
    expect(lines.length).toBeGreaterThan(2);
  });
});
