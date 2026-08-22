/**
 * `build/delimited.ts` — delimited blocks to nodes.
 *
 * Table-driven because the module is `(extent, index) → node` with no
 * context: the rows are the specification. They pin which delimiter
 * means which variant, the content slice (which stops BEFORE the
 * newline that precedes the terminator), and the three ways a block
 * can end — on its own terminator, on the outer terminator that took
 * its line, and at the document's end.
 */
import { describe, expect, test } from "vitest";
import {
  buildParentBlock,
  buildVerbatimBlock,
  type BlockExtent,
} from "../../../src/parse/build/delimited.js";
import { makeLocationIndex } from "../../../src/parse/positions.js";

/**
 * A block that met its own terminator, in a document that is nothing
 * but that block.
 * @param open - the opening delimiter, at offset 0
 * @param content - the lines between the delimiters
 * @param close - the closing delimiter
 * @returns the extent, and the index of the document it describes
 */
function closedExtent(
  open: string,
  content: string,
  close: string,
): { extent: BlockExtent; at: ReturnType<typeof makeLocationIndex> } {
  const source = `${open}\n${content}\n${close}\n`;
  return {
    extent: {
      open: { image: open, offset: 0 },
      close: { image: close, offset: open.length + content.length + 2 },
      unclosed: undefined,
      source,
    },
    at: makeLocationIndex(source),
  };
}

describe("buildVerbatimBlock variants", () => {
  test.each([
    ["----", "listing"],
    ["....", "literal"],
    ["++++", "pass"],
  ])("%j opens a %j block", (open, variant) => {
    const { extent, at } = closedExtent(open, "code", open);
    expect(buildVerbatimBlock(extent, at)).toEqual({
      type: "delimitedBlock",
      variant,
      form: "delimited",
      content: "code",
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 14, line: 3, column: 5 },
      },
    });
  });

  test("a fence with a language hint is a listing block that knows it", () => {
    const { extent, at } = closedExtent("```rust", "code", "```");
    expect(buildVerbatimBlock(extent, at)).toMatchObject({
      type: "delimitedBlock",
      variant: "listing",
      content: "code",
      fenced: true,
      language: "rust",
    });
  });

  test("a bare fence is fenced with no language", () => {
    const { extent, at } = closedExtent("```", "code", "```");
    const node = buildVerbatimBlock(extent, at);
    expect(node).toMatchObject({ variant: "listing", fenced: true });
    expect("language" in node).toBe(false);
  });

  test("`////` is a block comment, not a delimited block", () => {
    const { extent, at } = closedExtent("////", "hidden", "////");
    expect(buildVerbatimBlock(extent, at)).toEqual({
      type: "comment",
      commentType: "block",
      value: "hidden",
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 16, line: 3, column: 5 },
      },
    });
  });
});

describe("buildVerbatimBlock content", () => {
  test("keeps the blank lines inside, and stops before the terminator", () => {
    const { extent, at } = closedExtent("----", "a\n\nb", "----");
    expect(buildVerbatimBlock(extent, at)).toMatchObject({ content: "a\n\nb" });
  });

  test("an empty block has empty content", () => {
    const source = "----\n----\n";
    const node = buildVerbatimBlock(
      {
        open: { image: "----", offset: 0 },
        close: { image: "----", offset: 5 },
        unclosed: undefined,
        source,
      },
      makeLocationIndex(source),
    );
    expect(node).toMatchObject({ content: "" });
  });

  test("a block forced shut at EOF takes everything after its opener", () => {
    const source = "----\ncode\n";
    const node = buildVerbatimBlock(
      {
        open: { image: "----", offset: 0 },
        close: undefined,
        unclosed: { image: "", offset: source.length },
        source,
      },
      makeLocationIndex(source),
    );
    expect(node).toMatchObject({
      content: "code",
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 10, line: 3, column: 1 },
      },
    });
  });

  // The document's final newline is a line terminator, not content:
  // without one, the last character IS content and the block keeps it.
  test("a block forced shut at EOF without a final newline keeps its last character", () => {
    const source = "----\ncode";
    const node = buildVerbatimBlock(
      {
        open: { image: "----", offset: 0 },
        close: undefined,
        unclosed: { image: "", offset: source.length },
        source,
      },
      makeLocationIndex(source),
    );
    expect(node).toMatchObject({
      content: "code",
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 9, line: 2, column: 5 },
      },
    });
  });

  // Recovery alone leaves BOTH boundaries undefined; that reads as EOF,
  // the same as a block whose forced-close boundary sits at the end.
  test("a block with neither a terminator nor a forced-close boundary ends at EOF", () => {
    const source = "----\ncode\n";
    const node = buildVerbatimBlock(
      {
        open: { image: "----", offset: 0 },
        close: undefined,
        unclosed: undefined,
        source,
      },
      makeLocationIndex(source),
    );
    expect(node).toMatchObject({
      content: "code",
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 10, line: 3, column: 1 },
      },
    });
  });

  test("a block forced shut by an outer terminator ends at that line", () => {
    const source = "====\n----\ncode\n====\n";
    const node = buildVerbatimBlock(
      {
        open: { image: "----", offset: 5 },
        close: undefined,
        unclosed: { image: "", offset: 15 },
        source,
      },
      makeLocationIndex(source),
    );
    expect(node).toMatchObject({
      content: "code",
      position: {
        start: { offset: 5, line: 2, column: 1 },
        end: { offset: 15, line: 4, column: 1 },
      },
    });
  });
});

describe("buildParentBlock", () => {
  test("holds the children the reader put inside it", () => {
    const { extent, at } = closedExtent("====", "text", "====");
    const node = buildParentBlock(extent, "example", [], at);
    expect(node).toMatchObject({
      type: "parentBlock",
      variant: "example",
      children: [],
    });
  });

  test.each(["example", "sidebar", "open", "quote"] as const)(
    "carries the %j variant through",
    (variant) => {
      const { extent, at } = closedExtent("====", "text", "====");
      expect(buildParentBlock(extent, variant, [], at).variant).toBe(variant);
    },
  );
});

describe("buildParentBlock end position", () => {
  const source = "====\ntext\n";
  const at = makeLocationIndex(source);
  const open = { image: "====", offset: 0 };

  test("a block that met its terminator ends on it", () => {
    const closed = "====\ntext\n====\n";
    const node = buildParentBlock(
      {
        open,
        close: { image: "====", offset: 10 },
        unclosed: undefined,
        source: closed,
      },
      "example",
      [],
      makeLocationIndex(closed),
    );
    expect(node.position.end).toEqual({ offset: 14, line: 3, column: 5 });
  });

  test("a block forced shut at EOF ends at the document end", () => {
    const node = buildParentBlock(
      {
        open,
        close: undefined,
        unclosed: { image: "", offset: source.length },
        source,
      },
      "example",
      [],
      at,
    );
    expect(node.position.end).toEqual({ offset: 10, line: 3, column: 1 });
  });

  test("a block forced shut by an outer terminator ends at that line", () => {
    const nested = "====\n--\nx\n====\n";
    const node = buildParentBlock(
      {
        open: { image: "--", offset: 5 },
        close: undefined,
        unclosed: { image: "", offset: 10 },
        source: nested,
      },
      "open",
      [],
      makeLocationIndex(nested),
    );
    expect(node.position.end).toEqual({ offset: 10, line: 4, column: 1 });
  });

  // The bug this replaces, stated so it cannot come back: a parent
  // block that does not start at offset 0 used to END at offset 0.
  test("no parent block ends before it starts", () => {
    const unclosed = "para\n====\ntext\n";
    const node = buildParentBlock(
      {
        open: { image: "====", offset: 5 },
        close: undefined,
        unclosed: { image: "", offset: 15 },
        source: unclosed,
      },
      "example",
      [],
      makeLocationIndex(unclosed),
    );
    expect(node.position.end.offset).toBeGreaterThanOrEqual(
      node.position.start.offset,
    );
    expect(node.position.end).toEqual({ offset: 15, line: 4, column: 1 });
  });
});
