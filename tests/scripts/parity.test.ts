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
import type { ListNode, Location, ParagraphNode } from "../../src/ast.js";
import type { Row } from "../../scripts/parity.js";
import {
  describeDifference,
  differingCases,
  floorComplaint,
  isRow,
  isTiming,
  normalizeTree,
  parseArguments,
  verdict,
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

// One row per accepted spelling. The whole parsed result travels as
// the expectation rather than four positional columns: five parameters
// trips @typescript-eslint/max-params, and a row that names its fields
// is the one a new flag gets added to without renumbering.
const PARSED_ARGUMENTS_ROWS = [
  [
    ["--base", "abc123"],
    {
      revision: "abc123",
      limit: 20,
      allowParentBlockEnd: false,
      formattedLedger: false,
      expectedDiffs: undefined,
    },
  ],
  [
    ["--base=abc123"],
    {
      revision: "abc123",
      limit: 20,
      allowParentBlockEnd: false,
      formattedLedger: false,
      expectedDiffs: undefined,
    },
  ],
  [
    ["--base", "abc123", "--limit", "3"],
    {
      revision: "abc123",
      limit: 3,
      allowParentBlockEnd: false,
      formattedLedger: false,
      expectedDiffs: undefined,
    },
  ],
  [
    ["--base", "abc123", "--allow-parent-block-end"],
    {
      revision: "abc123",
      limit: 20,
      allowParentBlockEnd: true,
      formattedLedger: false,
      expectedDiffs: undefined,
    },
  ],
  [
    ["--base", "x", "--formatted-ledger"],
    {
      revision: "x",
      limit: 20,
      allowParentBlockEnd: false,
      formattedLedger: true,
      expectedDiffs: undefined,
    },
  ],
  [
    ["--base", "x", "--formatted-ledger", "--allow-parent-block-end"],
    {
      revision: "x",
      limit: 20,
      allowParentBlockEnd: true,
      formattedLedger: true,
      expectedDiffs: undefined,
    },
  ],
] as const;

describe("parseArguments", () => {
  test.each(PARSED_ARGUMENTS_ROWS)("%j", (argv, expected) => {
    expect(parseArguments(argv)).toEqual(expected);
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
    expect(differingCases(dumpOf([plain]), dumpOf([plain]))).toEqual({
      ast: [],
      formatted: [],
    });
  });

  test("a formatted-only difference lands in the ledger stream", async () => {
    const { plain, other } = await load();
    const head = { ...plain, formatted: other.formatted };
    expect(differingCases(dumpOf([plain]), dumpOf([head]))).toEqual({
      ast: [],
      formatted: ["case"],
    });
  });

  test("an ast difference is reported even when the output matches", async () => {
    const { plain, sameOutput } = await load();
    expect(plain.formatted).toBe(sameOutput.formatted);
    expect(plain.ast).not.toBe(sameOutput.ast);
    expect(differingCases(dumpOf([plain]), dumpOf([sameOutput]))).toEqual({
      ast: ["case"],
      formatted: [],
    });
  });

  test("a case differing in BOTH streams is an ast case, never a ledger one", async () => {
    const { plain, other } = await load();
    expect(plain.formatted).not.toBe(other.formatted);
    expect(plain.ast).not.toBe(other.ast);
    expect(differingCases(dumpOf([plain]), dumpOf([other]))).toEqual({
      ast: ["case"],
      formatted: [],
    });
  });

  test("the two streams are kept apart in one comparison", async () => {
    const { plain, other, sameOutput } = await load();
    const base = dumpOf([
      { ...plain, id: "same" },
      { ...plain, id: "ledger" },
      { ...plain, id: "structural" },
    ]);
    const head = dumpOf([
      { ...plain, id: "same" },
      { ...plain, id: "ledger", formatted: other.formatted },
      { ...plain, id: "structural", ast: sameOutput.ast },
    ]);
    expect(differingCases(base, head)).toEqual({
      ast: ["structural"],
      formatted: ["ledger"],
    });
  });

  test("a case only the base has is an ast case, never ledger material", async () => {
    const { plain } = await load();
    const gone = await realRow("dropped", "para\n");
    expect(differingCases(dumpOf([plain, gone]), dumpOf([plain]))).toEqual({
      ast: ["dropped"],
      formatted: [],
    });
  });

  test("a case only the head has is an ast case, never ledger material", async () => {
    const { plain } = await load();
    const added = await realRow("added", "para\n");
    expect(differingCases(dumpOf([plain]), dumpOf([plain, added]))).toEqual({
      ast: ["added"],
      formatted: [],
    });
  });
});

describe("verdict — which differing cases fail the gate", () => {
  test("without the flag, a formatted-only difference FAILS the run", () => {
    // The mutation this row exists to kill: returning `ast`
    // unconditionally would make the plan's central gate stop failing
    // on changed formatter output.
    expect(verdict({ ast: [], formatted: ["ledger"] }, false)).toEqual([
      "ledger",
    ]);
  });

  test("with the flag, a formatted-only difference is a listing, not a failure", () => {
    expect(verdict({ ast: [], formatted: ["ledger"] }, true)).toEqual([]);
  });

  test("with the flag, an AST difference still fails and the formatted ids stand aside", () => {
    expect(
      verdict({ ast: ["structural"], formatted: ["ledger"] }, true),
    ).toEqual(["structural"]);
  });

  test("no differences at all is a pass either way", () => {
    expect(verdict({ ast: [], formatted: [] }, false)).toEqual([]);
    expect(verdict({ ast: [], formatted: [] }, true)).toEqual([]);
  });

  test("without the flag both streams fail, AST ids first", () => {
    expect(
      verdict({ ast: ["structural"], formatted: ["ledger"] }, false),
    ).toEqual(["structural", "ledger"]);
  });
});

// Position helpers for hand-built nodes. Annotated with the real AST
// types, so a row that stops being a node the parser could produce
// fails to compile rather than being silently normalized as junk.
const at = (offset: number): Location => ({
  offset,
  line: 1,
  column: offset + 1,
});
const span = (
  from: number,
  to: number,
): { start: Location; end: Location } => ({ start: at(from), end: at(to) });
const para = (from: number): ParagraphNode => ({
  type: "paragraph",
  children: [],
  position: span(from, from + 1),
});
const nestedList = (from: number): ListNode => ({
  type: "list",
  variant: "unordered",
  children: [],
  position: span(from, from + 1),
});

describe("normalizeTree folds both list-item shapes into one canonical form", () => {
  const textNode = {
    type: "text",
    value: "a",
    position: span(2, 3),
  };
  // TODAY's shape: nested lists inside `children`, blocks in
  // `attachedBlocks` with their spelling, two printer flags.
  const oldItem = {
    type: "listItem",
    depth: 1,
    checkbox: undefined,
    calloutNumber: undefined,
    children: [textNode, nestedList(30)],
    attachedBlocks: [{ block: para(10), continuation: "plus", pluses: 1 }],
    keepTextBreak: false,
    danglingContinuation: true,
    position: span(0, 31),
  };
  // The D1 shape the cut-over produces for the same document.
  const newItem = {
    type: "listItem",
    depth: 1,
    checkbox: undefined,
    calloutNumber: undefined,
    text: [textNode],
    blocks: [
      { gap: ["+"], block: para(10) },
      { gap: [""], block: nestedList(30) },
    ],
    trailingContinuation: true,
    position: span(0, 31),
  };

  test("old and new spell out to the SAME canonical bytes", () => {
    expect(JSON.stringify(normalizeTree({ children: [oldItem] }, false))).toBe(
      JSON.stringify(normalizeTree({ children: [newItem] }, false)),
    );
  });

  test("the canonical item is source-ordered and spelling-free", () => {
    const canonical: unknown = normalizeTree({ children: [oldItem] }, false);
    const rendered = JSON.stringify(canonical);
    expect(rendered).not.toContain("attachedBlocks");
    expect(rendered).not.toContain("continuation");
    expect(rendered).not.toContain("keepTextBreak");
    expect(rendered).not.toContain("gap");
    // blocks merged by offset: the +-attached paragraph (10) before
    // the nested list (30).
    expect(rendered.indexOf('"offset":10')).toBeLessThan(
      rendered.indexOf('"offset":30'),
    );
  });

  test("the NEW shape's canonical form is a literal, not just equal to the old one", () => {
    // Both other rows compare newItem only RELATIVELY (against oldItem
    // or via oldItem's offsets), so a normaliser that dropped the
    // `blocks` field entirely would still pass them. This pins the
    // absolute answer: `blocks` unwrapped, source-ordered, gap gone.
    expect(normalizeTree({ children: [newItem] }, false)).toEqual({
      children: [
        {
          type: "listItem",
          depth: 1,
          inline: [textNode],
          blocks: [para(10), nestedList(30)],
          position: span(0, 31),
        },
      ],
    });
  });

  test("a structural difference is NOT masked: a block moved between items still differs", () => {
    const moved = {
      ...oldItem,
      attachedBlocks: [],
      children: [textNode, nestedList(30)],
    };
    expect(
      JSON.stringify(normalizeTree({ children: [moved] }, false)),
    ).not.toBe(JSON.stringify(normalizeTree({ children: [oldItem] }, false)));
  });
});

/**
 * How many `position.end`s the allowlist blanks in one document.
 * @param source - AsciiDoc source
 * @returns the count of blanked ends in its parsed, blanked AST
 */
function allowedEnds(source: string): number {
  return (
    JSON.stringify(normalizeTree(parse(source), true)).split('"<allowed>"')
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
      ast: digest(JSON.stringify(normalizeTree(tree, true))),
    });
    const base = dumpOf([rowOf(buggy())]);
    const head = dumpOf([rowOf(fixed())]);
    expect(differingCases(base, head)).toEqual({ ast: [], formatted: [] });
  });

  test("blanking leaves a document without a parentBlock alone", () => {
    // Against the canonicalizing normaliser, "alone" is the flag
    // making no difference: the list item is folded either way, and
    // nothing here has an end to blank.
    const document = parse("para\n\n* item\n");
    expect(JSON.stringify(normalizeTree(document, true))).toBe(
      JSON.stringify(normalizeTree(document, false)),
    );
    expect(allowedEnds("para\n\n* item\n")).toBe(0);
  });

  test("blanking does not mutate the tree it is given", () => {
    const document = buggy();
    const before = JSON.stringify(document);
    normalizeTree(document, true);
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
      normalizeTree(parse("* item\n+\n====\nexample\n"), true),
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
              // Canonical: the item's blocks, unwrapped and
              // source-ordered.
              blocks: [
                {
                  type: "parentBlock",
                  position: { end: "<allowed>" },
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
