/**
 * Direct tables for the two pure functions the cut-over added whose
 * edges whole-document parses reach only obliquely: gapsOf's verbatim
 * read (and its unreachable arm), and gapGlyph's budget-aware
 * spelling.
 */
import { describe, expect, test } from "vitest";
import type { BlockNode, GapLine } from "../../src/ast.js";
import { gapsOf } from "../../src/parse/lines/list-reader.js";
import { splitLines } from "../../src/parse/lines/split.js";
import { gapGlyph } from "./reader-helpers.js";

/**
 * A minimal positioned block for gapsOf (only positions are read).
 * @param startLine - the 1-based line the block starts on
 * @param endLine - the 1-based line it ends on
 * @returns the block
 */
function blockAt(startLine: number, endLine: number): BlockNode {
  return {
    type: "paragraph",
    children: [],
    position: {
      start: { offset: 0, line: startLine, column: 1 },
      end: { offset: 0, line: endLine, column: 1 },
    },
  };
}

describe("gapsOf", () => {
  const lines = splitLines("* a\n+\n\npara\n\n  lit\n");
  test.each<[string, number, BlockNode[], GapLine[][]]>([
    ["adjacent block: empty gap", 1, [blockAt(2, 2)], [[]]],
    ["+ then blank before the block", 1, [blockAt(4, 4)], [["+", ""]]],
    [
      "two blocks: each gap counts from the previous block's end",
      1,
      [blockAt(4, 4), blockAt(6, 6)],
      [["+", ""], [""]],
    ],
  ])("%s", (_name, textEnd, blocks, expected) => {
    expect(gapsOf(lines, textEnd, blocks)).toEqual(expected);
  });

  test("a content line inside a gap is unreachable — a reader bug, not an input", () => {
    const withContent = splitLines("* a\ncontent\npara\n");
    expect(() => gapsOf(withContent, 1, [blockAt(3, 3)])).toThrow(
      "list-item gap holds",
    );
  });
});

describe("gapGlyph reproduces every pinned spelling", () => {
  test.each<[readonly GapLine[], string]>([
    [[], "-"],
    [["+"], "+"],
    [["+", ""], "+"], // one trailing blank: the + still attached
    [["+", "", ""], "~"], // two: the budget erased it
    [[""], "~"],
    [["", ""], "~"],
    [["", "+"], "~+"],
    [["", "", "+"], "~+"],
    [["", "+", "", "+"], "~++"], // stacked detached
    [["+", "", "+"], "~++"], // dead + then a detached one
  ])("%j → %s", (gap, expected) => {
    expect(gapGlyph(gap)).toBe(expected);
  });
});
