/**
 * delimitedExtent — the pure port of `build_block`'s up-front extent
 * read (parser.rb:1016-1086 → `read_lines_until terminator:`,
 * reader.rb:414/433-435). One row per branch of the scan: a
 * terminator match, the fence's bare tip, and the lines' end. There
 * is no enclosing-boundary branch: the lines the scan is given
 * already end at every enclosing boundary, so an outer terminator is
 * never among them. Split
 * out of tests/parser/item-extent.test.ts when delimited-reader.ts
 * became its own module: the extent scan is no
 * longer the item reader's private helper, and the combined file
 * crossed the 450-line ceiling.
 */
import { describe, expect, test } from "vitest";
import type { DelimiterKind } from "../../src/parse/lines/classify.js";
import {
  delimitedExtent,
  FENCE_TIP,
} from "../../src/parse/lines/delimited-reader.js";
import { splitLines } from "../../src/parse/lines/split.js";

describe("delimitedExtent", () => {
  // [name, source, openIndex, kind, expected]
  const rows: Array<
    [
      string,
      string,
      number,
      DelimiterKind,
      { closed: boolean; interior: string[]; resume: number },
    ]
  > = [
    [
      "terminator closes (interior excludes both delimiters; resume is past the close)",
      "----\nx\n----\nafter\n",
      0,
      "listing",
      { closed: true, interior: ["x"], resume: 3 },
    ],
    // The source is built from FENCE_TIP — the module's one spelling
    // of the bare tip — so the constant and the terminator test
    // cannot drift apart.
    [
      "fence closes on the bare tip",
      `${FENCE_TIP}ruby\nx\n${FENCE_TIP}\n`,
      0,
      "fencedCode",
      { closed: true, interior: ["x"], resume: 3 },
    ],
    // The row above cannot see the tip rule on its own: its closing
    // fence is the LAST line, so a terminator that never matches
    // also stops at 3 (EOF). With a line after it the two answers
    // part — and the difference is the whole rule, because an
    // unterminated fence swallows everything after the block into
    // whatever contains it — a list item, for the scan's caller.
    // Found by a mutation pass: the mutants that drop the
    // tip rewrite changed the AST while every test passed.
    [
      "fence closes on the bare tip with content after it",
      `${FENCE_TIP}ruby\nx\n${FENCE_TIP}\nafter\n`,
      0,
      "fencedCode",
      { closed: true, interior: ["x"], resume: 3 },
    ],
    [
      "unterminated runs to the lines' end (reader.rb:433-435)",
      "----\nx\n",
      0,
      "listing",
      { closed: false, interior: ["x"], resume: 2 },
    ],
  ];

  test.each(rows)("%s", (...row) => {
    const [, source, openIndex, kind, expected] = row;
    const extent = delimitedExtent(splitLines(source), openIndex, kind);
    expect({
      closed: extent.close !== undefined,
      interior: extent.interior.map((line) => line.text),
      resume: extent.resume,
    }).toEqual(expected);
  });

  test("the interior is a view of the caller's lines, offsets intact", () => {
    const lines = splitLines("----\nx\n----\n");
    const extent = delimitedExtent(lines, 0, "listing");
    expect(extent.open).toBe(lines[0]);
    expect(extent.close).toBe(lines[2]);
    expect(extent.interior).toHaveLength(1);
    expect(extent.interior[0]).toBe(lines[1]);
  });
});
