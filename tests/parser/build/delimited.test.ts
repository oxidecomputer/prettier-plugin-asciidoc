/**
 * `build/delimited.ts` — delimited blocks to nodes.
 *
 * Table-driven because the module is `(extent, …, index) → node` with
 * no context: the rows are the specification. They pin which role
 * builds which variant, the content slice (which stops BEFORE the
 * newline that precedes the terminator), and the three ways a block
 * can end — on its own terminator, on the outer terminator that took
 * its line, and at the document's end.
 *
 * A verbatim block's ROLE is decided at OPEN by `lines/open-style.ts`
 * and handed straight to the builder with the extent, so
 * these rows hand the builder the role a reader would: the delimiter
 * in the extent is bytes to slice, not a decision to re-derive. The
 * extent itself states both offsets — `contentEnd`, always a line's
 * own raw end, and `end`, the node's — so these literals spell what
 * the reader's one packaging site produces, not a boundary encoding
 * the builder has to decode.
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
  const closeOffset = open.length + content.length + 2;
  return {
    extent: {
      open: { image: open, offset: 0 },
      close: { image: close, offset: closeOffset },
      // The last interior line's raw end is the character before the
      // newline that precedes the close line; the node ends past the
      // close line's raw end.
      contentEnd: closeOffset - 1,
      end: closeOffset + close.length,
      source,
    },
    at: makeLocationIndex(source),
  };
}

// The role a bare `----` opener resolves to — the one every content
// row below is measured with.
const LISTING_ROLE = { builds: "leafBlock", variant: "listing" } as const;

// The role a Markdown backtick fence resolves to, before the reader
// completes it with the opening line's language hint.
const FENCE_ROLE = { builds: "fencedBlock" } as const;

describe("buildVerbatimBlock variants", () => {
  test.each([
    ["----", "listing"],
    ["....", "literal"],
    ["++++", "pass"],
  ] as const)("%j opens a %j block", (open, variant) => {
    const { extent, at } = closedExtent(open, "code", open);
    expect(
      buildVerbatimBlock(extent, { builds: "leafBlock", variant }, at),
    ).toEqual({
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
    const role = { ...FENCE_ROLE, language: "rust" } as const;
    expect(buildVerbatimBlock(extent, role, at)).toMatchObject({
      type: "delimitedBlock",
      variant: "listing",
      content: "code",
      fenced: true,
      language: "rust",
    });
  });

  test("a bare fence is fenced with no language", () => {
    const { extent, at } = closedExtent("```", "code", "```");
    const node = buildVerbatimBlock(extent, FENCE_ROLE, at);
    expect(node).toMatchObject({ variant: "listing", fenced: true });
    expect("language" in node).toBe(false);
  });

  test("`////` is a block comment, not a delimited block", () => {
    const { extent, at } = closedExtent("////", "hidden", "////");
    expect(buildVerbatimBlock(extent, { builds: "comment" }, at)).toEqual({
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
    expect(buildVerbatimBlock(extent, LISTING_ROLE, at)).toMatchObject({
      content: "a\n\nb",
    });
  });

  test("an empty block has empty content", () => {
    const source = "----\n----\n";
    const node = buildVerbatimBlock(
      {
        open: { image: "----", offset: 0 },
        close: { image: "----", offset: 5 },
        contentEnd: 4,
        end: 9,
        source,
      },
      LISTING_ROLE,
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
        contentEnd: 9,
        end: source.length,
        source,
      },
      LISTING_ROLE,
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
        contentEnd: 9,
        end: source.length,
        source,
      },
      LISTING_ROLE,
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

  test("a block forced shut by an outer terminator ends at that line", () => {
    const source = "====\n----\ncode\n====\n";
    const node = buildVerbatimBlock(
      {
        open: { image: "----", offset: 5 },
        close: undefined,
        contentEnd: 14,
        end: 15,
        source,
      },
      LISTING_ROLE,
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
      { open, end: 14 },
      "example",
      [],
      makeLocationIndex(closed),
    );
    expect(node.position.end).toEqual({ offset: 14, line: 3, column: 5 });
  });

  test("a block forced shut at EOF ends at the document end", () => {
    const node = buildParentBlock(
      { open, end: source.length },
      "example",
      [],
      at,
    );
    expect(node.position.end).toEqual({ offset: 10, line: 3, column: 1 });
  });

  test("a block forced shut by an outer terminator ends at that line", () => {
    const nested = "====\n--\nx\n====\n";
    const node = buildParentBlock(
      { open: { image: "--", offset: 5 }, end: 10 },
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
      { open: { image: "====", offset: 5 }, end: 15 },
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
