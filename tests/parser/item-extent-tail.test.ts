/**
 * The tail FACTS the post-loop reports beside the buffer
 * ({@link finishItem}), and the after-blank arm's hard stop on an
 * erased line: the #56 rows, split from
 * tests/parser/item-extent.test.ts so each file stays under the
 * `max-lines` ceiling. The branch table itself lives there; these rows
 * pin only what `finishItem` says about an item's TAIL and what the
 * Placeholder tag does to an inner scan.
 */
import { describe, expect, test } from "vitest";
import { itemExtent, markerList } from "../../src/parse/lines/list-reader.js";
import { splitLines } from "../../src/parse/lines/split.js";
import { classifyLine } from "../../src/parse/lines/classify.js";
import { BLOCK_START_CONTEXT } from "../../src/parse/line-shapes.js";
import type { TrailingContinuation } from "../../src/ast.js";

// The rule every row matches by: the unordered marker each document
// opens with, read through the classifier so the rows and the reader
// resolve the style the same way.
const OPENING = classifyLine("* x", BLOCK_START_CONTEXT);
if (OPENING.kind !== "listMarker") {
  throw new Error("`* x` is a marker line");
}
const MARKER_RULE = markerList(OPENING);

/**
 * Scan a document and read back only the tail facts.
 * @param source - the whole document; its first line is the marker
 * @returns the two facts `finishItem` reported
 */
function tailFacts(source: string): {
  trailing: TrailingContinuation;
  activeTail: boolean;
} {
  const extent = itemExtent(splitLines(source), 1, MARKER_RULE, {
    tailSafe: true,
    directiveDepth: 0,
    hasText: true,
  });
  return {
    trailing: extent.trailingContinuation,
    activeTail: extent.activeTail,
  };
}

// The two facts `finishItem` reports beside the buffer - Ruby's
// post-loop, from `reader.unshift_line this_line` to the `buffer.pop`
// walk (parser.rb l.1574-89) - each finished
// rather than raw: what the pop TOOK is conjoined here with the
// boundary the item closed on, and the armed tail with what the scan
// buffered behind the `+`, so a reader of ItemExtent sees the answer
// the node carries and not a half of it.
//
// A pop that took the cell `detached_continuation` names (parser.rb
// l.1576) reports NO trailing continuation: the shield is a byte the
// printer does not write back, so the rows whose pop took one answer
// false. NOT PROTECTED BY DESIGN: the printer used to write that
// shield back as a blank line and a `+`, and the fact that told it to
// is gone. See tests/format/plus-run.test.ts for what the shape
// prints now.
describe("the tail facts finishItem reports", () => {
  // [name, source, trailingContinuation, activeTail]
  test.each<[string, string, TrailingContinuation, boolean]>([
    [
      "a blanked detached + strips off the tail (l.1576 then l.1580-82)",
      "* a\nb\n\n+\n",
      false,
      false,
    ],
    [
      "the same strip behind a surviving frozen + reports no tail either",
      "* a\n+\n+\n\n+\n",
      false,
      false,
    ],
    [
      "content after the detached + shields it from the pop",
      "* a\n\n+\npara\n* b\n",
      false,
      false,
    ],
    [
      "the marked pop fires instead when a live marker ends the buffer (l.1580-82)",
      "* a\nb\n+\n",
      "single",
      false,
    ],
    ["no + at all: both facts false", "* a\nb\n", false, false],
    [
      "a + whose activation ran through metadata only is still armed (l.1499-1501)",
      "* a\n+\n[role]\n\n\npara\n",
      false,
      true,
    ],
    [
      "one buffered blank keeps the armed tail armed (the final else touches no continuation)",
      "* a\n+\n.T\n",
      false,
      true,
    ],
    [
      "a + a NESTED list will own arms nothing here: the mark was never erased (l.1412-14)",
      "* a\n** b\n+\n",
      "single",
      false,
    ],
    [
      "and the same shape stopping on content prints no byte back: the tail is not inert",
      "* a\n** b\n+\n\n\npara\n",
      false,
      false,
    ],
    [
      "content consumes the continuation (l.1511), so the tail is not armed",
      "* a\n+\n[role]\n\npara\n",
      false,
      false,
    ],
    // #181 red-then-green: before this fix, an adjacent pair with
    // nothing to attach reported "single" here (the popped `+`'s own
    // fact), and the erased byte one turn behind it - which `gapsOf`
    // (list-item-node.ts) has no block to hang a gap on - vanished
    // silently. A re-read of the printed output then classified one
    // continuation where the source read two.
    [
      "a bare run of two reports the erased predecessor too",
      "* a\nb\n+\n+\n",
      "double",
      false,
    ],
    [
      "the same run before a sibling reports it too",
      "* a\nb\n+\n+\n* c\n",
      "double",
      false,
    ],
    [
      "a run of three still reports only the pair the buffer ever held",
      "* a\nb\n+\n+\n+\n",
      "double",
      false,
    ],
    // #263 red-then-green: the pair's first half here is the DETACHED
    // `+` (parser.rb l.1523), which the very next `+` activates and
    // erases at l.1439 exactly as it would a `pending` one - so the
    // pop takes the frozen half and the erased half is the pair's.
    // Before this fix the post-loop wrote `detached` over that cell's
    // recorded role on the way past (l.1576 writes the same
    // Placeholder l.1439 already wrote), the pairing read found no
    // `erased` cell behind the pop, and these three reported
    // "single" - one byte short.
    [
      "a pair over a blank reports the erased DETACHED half too",
      "* a\nb\n\n+\n+\n",
      "double",
      false,
    ],
    [
      "the same pair before a sibling reports it too",
      "* a\nb\n\n+\n+\n* c\n",
      "double",
      false,
    ],
    [
      "three over a blank still report only the pair the buffer held",
      "* a\nb\n\n+\n+\n+\n",
      "double",
      false,
    ],
    // The control the fix must NOT move: inside a nested list the
    // activation blanks nothing (`unless within_nested_list`,
    // l.1439), so the detached half keeps its own role, no pair is
    // reported, and the mark stays the nested scan's to spell.
    [
      "a pair over a blank inside a nested list reports no pair",
      "* a\n** b\n\n+\n+\n",
      "single",
      false,
    ],
  ])("%s", (...row) => {
    const [, source, trailing, activeTail] = row;
    expect(tailFacts(source)).toEqual({ trailing, activeTail });
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
  const extent = itemExtent(lines, 1, MARKER_RULE, {
    tailSafe: true,
    directiveDepth: 0,
    hasText: true,
  });
  expect(extent.buffer.map((line) => line.text)).toEqual(["b"]);
  expect(extent.end).toBe(3);
});
