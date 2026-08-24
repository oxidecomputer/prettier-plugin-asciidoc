/**
 * itemExtent — the pure port of read_lines_for_list_item (parser.rb
 * l.1404–1592) for ulist/olist/colist. One row per Ruby branch; the
 * oracle-facing behavior these buffers imply is pinned by the reader
 * and format suites — THIS table is the branch-level specification.
 */
import { describe, expect, test } from "vitest";
import { itemExtent } from "../../src/parse/lines/list-reader.js";
import { splitLines } from "../../src/parse/lines/split.js";
import type { SiblingTrait } from "../../src/parse/lines/classify.js";

// The trait the rows that name no style of their own match by: the
// unordered marker every such document opens with.
const MARKER_TRAIT: SiblingTrait = { kind: "marker", style: "*" };

/**
 * Run itemExtent over a document, starting after its first line. The
 * bounds default to the document reader's: a stream end that is EOF
 * (tailSafe).
 * @param source - the whole document; its first line is the marker
 * @param style - the marker style siblings are matched by
 * @param from - index of the first line after the marker line
 * @param bounds - the stream-end print-safety fact
 * @param bounds.tailSafe - whether the stream end is a safe boundary
 * @returns the buffer's text and the end index
 */
function scan(
  source: string,
  style = "*",
  from = 1,
  bounds: { tailSafe?: boolean } = {},
): { buffer: string[]; end: number } {
  const lines = splitLines(source);
  const extent = itemExtent(
    lines,
    from,
    { kind: "marker", style },
    { tailSafe: bounds.tailSafe ?? true },
  );
  return {
    buffer: extent.buffer.map((line) => line.text),
    end: extent.end,
  };
}

describe("itemExtent: one row per read_lines_for_list_item branch", () => {
  // [name, source, style, expected buffer, end]
  const rows: Array<[string, string, string, string[], number]> = [
    ["sibling stops the item (l.1430)", "* a\n* b\n", "*", [], 1],
    [
      "plain lines accumulate; trailing blanks are consumed and stripped (l.1560, l.1583-85)",
      "* a\nb\n\n\n",
      "*",
      ["b"],
      4,
    ],
    [
      "an activated + is erased (l.1437-39)",
      "* a\n+\npara\n",
      "*",
      ["", "para"],
      3,
    ],
    [
      "one blank inside the budget: the final else keeps :active (l.1560 sets no continuation)",
      "* a\n+\n\npara\n",
      "*",
      ["", "", "para"],
      4,
    ],
    [
      "two blanks break via the after-blank arm (l.1513, l.1549)",
      "* a\n+\n\n\npara\n",
      "*",
      [],
      4,
    ],
    [
      "adjacent + freezes and is buffered (l.1442-46)",
      "* a\n+\n+\npara\n",
      "*",
      ["", "+", "para"],
      4,
    ],
    [
      "the SECOND adjacent + freezes and is buffered; every later one is read and dropped (l.1444-46)",
      "* a\n+\n+\n+\npara\n",
      "*",
      ["", "+", "para"],
      5,
    ],
    [
      "a delimited block attaches whole behind an active + (l.1453-60)",
      "* a\n+\n----\nx\n----\n* b\n",
      "*",
      ["", "----", "x", "----"],
      5,
    ],
    [
      "a delimited block with no continuation breaks the list (l.1455-56)",
      "* a\n----\nx\n----\n",
      "*",
      [],
      1,
    ],
    [
      "an unterminated delimited block runs to EOF (read_lines_until semantics)",
      "* a\n+\n----\nx\n",
      "*",
      ["", "----", "x"],
      4,
    ],
    [
      "+ then one blank then a delimited block still attaches (blank budget before the delimiter test)",
      "* a\n+\n\n----\nx\n----\n",
      "*",
      ["", "", "----", "x", "----"],
      6,
    ],
    [
      "literal paragraph slurped whole in the :active arm (l.1486-95)",
      "* a\n+\n  lit\n  more\n\n* b\n",
      "*",
      ["", "  lit", "  more"],
      5,
    ],
    [
      "metadata plays out until the block (l.1499-1501): title, attribute line, attribute entry keep :active",
      "* a\n+\n[role]\n.T\n:x: y\npara\n",
      "*",
      ["", "[role]", ".T", ":x: y", "para"],
      6,
    ],
    [
      "a block anchor is metadata too: BlockAttributeLineRx carries the [[...]] alternative (l.1499-1501)",
      "* a\n+\n[[id]]\n----\nx\n----\n",
      "*",
      ["", "[[id]]", "----", "x", "----"],
      6,
    ],
    [
      "a comment is NOT metadata: it consumes the + and the next delimiter breaks (else arm l.1502-11)",
      "* a\n+\n// c\n----\nx\n----\n",
      "*",
      ["", "// c"],
      3,
    ],
    [
      "a nested marker sets within_nested_list and later erasure is suppressed (l.1503-04, l.1439 guard)",
      "* a\n** b\n+\npara\n",
      "*",
      ["** b", "+", "para"],
      4,
    ],
    [
      "F1: within_nested_list blocks BOTH l.1439 erasures — the first + rides the plain else, the second the :active arm; no detached registration; the nested item's re-scan takes para",
      "* a\n** b\n+\n\n+\npara\n",
      "*",
      ["** b", "+", "", "+", "para"],
      6,
    ],
    [
      "a dlist term is nestable too (asciidoctor.rb:315 includes :dlist; find sites l.1503/1530/1562)",
      "* a\nterm:: d\n+\npara\n",
      "*",
      ["term:: d", "+", "para"],
      4,
    ],
    [
      "a callout marker is NOT nestable (asciidoctor.rb:315 lists no :colist) — buffered plain, erasure NOT suppressed",
      "* a\n<1> x\n+\npara\n",
      "*",
      ["<1> x", "", "para"],
      4,
    ],
    [
      "detached + after a blank (l.1522-24) is erased after the loop (l.1576)",
      "* a\n\n+\npara\n* b\n",
      "*",
      ["", "", "para"],
      4,
    ],
    [
      "flat +/blank/+: prev_line reads the MUTATED buffer — the erased first + kept :active through the buffered blank, so the second + rides the :active arm and is erased in turn (l.1430, l.1439)",
      "* a\n+\n\n+\npara\n",
      "*",
      ["", "", "", "para"],
      5,
    ],
    [
      "within a nested list the detached + is still erased by l.1576 (it is unconditional)",
      "* a\n** b\n\n+\npara\n",
      "*",
      ["** b", "", "", "para"],
      5,
    ],
    [
      "stacked detached: the FIRST + is the registered detached_continuation and l.1576 erases it; the SECOND survives the :active arm under within_nested_list, so the inner item's re-scan takes the block",
      "* a\n** b\n\n+\n\n+\npara\n",
      "*",
      ["** b", "", "", "", "+", "para"],
      7,
    ],
    [
      "after-blank: a nested marker keeps the item (l.1530-32)",
      "* a\n\n** b\n",
      "*",
      ["", "** b"],
      3,
    ],
    [
      "after-blank: a literal paragraph is slurped (l.1537-46)",
      "* a\n+\n\n\n  lit\n  more\n",
      "*",
      ["", "", "  lit", "  more"],
      6,
    ],
    [
      "after-blank: anything else breaks, blanks already consumed (l.1517, l.1549)",
      "* a\n\n\npara\n",
      "*",
      [],
      3,
    ],
    [
      "after-blank: a sibling read after skipping blanks breaks (l.1519)",
      "* a\n\n\n* b\n",
      "*",
      [],
      3,
    ],
    [
      "a trailing + is popped and leaves no trace (l.1580-81)",
      "* a\nb\n+\n",
      "*",
      ["b"],
      3,
    ],
    [
      "a trailing + directly before a SIBLING pops the same way — the marker line is unread (l.1430)",
      "* a\nb\n+\n* b\n",
      "*",
      ["b"],
      3,
    ],
    [
      "the first + of a run is erased (l.1437-39) and the second popped; the blank ends the item",
      "* a\n+\n+\n\npara\n",
      "*",
      [""],
      4,
    ],
    [
      "the same erase+pop with a DELIMITER as the stopper: the listing is not the item's",
      "* a\n+\n+\n----\nx\n----\n",
      "*",
      [""],
      3,
    ],
    [
      "a run of three: one erased, one frozen into the buffer, the third dropped and then the frozen one popped as the tail",
      "* a\n+\n+\n+\n\npara\n",
      "*",
      [""],
      5,
    ],
    [
      "a lone trailing + straight after the marker leaves the buffer empty",
      "* a\n+\n",
      "*",
      [],
      2,
    ],
    [
      "a trailing + a blank line erased is already gone before the pop looks",
      "* a\nb\n+\n\n",
      "*",
      ["b"],
      4,
    ],
    [
      "an unerased + inside a nested list survives trailing blanks, then pops (l.1583-85, l.1580-81)",
      "* a\n** b\n+\n\n",
      "*",
      ["** b"],
      4,
    ],
    [
      "a detached + at EOF is erased by l.1576, so the pop finds nothing",
      "* a\n\n+\n",
      "*",
      [],
      3,
    ],
    [
      "ordered style: '.' items stop at '.' siblings, nest under '*' markers",
      ". a\n* b\n. c\n",
      ".",
      ["* b"],
      2,
    ],

    // Five branches the brief's table left without a row of their own,
    // found by reading the port for states no row distinguishes. Each
    // expectation was confirmed against the oracle before it was
    // written down (renderedHtml, quoted per row).
    [
      ":frozen is NOT :active (l.1445 vs l.1487): metadata after a frozen + rides the plain else, so the delimiter after it breaks the list — oracle renders the listing OUTSIDE the <ul>",
      "* a\n+\n+\n[role]\n----\nx\n----\n",
      "*",
      ["", "+", "[role]"],
      4,
    ],
    [
      "a frozen + at EOF: the erased first + stays a blank in the buffer and l.1580-81 pops exactly ONE trailing + — oracle renders the item as <p>a</p> alone",
      "* a\n+\n+\n",
      "*",
      [""],
      3,
    ],
    [
      "the literal slurp breaks on a + as well as on a blank (break_on_list_continuation, l.1495) — oracle renders TWO literal blocks in the item",
      "* a\n+\n  lit\n+\n  more\n",
      "*",
      ["", "  lit", "", "  more"],
      5,
    ],
    [
      "an attached delimited block consumes the continuation (l.1461), so a second delimiter breaks the list — oracle renders the second listing OUTSIDE the <ul>",
      "* a\n+\n----\nx\n----\n----\ny\n----\n",
      "*",
      ["", "----", "x", "----"],
      5,
    ],
    [
      "the :active arm sets within_nested_list too (l.1503-04), so the + after the nested marker survives and the inner item's re-scan takes para — oracle renders para inside b",
      "* a\n+\n** b\n+\npara\n",
      "*",
      ["", "** b", "+", "para"],
      5,
    ],
  ];

  // A rest parameter, not five named ones: `max-params` is 4.
  test.each(rows)("%s", (...row) => {
    const [, source, style, buffer, end] = row;
    expect(scan(source, style)).toEqual({ buffer, end });
  });

  test("erasure blanks text only — offsets and raw stay intact", () => {
    const lines = splitLines("* a\n+\npara\n");
    const { buffer } = itemExtent(lines, 1, MARKER_TRAIT, { tailSafe: true });
    expect(buffer[0]).toMatchObject({ text: "", raw: "+", offset: 4, line: 2 });
  });
});

// Ruby parses a list inside an example/open/quote/sidebar block from a
// reader CONFINED to that block's lines (build_block →
// read_lines_until terminator: → Reader.new) — and now so do we: the
// compound open hands the child reader the INTERIOR subarray, so the
// scan physically runs out of lines at the boundary.
// These rows are the old stop-line rows re-keyed onto interior views:
// the scan sees `* a\n+\n` where it used to see `====\n* a\n+\n====\n`
// plus a stop list.
describe("itemExtent: a confined stream end IS the boundary", () => {
  test("a trailing + at a CLOSED block's interior end pops like any other", () => {
    // Old row: `====\n* a\n+\n====\n` with `====` as a stop line.
    // The interior view is `* a\n+\n`.
    expect(scan("* a\n+\n", "*", 1)).toEqual({
      buffer: [],
      end: 2,
    });
  });
  test("the literal slurp stops at the interior's end", () => {
    // Old row: `====\n* a\n+\n  lit\n====\n` with stop lines.
    expect(scan("* a\n+\n  lit\n", "*", 1)).toEqual({
      buffer: ["", "  lit"],
      end: 3,
    });
  });
});
