/**
 * The parity harness's own unit tests.
 *
 * `scripts/parity.ts` is the gate the whole drop-chevrotain plan
 * leans on, and its two failure modes are silent ones: a dropped
 * `--base` comparing a checkout with itself, and a corpus that did
 * not load reporting "0 cases identical". Both are argument- and
 * bookkeeping-level bugs, so they are tested at that level.
 */
import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import type { Row } from "../../scripts/parity.js";
import {
  blankParentBlockEnds,
  describeDifference,
  differingCases,
  floorComplaint,
  isRow,
  isTiming,
  parseArguments,
} from "../../scripts/parity.js";
import { loadCorpus } from "../conformance/loader.js";
import { formatAdoc } from "../helpers.js";
import { parse } from "../../src/parser.js";

/**
 * Hash a string the way the dumper does.
 * @param text - the text to hash
 * @returns its sha256 in hex
 */
function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * A row built the way the dumper builds one, from real AsciiDoc: real
 * formatter output, real parser output, real digests. No fabricated
 * hashes anywhere in this file.
 * @param id - the case id to file it under
 * @param source - the AsciiDoc to format and parse
 * @returns the row
 */
async function realRow(id: string, source: string): Promise<Row> {
  return {
    id,
    formatted: digest(await formatAdoc(source)),
    ast: digest(JSON.stringify(parse(source))),
  };
}

/**
 * A one-entry dump, keyed by id.
 * @param rows - the rows to index
 * @returns the map `differingCases` takes
 */
function dumpOf(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [row.id, row]));
}

describe("parseArguments", () => {
  test.each([
    [["--base", "abc123"], "abc123", 20, false],
    [["--base=abc123"], "abc123", 20, false],
    [["--base", "abc123", "--limit", "3"], "abc123", 3, false],
    [["--base", "abc123", "--allow-parent-block-end"], "abc123", 20, true],
  ])("%j", (argv, revision, limit, allow) => {
    expect(parseArguments(argv)).toEqual({
      revision,
      limit,
      allowParentBlockEnd: allow,
    });
  });

  test("a missing --base is an error, never a self-comparison", () => {
    expect(() => parseArguments([])).toThrow("--base <rev> is required");
  });

  test("an unrecognised argument is an error, never a shrug", () => {
    expect(() => parseArguments(["--base", "x", "--fast"])).toThrow(
      "unrecognised argument --fast",
    );
  });

  test.each([["fast"], ["-1"], ["2.5"], []])(
    "--limit %s is an error, never a silent NaN",
    (...value) => {
      expect(() =>
        parseArguments(["--base", "x", "--limit", ...value]),
      ).toThrow("--limit needs a non-negative integer");
    },
  );
});

describe("isRow", () => {
  test.each([
    [{ id: "a", formatted: "f", ast: "t" }, true],
    [{ id: "a", formatted: "f" }, false],
    [{ id: 1, formatted: "f", ast: "t" }, false],
    ["not an object", false],
    [undefined, false],
  ])("%j → %s", (value, expected) => {
    expect(isRow(value)).toBe(expected);
  });
});

describe("isTiming", () => {
  test.each([
    [{ formatMs: 12 }, true],
    [{ formatMs: "12" }, false],
    // A case row must never read as the timing line, or the run would
    // drop a case from the comparison and still report parity.
    [{ id: "a", formatted: "f", ast: "t" }, false],
    [undefined, false],
  ])("%j → %s", (value, expected) => {
    expect(isTiming(value)).toBe(expected);
  });
});

/**
 * Three real rows under one id. `plain` and `other` differ in both
 * streams; `sameOutput` formats to exactly what `plain` does while
 * parsing to a different AST, which is the case the harness exists for
 * — an AST that prints the same today can still break range formatting
 * tomorrow.
 * @returns the three rows
 */
async function load(): Promise<{
  plain: Row;
  other: Row;
  sameOutput: Row;
}> {
  return {
    plain: await realRow("case", "para\n"),
    other: await realRow("case", "* item\n"),
    sameOutput: await realRow("case", "para\n\n\n"),
  };
}

describe("differingCases", () => {
  test("identical dumps report nothing", async () => {
    const { plain } = await load();
    expect(differingCases(dumpOf([plain]), dumpOf([plain]))).toEqual([]);
  });

  test("a formatted difference is reported", async () => {
    const { plain, other } = await load();
    const head = { ...plain, formatted: other.formatted };
    expect(differingCases(dumpOf([plain]), dumpOf([head]))).toEqual(["case"]);
  });

  test("an ast difference is reported even when the output matches", async () => {
    const { plain, sameOutput } = await load();
    expect(plain.formatted).toBe(sameOutput.formatted);
    expect(plain.ast).not.toBe(sameOutput.ast);
    expect(differingCases(dumpOf([plain]), dumpOf([sameOutput]))).toEqual([
      "case",
    ]);
  });

  test("a case only the base has is reported", async () => {
    const { plain } = await load();
    const gone = await realRow("dropped", "para\n");
    expect(differingCases(dumpOf([plain, gone]), dumpOf([plain]))).toEqual([
      "dropped",
    ]);
  });

  test("a case only the head has is reported", async () => {
    const { plain } = await load();
    const added = await realRow("added", "para\n");
    expect(differingCases(dumpOf([plain]), dumpOf([plain, added]))).toEqual([
      "added",
    ]);
  });
});

/**
 * How many `position.end`s the allowlist blanks in one document.
 * @param source - AsciiDoc source
 * @returns the count of blanked ends in its parsed, blanked AST
 */
function allowedEnds(source: string): number {
  return (
    JSON.stringify(blankParentBlockEnds(parse(source))).split('"<allowed>"')
      .length - 1
  );
}

describe("the allowlisted parentBlock end", () => {
  // `====` with no closing delimiter is the shape the allowlist
  // exists for. `fixed` is what HEAD parses it to since Task 4: the
  // block ends where the extent it read ends. `buggy` is the same
  // real AST with the end the BASELINE gives it — `buildParentBlock`
  // handed `closeExtent` an empty source there, so the block ended at
  // offset 0. Constructed rather than parsed because the bug is gone
  // from this checkout; it is still what the baseline emits, which is
  // what the allowlist has to reconcile.
  const source = "====\ntext\n";
  const fixed = (): ReturnType<typeof parse> => parse(source);
  const buggy = (): ReturnType<typeof parse> => {
    const document = parse(source);
    const block = document.children.at(0);
    if (block?.type !== "parentBlock") throw new Error("expected parentBlock");
    block.position.end = { offset: 0, line: 1, column: 1 };
    return document;
  };

  test("the two ends really do differ before blanking", () => {
    expect(JSON.stringify(buggy())).not.toBe(JSON.stringify(fixed()));
  });

  test("blanking makes them equal, and the harness reports nothing", async () => {
    const formatted = digest(await formatAdoc(source));
    const rowOf = (tree: unknown): Row => ({
      id: "parent-block",
      formatted,
      ast: digest(JSON.stringify(blankParentBlockEnds(tree))),
    });
    const base = dumpOf([rowOf(buggy())]);
    const head = dumpOf([rowOf(fixed())]);
    expect(differingCases(base, head)).toEqual([]);
  });

  test("blanking leaves a document without a parentBlock alone", () => {
    const document = parse("para\n\n* item\n");
    expect(JSON.stringify(blankParentBlockEnds(document))).toBe(
      JSON.stringify(document),
    );
  });

  test("blanking does not mutate the tree it is given", () => {
    const document = buggy();
    const before = JSON.stringify(document);
    blankParentBlockEnds(document);
    expect(JSON.stringify(document)).toBe(before);
  });

  // Ruling 54: a list item's end is DEFINED as its last block's end
  // and a list's as its last item's, so both inherit the one
  // enumerated difference rather than being a second one. Real
  // `parse()` output, not hand-built trees — the propagation is a
  // property of what the builders produce.
  test.each([
    // The block, the item that ends on it, and the list that ends on
    // the item.
    ["* item\n+\n====\nexample\n", 3],
    // A terminated parent block is blanked too (it always was), so
    // its item and list follow it for the same reason.
    ["* item\n+\n====\nexample\n====\n", 3],
    // A normal delimited block is never blanked, so the item that
    // ends on it keeps its end under comparison.
    ["* item\n+\n----\ncode\n----\n", 0],
    // Nor does an item that ends on a nested list.
    ["* item\n** nested\n", 0],
  ])("%j blanks %i end(s)", (input, count) => {
    expect(allowedEnds(input)).toBe(count);
  });

  test("the blanked ends are the block's, its item's and its list's", () => {
    // Read the three nodes out of the blanked tree and assert each
    // one's end separately. The count row above says how MANY ends
    // were blanked; this says WHICH — and the item and the list both
    // start at offset 0, so a positional assertion could not tell two
    // blanked ends at 0 from one.
    expect(
      blankParentBlockEnds(parse("* item\n+\n====\nexample\n")),
    ).toMatchObject({
      type: "document",
      children: [
        {
          type: "list",
          position: { end: "<allowed>" },
          children: [
            {
              type: "listItem",
              position: { end: "<allowed>" },
              attachedBlocks: [
                {
                  block: {
                    type: "parentBlock",
                    position: { end: "<allowed>" },
                  },
                },
              ],
            },
          ],
        },
      ],
      // The document's own end is read off the source and stays.
      position: { end: { offset: 22, line: 5, column: 1 } },
    });
  });
});

describe("floorComplaint", () => {
  test("the real corpus and fixtures clear the floor", () => {
    // The floor is a hand-maintained constant. This is what makes a
    // corpus that shrank under it fail loudly instead of turning the
    // plan's central gate into a formality.
    const { length: cases } = loadCorpus().flatMap((group) => group.cases);
    const { length: fixtures } = readdirSync("tests/format/fixtures/identity");
    expect(floorComplaint(cases + fixtures, cases + fixtures)).toBeUndefined();
  });

  test.each([
    ["head loaded nothing", 0, 1620],
    ["base loaded nothing", 1620, 0],
    ["both are one short", 1619, 1619],
  ])("%s is a complaint", (_name, head, base) => {
    const complaint = floorComplaint(head, base);
    expect(complaint).toContain(`${String(head)} head`);
    expect(complaint).toContain(`${String(base)} base`);
    expect(complaint).toContain("the corpus did not load");
  });
});

describe("describeDifference", () => {
  test("identical texts have no difference", () => {
    expect(describeDifference("ast", "a\nb", "a\nb")).toBeUndefined();
  });
  test("the first differing line is reported with both sides", () => {
    const message = describeDifference("ast", "a\nb", "a\nc");
    expect(message).toContain("ast line 2");
    expect(message).toContain('"b"');
    expect(message).toContain('"c"');
  });
});
