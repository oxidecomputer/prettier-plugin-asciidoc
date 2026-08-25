import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { ParentBlockNode } from "../../src/ast.js";
import { narrow } from "../../src/narrow.js";

/**
 * Extracts the first child as a ParentBlockNode. Throws
 * if it is not a parent block, surfacing test setup
 * errors early with a clear message.
 * @param children - parsed document children array
 * @returns the first child narrowed to ParentBlockNode
 */
function firstParentBlock(
  children: ReturnType<typeof parse>["children"],
): ParentBlockNode {
  const [block] = children;
  narrow(block, "parentBlock");
  return block;
}

describe("example block parsing", () => {
  // Basic example block with paragraph content.
  test("basic example block", () => {
    const { children } = parse("====\nSome content.\n====\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty example block (no content between delimiters).
  test("empty example block", () => {
    const { children } = parse("====\n====\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(0);
  });

  // Example block with multiple paragraphs separated by
  // blank lines.
  test("multiple inner paragraphs", () => {
    const { children } = parse(
      "====\nFirst paragraph.\n\nSecond paragraph.\n====\n",
    );
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(2);
    expect(block.children[0].type).toBe("paragraph");
    expect(block.children[1].type).toBe("paragraph");
  });

  // 6-character example delimiter: confirms any repeat length
  // >= 4 is accepted, not just exactly 4.
  test("extended delimiter length", () => {
    const { children } = parse("======\nContent.\n======\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });
});

describe("sidebar block parsing", () => {
  // Basic sidebar block with paragraph content.
  test("basic sidebar block", () => {
    const { children } = parse("****\nSidebar content.\n****\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty sidebar block.
  test("empty sidebar block", () => {
    const { children } = parse("****\n****\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(0);
  });

  // Sidebar block with multiple inner paragraphs.
  test("multiple inner paragraphs", () => {
    const { children } = parse("****\nFirst.\n\nSecond.\n****\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(2);
  });
});

describe("open block parsing", () => {
  // Basic open block with paragraph content.
  test("basic open block", () => {
    const { children } = parse("--\nOpen content.\n--\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty open block.
  test("empty open block", () => {
    const { children } = parse("--\n--\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(0);
  });

  // Open block with multiple inner paragraphs.
  test("multiple inner paragraphs", () => {
    const { children } = parse("--\nFirst.\n\nSecond.\n--\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(2);
  });
});

describe("quote block parsing", () => {
  // Basic quote block with paragraph content.
  test("basic quote block", () => {
    const { children } = parse("____\nQuoted text.\n____\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty quote block.
  test("empty quote block", () => {
    const { children } = parse("____\n____\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(0);
  });

  // Quote block with multiple inner paragraphs.
  test("multiple inner paragraphs", () => {
    const { children } = parse("____\nFirst.\n\nSecond.\n____\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(2);
  });
});

describe("parent block context", () => {
  // Parent block between paragraphs.
  test("between paragraphs", () => {
    const { children } = parse("Before.\n\n====\nInside.\n====\n\nAfter.\n");
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("parentBlock");
    expect(children[2].type).toBe("paragraph");
  });

  // Position tracking: all three fields (line, column, offset)
  // on the open delimiter's start position are verified.
  test("position tracking", () => {
    const { children } = parse("====\nContent.\n====\n");
    const block = firstParentBlock(children);
    expect(block.position.start.line).toBe(1);
    expect(block.position.start.column).toBe(1);
    expect(block.position.start.offset).toBe(0);
  });

  // Nested parent blocks: example inside sidebar.
  test("nested parent blocks", () => {
    const { children } = parse("****\n====\nNested content.\n====\n****\n");
    const outer = firstParentBlock(children);
    expect(outer.variant).toBe("sidebar");
    expect(outer.children).toHaveLength(1);
    const inner = firstParentBlock(outer.children);
    expect(inner.variant).toBe("example");
    const { children: innerChildren } = inner;
    expect(innerChildren).toHaveLength(1);
    expect(innerChildren[0]).toHaveProperty("type", "paragraph");
  });

  // A listing block (leaf) inside a parent block.
  test("leaf block inside parent block", () => {
    const { children } = parse("====\n----\ncode\n----\n====\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("delimitedBlock");
  });
});

describe("delimiter length matching", () => {
  // The close delimiter must be exactly the same length as the
  // open delimiter. A shorter delimiter is NOT the close —
  // it opens a nested block of the same type instead.
  test("example block close must match open length", () => {
    // Open with 5 `=`, attempt close with 4 `=` — the 4-char
    // line is not the close delimiter for the outer block.
    // Instead it opens a nested example block. The second
    // `====` immediately closes that nested block (empty),
    // leaving the outer 5-char block unclosed.
    const { children } = parse("=====\nContent.\n====\n====\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    // Children: paragraph("Content.") + nested empty example
    expect(block.children).toHaveLength(2);
    expect(block.children[0].type).toBe("paragraph");
    expect(block.children[1].type).toBe("parentBlock");
  });

  // Open with 5 `*`, attempt close with 4 `*` — the 4-char
  // line opens a nested sidebar. The second `****` closes
  // that nested block (empty), leaving the outer unclosed.
  test("sidebar block close must match open length", () => {
    const { children } = parse("*****\nContent.\n****\n****\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("sidebar");
    // Children: paragraph("Content.") + nested empty sidebar
    expect(block.children).toHaveLength(2);
    expect(block.children[0].type).toBe("paragraph");
    expect(block.children[1].type).toBe("parentBlock");
  });

  // Open with 5 `_`, attempt close with 4 `_` — the 4-char
  // line opens a nested quote. The second `____` closes
  // that nested block (empty), leaving the outer unclosed.
  test("quote block close must match open length", () => {
    const { children } = parse("_____\nContent.\n____\n____\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("quote");
    // Children: paragraph("Content.") + nested empty quote
    expect(block.children).toHaveLength(2);
    expect(block.children[0].type).toBe("paragraph");
    expect(block.children[1].type).toBe("parentBlock");
  });

  // Matching delimiter lengths work as expected.
  test("matching 5-char example delimiters", () => {
    const { children } = parse("=====\nContent.\n=====\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  test("matching 5-char sidebar delimiters", () => {
    const { children } = parse("*****\nContent.\n*****\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  test("matching 5-char quote delimiters", () => {
    const { children } = parse("_____\nContent.\n_____\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Nested same-type blocks with different delimiter lengths.
  // Outer uses 6-char, inner uses 4-char.
  test("nested same-type example blocks", () => {
    const { children } = parse("======\n====\nNested content.\n====\n======\n");
    expect(children).toHaveLength(1);
    const outer = firstParentBlock(children);
    expect(outer.variant).toBe("example");
    expect(outer.children).toHaveLength(1);
    const inner = firstParentBlock(outer.children);
    expect(inner.variant).toBe("example");
    expect(inner.children).toHaveLength(1);
    expect(inner.children[0].type).toBe("paragraph");
  });

  // Open blocks use a fixed `--` delimiter (not a repeating
  // pattern), so delimiter-length matching doesn't apply.
  // This test confirms open blocks parse correctly alongside
  // the variable-length example/sidebar/quote blocks.
  test("open blocks are unaffected", () => {
    const { children } = parse("--\nContent.\n--\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });
});
