/**
 * `print/list.ts` — the decisions a list item's printer makes before
 * any Doc is built: the marker it replays, the checkbox prefix whose
 * width is the item's extra indent, whether the item's TAIL would
 * swallow the next marker line, and the gap each of its blocks prints
 * behind.
 *
 * The fixtures are PARSED, not hand-built: every shape a row asks
 * about is one the reader produces, so a row can never pin a state
 * the printer will not be handed. The rules are Ruby's
 * (`read_lines_for_list_item`, parser.rb) — a nested marker sharing
 * its parent's spelling must print adjacent, and a marker an indented
 * literal's slurp would swallow needs a blank line in front of it.
 */
import { describe, expect, test } from "vitest";
import {
  buildMarker,
  formatCheckbox,
  printedGap,
  tailSwallowsMarker,
} from "../../src/print/list.js";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/narrow.js";
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
// The same read with a nested marker of its own spelling: the `** b`
// line the literal's slurp would swallow on re-read.
const SWALLOWED_MARKER = "* a\n\n  lit\n[role]\n** b\n";
// The same shape with a `+` in front of the marker: a gap that
// already stops the slurp, so nothing needs inventing.
const STOPPED_SLURP = "* a\n\n  lit\n+\n** b\n";
// A nested marker behind metadata with no literal anywhere: verbatim
// replay is already a fixed point.
const NO_LITERAL = "* a\n[role]\n** b\n";
// Prettier's path typing cannot promise a parent node, so both the
// marker and the gap take `ListNode | undefined`. This is that absent
// parent, named so the rows read as the fallback they are about.
const NO_PARENT_LIST: ListNode | undefined = undefined;

describe("the marker an item replays", () => {
  test.each([
    ["* a\n", "*"],
    ["- a\n", "-"],
    ["** a\n", "**"],
    [". a\n", "."],
  ])("%j replays the list's own spelling %j", (source, marker) => {
    const list = listOf(source);
    expect(buildMarker(list.children[0], list)).toBe(marker);
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

  test("with no parent list to ask, the marker falls back to `*`", () => {
    expect(buildMarker(itemOf("- a\n"), NO_PARENT_LIST)).toBe("*");
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
    // (parser.rb l.1539), so the boundary behind them is still inside it.
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
    ["an item ending on an attached paragraph", "* a\n+\npara\n", false],
    // A `+` in the printed gap is where the slurp stops
    // (break_on_list_continuation), so the tail behind it is out of
    // reach.
    [
      "an item whose literal is cut off by a `+` gap",
      "* a\n\n  lit\n+\npara\n",
      false,
    ],
    // The blank here is one printedGap INVENTS in front of the nested
    // marker; it stops the slurp the same way an authored blank would.
    [
      "an item whose literal is cut off by the printer's own blank",
      "* a\n\n  lit\n[role]\n** b\n",
      false,
    ],
    [
      "an item ending on a nested list whose last item ends on one",
      "* a\n** b\n\n   lit\n",
      true,
    ],
    [
      "an item ending on a nested list whose last item does not",
      "* a\n** b\n",
      false,
    ],
    // The item PRINTS its trailing `+`, so that `+` is the last line
    // it writes: it already stops the slurp, and a blank in front of
    // the next marker would put a line between the tail and the `+`
    // that the source never had.
    ["an item that prints a trailing continuation", "* a\n\n  lit\n+\n", false],
  ])("%s: %o", (_rule, source, swallows) => {
    expect(tailSwallowsMarker(itemOf(source), listOf(source))).toBe(swallows);
  });

  test("with no parent list to ask, no marker matches and the twin gains the blank that stops the slurp", () => {
    // The same-marker row above, asked without its parent: printedGap's
    // marker arm cannot fire, so the twin is placed behind an INVENTED
    // blank instead of adjacently, and that blank stops the slurp.
    expect(tailSwallowsMarker(itemOf(SAME_MARKER), NO_PARENT_LIST)).toBe(false);
  });
});

describe("the gap a block prints behind", () => {
  test("a block that is not a list replays its gap verbatim", () => {
    const list = listOf(SWALLOWED_MARKER);
    expect(printedGap(list.children[0], list, 0)).toEqual([""]);
  });

  test("a nested list sharing its parent's marker spelling prints ADJACENT", () => {
    const list = listOf(SAME_MARKER);
    const [item] = list.children;
    // The recorded gap is already empty here; the arm is what keeps
    // it empty however the blank-run rules move around it.
    expect(item.blocks[2].block.type).toBe("list");
    expect(printedGap(item, list, 2)).toEqual([]);
  });

  test("an empty gap in front of a marker the literal's slurp would swallow gains a blank line", () => {
    const list = listOf(SWALLOWED_MARKER);
    expect(printedGap(list.children[0], list, 2)).toEqual([""]);
  });

  test("a gap that already stops the slurp is replayed verbatim", () => {
    const list = listOf(STOPPED_SLURP);
    expect(printedGap(list.children[0], list, 1)).toEqual(["+"]);
  });

  test("with no literal earlier in the item, the empty gap is replayed", () => {
    const list = listOf(NO_LITERAL);
    expect(printedGap(list.children[0], list, 1)).toEqual([]);
  });

  test("with no parent list to ask, no marker matches and the gap is replayed", () => {
    const list = listOf(NO_LITERAL);
    expect(printedGap(list.children[0], NO_PARENT_LIST, 1)).toEqual([]);
  });
});
