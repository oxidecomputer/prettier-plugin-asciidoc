import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import { expectFormatted, firstDelimitedBlock } from "../helpers.js";

describe("literal paragraph formatting", () => {
  // Single indented line preserved verbatim.
  test("single indented line preserved", async () => {
    const input = " indented text\n";
    await expectFormatted(input, input);
    // A single line beginning with a space is recognised as a literal
    // paragraph (form: "indented"). The leading space is part of the
    // content — indentation is semantically significant in literal
    // blocks and must be preserved verbatim.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("literal");
    expect(block.form).toBe("indented");
    expect(block.content).toBe(" indented text");
    // The literal block node's start position covers the leading space:
    // line 1, column 1, offset 0. Column is 1-based and is NOT 2 even
    // though the content begins with a space — the position represents
    // the start of the block in the source, not the first non-space
    // character.
    expect(block.position.start.line).toBe(1);
    expect(block.position.start.column).toBe(1);
    expect(block.position.start.offset).toBe(0);
    // " indented text" is 14 chars; end offset is exclusive
    expect(block.position.end.line).toBe(1);
    expect(block.position.end.column).toBe(15);
    expect(block.position.end.offset).toBe(14);
  });

  // Multiple indented lines preserved with their indentation.
  test("multiple indented lines preserved", async () => {
    const input = " line one\n line two\n line three\n";
    await expectFormatted(input, input);
    // Multiple consecutive indented lines form a single literal block.
    // They are joined by the absence of a blank line between them —
    // the same rule that merges regular paragraph lines. Each line's
    // indentation is preserved verbatim in the content string.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("literal");
    expect(block.form).toBe("indented");
    expect(block.content).toBe(" line one\n line two\n line three");
  });

  // Varying indentation preserved exactly.
  test("varying indentation preserved", async () => {
    const input = "  two spaces\n    four spaces\n one space\n";
    await expectFormatted(input, input);
    // Indentation depth varies line-to-line: 2 spaces, 4 spaces, then
    // 1 space. All three lines still belong to the same block (no blank
    // lines separate them), and each line's exact leading whitespace is
    // preserved — even the minimum-indent line (1 space) is not stripped.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = firstDelimitedBlock(children);
    expect(block.content).toBe("  two spaces\n    four spaces\n one space");
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
