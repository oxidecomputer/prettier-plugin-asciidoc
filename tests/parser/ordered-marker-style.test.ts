/**
 * `parseListMarker` - the classifier's marker parse, and the two
 * fields it splits a marker into: the STYLE that sibling matching
 * compares (`resolve_list_marker`, parser.rb l.2192, which hands an
 * ordered marker to `resolve_ordered_list_marker`, parser.rb l.2229),
 * and the SPELLING the printer replays. For every unordered and
 * implicit-ordered marker the two are equal; the explicit ordered
 * forms are where they part, and a callout marker equals neither (its
 * style is the shared `<>` sentinel and its bytes are rebuilt from
 * the number, see `ListItemNode.markerSpelling`).
 *
 * Its own file rather than a describe inside tests/parser/lines.test.ts:
 * the ordered table alone covers five explicit families, the implicit
 * run and both cases of the roman form, and lines.test.ts is at its
 * line budget. The renderings the rows stand on are the oracle's, in
 * tests/format/explicit-ordered-list.test.ts.
 */
import { describe, expect, test } from "vitest";
import { parseListMarker } from "../../src/parse/lines/classify.js";

describe("parseListMarker", () => {
  test.each([
    [
      "* a",
      {
        variant: "unordered",
        style: "*",
        spelling: "*",
        indent: 0,
        markerEnd: 2,
      },
    ],
    [
      "  **  a",
      {
        variant: "unordered",
        style: "**",
        spelling: "**",
        indent: 2,
        markerEnd: 6,
      },
    ],
    [
      "- a",
      {
        variant: "unordered",
        style: "-",
        spelling: "-",
        indent: 0,
        markerEnd: 2,
      },
    ],
    [
      ".. a",
      {
        variant: "ordered",
        style: "..",
        spelling: "..",
        indent: 0,
        markerEnd: 3,
      },
    ],
    // The callout arm reports the marker's own number - the group its
    // match captured. `<.>` is auto-numbered, and 0 is the sentinel
    // for it (AUTO_CALLOUT_NUMBER).
    [
      "<.> a",
      {
        variant: "callout",
        style: "<>",
        spelling: "<.>",
        indent: 0,
        markerEnd: 4,
        calloutNumber: 0,
      },
    ],
    [
      "<1> a",
      {
        variant: "callout",
        style: "<>",
        spelling: "<1>",
        indent: 0,
        markerEnd: 4,
        calloutNumber: 1,
      },
    ],
    [
      "<12> a",
      {
        variant: "callout",
        style: "<>",
        spelling: "<12>",
        indent: 0,
        markerEnd: 5,
        calloutNumber: 12,
      },
    ],
  ])("%j", (line, expected) => {
    expect(parseListMarker(line)).toEqual(expected);
  });
  test("no trailing text means no marker (rstripped line)", () => {
    expect(parseListMarker("*")).toBeUndefined();
    expect(parseListMarker("****")).toBeUndefined();
  });
});

// Ruby's `OrderedListRx` marker group (rx.rb l.300) is
// `(\.\.*|\d+\.|[a-zA-Z]\.|[IVXivx]+\))`, and
// `resolve_ordered_list_marker` (parser.rb l.2229) collapses the four
// explicit families onto five representatives - the strings
// `is_sibling_list_item?` (parser.rb l.2280) compares. These rows pin
// the SPLIT the registry makes: the style decides structure, the
// spelling is what the printer replays. The renderings behind the
// rows are the oracle's, pinned in
// tests/format/explicit-ordered-list.test.ts.
describe("explicit ordered markers resolve to a style and keep their spelling", () => {
  test.each([
    ["1. a", "1.", "1."],
    ["5. a", "1.", "5."],
    ["2020. a", "1.", "2020."],
    ["0. a", "1.", "0."],
    ["a. a", "a.", "a."],
    ["c. a", "a.", "c."],
    ["A. a", "A.", "A."],
    ["C. a", "A.", "C."],
    // `i.` is loweralpha, not roman, and NOT because of any
    // alternation order: every roman form ends in `)`
    // (`OrderedListMarkerRxMap`'s `[ivx]+\)`, rx.rb l.303), so a
    // dotted `i` cannot reach the roman branch at all. It is a single
    // letter plus a dot, and `i` is the 9th, so the oracle renders
    // `<ol type="a" start="9">`. The trap is `ii.`, which is no
    // marker at all (multi-letter alpha) and folds into item one.
    ["i. a", "a.", "i."],
    ["i) a", "i)", "i)"],
    ["iii) a", "i)", "iii)"],
    ["x) a", "i)", "x)"],
    ["I) a", "I)", "I)"],
    ["XIV) a", "I)", "XIV)"],
    // Ruby's `OrderedListMarkerRxMap` tests (rx.rb l.303) are
    // UNANCHORED, so a mixed-case roman is decided by the letter
    // before the `)`: `[ivx]+\)` finds `v)` inside `Iv)`, while `iV)`
    // has no lowercase letter against the `)` and falls to
    // `[IVX]+\)`. Both are oracle-confirmed (`Iv)` renders
    // `<ol class="lowerroman" type="i">`, `iV)` upperroman).
    ["Iv) a", "i)", "Iv)"],
    ["iV) a", "I)", "iV)"],
    // An implicit marker resolves to itself, run length and all.
    [". a", ".", "."],
    ["..... a", ".....", "....."],
  ])("%j resolves to %j and spells %j", (line, style, spelling) => {
    expect(parseListMarker(line)).toEqual({
      variant: "ordered",
      style,
      spelling,
      indent: 0,
      markerEnd: spelling.length + 1,
    });
  });

  // Shapes `OrderedListRx` does NOT accept: the paren forms of the
  // arabic and alpha families, a multi-letter alpha, and a roman
  // letter outside `[IVXivx]`. Each is ordinary paragraph text.
  test.each([["1) a"], ["a) a"], ["A) a"], ["ab. a"], ["l) a"], ["c) a"]])(
    "%j is no marker",
    (line) => {
      expect(parseListMarker(line)).toBeUndefined();
    },
  );
});
