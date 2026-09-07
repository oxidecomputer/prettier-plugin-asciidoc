/**
 * THE BLOCK'S FIRST OUTPUT LINE, asked behind the prefix its caller
 * writes (`opensTheSameBlock`, src/print/reflow.ts).
 *
 * A list item's marker, its gap and any checkbox stand in front of
 * the words the packer lays out and decide the line's reading with
 * them, so the question is asked of the whole line and of both
 * spellings of that prefix: the bytes the printer writes, and the
 * bytes the source had. The rows here are the packer's own, one
 * layout at a time; what a whole document makes of the same refusal
 * is tests/format/packed-line-reading.test.ts.
 */
import { describe, expect, test } from "vitest";
import {
  atomOf,
  blockLayout,
  wrap,
  type Atom,
  type BlockLayout,
} from "../../src/print/reflow.js";

/**
 * One neutral atom.
 * @param text - the atom's text
 * @returns the atom
 */
function atom(text: string): Atom {
  return atomOf(text);
}

/**
 * A layout for a block the reader read as a list item's own text,
 * with the marker line's bytes as the prefix.
 * @param prefix - the marker, its gap and any checkbox, as the
 *   printer writes them
 * @param replay - the item's own text lines, marker excluded
 * @returns the layout the packer takes
 */
function itemLayout(prefix: string, replay: readonly string[]): BlockLayout {
  return blockLayout(
    replay,
    { context: "listItemText", openList: { kind: "marker", style: "-" } },
    { at: "behindAPrefix", prefix },
    "listMarker",
  );
}

describe("the block's first output line, behind a prefix the caller writes", () => {
  // RED before the prefixed sites were asked at all: the packer put
  // the item's second source line onto the marker line and wrote
  // `- - -`, which the reader reads as a thematic break rather than
  // as the item the source had. The prefix is what makes the line
  // askable - the two marks the packer places are the rest of a rule
  // whose first mark the marker wrote.
  test("a marker line the packed words turn into a rule is refused", () => {
    expect(
      wrap([atom("-"), atom("-")], 80, 2, itemLayout("- ", ["-", "-"])),
    ).toEqual(["-", "-"]);
  });

  // The mirror, one mark further on: `- - - x` is an item line, not a
  // rule, so the same join is written.
  test("and the same words join where the line they make is an item", () => {
    expect(
      wrap(
        [atom("-"), atom("-"), atom("x")],
        80,
        2,
        itemLayout("- ", ["-", "- x"]),
      ),
    ).toEqual(["- - x"]);
  });

  // The prefix the printer writes is not the bytes the source had -
  // an authored `[*]` checkbox comes back as `[x]` - and the question
  // is asked of the bytes that will be WRITTEN, held against the
  // reading the reader recorded, so a respelling that keeps the
  // reading keeps the layout.
  test("a respelled checkbox prefix still opens the item it opened", () => {
    expect(
      wrap(
        [atom("aaa"), atom("bbb")],
        80,
        2,
        itemLayout("- [x] ", ["aaa", "bbb"]),
      ),
    ).toEqual(["aaa bbb"]);
  });
});
