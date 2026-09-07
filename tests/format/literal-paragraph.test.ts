import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

describe("literal paragraph formatting", () => {
  // Single indented line preserved verbatim.
  test("single indented line preserved", async () => {
    const input = " indented text\n";
    await expectFormatted(input, input);
  });

  // Multiple indented lines preserved with their indentation.
  test("multiple indented lines preserved", async () => {
    const input = " line one\n line two\n line three\n";
    await expectFormatted(input, input);
  });

  // Varying indentation preserved exactly.
  test("varying indentation preserved", async () => {
    const input = "  two spaces\n    four spaces\n one space\n";
    await expectFormatted(input, input);
  });

  // Blank line separation between paragraph and literal paragraph.
  test("blank line between paragraph and literal paragraph", async () => {
    const input = "Some text.\n\n indented code\n";
    await expectFormatted(input, input);
  });

  // Blank line separation between literal paragraph and paragraph.
  test("blank line between literal paragraph and paragraph", async () => {
    const input = " indented code\n\nSome text.\n";
    await expectFormatted(input, input);
  });

  // Literal paragraph between two regular paragraphs.
  test("between paragraphs", async () => {
    const input = "Before.\n\n  indented code\n  more code\n\nAfter.\n";
    await expectFormatted(input, input);
  });
});
