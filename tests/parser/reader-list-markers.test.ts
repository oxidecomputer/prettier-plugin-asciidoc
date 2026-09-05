/**
 * BlockReader characterization: WHICH LINES OPEN A LIST ITEM.
 *
 * The marker ALPHABET, the `ListRxMap` question asked before any of
 * the read loop's arms: reader-lists.test.ts holds those - what a `+`
 * attaches, where a block lands, how far an item reads. Both share
 * tests/parser/reader-helpers.ts.
 *
 * Every row is oracle-pinned the same way its neighbours are: the
 * SHAPE says where the reader put the boundaries, and the list-item
 * count must equal Asciidoctor's `<li>` count.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";
import { astShape, itemCount, oracleItems } from "./reader-helpers.js";

// Issue #29's seam, closed here: `read_lines_for_list_item` matches
// siblings and nested markers with `ListRxMap`, whose `UnorderedListRx`
// and `OrderedListRx` both open with `^[ \t]*` and take a `[ \t]+` gap.
// The oracle agrees on all three rows below, so the interrupting set in
// line-shapes.ts was widened to match and tests/parser/lines.test.ts's
// seam suite now asserts the Ruby-true verdict.
describe("reader: indented and tab-gapped markers (issue #29)", () => {
  test.each([
    [
      "an indented DEEPER marker nests",
      "* a\n  ** b\n* c\n",
      "list(item(t list(item(t))) item(t))",
    ],
    [
      "an indented SAME-STYLE marker is a sibling (indentation is not depth)",
      "* a\n  * b\n",
      "list(item(t) item(t))",
    ],
    ["a tab gap is a marker", "* a\n*\tb\n", "list(item(t) item(t))"],
  ])("%s", async (_name, input, expected) => {
    expect(astShape(input)).toBe(expected);
    expect(itemCount(input)).toBe(await oracleItems(input));
  });
});

// `UnorderedListRx` (rx.rb l.284) is
// `/^[ \t]*(-|\*\**|\u2022)[ \t]+(CC_ANY*)$/`:
// U+2022 BULLET is a third marker alternative beside `-` and `*`, and
// `AnyListRx` (l.274) carries it too. It is a SINGLE character where
// `*` and `.` are runs, so `\u{2022}\u{2022}` is no marker, and
// `resolve_list_marker` returns a ulist marker unchanged (parser.rb
// l.2194-2195), so a bullet is its own sibling trait: a bullet under a
// star nests, exactly as `-` under `*` does.
//
// Before the marker source carried it, every row below read as one
// paragraph and reflowed its lines together, so a bare two-bullet
// document formatted to a single line and rendered as text where the
// oracle renders a list.
describe("reader: the U+2022 bullet is an unordered marker", () => {
  test.each([
    [
      "two bullet lines are two items",
      "\u{2022} a\n\u{2022} b\n",
      "list(item(t) item(t))",
    ],
    [
      "a bullet under a star nests (different style)",
      "* a\n\u{2022} b\n",
      "list(item(t list(item(t))))",
    ],
    [
      "a star under a bullet nests too",
      "\u{2022} a\n* b\n",
      "list(item(t list(item(t))))",
    ],
    [
      "a bullet item takes a + continuation",
      "\u{2022} a\n+\npara\n\u{2022} b\n",
      "list(item(t +p(t)) item(t))",
    ],
    ["an indented bullet is a marker", "  \u{2022} a\n", "list(item(t))"],
    ["a tab gap is a marker", "\u{2022}\ta\n", "list(item(t))"],
  ])("%s", async (_name, input, expected) => {
    expect(astShape(input)).toBe(expected);
    expect(itemCount(input)).toBe(await oracleItems(input));
  });

  // The boundary, held from the other side: the alternation holds ONE
  // bullet and no run of them, and it holds no lookalike character.
  test.each([
    ["a doubled bullet is text", "\u{2022}\u{2022} x\n"],
    ["a bullet with no gap is text", "\u{2022}x\n"],
    ["U+2043 HYPHEN BULLET is text", "\u{2043} a\n"],
    ["U+2219 BULLET OPERATOR is text", "\u{2219} a\n"],
    ["U+00B7 MIDDLE DOT is text", "\u{00B7} a\n"],
  ])("%s", async (_name, input) => {
    expect(astShape(input)).toBe("p(t)");
    expect(await oracleItems(input)).toBe(0);
  });

  test("a bullet list survives the round trip", async () => {
    const input = "\u{2022} a\n\u{2022} b\n";
    expect(await formatAdoc(input)).toBe(input);
    expect(await renderedHtml(await formatAdoc(input))).toBe(
      await renderedHtml(input),
    );
  });
});
