import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import { astShape } from "./reader-helpers.js";
import type { TableNode } from "../../src/ast.js";
import { allowsOverhang, replayTable } from "./table-nodes.js";

/**
 * The first table node in a parse, for the rows below.
 * @param source - the document
 * @returns the table node
 */
function firstTable(source: string): TableNode {
  const node = parse(source).children.find((child) => child.type === "table");
  if (node?.type !== "table") {
    throw new Error(`no table in ${JSON.stringify(source)}`);
  }
  return node;
}

// A table is a node of its own, with the delimiter lines as its own
// fields and the interior cut into cells; behavior is Ruby's
// is_delimited_block? + parse_table (parser.rb:976-1010, :870-878,
// :2295-2422) over the lines `read_lines_until` collected
// (reader.rb:414), pinned here and in tests/format/table.test.ts.
describe("table delimiters open table nodes", () => {
  test("a |=== table is one node whose rows hold its cells", () => {
    const source = "|===\n|a |b\n\n|c |d\n|===\n";
    expect(astShape(source)).toBe("table[2]");
    const node = firstTable(source);
    expect(node.children.map((row) => row.children.length)).toEqual([2, 2]);
    expect(node.cutting).toEqual({ format: "psv", separator: "|" });
    expect(node.close).toEqual({ kind: "delimiter", image: "|===" });
  });

  test.each([
    ["psv", "|===\n|a\n|===\n", "psv", "|"],
    ["csv", ",===\na,b\n,===\n", "csv", ","],
    ["dsv", ":===\na:b\n:===\n", "dsv", ":"],
    // A top-level `!===` cuts on `|`, not on `!`: Ruby takes the `!`
    // separator only where the document is nested, and the `xsv` key
    // that branch sets is what indexes `DELIMITERS` into `@delimiter`
    // and `delimiter_rx` (table.rb:466-474).
    ["nested-psv", "!===\n!a\n!===\n", "psv", "|"],
  ])(
    "%s delimiter opens and closes a table",
    (_name, source, format, separator) => {
      expect(astShape(source)).toBe("table[1]");
      expect(firstTable(source).cutting).toEqual({ format, separator });
    },
  );

  test("format= overrides the hint character, and an illegal one is psv", () => {
    expect(firstTable("[format=csv]\n|===\na,b\n|===\n").cutting).toEqual({
      format: "csv",
      separator: ",",
    });
    // tsv is csv with a tab separator (table.rb:461-463).
    expect(firstTable("[format=tsv]\n|===\na\tb\n|===\n").cutting).toEqual({
      format: "csv",
      separator: "\t",
    });
    // The hint is NOT the fallback: Ruby logs and takes psv outright
    // (table.rb:467-470).
    expect(firstTable("[format=bogus]\n,===\na,b\n,===\n").cutting).toEqual({
      format: "psv",
      separator: "|",
    });
  });

  test("separator= names the cut, and an empty one falls back", () => {
    expect(firstTable("[separator=;]\n|===\n;a;b\n|===\n").cutting).toEqual({
      format: "psv",
      separator: ";",
    });
    expect(firstTable("[separator=]\n|===\n|a\n|===\n").cutting).toEqual({
      format: "psv",
      separator: "|",
    });
  });

  test("cols= fixes the column count that closes a row", () => {
    const node = firstTable('[cols="1,1"]\n|===\n|a |b |c |d\n|===\n');
    expect(node.columns?.length).toBe(2);
    expect(node.children.map((row) => row.children.length)).toEqual([2, 2]);
  });

  test("the header and footer options are read from both spellings", () => {
    expect(firstTable("[%header]\n|===\n|a\n|===\n").header).toBe("explicit");
    expect(firstTable('[options="header"]\n|===\n|a\n|===\n').header).toBe(
      "explicit",
    );
    expect(firstTable("[%footer]\n|===\n|a\n|===\n").footer).toBe(true);
    expect(firstTable("|===\n|a\n\n|b\n|===\n").header).toBe("implicit");
    expect(firstTable("[%noheader]\n|===\n|a\n\n|b\n|===\n").header).toBe(
      "none",
    );
  });

  test("a paragraph is interrupted by a table delimiter (StartOfBlockProc parity)", () => {
    expect(astShape("para\n|===\n|a\n|===\n")).toBe("p(t) table[1]");
  });

  test("the terminator is the exact rstripped opening line: |==== inside |=== is content", () => {
    // Oracle-probed: the table stays open to EOF; `after` is
    // table content, not a paragraph.
    expect(astShape("|===\n|a\n|====\n\nafter\n")).toBe("table[2]");
  });

  test("|==== opens a table that |==== closes", () => {
    expect(astShape("|====\n|a\n|====\n")).toBe("table[1]");
  });

  test("an unterminated table runs to EOF (Ruby also runs to EOF, parser.rb:872)", () => {
    expect(astShape("|===\n|a |b\n")).toBe("table[1]");
    expect(firstTable("|===\n|a |b\n").close).toEqual({ kind: "endOfStream" });
  });

  test("|=| is not a table delimiter (oracle-probed paragraph)", () => {
    expect(astShape("|=|\n")).toBe("p(t)");
  });

  test("held metadata stays sibling nodes above the table", () => {
    expect(astShape('[cols="1,1"]\n.Title\n|===\n|a\n|===\n')).toBe(
      "attrs title table[1]",
    );
  });

  // Invariant (xv)'s partition, pinned per close kind and per
  // interior shape: a table's records account for every byte of its
  // extent, and what its position may name past them is exactly what
  // its close kind allows (`allowsOverhang`) - nothing at all on a
  // terminator close, at most the final newline on a forced one. The
  // two blank-interior rows are the pair the record of a zero-byte
  // line exists for (`appendWholeLine`,
  // src/parse/lines/table-reader.ts): without it the empty table and
  // the blank-line table replay alike, and one of the two loses a
  // line.
  test.each([
    ["a closed table", "|===\n|a\n|=== \n"],
    ["a table with an empty interior", "|===\n|===\n"],
    ["a table whose interior is one blank line", "|===\n\n|===\n"],
    ["a table whose last interior line is blank", "|===\n|a\n\n|===\n"],
    ["a table opening on a dropped comment", "|===\n// gone\n|a\n|===\n"],
    ["an unterminated table", "|===\n|a\n"],
    ["an unterminated table with a trailing blank", "|===\n\n"],
  ])("%s replays its own extent", (_name, source) => {
    const node = firstTable(source);
    const slice = source.slice(
      node.position.start.offset,
      node.position.end.offset,
    );
    const replayed = replayTable(node);
    expect(slice.startsWith(replayed)).toBe(true);
    expect(allowsOverhang(node, slice.slice(replayed.length))).toBe(true);
  });
});
