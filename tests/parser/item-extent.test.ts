/**
 * itemExtent — the pure port of read_lines_for_list_item (parser.rb
 * l.1395–1577) for ulist/olist/colist. One row per Ruby branch; the
 * oracle-facing behavior these buffers imply is pinned by the reader
 * and format suites — THIS table is the branch-level specification.
 */
import { describe, expect, test } from "vitest";
import type { DelimiterKind } from "../../src/parse/lines/classify.js";
import {
  delimitedEnd,
  FENCE_TIP,
  itemExtent,
} from "../../src/parse/lines/list-reader.js";
import { splitLines } from "../../src/parse/lines/split.js";

/**
 * Run itemExtent over a document, starting after its first line. The
 * bounds default to the document reader's: no enclosing delimited
 * block, and a stream end that is EOF (tailSafe).
 * @param source - the whole document; its first line is the marker
 * @param style - the marker style siblings are matched by
 * @param from - index of the first line after the marker line
 * @param bounds - enclosing terminators and the stream-end safety
 * @param bounds.openTerminators - enclosing delimited blocks' terminators
 * @param bounds.tailSafe - whether the stream end is a safe boundary
 * @returns the buffer's text, the end index and the trailing-`+` flag
 */
function scan(
  source: string,
  style = "*",
  from = 1,
  bounds: { openTerminators?: readonly string[]; tailSafe?: boolean } = {},
): { buffer: string[]; end: number; trailing: boolean } {
  const lines = splitLines(source);
  const extent = itemExtent(lines, from, style, {
    openTerminators: bounds.openTerminators ?? [],
    tailSafe: bounds.tailSafe ?? true,
  });
  return {
    buffer: extent.buffer.map((line) => line.text),
    end: extent.end,
    trailing: extent.trailingContinuation,
  };
}

describe("itemExtent: one row per read_lines_for_list_item branch", () => {
  // [name, source, style, expected buffer, end, trailing]
  const rows: Array<[string, string, string, string[], number, boolean]> = [
    ["sibling stops the item (l.1421)", "* a\n* b\n", "*", [], 1, false],
    [
      "plain lines accumulate; trailing blanks are consumed and stripped (l.1546, l.1567-69)",
      "* a\nb\n\n\n",
      "*",
      ["b"],
      4,
      false,
    ],
    [
      "an activated + is erased (l.1427-29)",
      "* a\n+\npara\n",
      "*",
      ["", "para"],
      3,
      false,
    ],
    [
      "one blank inside the budget: the final else keeps :active (l.1546 sets no continuation)",
      "* a\n+\n\npara\n",
      "*",
      ["", "", "para"],
      4,
      false,
    ],
    [
      "two blanks break via the after-blank arm (l.1502, l.1538)",
      "* a\n+\n\n\npara\n",
      "*",
      [],
      4,
      false,
    ],
    [
      "adjacent + freezes and is buffered (l.1433-35)",
      "* a\n+\n+\npara\n",
      "*",
      ["", "+", "para"],
      4,
      false,
    ],
    [
      "every later adjacent + is buffered too (DEVIATION from l.1437: Ruby drops it; Ruling 23 keeps the byte, pinned oracle divergence D5)",
      "* a\n+\n+\n+\npara\n",
      "*",
      ["", "+", "+", "para"],
      5,
      false,
    ],
    [
      "a delimited block attaches whole behind an active + (l.1445-50)",
      "* a\n+\n----\nx\n----\n* b\n",
      "*",
      ["", "----", "x", "----"],
      5,
      false,
    ],
    [
      "a delimited block with no continuation breaks the list (l.1446)",
      "* a\n----\nx\n----\n",
      "*",
      [],
      1,
      false,
    ],
    [
      "an unterminated delimited block runs to EOF (read_lines_until semantics)",
      "* a\n+\n----\nx\n",
      "*",
      ["", "----", "x"],
      4,
      false,
    ],
    [
      "+ then one blank then a delimited block still attaches (blank budget before the delimiter test)",
      "* a\n+\n\n----\nx\n----\n",
      "*",
      ["", "", "----", "x", "----"],
      6,
      false,
    ],
    [
      "literal paragraph slurped whole in the :active arm (l.1477-83)",
      "* a\n+\n  lit\n  more\n\n* b\n",
      "*",
      ["", "  lit", "  more"],
      5,
      false,
    ],
    [
      "metadata plays out until the block (l.1488-90): title, attribute line, attribute entry keep :active",
      "* a\n+\n[role]\n.T\n:x: y\npara\n",
      "*",
      ["", "[role]", ".T", ":x: y", "para"],
      6,
      false,
    ],
    [
      "a block anchor is metadata too: BlockAttributeLineRx carries the [[...]] alternative (l.1488-90)",
      "* a\n+\n[[id]]\n----\nx\n----\n",
      "*",
      ["", "[[id]]", "----", "x", "----"],
      6,
      false,
    ],
    [
      "a comment is NOT metadata: it consumes the + and the next delimiter breaks (else arm l.1492-97)",
      "* a\n+\n// c\n----\nx\n----\n",
      "*",
      ["", "// c"],
      3,
      false,
    ],
    [
      "a nested marker sets within_nested_list and later erasure is suppressed (l.1492-93, l.1429 guard)",
      "* a\n** b\n+\npara\n",
      "*",
      ["** b", "+", "para"],
      4,
      false,
    ],
    [
      "F1: within_nested_list blocks BOTH l.1429 erasures — the first + rides the plain else, the second the :active arm; no detached registration; the nested item's re-scan takes para",
      "* a\n** b\n+\n\n+\npara\n",
      "*",
      ["** b", "+", "", "+", "para"],
      6,
      false,
    ],
    [
      "a dlist term is nestable too (asciidoctor.rb:316 includes :dlist; find sites l.1492/1519/1548)",
      "* a\nterm:: d\n+\npara\n",
      "*",
      ["term:: d", "+", "para"],
      4,
      false,
    ],
    [
      "a callout marker is NOT nestable (asciidoctor.rb:316 lists no :colist) — buffered plain, erasure NOT suppressed",
      "* a\n<1> x\n+\npara\n",
      "*",
      ["<1> x", "", "para"],
      4,
      false,
    ],
    [
      "detached + after a blank (l.1511-12) is erased after the loop (l.1554/l.1562 in the local copy)",
      "* a\n\n+\npara\n* b\n",
      "*",
      ["", "", "para"],
      4,
      false,
    ],
    [
      "flat +/blank/+: prev_line reads the MUTATED buffer — the erased first + kept :active through the buffered blank, so the second + rides the :active arm and is erased in turn (l.1421, l.1429)",
      "* a\n+\n\n+\npara\n",
      "*",
      ["", "", "", "para"],
      5,
      false,
    ],
    [
      "within a nested list the detached + is still erased by l.1562 (it is unconditional)",
      "* a\n** b\n\n+\npara\n",
      "*",
      ["** b", "", "", "para"],
      5,
      false,
    ],
    [
      "stacked detached: the FIRST + is the registered detached_continuation and l.1562 erases it; the SECOND survives the :active arm under within_nested_list, so the inner item's re-scan takes the block",
      "* a\n** b\n\n+\n\n+\npara\n",
      "*",
      ["** b", "", "", "", "+", "para"],
      7,
      false,
    ],
    [
      "after-blank: a nested marker keeps the item (l.1519-21)",
      "* a\n\n** b\n",
      "*",
      ["", "** b"],
      3,
      false,
    ],
    [
      "after-blank: a literal paragraph is slurped (l.1528-34)",
      "* a\n+\n\n\n  lit\n  more\n",
      "*",
      ["", "", "  lit", "  more"],
      6,
      false,
    ],
    [
      "after-blank: anything else breaks, blanks already consumed (l.1506, l.1538)",
      "* a\n\n\npara\n",
      "*",
      [],
      3,
      false,
    ],
    [
      "after-blank: a sibling read after skipping blanks breaks (l.1508)",
      "* a\n\n\n* b\n",
      "*",
      [],
      3,
      false,
    ],
    [
      "trailing + is popped and reported (l.1571)",
      "* a\nb\n+\n",
      "*",
      ["b"],
      3,
      true,
    ],
    [
      "a pop directly before a SIBLING is reported: the reprint sits adjacent to the marker and pops identically (review B1's safe boundary)",
      "* a\nb\n+\n* b\n",
      "*",
      ["b"],
      3,
      true,
    ],
    [
      "a pop before blank+content is NOT reported: the reprinted + would sit above the joiner's blank and ERASE on re-read, arming the block (review B1/B2)",
      "* a\n+\n+\n\npara\n",
      "*",
      [""],
      4,
      false,
    ],
    [
      "a pop directly before a DELIMITER is not reported either: the listing prints behind a blank line, same arming (review B1's flat cousin)",
      "* a\n+\n+\n----\nx\n----\n",
      "*",
      [""],
      3,
      false,
    ],
    [
      "a pop under this item's own frozen + IS reported even at an unsafe tail: the pair re-reads as erase+pop, a fixed point (review B2)",
      "* a\n+\n+\n+\n\npara\n",
      "*",
      ["", "+"],
      5,
      true,
    ],
    [
      "a lone trailing + straight after the marker (the !dangling row)",
      "* a\n+\n",
      "*",
      [],
      2,
      true,
    ],
    [
      "an ERASED trailing + is not trailing (Ruby turned it into a blank; today's reader drops it too)",
      "* a\nb\n+\n\n",
      "*",
      ["b"],
      4,
      false,
    ],
    [
      "an unerased + inside a nested list survives trailing blanks, then pops as trailing (l.1567-71)",
      "* a\n** b\n+\n\n",
      "*",
      ["** b"],
      4,
      true,
    ],
    [
      "a detached + at EOF is erased by l.1562, so it is NOT trailing (ledger family: trailingContinuation spelling)",
      "* a\n\n+\n",
      "*",
      [],
      3,
      false,
    ],
    [
      "ordered style: '.' items stop at '.' siblings, nest under '*' markers",
      ". a\n* b\n. c\n",
      ".",
      ["* b"],
      2,
      false,
    ],

    // Five branches the brief's table left without a row of their own,
    // found by reading the port for states no row distinguishes. Each
    // expectation was confirmed against the oracle before it was
    // written down (renderedHtml, quoted per row).
    [
      ":frozen is NOT :active (l.1435 vs l.1476): metadata after a frozen + rides the plain else, so the delimiter after it breaks the list — oracle renders the listing OUTSIDE the <ul>",
      "* a\n+\n+\n[role]\n----\nx\n----\n",
      "*",
      ["", "+", "[role]"],
      4,
      false,
    ],
    [
      "a frozen + at EOF: the erased first + stays a blank in the buffer and l.1571 pops exactly ONE trailing + — oracle renders the item as <p>a</p> alone",
      "* a\n+\n+\n",
      "*",
      [""],
      3,
      true,
    ],
    [
      "the literal slurp breaks on a + as well as on a blank (break_on_list_continuation, l.1483) — oracle renders TWO literal blocks in the item",
      "* a\n+\n  lit\n+\n  more\n",
      "*",
      ["", "  lit", "", "  more"],
      5,
      false,
    ],
    [
      "an attached delimited block consumes the continuation (l.1451), so a second delimiter breaks the list — oracle renders the second listing OUTSIDE the <ul>",
      "* a\n+\n----\nx\n----\n----\ny\n----\n",
      "*",
      ["", "----", "x", "----"],
      5,
      false,
    ],
    [
      "the :active arm sets within_nested_list too (l.1492-93), so the + after the nested marker survives and the inner item's re-scan takes para — oracle renders para inside b",
      "* a\n+\n** b\n+\npara\n",
      "*",
      ["", "** b", "+", "para"],
      5,
      false,
    ],
  ];

  // A rest parameter, not six named ones: `max-params` is 4.
  test.each(rows)("%s", (...row) => {
    const [, source, style, buffer, end, trailing] = row;
    expect(scan(source, style)).toEqual({ buffer, end, trailing });
  });

  test("erasure blanks text only — offsets and raw stay intact", () => {
    const lines = splitLines("* a\n+\npara\n");
    const { buffer } = itemExtent(lines, 1, "*", {
      openTerminators: [],
      tailSafe: true,
    });
    expect(buffer[0]).toMatchObject({ text: "", raw: "+", offset: 4, line: 2 });
  });
});

// Ruby parses a list inside an example/open/quote/sidebar block from a
// reader CONFINED to that block's lines (build_block →
// read_lines_until terminator: → Reader.new), so
// read_lines_for_list_item can never see the closing delimiter. Our
// delimited blocks stay on the frame stack, so the confinement is the
// openTerminators stop lines — without them, the `====` below would
// pass the delimiterKind test as an OPENER and slurp to EOF, or be
// swallowed by the literal slurp (plan-review B1).
describe("itemExtent: confinement by an enclosing delimited block", () => {
  test("an open terminator with an active + is a stop line, never an opener", () => {
    // from 2: the item's marker is line 2 of `====\n* a\n+\n====\n`.
    expect(
      scan("====\n* a\n+\n====\n", "*", 2, { openTerminators: ["===="] }),
    ).toEqual({
      buffer: [],
      end: 3,
      trailing: true,
    });
  });
  test("the literal slurp stops at an open terminator", () => {
    expect(
      scan("====\n* a\n+\n  lit\n====\n", "*", 2, {
        openTerminators: ["===="],
      }),
    ).toEqual({
      buffer: ["", "  lit"],
      end: 4,
      trailing: false,
    });
  });
});

describe("delimitedEnd", () => {
  const rows: Array<[string, string, number, DelimiterKind, string[], number]> =
    [
      ["terminator closes", "----\nx\n----\nafter\n", 0, "listing", [], 3],
      // The source is built from FENCE_TIP — the module's one spelling
      // of the bare tip, which reader.ts dedupes against in Task 4 —
      // so the constant and the terminator test cannot drift apart.
      [
        "fence closes on the bare tip",
        `${FENCE_TIP}ruby\nx\n${FENCE_TIP}\n`,
        0,
        "fencedCode",
        [],
        3,
      ],
      // The row above cannot see the tip rule on its own: its closing
      // fence is the LAST line, so a terminator that never matches
      // also stops at 3 (EOF). With a line after it the two answers
      // part — and the difference is the whole rule, because an
      // unterminated fence swallows everything after the block into
      // the item (found by the plan's mutation pass: the mutants that
      // drop the tip rewrite changed the AST while every test passed).
      [
        "fence closes on the bare tip with content after it",
        `${FENCE_TIP}ruby\nx\n${FENCE_TIP}\nafter\n`,
        0,
        "fencedCode",
        [],
        3,
      ],
      ["unterminated runs to EOF", "----\nx\n", 0, "listing", [], 2],
      [
        "an enclosing terminator ends the scan, exclusive (outermost wins)",
        "----\nx\n====\n----\n",
        0,
        "listing",
        ["===="],
        2,
      ],
    ];

  test.each(rows)("%s", (...row) => {
    const [, source, openIndex, kind, terminators, end] = row;
    expect(delimitedEnd(splitLines(source), openIndex, kind, terminators)).toBe(
      end,
    );
  });
});

// A confined reader's stream end is the ENCLOSING item's boundary, not
// EOF — the scan inherits that item's own tailSafe (review B1: the
// disjunct must mean the DOCUMENT's end, threaded down through
// ExtentBounds rather than read off the stream length).
describe("itemExtent: the stream-end pop inherits the bounds' tailSafe", () => {
  test("a pop at stream end is reported only when the boundary is safe", () => {
    expect(scan("* a\nb\n+\n", "*", 1, { tailSafe: true }).trailing).toBe(true);
    expect(scan("* a\nb\n+\n", "*", 1, { tailSafe: false }).trailing).toBe(
      false,
    );
  });
});
