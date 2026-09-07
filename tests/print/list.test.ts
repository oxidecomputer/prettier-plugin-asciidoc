/**
 * `print/list.ts` — the decisions a list item's printer makes: the
 * marker it replays, the checkbox prefix whose width is the item's
 * extra indent, and whether the LINES the item comes out as would
 * swallow the next marker line.
 *
 * No fixture is hand-built. The node rows are PARSED, so a row can
 * never pin a state the printer will not be handed; the line rows are
 * FORMATTED, so they are the printer's real output rather than a
 * guess at it (each of those documents is one item, so the whole
 * output is that item's lines). The rules are Ruby's
 * (`read_lines_for_list_item`, parser.rb): a marker an indented
 * literal's slurp would swallow needs a blank line in front of it.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, narrow } from "../helpers.js";
import {
  buildMarker,
  formatCheckbox,
  tailSwallowsMarker,
} from "../../src/print/list.js";
import { parse } from "../../src/parser.js";
import type { ListItemNode, ListNode } from "../../src/ast.js";

/**
 * The list a source document opens with.
 * @param source - the document
 * @returns its first block, as a list
 */
function listOf(source: string): ListNode {
  const [block] = parse(source).children;
  narrow(block, "list");
  return block;
}

/**
 * One item of the list a source document opens with.
 * @param source - the document
 * @param index - which item; the first by default
 * @returns the item node
 */
function itemOf(source: string, index = 0): ListItemNode {
  const item = listOf(source).children[index];
  narrow(item, "listItem");
  return item;
}

// An item whose read runs THROUGH an indented literal and the
// metadata behind it, so the `* a` line after them lands INSIDE the
// item — a nested list sharing its parent's marker spelling.
const SAME_MARKER = "* a\n\n  lit\n[[anc]]\n* a\n";
// Prettier's path typing cannot promise a parent node, so the marker
// takes `ListNode | undefined`. This is that absent parent, named so
// the rows read as the fallback they are about.
const NO_PARENT_LIST: ListNode | undefined = undefined;

/**
 * The output lines of a document that is ONE list item — the unit
 * {@link tailSwallowsMarker} answers in, taken from the printer
 * rather than written out beside the source.
 * @param source - a document whose whole body is one list item
 * @returns the lines it is printed as, without the trailing newline's
 *   empty tail
 */
async function itemLines(source: string): Promise<string[]> {
  const formatted = await formatAdoc(source);
  return formatted.split("\n").slice(0, -1);
}

describe("the marker an item replays", () => {
  test.each([
    ["* a\n", "*"],
    ["- a\n", "-"],
    ["** a\n", "**"],
    [". a\n", "."],
    // Explicit ordered markers replay their own spelling, not the
    // style they resolve to (`5.` and `2020.` are both style `1.`).
    ["1. a\n", "1."],
    ["5. a\n", "5."],
    ["2020. a\n", "2020."],
    ["a. a\n", "a."],
    ["A. a\n", "A."],
    ["i) a\n", "i)"],
    ["I) a\n", "I)"],
  ])("%j replays the item's own spelling %j", (source, marker) => {
    const list = listOf(source);
    expect(buildMarker(list.children[0], list)).toBe(marker);
  });

  // The list's STYLE is one string; its items' spellings need not be.
  test("each item of one explicit ordered list replays its own marker", () => {
    const list = listOf("5. five\n6. six\n2020. year\n");
    expect(list.marker).toBe("1.");
    expect(list.children.map((item) => buildMarker(item, list))).toEqual([
      "5.",
      "6.",
      "2020.",
    ]);
  });

  test("a callout item prints from its recorded number, not the list's marker", () => {
    // The callouts follow the listing block they annotate.
    const [, block] = parse("----\ncode\n----\n<1> one\n<.> two\n").children;
    narrow(block, "list");
    const list = block;
    expect(buildMarker(list.children[0], list)).toBe("<1>");
    // 0 is the sentinel an auto-numbered `<.>` stores.
    expect(buildMarker(list.children[1], list)).toBe("<.>");
  });

  // The parent is asked for the VARIANT alone (is this a callout
  // list?), so an absent one needs no marker fallback: the item's own
  // recorded spelling answers, and a non-callout item answers the
  // same with or without its parent.
  test("with no parent list to ask, the item's own spelling answers", () => {
    expect(buildMarker(itemOf("- a\n"), NO_PARENT_LIST)).toBe("-");
    expect(buildMarker(itemOf("2020. a\n"), NO_PARENT_LIST)).toBe("2020.");
  });
});

describe("the checkbox prefix", () => {
  test.each([
    ["checked" as const, "[x] "],
    ["unchecked" as const, "[ ] "],
    [undefined, ""],
  ])("%j prints %j", (checkbox, prefix) => {
    expect(formatCheckbox(checkbox)).toBe(prefix);
  });

  test("`[*]` is normalized to the canonical checked form", () => {
    expect(formatCheckbox(itemOf("* [*] a\n").checkbox)).toBe("[x] ");
  });

  test("both checkbox spellings are four columns — the indent the text gains", () => {
    expect(formatCheckbox("checked")).toHaveLength(
      formatCheckbox("unchecked").length,
    );
    expect(formatCheckbox("checked")).toHaveLength(4);
  });
});

describe("whether an item's tail swallows the next marker line", () => {
  test.each([
    ["an item holding nothing", "* a\n", false],
    ["an item ending on an indented literal", "* a\n\n  lit\n", true],
    // The slurp does not care what KIND of line follows the literal —
    // metadata, a delimited block, a marker: it takes them all
    // (parser.rb l.1546), so the boundary behind them is still inside it.
    [
      "an item whose literal stands behind trailing metadata",
      "* a\n\n  lit\n[[anc]]\n",
      true,
    ],
    [
      "an item whose literal stands behind a delimited block",
      "* a\n\n  lit\n----\nx\n----\n",
      true,
    ],
    [
      "an item whose literal stands behind an adjacent same-marker twin",
      "* a\n\n  lit\n[[anc]]\n* a\n",
      true,
    ],
    [
      "an item whose literal stands behind a nested marker",
      "* a\n\n  lit\n[role]\n** b\n",
      true,
    ],
    ["an item ending on an attached paragraph", "* a\n+\npara\n", false],
    // A `+` is where the slurp stops
    // (break_on_list_continuation), so the tail behind it is out of
    // reach — unless the line after it opens a literal of its own.
    [
      "an item whose literal is cut off by a `+`",
      "* a\n\n  lit\n+\npara\n",
      false,
    ],
    // "Let block metadata play out until we find the block"
    // (parser.rb l.1499-1501): the continuation is still live under
    // the `[role]`, so the indented line below it opens a literal.
    [
      "an item whose live `+` reaches a literal through metadata",
      "* a\n+\n[role]\n  lit\n",
      true,
    ],
    // After a BLANK there is no such tolerance: the branch breaks the
    // item on anything but a marker, a `+` or an indented line
    // (parser.rb l.1522-49), so the metadata run below the marker
    // never reaches a slurp.
    [
      "an item whose indented tail follows a marker and metadata",
      "* a\n\n** b\n[role]\n  lit\n",
      false,
    ],
    [
      "an item ending on a nested list whose last item ends on a literal",
      "* a\n** b\n\n   lit\n",
      true,
    ],
    [
      "an item ending on a nested list whose last item does not",
      "* a\n** b\n",
      false,
    ],
    // The item PRINTS its trailing `+`, so that `+` is the last line
    // it writes: nothing follows it to open a literal, and a blank in
    // front of the next marker would put a line between the tail and
    // the `+` that the source never had.
    ["an item that prints a trailing continuation", "* a\n\n  lit\n+\n", false],
  ])("%s: %o", async (_rule, source, swallows) => {
    expect(tailSwallowsMarker(await itemLines(source))).toBe(swallows);
  });

  // The printer derives delimiters from structure, so its output
  // always closes what it opens - no ITEM prints an unterminated
  // opener. The walk's type does not know that: it is total over any
  // line array, and an opener with no closer skips to the end of the
  // lines (the same fate Ruby gives an unterminated body,
  // read_lines_until terminator: running out of lines) where nothing
  // is left to slurp.
  test("an unterminated opener, which no item prints, skips to the end", () => {
    expect(tailSwallowsMarker(["* a", "----", "lit"])).toBe(false);
  });
});

describe("the gap a same-marker nested list is recorded behind", () => {
  // NOT PROTECTED BY DESIGN. The printer once dropped a blank-only
  // gap in front of a nested list that shares its parent's marker,
  // because a blank there reads back as a SIBLING boundary. No input
  // reaches that drop: 1,614 corpus documents and the whole
  // list-shape sweep product produce no such gap, and the reason is
  // structural, which is what this row records. An item's read runs
  // THROUGH an indented literal and the metadata behind it, so the
  // marker line lands inside the item ONLY while nothing separates
  // them; put a blank or a `+` there and the reader has two siblings
  // instead, with no nested block to carry a gap.
  // The gap in front of such a list is therefore always empty, and
  // the printer replays it like every other one.
  test("it is empty, so there is nothing to drop", () => {
    const list = listOf(SAME_MARKER);
    const [item] = list.children;
    const [{ gap, block }] = item.blocks.slice(2);
    expect(block.type).toBe("list");
    narrow(block, "list");
    expect(block.marker).toBe(list.marker);
    expect(gap).toEqual([]);
  });
});
