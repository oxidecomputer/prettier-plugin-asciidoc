import { describe, expect, test } from "vitest";
import {
  parseCellSpecEnd,
  parseCellSpecStart,
  parseColumnSpecs,
  type TableCellRepeat,
  type TableCellSpec,
  type TableCellStyle,
  type TableColumnSpec,
  type TableHorizontalAlignment,
  type TableVerticalAlignment,
} from "../../src/parse/lines/table-cell-spec.js";

/** A cell spec naming nothing at all: the bare `\|` reading. */
const EMPTY_SPEC: TableCellSpec = { repeat: { kind: "none" } };

// Named against the module's own alignment/style/repeat types, rather
// than left as bare string literals, so a rename of any one of them
// is a type error here rather than a silently-stale fixture.
const CENTER: TableHorizontalAlignment = "center";
const MIDDLE: TableVerticalAlignment = "middle";
const HEADER: TableCellStyle = "header";
const ROWSPAN_TWO: TableCellRepeat = {
  kind: "span",
  colspan: 1,
  rowspan: 2,
};

describe("parseCellSpecStart (CellSpecStartRx, rx.rb:399)", () => {
  // `text` is the text before a line's FIRST separator, spec_part in
  // Ruby's own naming (parser.rb:2495-2527). One row per grammar shape
  // from the cell-spec vocabulary, plus its near-misses.
  test.each<[string, string, TableCellSpec | undefined]>([
    // A bare `|`: spec_part is "", which still matches (every group is
    // optional) and opens a cell with no attributes at all: the
    // ordinary case, not an absence.
    ["", "empty spec_part opens a cell with no attributes", EMPTY_SPEC],
    // `2+|`: colspan only, rowspan defaults to 1 (parser.rb:2515-2518).
    [
      "2+",
      "colspan-only span",
      { repeat: { kind: "span", colspan: 2, rowspan: 1 } },
    ],
    // `.2+|`: rowspan only, colspan defaults to 1.
    [
      ".2+",
      "rowspan-only span",
      { repeat: { kind: "span", colspan: 1, rowspan: 2 } },
    ],
    // `2.3+|`: both halves written.
    [
      "2.3+",
      "colspan and rowspan together",
      { repeat: { kind: "span", colspan: 2, rowspan: 3 } },
    ],
    // `3*|`: duplication count only. The row half of the SAME digits
    // does not exist for `*` at all (there is only one number here),
    // unlike `+`'s two-number form.
    ["3*", "duplicate count", { repeat: { kind: "duplicate", count: 3 } }],
    // `<.>|`: halign and valign from DISTINCT letters on DIFFERENT
    // sides of the dot, so a map that swapped `<`/`>` on either axis,
    // or a scan that swapped which half of the align capture feeds
    // which axis, would both read back a value neither this row nor
    // any other names.
    [
      "<.>",
      "asymmetric horizontal and vertical alignment, no dot pair reused",
      {
        repeat: { kind: "none" },
        halign: "left",
        valign: "bottom",
      },
    ],
    // `.2+^.^h|`, a worked example combining a row-only span, both
    // alignments, and a mapped style letter, all in one spec.
    [
      ".2+^.^h",
      "rowspan, both alignments, header style, combined in one spec",
      {
        repeat: ROWSPAN_TWO,
        halign: CENTER,
        valign: MIDDLE,
        style: HEADER,
      },
    ],
    // A style letter `TableCellStyles` does not map (parser.rb:69-77):
    // dropped, not reported. The spec is still valid, just plainer.
    ["q", "unmapped style letter is dropped, not a parse failure", EMPTY_SPEC],
    // Leading whitespace is part of CellSpecStartRx's own `[ \t]*`
    // (rx.rb:399): pure whitespace still opens a cell with no
    // attributes, exactly like the empty string above.
    ["   ", "pure leading whitespace still opens a cell", EMPTY_SPEC],
    // Whitespace AND a spec together: the leading run is absorbed,
    // the digits after it still parse.
    [
      "  2+",
      "leading whitespace ahead of a real spec",
      {
        repeat: { kind: "span", colspan: 2, rowspan: 1 },
      },
    ],
  ])("%s -> %s", (text, _label, expected) => {
    expect(parseCellSpecStart(text)).toEqual({
      kind: "opensCell",
      spec: expected,
    });
  });

  // Near-misses: text that is not a cell spec at all, so the grammar
  // reports "continues" (Ruby's `nil`, the "missing leading separator"
  // recovery, table.rb:621-627) rather than a parse.
  test.each<[string, string]>([
    ["not a spec", "ordinary prose before a separator"],
    ["2x", "digits with no `+`/`*` operator, then trailing garbage"],
    ["2", "digits alone: the operator that makes them a repeat is missing"],
    ["*", "an operator with no digits in front of it does not match either"],
    ["ab", "two letters: only one style letter is ever legal"],
  ])("%s -> continues (%s)", (text) => {
    expect(parseCellSpecStart(text)).toEqual({ kind: "continues" });
  });
});

describe("parseCellSpecEnd (CellSpecEndRx, rx.rb:400)", () => {
  // Total, unlike the start reading: a later separator always cuts a
  // cell, spec or no spec (parser.rb:2508-2510).
  test("a run of trailing whitespace with a real spec after it belongs to the spec, not the cell", () => {
    expect(parseCellSpecEnd("cell text 2+")).toEqual({
      spec: { repeat: { kind: "span", colspan: 2, rowspan: 1 } },
      rest: "cell text",
    });
  });

  test("pure trailing whitespace, no spec letters at all, still opens with an empty spec", () => {
    expect(parseCellSpecEnd("abc   ")).toEqual({
      spec: EMPTY_SPEC,
      rest: "abc",
    });
  });

  test("no whitespace anywhere: CellSpecEndRx cannot match, so the whole text is cell content", () => {
    expect(parseCellSpecEnd("abc")).toEqual({ spec: EMPTY_SPEC, rest: "abc" });
  });

  test("empty text: also no match, also the whole (empty) text as content", () => {
    expect(parseCellSpecEnd("")).toEqual({ spec: EMPTY_SPEC, rest: "" });
  });

  test("a duplicate spec reached through the end reading", () => {
    expect(parseCellSpecEnd("abc 2*")).toEqual({
      spec: { repeat: { kind: "duplicate", count: 2 } },
      rest: "abc",
    });
  });

  test("CellSpecEndRx skips a whitespace run whose remainder does not fit, and matches the next one", () => {
    // The run after "a" is followed by "b", which is not spec-shaped
    // on its own (a bare style letter has to reach `$` immediately),
    // so that candidate match fails and the scan moves on to the run
    // after "b", where "2+" does reach the end.
    expect(parseCellSpecEnd("a b 2+")).toEqual({
      spec: { repeat: { kind: "span", colspan: 2, rowspan: 1 } },
      rest: "a b",
    });
  });
});

describe("parseColumnSpecs (ColumnSpecRx, rx.rb:390)", () => {
  test('cols="": an empty value is no columns at all, not one default column', () => {
    // Ruby's String#split on an empty receiver returns [] regardless
    // of limit (parser.rb:2446), so parse_colspecs("") never enters
    // its loop; a caller then treats cols as wholly absent
    // (parser.rb:2298's !empty? guard), which is why "" and "1" must
    // not read the same.
    expect(parseColumnSpecs("")).toEqual<TableColumnSpec[]>([]);
  });

  test('cols=" ": spaces are deleted first, so this is also the empty-value case', () => {
    expect(parseColumnSpecs(" ")).toEqual<TableColumnSpec[]>([]);
  });

  test('cols="3": the deprecated bare-integer spread is N default columns', () => {
    expect(parseColumnSpecs("3")).toEqual<TableColumnSpec[]>([{}, {}, {}]);
  });

  test('cols="0": the deprecated spread is total, not a crash, even at zero', () => {
    expect(parseColumnSpecs("0")).toEqual<TableColumnSpec[]>([]);
  });

  test('cols="-1": Ruby\'s Array.new(-1) raises; this reads the pathological spread as zero columns', () => {
    // "-1".to_i.to_s round-trips to "-1", so Ruby's own equality check
    // (parser.rb:2437-2440) takes the deprecated-spread branch here
    // too, not the ordinary record grammar.
    expect(parseColumnSpecs("-1")).toEqual<TableColumnSpec[]>([]);
  });

  test('cols="1;2": semicolon-split when no comma is present, one plain column each', () => {
    expect(parseColumnSpecs("1;2")).toEqual<TableColumnSpec[]>([{}, {}]);
  });

  test('cols="^,,^": an empty record survives as one plain column', () => {
    expect(parseColumnSpecs("^,,^")).toEqual<TableColumnSpec[]>([
      { halign: "center" },
      {},
      { halign: "center" },
    ]);
  });

  test('cols="^,##,^": a record matching neither ColumnSpecRx shape contributes NO column at all', () => {
    // parser.rb:2452 has no `else`: "##" is silently dropped, so the
    // result has two entries, not three.
    expect(parseColumnSpecs("^,##,^")).toEqual<TableColumnSpec[]>([
      { halign: "center" },
      { halign: "center" },
    ]);
  });

  test("spaces inside the value are deleted before the split (parser.rb:2437)", () => {
    // With the spaces gone this is one record, "2*h": a repeat count
    // of 2 with a header style, not two records split on a space that
    // was never a real separator.
    expect(parseColumnSpecs("2 * h")).toEqual<TableColumnSpec[]>([
      { style: "header" },
      { style: "header" },
    ]);
  });

  test("rx.rb:388's own worked example: `1*h,2*,^3e`", () => {
    expect(parseColumnSpecs("1*h,2*,^3e")).toEqual<TableColumnSpec[]>([
      { style: "header" },
      {},
      {},
      { halign: "center", style: "emphasis" },
    ]);
  });

  test("every TableCellStyles letter not already pinned by another row: d, m, l, a, s (parser.rb:69-77)", () => {
    expect(parseColumnSpecs("d,m,l,a,s")).toEqual<TableColumnSpec[]>([
      { style: "none" },
      { style: "monospaced" },
      { style: "literal" },
      { style: "asciidoc" },
      { style: "strong" },
    ]);
  });

  test("comma wins over semicolon when both are present, matching parser.rb:2445", () => {
    // A semicolon here is just an ordinary character inside the single
    // comma-delimited record it sits in: it names no alignment, width
    // or style, so ColumnSpecRx declines it and it is silently
    // skipped, same as any other non-matching record.
    expect(parseColumnSpecs("^,a;b")).toEqual<TableColumnSpec[]>([
      { halign: "center" },
    ]);
  });
});
