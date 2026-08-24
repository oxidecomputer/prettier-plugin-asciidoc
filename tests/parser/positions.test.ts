/**
 * The document's offset→Location index — the one place that knows how
 * lines are counted, now that per-token line/column
 * bookkeeping is gone.
 *
 * The END convention is the load-bearing part and it is NOT "the
 * location of the exclusive end offset": the AST has always spelled
 * an exclusive end as the LAST character's line and column, plus one
 * (positions.ts has documented that since it was extracted from the
 * AST builder). A text run that ends at a line break therefore
 * reports its end on the line the break is on, not at column 1 of the
 * next line — see the same case pinned in
 * tests/parser/ast-invariants.ts. Computing it any other way changes
 * every such node's position and breaks parity.
 */
import { describe, expect, test } from "vitest";
import { splitLines } from "../../src/parse/lines/split.js";
import { makeLocationIndex } from "../../src/parse/positions.js";

describe("makeLocationIndex", () => {
  const source = "ab\ncd\n";
  const at = makeLocationIndex(source);

  test.each([
    [0, { offset: 0, line: 1, column: 1 }],
    [1, { offset: 1, line: 1, column: 2 }],
    [2, { offset: 2, line: 1, column: 3 }],
    [3, { offset: 3, line: 2, column: 1 }],
    [6, { offset: 6, line: 3, column: 1 }],
  ])("offset %i", (offset, expected) => {
    expect(at.at(offset)).toEqual(expected);
  });

  test("an exclusive end is the last character's position, plus one column", () => {
    expect(at.end({ image: "ab", offset: 0 })).toEqual({
      offset: 2,
      line: 1,
      column: 3,
    });
    // The newline case: end offset 3 is on line 2, but the end is
    // reported on line 1 — one past the `\n` it consumed.
    expect(at.end({ image: "ab\n", offset: 0 })).toEqual({
      offset: 3,
      line: 1,
      column: 4,
    });
  });

  // A span whose INTERIOR crosses a line break, which is not the
  // same case as one that ends at a break: the end lands on the LAST
  // line. This shape was measured off the old lexer — an
  // inline macro's or bare URL's attrlist is `[^\]]*`, which does not
  // exclude `\n`, so `xref:a[multi\nline label]` is ONE token over
  // two lines. Traced against the old lexer's token-instance
  // convention (the since-deleted inline bridge's `inlineInstance`),
  // which this index inherited: for `"ab\ncd"` at offset 0 the head is
  // `"ab\nc"`, so the old lexer reported endLine 2 / endColumn 2 (the
  // `d`), and the exclusive end adds one column.
  test("a span that crosses a line break ends on its LAST line", () => {
    expect(at.end({ image: "ab\ncd", offset: 0 })).toEqual({
      offset: 5,
      line: 2,
      column: 3,
    });
  });

  // `start` is the plain offset lookup, but it is a separate export
  // and the builders call it far more often than `at`; a row here
  // stops a future `start` that quietly returned the END from
  // passing.
  test("a span starts at its own offset", () => {
    expect(at.start({ image: "cd", offset: 3 })).toEqual({
      offset: 3,
      line: 2,
      column: 1,
    });
  });

  test("a zero-length span ends where it starts", () => {
    expect(at.end({ image: "", offset: 3 })).toEqual(
      at.start({ image: "", offset: 3 }),
    );
  });

  test("the document end is one past the last character, for both spellings", () => {
    expect(makeLocationIndex("a\n").at(2)).toEqual({
      offset: 2,
      line: 2,
      column: 1,
    });
    expect(makeLocationIndex("a").at(1)).toEqual({
      offset: 1,
      line: 1,
      column: 2,
    });
    expect(makeLocationIndex("").at(0)).toEqual({
      offset: 0,
      line: 1,
      column: 1,
    });
  });
});

describe("splitLines and LocationIndex share one line numbering", () => {
  test("every line's number agrees with the index at its offset", () => {
    const source = "a\n\nbb\n  ccc\nd";
    const at = makeLocationIndex(source);
    for (const line of splitLines(source)) {
      expect(at.at(line.offset).line).toBe(line.line);
    }
  });
});
