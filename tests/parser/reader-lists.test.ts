/**
 * BlockReader characterization: LISTS — the port of
 * `read_lines_for_list_item` and its `+` continuation state machine.
 *
 * Split from reader.test.ts, which covers everything the reader does
 * outside a list frame. Both share tests/parser/reader-helpers.ts. The
 * invariants every document's AST must satisfy, fuzzed at the same
 * counts these rows were found by, are tests/parser/ast-invariants.test.ts.
 *
 * Every list row is oracle-pinned twice: the SHAPE says where the
 * reader put the boundaries, and the list-item count must equal
 * Asciidoctor's `<li>` count. Where the two disagreed while these were
 * written, the oracle won and the shape was fixed.
 */
import { describe, expect, test } from "vitest";
import { renderedHtml } from "../helpers.js";
import { expectAstInvariants } from "./ast-invariants.js";
import { astShape, itemCount, oracleItems } from "./reader-helpers.js";

describe("reader: list items (read_lines_for_list_item)", () => {
  const rows: Array<[string, string, string]> = [
    ["siblings by style", "* a\n* b\n", "list(item(t) item(t))"],
    [
      "continuation lines are item text (incl. indented and block-shaped)",
      "* a\n  b\n.c\nNOTE: d\n",
      "list(item(t / t / t / t))",
    ],
    [
      "a different style nests (is_sibling_list_item? compares markers)",
      "* a\n** b\n* c\n",
      "list(item(t list(item(t))) item(t))",
    ],
    [
      "- under * nests (different style)",
      "* a\n- b\n",
      "list(item(t list(item(t))))",
    ],
    [
      "an ordered list nests a bullet and resumes",
      ". a\n* b\n. c\n",
      "olist(item(t list(item(t))) item(t))",
    ],
    [
      "blank line between siblings keeps the list",
      "* a\n\n* b\n",
      "list(item(t) item(t))",
    ],
    [
      "blank then plain text ends every open list",
      "* a\n** b\n\npara\n",
      "list(item(t list(item(t)))) p(t)",
    ],
    [
      "+ attaches a paragraph read with the plain set (a foreign marker is a RawLine, not an end)",
      "* a\n+\npara\n. next\n* b\n",
      "list(item(t +p(t raw)) item(t))",
    ],
    [
      "+ then ONE blank then content still attaches (continuation stays active)",
      "* a\n+\n\npara\n* b\n",
      "list(item(t +p(t)) item(t))",
    ],
    [
      "+ then TWO blanks ends the list and drops the +",
      "* a\n+\n\n\npara\n",
      "list(item(t)) p(t)",
    ],
    [
      "blank(s) then + is a detached continuation, noted for the printer",
      "* a\n\n\n+\npara\n* b\n",
      "list(item(t ~+p(t)) item(t))",
    ],
    [
      "metadata plays out between + and the block",
      "* a\n+\n[source]\n.T\n----\nx\n----\n* b\n",
      "list(item(t +attrs -title -listing[1]) item(t))",
    ],
    [
      "+ chain after a delimited block",
      "* a\n+\n----\nx\n----\n+\npara\n* b\n",
      "list(item(t +listing[1] +p(t)) item(t))",
    ],
    [
      "+ then ONE blank then a delimited block still attaches",
      "* a\n+\n\n----\nx\n----\n* b\n",
      "list(item(t +listing[1]) item(t))",
    ],
    [
      "+ then TWO blanks then a listing block: the block lands OUTSIDE the list",
      "* a\n+\n\n\n----\nx\n----\n* b\n",
      "list(item(t)) listing[1] list(item(t))",
    ],
    [
      "+ then TWO blanks then an example block: outside too",
      "* a\n+\n\n\n====\nx\n====\n* b\n",
      "list(item(t)) example(p(t)) list(item(t))",
    ],
    [
      "+ then TWO blanks then an open block: outside too",
      "* a\n+\n\n\n--\nx\n--\n* b\n",
      "list(item(t)) open(p(t)) list(item(t))",
    ],
    [
      "+ then TWO blanks then a comment block: outside too",
      "* a\n+\n\n\n////\nx\n////\n* b\n",
      "list(item(t)) commentBlock[1] list(item(t))",
    ],
    [
      "+ then TWO blanks then an indented literal: the item keeps it, the + is gone",
      "* a\n+\n\n\n  lit\n* b\n",
      "list(item(t ~literal-indented[2]))",
    ],
    [
      "+ then TWO blanks then a dlist term: the item keeps it, the + is gone",
      "* a\n+\n\n\nterm:: def\n",
      "list(item(t ~p(t)))",
    ],
    [
      "+ then TWO blanks then a nested marker: the item keeps it, the + is gone",
      "* a\n+\n\n\n** b\n* c\n",
      "list(item(t list(item(t))) item(t))",
    ],
    [
      "+ then TWO blanks then a sibling: the + is gone",
      "* a\n+\n\n\n* b\n",
      "list(item(t) item(t))",
    ],
    [
      "a delimiter without + ends the item AND the list",
      "* a\n-----\nx\n-----\n",
      "list(item(t)) listing[1]",
    ],
    [
      "an attribute line without + stays INSIDE the item as metadata for its next block",
      "* a\n[source]\ncode\n* b\n",
      "list(item(t -attrs -listing[1]) item(t))",
    ],
    [
      "an anchor directly after item text is a raw line (fold_first discards it)",
      "* a\n[[x]]\npara\n",
      "list(item(t raw t))",
    ],
    ["a trailing + at EOF is dangling", "* a\n+\n", "list(item(t !dangling))"],
    [
      "indented content after + is a literal paragraph that runs on through a sibling marker",
      "* a\n+\n  lit\nflush\n* b\n",
      "list(item(t +literal-indented[3]))",
    ],
    [
      "indented paragraph after a blank stays in the item (slurp literal offset by blank lines)",
      "* a\n\n  lit\n* b\n",
      "list(item(t ~literal-indented[2]))",
    ],
    [
      "a dlist term ends item text and continues as a dlistItem paragraph inside the item",
      "* a\nterm:: def\nmore\n* b\n",
      "list(item(t -p(t / t)) item(t))",
    ],
    [
      "a dlist term after a blank line keeps the item open (NESTABLE_LIST_CONTEXTS)",
      "* a\n\nterm:: def\n",
      "list(item(t ~p(t)))",
    ],
    [
      "a section title after + is attached paragraph text (no sections inside list readers)",
      "* a\n+\n== H\n",
      "list(item(t +p(t)))",
    ],
    [
      "a callout list after item text is an in-item block (colist is not NESTABLE)",
      "* a\n<1> x\n",
      "list(item(t colist(item(t))))",
    ],
    [
      "a callout list after a BLANK line ends the list (colist is not NESTABLE)",
      "* a\n\n<1> b\n",
      "list(item(t)) colist(item(t))",
    ],
    ["callouts", "<1> a\n<2> b\n", "colist(item(t) item(t))"],
    ["admonition paragraph", "NOTE: a\nb\n", "admonition(note)"],
    [
      "admonition after + inside an item",
      "* a\n+\nNOTE: b\n",
      "list(item(t +admonition(note)))",
    ],
    [
      "a list inside a compound block closes with the block",
      "====\n* a\n====\n",
      "example(list(item(t)))",
    ],
    [
      "+ attaches a thematic break like any other block",
      "* a\n+\n'''\n+\npara\n",
      "list(item(t +thematic +p(t)))",
    ],
    [
      "the break CONSUMES the continuation, so a blank-separated paragraph is outside",
      "* a\n+\n'''\n\npara\n",
      "list(item(t +thematic)) p(t)",
    ],
    [
      "+ attaches a page break like any other block",
      "* a\n+\n<<<\n",
      "list(item(t +pagebreak))",
    ],
    [
      "an attribute entry inside an item is a leaf of its own and the + survives it",
      "* a\n+\n:foo: bar\npara\n",
      "list(item(t +attr -p(t)))",
    ],
    [
      "a block after a BLANK line past that entry is marked blank, not unmarked",
      "* a\n+\n:foo: bar\n\npara\n",
      "list(item(t +attr ~p(t)))",
    ],
    [
      "a nested marker after + consumes it, so a later blank+text ends the list",
      "* a\n+\n** b\n\npara\n",
      "list(item(t list(item(t)))) p(t)",
    ],
    [
      "a detached + under NESTED lists attaches to the outermost item, not the innermost",
      "* a\n** b\n*** c\n\n+\npara\n",
      "list(item(t list(item(t list(item(t)))) ~+p(t)))",
    ],
    [
      "a compound block confines the list reader: a blank+text ends only the INNER list",
      "* a\n+\n====\n* x\n\npara\n====\n* b\n",
      "list(item(t +example(list(item(t)) p(t))) item(t))",
    ],
  ];
  test.each(rows)("%s", (_name, input, expected) => {
    expect(astShape(input)).toBe(expected);
    expect(itemCount(input), "one list item per oracle <li>").toBe(
      oracleItems(input),
    );
  });
});

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
  ])("%s", (_name, input, expected) => {
    expect(astShape(input)).toBe(expected);
    expect(itemCount(input)).toBe(oracleItems(input));
  });
});

describe("reader: list oracle surprises", () => {
  test("a comment after + consumes the continuation, so the block breaks the list", () => {
    // Ruby's `let block metadata play out` test names BlockTitleRx,
    // BlockAttributeLineRx and AttributeEntryRx only, so a comment line
    // falls into the else branch, which sets continuation = :inactive.
    // The listing below therefore hits `break unless continuation ==
    // :active` and lands OUTSIDE the list — as the oracle confirms.
    const input = "* a\n+\n// c\n[source]\n.T\n----\nx\n----\n* b\n";
    expect(renderedHtml(input)).not.toContain('class="title">T');
    expect(astShape(input)).toBe(
      "list(item(t +comment -attrs -title)) listing[1] list(item(t))",
    );
  });
  test("metadata held inside an item is released before the block that follows it", () => {
    // Regression, found by fuzzing the reader over random line
    // sequences: a held-back `[source]` / `[[x]]` sits at an EARLIER
    // offset than the label or the frozen `+` that follows it, so both
    // have to flush first or the tree stops being in document order.
    // Shape only: the second row's `ifdef::` is one the preprocessor
    // eats (with everything after it, there being no `endif`), so the
    // oracle sees a different document than the reader does.
    // `-attrs`, not the old `+attrs`: the source has no `+` line (the
    // gap is empty), and the old glyph spelled the READER's Ruling-26
    // decision to introduce one. Under spec D1 that decision is the
    // printer's (`hazard()` answers "plus" for this node), the AST
    // records the verbatim gap, and the FORMATTED bytes are unchanged:
    // "** b lit\n+\n[source]\nNOTE: x\n" before and after the
    // cut-over.
    expect(astShape("** b\n  lit\n[source]\nNOTE: x\n")).toBe(
      "list(item(t / t -attrs -admonition(note)))",
    );
    expect(astShape("** b\nifdef::x[]\n// c\n[[x]]\n+\n+\n* a\n")).toBe(
      "list(item(t raw raw -p(t) +p(raw) list(item(t))))",
    );
    // The invariant they were FOUND by, not just the shape they settled
    // on: document order, values reconstruct, containment.
    expectAstInvariants("** b\n  lit\n[source]\nNOTE: x\n");
    expectAstInvariants("** b\nifdef::x[]\n// c\n[[x]]\n+\n+\n* a\n");
  });
  test("adjacent + lines: the second is content, the rest are kept verbatim", () => {
    // ORACLE DIVERGENCE, deliberate. Ruby buffers the second `+` as
    // text and DROPS every later one, rendering `+\nAttached` as one
    // paragraph. Dropping a line would delete source, so the reader
    // keeps each extra `+` as its own RawLine; the printed bytes are
    // unchanged, so the rendering is too.
    expect(renderedHtml("* a\n+\n+\n+\nAttached\n")).toContain(
      "<p>+ Attached</p>",
    );
    expect(astShape("* a\n+\n+\n+\nAttached\n")).toBe(
      "list(item(t +p(raw) -p(raw) -p(t)))",
    );
  });
});

// A detached `+` inside a nested list is the OUTERMOST item's, but the
// moment the inner item keeps the line after it (a sibling or nested
// marker, a dlist term, a literal paragraph) Ruby's outer loop buffers
// that line through its `continuation == :active` branch and sets
// `continuation = :inactive` — so a later blank-separated block is
// OUTSIDE the list, not the outer item's. Only metadata leaves it
// active ("let block metadata play out until we find the block").
describe("reader: a detached + an outer item took is released when the inner item keeps the next line", () => {
  const outside: Array<[string, string, RegExp]> = [
    ["sibling marker", "* a\n** b\n\n+\n** c\n\npara\n", /\) p\(t\)$/v],
    ["literal paragraph", "* a\n** b\n\n+\n  lit\n\npara\n", /\) p\(t\)$/v],
    [
      "sibling marker, then a listing",
      "* a\n** b\n\n+\n** c\n\n----\nx\n----\n",
      /\) listing\[1\]$/v,
    ],
    [
      "literal paragraph, then a listing",
      "* a\n** b\n\n+\n  lit\n\n----\nx\n----\n",
      /\) listing\[1\]$/v,
    ],
    ["dlist term", "* a\n** b\n\n+\nterm:: d\n\npara\n", /\) p\(t\)$/v],
    [
      "two sibling markers",
      "* a\n** b\n\n+\n** c\n** d\n\npara\n",
      /\) p\(t\)$/v,
    ],
  ];
  test.each(outside)(
    "%s: the blank-separated block is outside the list",
    (_name, input, tail) => {
      expect(astShape(input)).toMatch(tail);
      expect(itemCount(input)).toBe(oracleItems(input));
    },
  );
  test("metadata after the detached + keeps it active for the outer item", () => {
    const input = "* a\n** b\n\n+\n[role]\npara\n";
    // The inner list ends at the metadata line; the paragraph is a's —
    // the detached `+` speaks for the metadata it stands above, and the
    // paragraph under it is stacked (no `+` of its own).
    expect(astShape(input)).toMatch(/list\(item\(t\)\) ~\+attrs -p\(t\)\)\)$/v);
    expect(itemCount(input)).toBe(oracleItems(input));
  });
});

describe("reader: stacked detached continuations", () => {
  // Ruby's outer item erases only the LAST detached `+`
  // (`detached_continuation` is a scalar); the inner item re-reads the
  // first as its own and takes the block. Both marks ride ahead of it
  // so the printer writes both `+` lines back.
  test("the inner item takes the block, with one mark per +", () => {
    const input = "* a\n** b\n\n+\n\n+\npara\n";
    expect(astShape(input)).toBe("list(item(t list(item(t ~++p(t)))))");
    expect(itemCount(input)).toBe(oracleItems(input));
  });
});

describe("reader: a //-headed dlist term keeps its own line", () => {
  // ORACLE QUIRK. `Reader#skip_line_comments` takes ANY `//`-headed line
  // (`///b::` included — the classifier, mirroring LineCommentRx, does
  // not), and `parse_list_item` restores what it skipped only when a
  // line follows. So `* a` / `///b::` / `c` renders the dlist, while
  // `* a` / `///b:: c` — the reflowed form — renders nothing after `a`.
  // The term is kept as a verbatim line so the description stays below
  // it.
  test("the term line is verbatim, the description follows it", () => {
    const input = "* a\n///b::\nc\n";
    expect(renderedHtml(input)).toContain("///b</dt>");
    expect(renderedHtml("* a\n///b:: c\n")).not.toContain("///b");
    expect(astShape(input)).toBe("list(item(t -p(raw t)))");
  });
});
