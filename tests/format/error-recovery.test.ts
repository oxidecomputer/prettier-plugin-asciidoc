import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

// TOTALITY, at the formatter's edge: `formatAdoc` returns a string
// for every input. It may not produce the output a human would
// choose, but it must produce one rather than throwing. (The file
// keeps its name so its history stays findable.)
describe("format totality", () => {
  // Plain text with no AsciiDoc constructs should format as-is.
  test("plain prose formats without throwing", async () => {
    const input = "Just some regular text.\n";
    const result = await formatAdoc(input);
    expect(result).toContain("Just some regular text.");
  });

  // An unclosed listing block should not crash the formatter.
  // The output should preserve the input content in some form.
  test("unclosed listing block formats without throwing", async () => {
    const input = "----\nsome code\nmore code\n";
    const result = await formatAdoc(input);
    expect(result).toContain("some code");
  });

  // An unclosed literal block should not crash the formatter.
  test("unclosed literal block formats without throwing", async () => {
    const input = "....\nliteral content\n";
    const result = await formatAdoc(input);
    expect(result).toContain("literal content");
  });

  // An unclosed pass block should not crash the formatter.
  test("unclosed pass block formats without throwing", async () => {
    const input = "++++\npass content\n";
    const result = await formatAdoc(input);
    expect(result).toContain("pass content");
  });

  // Mixed recognized and unrecognized constructs should
  // format without throwing and preserve key content.
  test("mixed constructs format without throwing", async () => {
    const input = [
      "= Title",
      "",
      "A paragraph.",
      "",
      "````unknown-fence",
      "some content",
      "````",
      "",
      "Another paragraph.",
      "",
    ].join("\n");
    const result = await formatAdoc(input);
    expect(result).toContain("Title");
    expect(result).toContain("A paragraph.");
    expect(result).toContain("Another paragraph.");
  });

  // Unclosed block comment should not crash.
  test("unclosed block comment formats without throwing", async () => {
    const input = "////\ncomment content\n";
    const result = await formatAdoc(input);
    expect(result).toBeDefined();
  });

  // Unclosed example block should not crash.
  test("unclosed example block formats without throwing", async () => {
    const input = "====\nexample content\n";
    const result = await formatAdoc(input);
    expect(result).toContain("example content");
  });

  // Unclosed sidebar block should not crash.
  test("unclosed sidebar block formats without throwing", async () => {
    const input = "****\nsidebar content\n";
    const result = await formatAdoc(input);
    expect(result).toContain("sidebar content");
  });

  // Unclosed quote block should not crash.
  test("unclosed quote block formats without throwing", async () => {
    const input = "____\nquote content\n";
    const result = await formatAdoc(input);
    expect(result).toContain("quote content");
  });

  // Unclosed open block should not crash.
  test("unclosed open block formats without throwing", async () => {
    const input = "--\nopen block content\n";
    const result = await formatAdoc(input);
    expect(result).toContain("open block content");
  });
});
