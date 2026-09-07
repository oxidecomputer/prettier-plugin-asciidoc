import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstDelimitedBlock } from "../helpers.js";

// Listing blocks use verbatim content (no inline parsing) and are
// closed by a same-length delimiter; the reader slices their raw text
// straight out of the source rather than classifying it.
describe("listing block parsing", () => {
  // Other delimiter types inside a listing block are treated as
  // content, not as delimiters: the extent scan collected at the
  // opening line ends only at its OWN terminator, and an interior line
  // is never classified at all.
  test("other delimiters inside listing are content", () => {
    const { children } = parse("----\n....\ncontent\n++++\n----\n");
    const block = firstDelimitedBlock(children);
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("....\ncontent\n++++");
  });
});

describe("literal block parsing", () => {
  // Listing delimiters inside a literal block are content.
  test("listing delimiters inside literal are content", () => {
    const { children } = parse("....\n----\nstuff\n----\n....\n");
    const block = firstDelimitedBlock(children);
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("----\nstuff\n----");
  });
});

describe("delimited block context", () => {
  // Delimited block between paragraphs. AsciiDoc requires at least
  // one blank line before and after the block to prevent it from
  // being consumed as paragraph continuation.
  test("between paragraphs", () => {
    const { children } = parse(
      "Before paragraph.\n\n----\ncode here\n----\n\nAfter paragraph.\n",
    );
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("delimitedBlock");
    expect(children[2].type).toBe("paragraph");
  });

  // Position tracking: the node starts at the opening delimiter.
  // line and column are 1-based; offset is 0-based (see Location in
  // ast.ts). Only the start is asserted here; end position testing
  // is covered by dedicated position tests in other suites.
  test("position tracking", () => {
    const { children } = parse("----\ncode\n----\n");
    const block = firstDelimitedBlock(children);
    expect(block.position.start.line).toBe(1);
    expect(block.position.start.column).toBe(1);
    expect(block.position.start.offset).toBe(0);
    // "----\ncode\n----" = 14 chars; close delimiter ends at
    // line 3, column 4; exclusive end is offset 14, column 5.
    expect(block.position.end.line).toBe(3);
    expect(block.position.end.column).toBe(5);
    expect(block.position.end.offset).toBe(14);
  });
});
