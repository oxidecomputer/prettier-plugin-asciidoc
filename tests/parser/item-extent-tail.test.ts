/**
 * The tail FACTS `ExtentScan.finish` reports beside the buffer
 * (src/parse/lines/list-reader.ts), and the after-blank arm's hard
 * stop on an erased line — the #56 rows, split from
 * tests/parser/item-extent.test.ts so each file stays under the
 * `max-lines` ceiling. The branch table itself lives there; these
 * rows pin only what finish() says about an item's TAIL and what the
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
 * @returns the booleans finish() reported
 */
function tailFacts(source: string): {
  popped: boolean;
  erasedTail: boolean;
  activeTail: boolean;
} {
  const extent = itemExtent(splitLines(source), 1, MARKER_TRAIT, {
    tailSafe: true,
    gaps: new Map(),
  });
  return {
    popped: extent.poppedContinuation,
    erasedTail: extent.erasedTailContinuation,
    activeTail: extent.activeTailContinuation,
  };
}

// The tail facts finish() reports beside the buffer. The first two
// are structurally mutually exclusive: `marked` IS the detached cell
// whenever a detached `+` is the last one buffered, so the strip
// loop either breaks on the marked pop before reaching the detached
// cell, or pops the blanked detached cell as a blank and then breaks
// on content. The third is the continuation still armed at the end.
//
// The third is the RAW scan fact and nothing more: it says only that
// `continuation` was still `:active`, never that the printed item
// shows a live `+`. A nested-list row reads true here while the NODE's
// `activeTail` is false, because list-item-node.ts's armedTailPrints
// finds a list — not metadata — behind the tail. The printed side is
// pinned in tests/format/plus-run.test.ts.
describe("the tail facts finish() reports", () => {
  // [name, source, popped, erasedTail, activeTail]
  test.each<[string, string, boolean, boolean, boolean]>([
    [
      "a blanked detached + strips off the tail (l.1576 then l.1583-85)",
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
      "content after the detached + shields it from the strip",
      "* a\n\n+\npara\n* b\n",
      false,
      false,
      false,
    ],
    [
      "the marked pop fires instead when a marked + ends the buffer (l.1580-81)",
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
      "a nested list is no exception: the raw fact reads :active there too",
      "* a\n** b\n+\n\n\npara\n",
      true,
      false,
      true,
    ],
    [
      "content consumes the continuation (l.1511), so the tail is not armed",
      "* a\n+\n[role]\n\npara\n",
      false,
      false,
      false,
    ],
  ])("%s", (...row) => {
    const [, source, popped, erasedTail, activeTail] = row;
    expect(tailFacts(source)).toEqual({ popped, erasedTail, activeTail });
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
    gaps: new Map(),
  });
  expect(extent.buffer.map((line) => line.text)).toEqual(["b"]);
  expect(extent.end).toBe(3);
});
