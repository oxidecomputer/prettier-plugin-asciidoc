import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("listing block formatting", () => {
  // Canonical listing block passes through unchanged.
  test("basic listing block preserved", async () => {
    const input = "----\nsome code\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multi-line content preserved verbatim (no reflowing).
  test("multi-line content preserved", async () => {
    const input = "----\nline 1\nline 2\nline 3\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty listing block preserved.
  test("empty listing block preserved", async () => {
    const input = "----\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended delimiters are normalized to exactly 4 characters.
  test("delimiter length normalized to 4", async () => {
    const input = "------\ncode\n------\n";
    const expected = "----\ncode\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Formatting characters inside listing blocks are NOT reflowed.
  test("formatting chars preserved verbatim", async () => {
    const input = "----\n*bold* _italic_ `mono`\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Blank line separation between paragraph and listing block.
  test("blank line between paragraph and listing block", async () => {
    const input = "Some text.\n\n----\ncode\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Blank line separation between listing block and paragraph.
  test("blank line between listing block and paragraph", async () => {
    const input = "----\ncode\n----\n\nSome text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Smart minimization: the inner `----` (4 chars) conflicts
  // with a 4-char delimiter, so output uses 5-char delimiters.
  test("extended delimiters with inner shorter delimiter", async () => {
    const input = "------\n----\nstill inside\n------\n";
    const expected = "-----\n----\nstill inside\n-----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });
});

describe("literal block formatting", () => {
  // Basic literal block preserved.
  test("basic literal block preserved", async () => {
    const input = "....\nsome text\n....\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty literal block preserved.
  test("empty literal block preserved", async () => {
    const input = "....\n....\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended literal delimiters normalized to 4.
  test("delimiter length normalized to 4", async () => {
    const input = "......\ntext\n......\n";
    const expected = "....\ntext\n....\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Smart minimization for literal blocks.
  test("extended delimiters with inner shorter delimiter", async () => {
    const input = "......\n....\nstill inside\n......\n";
    const expected = ".....\n....\nstill inside\n.....\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Regression: content inside a literal block that is entirely
  // whitespace is dropped — Prettier trims trailing whitespace
  // per line, so whitespace-only content would become blank
  // lines that re-parse as an empty block.
  test("whitespace-only content treated as empty", async () => {
    const input = "========\n....\n      ";
    expect(await formatAdoc(input)).toBe("====\n....\n....\n====\n");
  });

  // Regression: a close delimiter that is a prefix of a content
  // line must not match. `....x` inside a `....`-delimited
  // literal block should stay as content, not split the block.
  test("close delimiter requires full line match", async () => {
    const input = ".....\n....x\n";
    // `....x` is content, not the terminator, so the block runs to end of
    // input and the printer closes it directly under its last line.
    const out = await formatAdoc(input);
    expect(out).toBe("....\n....x\n....\n");
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("passthrough block formatting", () => {
  // Basic passthrough block preserved.
  test("basic passthrough block preserved", async () => {
    const input = "++++\n<div>raw</div>\n++++\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty passthrough block preserved.
  test("empty passthrough block preserved", async () => {
    const input = "++++\n++++\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended passthrough delimiters normalized to 4.
  test("delimiter length normalized to 4", async () => {
    const input = "++++++\n<p>text</p>\n++++++\n";
    const expected = "++++\n<p>text</p>\n++++\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Smart minimization for passthrough blocks.
  test("extended delimiters with inner shorter delimiter", async () => {
    const input = "++++++\n++++\nstill inside\n++++++\n";
    const expected = "+++++\n++++\nstill inside\n+++++\n";
    expect(await formatAdoc(input)).toBe(expected);
  });
});
