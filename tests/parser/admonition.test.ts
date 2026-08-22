/**
 * Parser tests for admonition blocks.
 *
 * AsciiDoc has five admonition types: NOTE, TIP, IMPORTANT,
 * CAUTION, WARNING. They appear in two forms:
 *
 * **Paragraph form** — a label prefix on a paragraph:
 *   `NOTE: This is a note.`
 *
 * **Block form** — an attribute list on a parent block:
 *   `[NOTE]\n====\nContent.\n====`
 *
 * Paragraph-form admonitions produce `AdmonitionNode` directly
 * from the reader (`BlockReader.admonition`). Block-form
 * admonitions are recognized by
 * the post-parse `convertParagraphFormBlocks` transform, which
 * converts `BlockAttributeList + ParentBlock` pairs to
 * `AdmonitionNode` with `form: "delimited"`. The original
 * `blockAttributeList` node is retained as a preceding
 * sibling so attribute metadata is not lost.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { AdmonitionNode } from "../../src/ast.js";
import { narrow } from "../../src/unreachable.js";

/**
 * Extracts the child at the given index as an
 * AdmonitionNode. Throws if the node at that position is
 * not an admonition, surfacing test setup errors early.
 * @param children - parsed document children array
 * @param index - position of the expected admonition
 * @returns the child narrowed to AdmonitionNode
 */
function admonitionAt(
  children: ReturnType<typeof parse>["children"],
  index: number,
): AdmonitionNode {
  const { [index]: block } = children;
  narrow(block, "admonition");
  return block;
}

describe("paragraph-form admonitions", () => {
  test("NOTE: produces admonition with variant note", () => {
    const { children } = parse("NOTE: This is a note.\n");
    expect(children).toHaveLength(1);
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("note");
    expect(node.form).toBe("paragraph");
    expect(node.content).toBe("This is a note.");
    expect(node.children).toHaveLength(0);
    expect(node.delimiter).toBeUndefined();
  });

  test("TIP: produces admonition with variant tip", () => {
    const { children } = parse("TIP: Here is a tip.\n");
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("tip");
    expect(node.form).toBe("paragraph");
    expect(node.content).toBe("Here is a tip.");
  });

  test("IMPORTANT: produces admonition with variant important", () => {
    const { children } = parse("IMPORTANT: Do not forget.\n");
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("important");
    expect(node.form).toBe("paragraph");
    expect(node.content).toBe("Do not forget.");
  });

  test("CAUTION: produces admonition with variant caution", () => {
    const { children } = parse("CAUTION: Watch out.\n");
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("caution");
    expect(node.form).toBe("paragraph");
    expect(node.content).toBe("Watch out.");
  });

  test("WARNING: produces admonition with variant warning", () => {
    const { children } = parse("WARNING: Be careful.\n");
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("warning");
    expect(node.form).toBe("paragraph");
    expect(node.content).toBe("Be careful.");
  });

  // Continuation lines (no blank line between them) are joined
  // into a single content string separated by \n — the same
  // joining rule that applies to regular paragraphs.
  test("multi-line paragraph-form admonition", () => {
    const { children } = parse("NOTE: First line\nsecond line\nthird line\n");
    expect(children).toHaveLength(1);
    const node = admonitionAt(children, 0);
    expect(node.variant).toBe("note");
    expect(node.content).toBe("First line\nsecond line\nthird line");
  });

  test("position tracking for paragraph-form admonition", () => {
    const { children } = parse("NOTE: Hello.\n");
    const node = admonitionAt(children, 0);
    expect(node.position.start.line).toBe(1);
    expect(node.position.start.column).toBe(1);
    expect(node.position.start.offset).toBe(0);
    // "NOTE: Hello." is 12 chars; end offset is exclusive
    expect(node.position.end.line).toBe(1);
    expect(node.position.end.column).toBe(13);
    expect(node.position.end.offset).toBe(12);
  });

  test("paragraph-form admonition between paragraphs", () => {
    const { children } = parse("Before.\n\nNOTE: A note.\n\nAfter.\n");
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("admonition");
    expect(children[2].type).toBe("paragraph");
  });
});

describe("block-form admonitions (example block)", () => {
  test("[NOTE] + example block produces delimited admonition", () => {
    const { children } = parse("[NOTE]\n====\nContent.\n====\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
    expect(node.form).toBe("delimited");
    expect(node.delimiter).toBe("example");
    expect(node.content).toBeUndefined();
    expect(node.children.length).toBeGreaterThan(0);
  });

  test("[TIP] + example block", () => {
    const { children } = parse("[TIP]\n====\nA tip.\n====\n");
    expect(children).toHaveLength(2);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("tip");
    expect(node.form).toBe("delimited");
    expect(node.delimiter).toBe("example");
  });

  test("[IMPORTANT] + example block", () => {
    const { children } = parse("[IMPORTANT]\n====\nDo not forget.\n====\n");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("important");
  });

  test("[CAUTION] + example block", () => {
    const { children } = parse("[CAUTION]\n====\nWatch out.\n====\n");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("caution");
  });

  test("[WARNING] + example block", () => {
    const { children } = parse("[WARNING]\n====\nBe careful.\n====\n");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("warning");
  });

  test("block-form admonition with multiple paragraphs", () => {
    const { children } = parse(
      "[NOTE]\n====\nFirst paragraph.\n\nSecond paragraph.\n====\n",
    );
    expect(children).toHaveLength(2);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
    expect(node.children).toHaveLength(2);
    expect(node.children[0].type).toBe("paragraph");
    expect(node.children[1].type).toBe("paragraph");
  });
});

describe("block-form admonitions (open block)", () => {
  test("[CAUTION] + open block", () => {
    const { children } = parse("[CAUTION]\n--\nContent.\n--\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("caution");
    expect(node.form).toBe("delimited");
    expect(node.delimiter).toBe("open");
  });

  test("[NOTE] + open block with multiple paragraphs", () => {
    const { children } = parse("[NOTE]\n--\nFirst.\n\nSecond.\n--\n");
    expect(children).toHaveLength(2);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
    expect(node.delimiter).toBe("open");
    expect(node.children).toHaveLength(2);
  });
});

describe("admonition edge cases", () => {
  // Non-admonition attribute lists followed by parent blocks
  // should remain as regular parent blocks.
  test("[#myid] + example block is NOT an admonition", () => {
    const { children } = parse("[#myid]\n====\nContent.\n====\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    expect(children[1].type).toBe("parentBlock");
  });

  // Lowercase admonition types in attribute lists should also
  // be recognized (AsciiDoc typically uses uppercase, but
  // getAdmonitionVariant normalizes the style to uppercase
  // before matching, so [note] and [NOTE] are equivalent).
  test("[note] lowercase in attribute list is recognized", () => {
    const { children } = parse("[note]\n====\nContent.\n====\n");
    expect(children).toHaveLength(2);
    const node = admonitionAt(children, 1);
    expect(node.variant).toBe("note");
  });

  // Any single uppercase alphabetic word in an attribute list
  // becomes a custom admonition variant. The regex used by
  // getAdmonitionVariant is /^[A-Z]+$/, so hyphenated names
  // (e.g. MY-TYPE) do not match. This mirrors AsciiDoc's
  // convention for custom admonition types.
  test("[EXERCISE] + example block is a custom admonition", () => {
    const { children } = parse("[EXERCISE]\n====\nContent.\n====\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const [, child1] = children;
    narrow(child1, "admonition");
    expect(child1.variant).toBe("exercise");
    expect(child1.form).toBe("delimited");
  });
});
