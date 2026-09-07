import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstDelimitedBlock } from "../helpers.js";

// Tests for the indented form of literal blocks (one or more lines
// beginning with a space) and — as a contrast case — the delimited
// `....` form. The paragraph form (`[literal]` + plain paragraph) is
// covered in tests/format/paragraph-form-blocks.test.ts.
describe("literal paragraph and delimited literal block parsing", () => {
  // A blank line terminates the literal block. Text after the blank
  // line is not indented, so it parses as a regular paragraph —
  // verifying that the block boundary is correct and the two nodes
  // are independent siblings.
  test("blank line ends literal paragraph", () => {
    const { children } = parse(" indented\n\nregular paragraph\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("delimitedBlock");
    expect(children[1].type).toBe("paragraph");
    const block = firstDelimitedBlock(children);
    expect(block.content).toBe(" indented");
  });

  // A literal block surrounded by regular paragraphs. Both blank-line
  // boundaries are respected: the first blank line closes the opening
  // paragraph, the second closes the literal block. All three nodes
  // are independent siblings in the document children array.
  test("between regular paragraphs", () => {
    const { children } = parse("Before.\n\n  indented\n\nAfter.\n");
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("delimitedBlock");
    expect(children[2].type).toBe("paragraph");
  });

  // A `....` delimited block produces variant "literal" with
  // form "delimited" — distinguishing it from an indented literal
  // paragraph (form "indented") and a paragraph-form literal
  // ([literal] + paragraph, form "paragraph"). The three forms share
  // the same variant but differ in how the content was expressed in
  // source, which the printer uses to decide how to reformat.
  test("delimited literal block has form delimited", () => {
    const { children } = parse("....\nsome text\n....\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("literal");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("some text");
  });
});
