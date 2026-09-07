/**
 * The separator lines in FRONT of a sibling list item
 * (`ListItemNode.leadingGap`, src/ast.ts).
 *
 * A `+` the author wrote BETWEEN two items of one list is the byte
 * that decides what the item under it attaches to, and until the
 * field landed it had no home: the reader recorded the line, but the
 * gap partition cut the record at BLOCK boundaries only, so a `+`
 * standing between two ITEMS belonged to nothing and was destroyed.
 * Both witnesses below printed `"* a\n** b\n  ** z\n* a\n"` before the
 * field landed - the trailing item renested onto the outer list,
 * which the oracle's HTML shows as a sibling of the first `a` rather
 * than a child of `z` (issue #184).
 *
 * The other describes are what the printer spends of the record,
 * which is less than what is recorded: blank lines alone are dropped,
 * a run is replayed only through its LAST `+`, and a gap the item
 * ABOVE already spelled through its own tail is not written at all.
 * The last one is narrower still, because the record itself can hold
 * less than the source: a `+` the reader took off the item above is
 * gone from the record before the partition runs.
 */
import { describe, expect, test } from "vitest";
import { expectFormatted, narrow } from "../helpers.js";
import { parse } from "../../src/parser.js";

/**
 * Every leading gap of the list nested inside the document's first
 * list item, in item order.
 * @param source - a document whose first block is a list whose first
 *   item holds a nested list as its first block
 * @returns one recorded leading gap per item of that nested list
 */
function nestedLeadingGaps(source: string): ReadonlyArray<readonly string[]> {
  const [outer] = parse(source).children;
  narrow(outer, "list");
  const [inner] = outer.children[0].blocks;
  narrow(inner.block, "list");
  return inner.block.children.map((item) => item.leadingGap);
}

describe("a + between two items of one list is printed back", () => {
  // Red before `leadingGap`: both rows printed
  // `"* a\n** b\n  ** z\n* a\n"`, whose render nests the trailing `a`
  // under the FIRST `a` instead of under `z`.
  test.each([
    [
      "a sibling nested marker stands above it",
      "* a\n** b\n\n+\n  ** z\n* a\n",
    ],
    ["the item's own nested marker does", "* a\n  ** z\n\n+\n  ** z\n* a\n"],
  ])("%s", async (_what, source) => {
    await expectFormatted(source, source);
  });

  test("the gap is recorded in front of the item it leads", () => {
    // The first item of a list has nothing of the list's in front of
    // it, so its gap is empty by construction; the `+` and the blank
    // above it are the SECOND item's.
    expect(nestedLeadingGaps("* a\n** b\n\n+\n  ** z\n* a\n")).toEqual([
      [],
      ["", "+"],
    ]);
  });
});

describe("a leading gap of blank lines alone is still normalized away", () => {
  // A blank line between two items of one list separates nothing -
  // `parse_list` skips the run before it reads the next marker
  // (parser.rb l.1125) - so siblings keep printing adjacent. These
  // rows were green before `leadingGap` landed and say the field did
  // not start replaying blanks.
  test.each([
    ["one blank", "* a\n** b\n\n** z\n"],
    ["two blanks", "* a\n** b\n\n\n** z\n"],
  ])("%s", async (_what, source) => {
    await expectFormatted(source, "* a\n** b\n** z\n");
  });

  test("the blanks are recorded even though the printer drops them", () => {
    expect(nestedLeadingGaps("* a\n** b\n\n\n** z\n")).toEqual([[], ["", ""]]);
  });
});

describe("a gap is replayed through its LAST +, the blanks behind it dropped", () => {
  // Red before the truncation: both rows dropped the whole run, and
  // the first one is the shape that made the drop wrong. The blanks
  // behind the `+` are erased because a MARKER line follows: the
  // marker ends the item whether the `+` above it is live or erased
  // (parser.rb l.1430 and l.1519 are reached either way), so what the
  // run still decides is the nesting the marker opens, and the `+`
  // decides that from wherever in the run it stands. A gap in front
  // of a BLOCK may not do this - there the blanks decide whether the
  // block attaches at all.
  test.each([
    [
      "an indented marker under the run",
      "* a\n** b\n\n+\n\n  ** z\n* a\n",
      "* a\n** b\n\n+\n  ** z\n* a\n",
    ],
    [
      "a flush-left marker under the run",
      "* a\n** b\n\n+\n\n** z\n",
      "* a\n** b\n\n+\n** z\n",
    ],
  ])("%s", async (_what, source, want) => {
    await expectFormatted(source, want);
  });

  test("the whole run is recorded, blanks and all", () => {
    expect(nestedLeadingGaps("* a\n** b\n\n+\n\n** z\n")).toEqual([
      [],
      ["", "+", ""],
    ]);
  });
});

describe("a gap the item above already spelled is not written twice", () => {
  // A run of three `+`: Ruby reaches the pop with two of them (the
  // third is read and dropped before it ever reaches a cell,
  // parser.rb l.1444), the item's own tail writes those two back, and
  // the third's record entry is what lands in this gap. Printing it
  // would put a byte back that the pop threw away, so the tail is the
  // one route and the gap stands down.
  test("a popped tail owns the bytes between the two items", async () => {
    await expectFormatted("* a\n+\n+\n+\n* b\n", "* a\n+\n+\n* b\n");
  });
});

describe("a + the record no longer holds cannot be replayed", () => {
  // `* a` / `+` / blank / blank / `+` / `* a`. The LAST `+` is the
  // `detached_continuation` Ruby overwrites with a
  // ListContinuationPlaceholder (parser.rb l.1576), so the tail walk
  // pops it and its line leaves the separator record with the buffer
  // (`finishItem`, src/parse/lines/item-tail.ts). Nothing prints a
  // popped `+` back, so the byte has no home. What the record still
  // holds is the FIRST `+` and the blanks under it, and the replay
  // writes that `+` back. Red before `leadingGap`: the whole gap was
  // destroyed and the row printed `"* a\n* a\n"`, losing both
  // bytes.
  test("the recorded + comes back and the popped one does not", async () => {
    await expectFormatted("* a\n+\n\n\n+\n* a\n", "* a\n+\n* a\n");
  });

  test("the popped + is not in the record", () => {
    const [list] = parse("* a\n+\n\n\n+\n* a\n").children;
    narrow(list, "list");
    expect(list.children.map((item) => item.leadingGap)).toEqual([
      [],
      ["+", "", ""],
    ]);
  });
});
