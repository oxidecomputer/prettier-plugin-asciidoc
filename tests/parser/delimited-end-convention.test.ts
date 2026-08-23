/**
 * The one end-position convention every delimited close obeys (spec
 * D4, the Q3 floor): a closed block ends past its terminator line's
 * RAW end; a block forced shut by an outer terminator ends at that
 * line's START; a block forced shut by EOF ends at the document
 * length. Landed at the plan parent BEFORE the extent-first rewrite,
 * so the rewrite's one-formula spelling (`at.at(extent.end)`) is
 * pinned against today's two spellings across every close kind ×
 * final-newline choice, plus the trailing-whitespace terminator.
 * Values measured at 594dc598.
 */
import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/unreachable.js";
import type { BlockNode, DelimitedBlockNode } from "../../src/ast.js";

/**
 * The first listing node in a parse: a document child, or a child of
 * a parent block (the two places this table's rows put one). No
 * section traversal on purpose — the rows carry no headings, and the
 * helper must survive plan β's Task 4 (which deletes the section
 * kind) without an edit.
 * @param source - the document
 * @returns the listing node
 */
function firstListing(source: string): DelimitedBlockNode {
  const queue: BlockNode[] = [...parse(source).children];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    if (node.type === "delimitedBlock" && node.variant === "listing") {
      return node;
    }
    if (node.type === "parentBlock") queue.push(...node.children);
  }
  throw new Error(`no listing in ${JSON.stringify(source)}`);
}

describe("delimited end positions: one convention across every close kind", () => {
  // [name, source, content, end {offset, line, column}]
  const rows: Array<
    [string, string, string, { offset: number; line: number; column: number }]
  > = [
    [
      "terminator close, final newline",
      "----\nfoo\n----\n",
      "foo",
      { offset: 13, line: 3, column: 5 },
    ],
    [
      "terminator close, no final newline",
      "----\nfoo\n----",
      "foo",
      { offset: 13, line: 3, column: 5 },
    ],
    [
      "forced by an outer terminator, final newline",
      "====\n----\nfoo\n====\n",
      "foo",
      { offset: 14, line: 4, column: 1 },
    ],
    [
      "forced by an outer terminator, no final newline",
      "====\n----\nfoo\n====",
      "foo",
      { offset: 14, line: 4, column: 1 },
    ],
    [
      "forced by EOF, final newline",
      "----\nfoo\n",
      "foo",
      { offset: 9, line: 3, column: 1 },
    ],
    [
      "forced by EOF, no final newline",
      "----\nfoo",
      "foo",
      { offset: 8, line: 2, column: 4 },
    ],
    [
      "terminator with trailing whitespace: end is the RAW end",
      "----\nfoo\n----   \n",
      "foo",
      { offset: 16, line: 3, column: 8 },
    ],
  ];
  test.each(rows)("%s", (_name, source, content, end) => {
    const listing = firstListing(source);
    expect(listing.content).toBe(content);
    expect(listing.position.end).toEqual(end);
  });

  test("the enclosing example's own end is past ITS close line (the two-offsets convention, spec D2)", () => {
    const source = "====\n----\nfoo\n====\n";
    const [example] = parse(source).children;
    narrow(example, "parentBlock");
    // The listing's forced end is 14 (the terminator line's START,
    // asserted above); the example's own end is 18 (past the line's
    // raw end). One producer each.
    expect(example.position.end.offset).toBe(18);
  });
});
