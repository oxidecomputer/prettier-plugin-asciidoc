/**
 * The b44-confined-extent family (spec D4; issue #44): an unterminated
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

describe("b44-confined-extent: content is whole, position.end does not move", () => {
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
  ];
  test.each(rows)("%s", (_name, input, content, end) => {
    expect(firstVerbatim(input)).toEqual({ content, end });
  });

  // The must-not-change AST controls (spec D4): document-level EOF,
  // outer-terminator forced close, table-in-closed-example. Base-
  // measured; identical before and after the fix.
  test.each([
    ["document-level EOF", "----\nfoo\n", "foo", 9],
    ["outer-terminator forced close", "====\n----\nfoo\n====\n", "foo", 14],
    ["table in a closed example", "====\n|===\n|a\n====\n", "|===\n|a", 13],
  ] as Array<[string, string, string, number]>)(
    "%s is unchanged",
    (_name, input, content, end) => {
      expect(firstVerbatim(input)).toEqual({ content, end });
    },
  );
});
