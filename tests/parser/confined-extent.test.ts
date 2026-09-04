/**
 * The confined-extent family (issue #44): an unterminated
 * verbatim block whose forced close is a CONFINED stream end lost its
 * final content byte to `boundary - NEWLINE_LENGTH` arithmetic — at a
 * confined close the subtracted byte is a CONTENT byte, not a line
 * terminator. These rows assert the FIXED `content` and, against
 * base-measured literals (594dc598, 2026-08-22), that `position.end`
 * did NOT move: the fix is the content value and the formatted bytes
 * only. Six verbatim roles × three confined sites; the must-not-change
 * controls ride below. The corpus holds zero such extents (invariant
 * (xii)'s zero-violation run is the proof), so these fixtures are the
 * family's only mechanical home for the confined positions.
 */
import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import { preorder } from "./ast-walk.js";
import { replayTable, tableNodes } from "./table-nodes.js";

/**
 * The first source-sliced verbatim node in a parse — a delimited
 * block or a block comment — wherever it nests. Walks with the
 * invariant suite's own `preorder`, so "first" means the same thing
 * here as it does there and the traversal stays cast-free.
 * @param source - the document
 * @returns the node's content (or comment value) and end offset
 */
function firstVerbatim(source: string): { content: string; end: number } {
  for (const node of preorder(parse(source))) {
    const verbatim =
      node.type === "delimitedBlock" ||
      (node.type === "comment" && node.commentType === "block");
    const content = node.content ?? node.value;
    if (verbatim && typeof content === "string") {
      return { content, end: node.position.end.offset };
    }
  }
  throw new Error(`no verbatim node in ${JSON.stringify(source)}`);
}

/**
 * The same two facts for the first TABLE in a parse. A table holds no
 * `content` slice - its bytes are its own records - so the row's
 * literal is compared against the REPLAY of those records
 * (tests/parser/table-nodes.ts), which is the string a table's own
 * bytes have to spell for it to have kept them. The literals and the
 * end offsets are the base-measured ones this file's header names,
 * unchanged: what a confined forced close ends at is the property
 * these rows exist for, and it does not depend on how the bytes
 * inside are recorded.
 * @param source - the document
 * @returns the table's replayed bytes and end offset
 */
function firstTable(source: string): { content: string; end: number } {
  const table = tableNodes(parse(source)).at(0);
  if (table === undefined) {
    throw new Error(`no table in ${JSON.stringify(source)}`);
  }
  return { content: replayTable(table), end: table.position.end.offset };
}

describe("confined-extent: content is whole, position.end does not move", () => {
  // [name, input, FIXED content, base-measured end offset]
  const rows: Array<[string, string, string, number]> = [
    ["listing / item", "* item\n+\n----\nfoo\n\nafter\n", "foo\n\nafter", 24],
    [
      "listing / nested item",
      "* a\n** b\n+\n----\nfoo\n\nafter\n",
      "foo\n\nafter",
      26,
    ],
    [
      "listing / item -> unterminated compound",
      "* item\n+\n====\n----\nfoo\n",
      "foo",
      22,
    ],
    ["literal / item", "* item\n+\n....\nfoo\n\nafter\n", "foo\n\nafter", 24],
    [
      "literal / nested item",
      "* a\n** b\n+\n....\nfoo\n\nafter\n",
      "foo\n\nafter",
      26,
    ],
    [
      "literal / item -> unterminated compound",
      "* item\n+\n====\n....\nfoo\n",
      "foo",
      22,
    ],
    ["pass / item", "* item\n+\n++++\nfoo\n\nafter\n", "foo\n\nafter", 24],
    [
      "pass / nested item",
      "* a\n** b\n+\n++++\nfoo\n\nafter\n",
      "foo\n\nafter",
      26,
    ],
    [
      "pass / item -> unterminated compound",
      "* item\n+\n====\n++++\nfoo\n",
      "foo",
      22,
    ],
    ["fence / item", "* item\n+\n```\nfoo\n\nafter\n", "foo\n\nafter", 23],
    [
      "fence / nested item",
      "* a\n** b\n+\n```\nfoo\n\nafter\n",
      "foo\n\nafter",
      25,
    ],
    [
      "fence / item -> unterminated compound",
      "* item\n+\n====\n```\nfoo\n",
      "foo",
      21,
    ],
    ["comment block / item", "* item\n+\n////\nx\n\nafter\n", "x\n\nafter", 22],
    [
      "comment block / nested item",
      "* a\n** b\n+\n////\nx\n\nafter\n",
      "x\n\nafter",
      24,
    ],
    [
      "comment block / item -> unterminated compound",
      "* item\n+\n====\n////\nx\n",
      "x",
      20,
    ],
  ];
  test.each(rows)("%s", (_name, input, content, end) => {
    expect(firstVerbatim(input)).toEqual({ content, end });
  });

  // The same three sites for a table, whose bytes are its records
  // rather than a slice: same inputs, same literals, same end
  // offsets, read through {@link firstTable}.
  test.each([
    ["table / item", "* item\n+\n|===\n|a\n\nafter\n", "|===\n|a\n\nafter", 23],
    [
      "table / nested item",
      "* a\n** b\n+\n|===\n|a\n\nafter\n",
      "|===\n|a\n\nafter",
      25,
    ],
    [
      "table / item -> unterminated compound",
      "* item\n+\n====\n|===\n|a\n",
      "|===\n|a",
      21,
    ],
  ] as Array<[string, string, string, number]>)(
    "%s",
    (_name, input, content, end) => {
      expect(firstTable(input)).toEqual({ content, end });
    },
  );

  // The must-not-change AST controls: document-level EOF,
  // outer-terminator forced close, table-in-closed-example. Base-
  // measured; identical before and after the fix.
  test.each([
    ["document-level EOF", "----\nfoo\n", "foo", 9],
    ["outer-terminator forced close", "====\n----\nfoo\n====\n", "foo", 14],
  ] as Array<[string, string, string, number]>)(
    "%s is unchanged",
    (_name, input, content, end) => {
      expect(firstVerbatim(input)).toEqual({ content, end });
    },
  );

  test("a table in a closed example is unchanged", () => {
    expect(firstTable("====\n|===\n|a\n====\n")).toEqual({
      content: "|===\n|a",
      end: 13,
    });
  });
});
