/**
 * The tail FACTS the post-loop reports beside the buffer
 * (`finishItem`, src/parse/lines/item-tail.ts), and the after-blank
 * arm's hard stop on an erased line: the #56 rows, split from
 * tests/parser/item-extent.test.ts so each file stays under the
 * `max-lines` ceiling. The branch table itself lives there; these
 * rows pin only what `finishItem` says about an item's TAIL and what the
 * Placeholder tag does to an inner scan.
 */
import { describe, expect, test } from "vitest";
import { itemExtent } from "../../src/parse/lines/list-reader.js";
import { splitLines } from "../../src/parse/lines/split.js";
import type { SiblingTrait } from "../../src/parse/lines/classify.js";

// The trait every row matches by: the unordered marker each document
// opens with.
const MARKER_TRAIT: SiblingTrait = { kind: "marker", style: "*" };

/**
 * Scan a document and read back only the tail facts.
 * @param source - the whole document; its first line is the marker
 * @returns the three facts `finishItem` reported
 */
function tailFacts(source: string): {
  trailing: boolean;
  erasedTail: boolean;
  activeTail: boolean;
} {
  const extent = itemExtent(splitLines(source), 1, MARKER_TRAIT, {
    tailSafe: true,
    directiveDepth: 0,
  });
  return {
    trailing: extent.trailingContinuation,
    erasedTail: extent.erasedTailContinuation,
    activeTail: extent.activeTail,
  };
}

// The three facts `finishItem` reports beside the buffer - Ruby's
// post-loop, from `reader.unshift_line this_line` to the `buffer.pop`
// walk (parser.rb l.1574-89) - each finished
// rather than raw: what the pop TOOK is conjoined here with the
// boundary the item closed on, and the armed tail with what the scan
// buffered behind the `+`, so a reader of ItemExtent sees the answer
// the node carries and not a half of it.
//
// The first two are structurally mutually exclusive: the pop takes
// exactly one cell and breaks, and the role of the cell it took is
// what says which fact to report - `detached` for the shield
// `detached_continuation` names (parser.rb l.1576), any other marker
// role for a `+` the item may print back.
// The third is the armed continuation, which is a fact about what the
// item BUFFERED and not about what came off its tail.
describe("the tail facts finishItem reports", () => {
  // [name, source, trailingContinuation, erasedTail, activeTail]
  test.each<[string, string, boolean, boolean, boolean]>([
    [
      "a blanked detached + strips off the tail (l.1576 then l.1580-82)",
      "* a\nb\n\n+\n",
      false,
      true,
      false,
    ],
    [
      "the same strip behind a surviving frozen + — the pair the printer re-emits",
      "* a\n+\n+\n\n+\n",
      false,
      true,
      false,
    ],
    [
      "content after the detached + shields it from the pop",
      "* a\n\n+\npara\n* b\n",
      false,
      false,
      false,
    ],
    [
      "the marked pop fires instead when a live marker ends the buffer (l.1580-82)",
      "* a\nb\n+\n",
      true,
      false,
      false,
    ],
    ["no + at all: every fact false", "* a\nb\n", false, false, false],
    [
      "a + whose activation ran through metadata only is still armed (l.1499-1501)",
      "* a\n+\n[role]\n\n\npara\n",
      false,
      false,
      true,
    ],
    [
      "one buffered blank keeps the armed tail armed (the final else touches no continuation)",
      "* a\n+\n.T\n",
      false,
      false,
      true,
    ],
    [
      "a + a NESTED list will own arms nothing here: the mark was never erased (l.1412-14)",
      "* a\n** b\n+\n",
      true,
      false,
      false,
    ],
    [
      "and the same shape stopping on content prints no byte back: the tail is not inert",
      "* a\n** b\n+\n\n\npara\n",
      false,
      false,
      false,
    ],
    [
      "content consumes the continuation (l.1511), so the tail is not armed",
      "* a\n+\n[role]\n\npara\n",
      false,
      false,
      false,
    ],
  ])("%s", (...row) => {
    const [, source, trailing, erasedTail, activeTail] = row;
    expect(tailFacts(source)).toEqual({ trailing, erasedTail, activeTail });
  });
});

test("the after-blank arm hard-stops on an ERASED line, unread", () => {
  // An inner scan re-reads an outer buffer, where an erased `+`
  // spells `""` but carries the Placeholder tag — the JS oracle's
  // strict `thisLine === ''` is false for the boxed object
  // (parser.js l.2168), so the arm skips nothing and breaks with the
  // line unread. Without the tag the same lines read one line
  // further (the blank run swallows line 4 and stops at para).
  const lines = splitLines("* a\nb\n\n\npara\n").map((line, index) =>
    index === 3 ? { ...line, continuationTag: "erased" as const } : line,
  );
  const extent = itemExtent(lines, 1, MARKER_TRAIT, {
    tailSafe: true,
    directiveDepth: 0,
  });
  expect(extent.buffer.map((line) => line.text)).toEqual(["b"]);
  expect(extent.end).toBe(3);
});
