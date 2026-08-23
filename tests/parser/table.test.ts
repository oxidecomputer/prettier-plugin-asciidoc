import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import { astShape } from "./reader-helpers.js";
import type { DelimitedBlockNode } from "../../src/ast.js";

/**
 * The first table node in a parse, for the extent rows below.
 * @param source - the document
 * @returns the table node
 */
function firstTable(source: string): DelimitedBlockNode {
  const node = parse(source).children.find(
    (child) => child.type === "delimitedBlock" && child.variant === "table",
  );
  if (node?.type !== "delimitedBlock") {
    throw new Error(`no table in ${JSON.stringify(source)}`);
  }
  return node;
}

// Spec D1: tables are opaque verbatim extents. The delimiter lines are
// part of `content`; behavior is Ruby's is_delimited_block? +
// read_lines_until (parser.rb:967-1001, :861-869, reader.rb:414),
// pinned here and in tests/format/table.test.ts.
describe("table delimiters open verbatim table blocks", () => {
  test("a |=== table is one node, delimiters included in content", () => {
    expect(astShape("|===\n|a |b\n\n|c |d\n|===\n")).toBe("table[5]");
    expect(firstTable("|===\n|a |b\n\n|c |d\n|===\n").content).toBe(
      "|===\n|a |b\n\n|c |d\n|===",
    );
  });

  test.each([
    ["psv", "|===\n|a\n|===\n"],
    ["csv", ",===\na,b\n,===\n"],
    ["dsv", ":===\na:b\n:===\n"],
    ["nested-psv", "!===\n!a\n!===\n"],
  ])("%s delimiter opens and closes a table", (_name, source) => {
    expect(astShape(source)).toBe("table[3]");
  });

  test("a paragraph is interrupted by a table delimiter (StartOfBlockProc parity)", () => {
    expect(astShape("para\n|===\n|a\n|===\n")).toBe("p(t) table[3]");
  });

  test("the terminator is the exact rstripped opening line: |==== inside |=== is content", () => {
    // Oracle-probed (Task 1): the table stays open to EOF; `after` is
    // table content, not a paragraph.
    expect(astShape("|===\n|a\n|====\n\nafter\n")).toBe("table[5]");
  });

  test("|==== opens a table that |==== closes", () => {
    expect(astShape("|====\n|a\n|====\n")).toBe("table[3]");
  });

  test("an unterminated table runs to EOF (Ruby also runs to EOF, parser.rb:863)", () => {
    expect(astShape("|===\n|a |b\n")).toBe("table[2]");
    expect(firstTable("|===\n|a |b\n").content).toBe("|===\n|a |b");
  });

  test("|=| is not a table delimiter (oracle-probed paragraph)", () => {
    expect(astShape("|=|\n")).toBe("p(t)");
  });

  test("held metadata stays sibling nodes above the table", () => {
    expect(astShape('[cols="1,1"]\n.Title\n|===\n|a\n|===\n')).toBe(
      "attrs title table[3]",
    );
  });

  // Invariant (x)'s position tie, pinned directly per close kind.
  test("terminator close: end offset is start + content length", () => {
    const node = firstTable("|===\n|a\n|=== \n");
    expect(node.position.end.offset).toBe(
      node.position.start.offset + node.content.length,
    );
  });

  test("forced close: end exceeds the content end by at most one character", () => {
    const node = firstTable("|===\n|a\n");
    const over =
      node.position.end.offset -
      (node.position.start.offset + node.content.length);
    expect(over === 0 || over === 1).toBe(true);
  });
});
