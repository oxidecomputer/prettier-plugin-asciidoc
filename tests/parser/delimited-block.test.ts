import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstDelimitedBlock } from "../helpers.js";

// Listing blocks use verbatim content (no inline parsing),
// are closed by a same-length delimiter, and trigger a lexer
// mode switch to capture raw text.
describe("listing block parsing", () => {
  // The simplest listing block: `----` delimiters around content.
  test("basic listing block", () => {
    const { children } = parse("----\nsome code\n----\n");
    expect(children).toHaveLength(1);
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("some code");
  });

  // Multi-line content is preserved verbatim.
  test("multi-line listing block", () => {
    const { children } = parse("----\nline 1\nline 2\nline 3\n----\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("line 1\nline 2\nline 3");
  });

  // Empty listing block (no content between delimiters).
  test("empty listing block", () => {
    const { children } = parse("----\n----\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("");
  });

  // Listing block with extended delimiters (more than 4 dashes).
  test("extended delimiter length", () => {
    const { children } = parse("------\ncode\n------\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("code");
  });

  // A shorter delimiter inside an extended block must NOT close
  // it — AsciiDoc requires open/close lengths to match exactly.
  test("shorter delimiter inside extended block is content", () => {
    const { children } = parse("------\n----\nstill inside\n------\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("----\nstill inside");
  });

  // Inline formatting characters are NOT special inside listing
  // blocks — they are preserved verbatim.
  test("formatting chars preserved verbatim", () => {
    const { children } = parse("----\n*bold* _italic_ `mono`\n----\n");
    const block = firstDelimitedBlock(children);
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("*bold* _italic_ `mono`");
  });

  // Other delimiter types inside a listing block are treated as
  // content, not as delimiters: the reader's verbatim frame ends only
  // at its OWN terminator, so nothing else is even classified.
  test("other delimiters inside listing are content", () => {
    const { children } = parse("----\n....\ncontent\n++++\n----\n");
    const block = firstDelimitedBlock(children);
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("....\ncontent\n++++");
  });
});

describe("literal block parsing", () => {
  // Basic literal block with `....` delimiters.
  test("basic literal block", () => {
    const { children } = parse("....\nsome text\n....\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("literal");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("some text");
  });

  // Empty literal block.
  test("empty literal block", () => {
    const { children } = parse("....\n....\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("literal");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("");
  });

  // Listing delimiters inside a literal block are content.
  test("listing delimiters inside literal are content", () => {
    const { children } = parse("....\n----\nstuff\n----\n....\n");
    const block = firstDelimitedBlock(children);
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("----\nstuff\n----");
  });

  // A shorter literal delimiter inside an extended block is
  // content, not a close delimiter.
  test("shorter delimiter inside extended block is content", () => {
    const { children } = parse("......\n....\nstill inside\n......\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("literal");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("....\nstill inside");
  });
});

describe("passthrough block parsing", () => {
  // Basic passthrough block with `++++` delimiters.
  test("basic passthrough block", () => {
    const { children } = parse("++++\n<div>raw</div>\n++++\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("pass");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("<div>raw</div>");
  });

  // Empty passthrough block.
  test("empty passthrough block", () => {
    const { children } = parse("++++\n++++\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("pass");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("");
  });

  // A shorter passthrough delimiter inside an extended block is
  // content, not a close delimiter.
  test("shorter delimiter inside extended block is content", () => {
    const { children } = parse("++++++\n++++\nstill inside\n++++++\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("pass");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("++++\nstill inside");
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
