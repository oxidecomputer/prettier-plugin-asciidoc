/**
 * Direct tables for list-reader.ts's pure functions whose edges
 * whole-document parses reach only obliquely: listShape's sibling
 * walk (the port of `parse_list`, parser.rb l.1115-1129), gapsOf's
 * verbatim read (and its unreachable arm), and gapGlyph's
 * budget-aware spelling.
 *
 * listShape is a SHAPE scan and nothing more — it decides extents and
 * parses no item's interior — so these rows read markers, buffers and
 * the resume index. What the items BECOME is pinned by the reader and
 * format suites.
 */
import { describe, expect, test } from "vitest";
import type { BlockNode, GapLine } from "../../src/ast.js";
import { BLOCK_START_CONTEXT } from "../../src/parse/line-shapes.js";
import { classifyLine } from "../../src/parse/lines/classify.js";
import { gapsOf, listShape } from "../../src/parse/lines/list-reader.js";
import { splitLines, type SourceLine } from "../../src/parse/lines/split.js";
import { gapGlyph } from "./reader-helpers.js";

/**
 * Scan the list a document opens with, the way the document reader
 * does: from line 0, with the stream end EOF (tailSafe).
 * @param source - the whole document; its first line is the marker
 * @returns each item's marker text and buffer, and the resume index
 */
function shapeOf(source: string): {
  items: Array<{ marker: string; buffer: string[] }>;
  end: number;
} {
  const lines: readonly SourceLine[] = splitLines(source);
  const opening = classifyLine(lines[0].text, BLOCK_START_CONTEXT);
  if (opening.kind !== "listMarker") {
    throw new Error(`not a marker line: ${JSON.stringify(lines[0].text)}`);
  }
  const shape = listShape(lines, 0, opening, {
    tailSafe: true,
    gaps: new Map(),
  });
  return {
    items: shape.items.map((item) => ({
      marker: item.markerLine.text,
      buffer: item.buffer.map((line) => line.text),
    })),
    end: shape.end,
  };
}

describe("listShape walks siblings and stops at anything else", () => {
  test("one item per sibling marker, in source order", () => {
    expect(shapeOf("* a\n* b\n* c\n")).toEqual({
      items: [
        { marker: "* a", buffer: [] },
        { marker: "* b", buffer: [] },
        { marker: "* c", buffer: [] },
      ],
      end: 3,
    });
  });

  test("a marker of another style is no sibling — it nests INSIDE the item", () => {
    // `is_sibling_list_item?` is style equality, so `. b` cannot open
    // a second item here; `read_lines_for_list_item` keeps it in the
    // buffer, where the item's own reader opens the nested list.
    expect(shapeOf("* a\n. b\n")).toEqual({
      items: [{ marker: "* a", buffer: [". b"] }],
      end: 2,
    });
  });

  test("a plain line after a blank ends both the item and the list", () => {
    expect(shapeOf("* a\n\ntext\n")).toEqual({
      items: [{ marker: "* a", buffer: [] }],
      end: 2,
    });
  });

  test("a lone marker line is a whole list — items is never empty", () => {
    expect(shapeOf("* a\ntext\n").items).toHaveLength(1);
  });

  test("each item carries its own buffer and the list resumes past it", () => {
    // `+` attaches the paragraph to the first item; the blank run
    // before `* b` is consumed by the item's own extent scan, so the
    // sibling loop never sees a blank line (see listShape's comment).
    expect(shapeOf("* a\n+\npara\n\n* b\nmore\n")).toEqual({
      items: [
        { marker: "* a", buffer: ["", "para"] },
        { marker: "* b", buffer: ["more"] },
      ],
      end: 6,
    });
  });

  test("a trailing `+` that attached nothing leaves the buffer empty", () => {
    expect(shapeOf("* a\n+\n").items[0].buffer).toEqual([]);
  });

  test("every sibling's marker is parsed from ITS OWN line", () => {
    // The loop's `siblingMarker` answers with the parse, so the second
    // item's indent and markerEnd are the second LINE's — the fragment
    // the printer spells the marker from. Copying the opening's parse
    // forward would put this item's text at column 3.
    const lines: readonly SourceLine[] = splitLines("* a\n  * b\n");
    const opening = classifyLine(lines[0].text, BLOCK_START_CONTEXT);
    if (opening.kind !== "listMarker") throw new Error("not a marker line");
    const shape = listShape(lines, 0, opening, {
      tailSafe: true,
      gaps: new Map(),
    });
    expect(shape.items.map((item) => item.marker)).toEqual([
      {
        kind: "listMarker",
        variant: "unordered",
        style: "*",
        indent: 0,
        markerEnd: 2,
      },
      {
        kind: "listMarker",
        variant: "unordered",
        style: "*",
        indent: 2,
        markerEnd: 4,
      },
    ]);
  });
});

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
  // The record for "* a\n+\n\npara\n\n  lit\n": the scan erased the
  // `+` on line 2 and consumed the blanks on lines 3 and 5.
  const record = new Map<number, GapLine>([
    [2, "+"],
    [3, ""],
    [5, ""],
  ]);
  test.each<[string, number, BlockNode[], GapLine[][]]>([
    ["adjacent block: empty gap", 1, [blockAt(2, 2)], [[]]],
    ["+ then blank before the block", 1, [blockAt(4, 4)], [["+", ""]]],
    [
      "two blocks: each gap counts from the previous block's end",
      1,
      [blockAt(4, 4), blockAt(6, 6)],
      [["+", ""], [""]],
    ],
    // Both ends exclusive: a line recorded ON the previous piece's last
    // line is that piece's own, so it opens no gap.
    ["an entry ON the boundary is in no gap", 2, [blockAt(4, 4)], [[""]]],
  ])("%s", (_name, textEnd, blocks, expected) => {
    expect(gapsOf(record, textEnd, blocks)).toEqual(expected);
  });

  test("entries come back in line order whatever order they were recorded", () => {
    const outOfOrder = new Map<number, GapLine>([
      [3, ""],
      [2, "+"],
    ]);
    expect(gapsOf(outOfOrder, 1, [blockAt(4, 4)])).toEqual([["+", ""]]);
  });

  test("a line nothing recorded is not in any gap", () => {
    // A hole in the record shortens the gap silently — the degrade
    // gapsOf documents; parity and idempotence are the nets for it.
    const holey = new Map<number, GapLine>([[2, "+"]]);
    expect(gapsOf(holey, 1, [blockAt(4, 4)])).toEqual([["+"]]);
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
