/**
 * BlockReader characterization: LISTS — the port of
 * `read_lines_for_list_item`, its `+` continuation state machine, and
 * the stream invariants every document must satisfy.
 *
 * Split from reader.test.ts, which covers everything the reader does
 * outside a list frame. Both share tests/parser/reader-helpers.ts.
 *
 * Every list row is oracle-pinned twice: the SHAPE says where the
 * reader put the boundaries, and the ItemEnd count must equal
 * Asciidoctor's `<li>` count. Where the two disagreed while these were
 * written, the oracle won and the shape was fixed.
 */
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { asciidocParser } from "../../src/parse/grammar.js";
import { readBlocks } from "../../src/parse/lines/reader.js";
import { randomInput, readerDocument } from "../fuzz/arbitraries.js";
import { fuzzParameters } from "../fuzz/config.js";
import { renderedHtml } from "../helpers.js";
import { count, oracleItems, shape } from "./reader-helpers.js";

describe("reader: list items (read_lines_for_list_item)", () => {
  const rows: Array<[string, string, string]> = [
    [
      "siblings by style",
      "* a\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "continuation lines are item text (incl. indented and block-shaped)",
      "* a\n  b\n.c\nNOTE: d\n",
      "UnorderedListMarker ParagraphStart t / t / t / t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "a different style nests (is_sibling_list_item? compares markers)",
      "* a\n** b\n* c\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd NoContinuation UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "- under * nests (different style)",
      "* a\n- b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd NoContinuation UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd ItemEnd ListEnd",
    ],
    [
      "an ordered list nests a bullet and resumes",
      ". a\n* b\n. c\n",
      "OrderedListMarker ParagraphStart t / ParagraphEnd NoContinuation UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd ItemEnd OrderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "blank line between siblings keeps the list",
      "* a\n\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "blank then plain text ends every open list",
      "* a\n** b\n\npara\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd NoContinuation UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd ItemEnd ListEnd ParagraphStart t / ParagraphEnd",
    ],
    [
      "+ attaches a paragraph read with the plain set (a foreign marker is a RawLine, not an end)",
      "* a\n+\npara\n. next\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ParagraphStart t / RawLine ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then ONE blank then content still attaches (continuation stays active)",
      "* a\n+\n\npara\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ParagraphStart t / ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then TWO blanks ends the list and drops the +",
      "* a\n+\n\n\npara\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd ParagraphStart t / ParagraphEnd",
    ],
    [
      "blank(s) then + is a detached continuation, noted for the printer",
      "* a\n\n\n+\npara\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd DetachedContinuation ParagraphStart t / ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "metadata plays out between + and the block",
      "* a\n+\n[source]\n.T\n----\nx\n----\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd BlockAttributeLine NoContinuation BlockTitleLine NoContinuation VerbatimBlockOpen VerbatimLine VerbatimBlockClose ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ chain after a delimited block",
      "* a\n+\n----\nx\n----\n+\npara\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd VerbatimBlockOpen VerbatimLine VerbatimBlockClose ParagraphStart t / ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then ONE blank then a delimited block still attaches",
      "* a\n+\n\n----\nx\n----\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd VerbatimBlockOpen VerbatimLine VerbatimBlockClose ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then TWO blanks then a listing block: the block lands OUTSIDE the list",
      "* a\n+\n\n\n----\nx\n----\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd VerbatimBlockOpen VerbatimLine VerbatimBlockClose UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then TWO blanks then an example block: outside too",
      "* a\n+\n\n\n====\nx\n====\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd CompoundBlockOpen ParagraphStart t / ParagraphEnd CompoundBlockClose UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then TWO blanks then an open block: outside too",
      "* a\n+\n\n\n--\nx\n--\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd CompoundBlockOpen ParagraphStart t / ParagraphEnd CompoundBlockClose UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then TWO blanks then a comment block: outside too",
      "* a\n+\n\n\n////\nx\n////\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd VerbatimBlockOpen VerbatimLine VerbatimBlockClose UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then TWO blanks then an indented literal: the item keeps it, the + is gone",
      "* a\n+\n\n\n  lit\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd BlankSeparated LiteralLine LiteralLine LiteralParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then TWO blanks then a dlist term: the item keeps it, the + is gone",
      "* a\n+\n\n\nterm:: def\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd BlankSeparated ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then TWO blanks then a nested marker: the item keeps it, the + is gone",
      "* a\n+\n\n\n** b\n* c\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd BlankSeparated UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "+ then TWO blanks then a sibling: the + is gone",
      "* a\n+\n\n\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "a delimiter without + ends the item AND the list",
      "* a\n-----\nx\n-----\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd VerbatimBlockOpen VerbatimLine VerbatimBlockClose",
    ],
    [
      "an attribute line without + stays INSIDE the item as metadata for its next block",
      "* a\n[source]\ncode\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd NoContinuation BlockAttributeLine NoContinuation ParagraphStart t / ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "an anchor directly after item text is a raw line (fold_first discards it)",
      "* a\n[[x]]\npara\n",
      "UnorderedListMarker ParagraphStart t / RawLine t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "a trailing + at EOF is dangling",
      "* a\n+\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd DanglingContinuation ItemEnd ListEnd",
    ],
    [
      "indented content after + is a literal paragraph that runs on through a sibling marker",
      "* a\n+\n  lit\nflush\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd LiteralLine LiteralLine LiteralLine LiteralParagraphEnd ItemEnd ListEnd",
    ],
    [
      "indented paragraph after a blank stays in the item (slurp literal offset by blank lines)",
      "* a\n\n  lit\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd BlankSeparated LiteralLine LiteralLine LiteralParagraphEnd ItemEnd ListEnd",
    ],
    [
      "a dlist term ends item text and continues as a dlistItem paragraph inside the item",
      "* a\nterm:: def\nmore\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd NoContinuation ParagraphStart t / t / ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "a dlist term after a blank line keeps the item open (NESTABLE_LIST_CONTEXTS)",
      "* a\n\nterm:: def\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd BlankSeparated ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "a section title after + is attached paragraph text (no sections inside list readers)",
      "* a\n+\n== H\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "a callout list after item text is an in-item block (colist is not NESTABLE)",
      "* a\n<1> x\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd NoContinuation CalloutListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd ItemEnd ListEnd",
    ],
    [
      "a callout list after a BLANK line ends the list (colist is not NESTABLE)",
      "* a\n\n<1> b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd CalloutListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "callouts",
      "<1> a\n<2> b\n",
      "CalloutListMarker ParagraphStart t / ParagraphEnd ItemEnd CalloutListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "admonition paragraph",
      "NOTE: a\nb\n",
      "AdmonitionLabel ParagraphStart t / t / ParagraphEnd",
    ],
    [
      "admonition after + inside an item",
      "* a\n+\nNOTE: b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd AdmonitionLabel ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "a list inside a compound block closes with the block",
      "====\n* a\n====\n",
      "CompoundBlockOpen UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd CompoundBlockClose",
    ],
    [
      "a compound block confines the list reader: a blank+text ends only the INNER list",
      "* a\n+\n====\n* x\n\npara\n====\n* b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd CompoundBlockOpen UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd ParagraphStart t / ParagraphEnd CompoundBlockClose ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
  ];
  test.each(rows)("%s", (_name, input, expected) => {
    const tokens = readBlocks(input);
    expect(shape(tokens)).toBe(expected);
    expect(count(tokens, "ItemEnd"), "one ItemEnd per oracle <li>").toBe(
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
      "UnorderedListMarker ParagraphStart t / ParagraphEnd NoContinuation UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "an indented SAME-STYLE marker is a sibling (indentation is not depth)",
      "* a\n  * b\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
    [
      "a tab gap is a marker",
      "* a\n*\tb\n",
      "UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    ],
  ])("%s", (_name, input, expected) => {
    const tokens = readBlocks(input);
    expect(shape(tokens)).toBe(expected);
    expect(count(tokens, "ItemEnd")).toBe(oracleItems(input));
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
    expect(shape(readBlocks(input))).toBe(
      "UnorderedListMarker ParagraphStart t / ParagraphEnd RawLine NoContinuation BlockAttributeLine NoContinuation BlockTitleLine ItemEnd ListEnd VerbatimBlockOpen VerbatimLine VerbatimBlockClose UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    );
  });
  test("metadata held inside an item is released before the token that follows it", () => {
    // Regression, found by fuzzing the reader over random line
    // sequences: a held-back `[source]` / `[[x]]` sits at an EARLIER
    // offset than the label or the frozen `+` that follows it, so both
    // have to flush first or the stream stops being offset-sorted —
    // which the corpus position suite requires of every token. Shape
    // only: the second row's `ifdef::` is one the preprocessor eats
    // (with everything after it, there being no `endif`), so the
    // oracle sees a different document than the reader does.
    expect(shape(readBlocks("** b\n  lit\n[source]\nNOTE: x\n"))).toBe(
      "UnorderedListMarker ParagraphStart t / t / ParagraphEnd BlockAttributeLine NoContinuation AdmonitionLabel ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    );
    expect(
      shape(readBlocks("** b\nifdef::x[]\n// c\n[[x]]\n+\n+\n* a\n")),
    ).toBe(
      "UnorderedListMarker ParagraphStart t / RawLine RawLine ParagraphEnd NoContinuation AnchorLine RawLine NoContinuation UnorderedListMarker ParagraphStart t / ParagraphEnd ItemEnd ListEnd ItemEnd ListEnd",
    );
    // The invariant they were FOUND by, not just the shape they settled
    // on: offsets monotone, images exact, boundaries balanced.
    expectStreamInvariants("** b\n  lit\n[source]\nNOTE: x\n");
    expectStreamInvariants("** b\nifdef::x[]\n// c\n[[x]]\n+\n+\n* a\n");
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
    expect(shape(readBlocks("* a\n+\n+\n+\nAttached\n"))).toBe(
      "UnorderedListMarker ParagraphStart t / ParagraphEnd RawLine NoContinuation RawLine NoContinuation ParagraphStart t / ParagraphEnd ItemEnd ListEnd",
    );
  });
});

/**
 * The invariants every token stream must satisfy, whatever the input.
 * Extracted so the two fuzz-regression documents and the property test
 * check exactly the same things.
 * @param source - the document the tokens came from
 */
function expectStreamInvariants(source: string): void {
  const tokens = readBlocks(source);
  // 1. Offsets are monotone. The reader holds metadata lines back, so
  //    a token emitted later can carry an EARLIER offset unless every
  //    holder releases its run first — the exact bug the reader fuzz
  //    found twice.
  const offsets = tokens.map((t) => t.startOffset);
  expect(offsets, "tokens are offset-sorted").toEqual(
    offsets.toSorted((a, b) => a - b),
  );
  // 2. Every token's image is the source slice at its own offsets.
  for (const token of tokens) {
    const { startOffset } = token;
    const end = token.endOffset ?? startOffset - 1;
    expect(
      source.slice(startOffset, end + 1),
      `${token.tokenType.name} image`,
    ).toBe(token.image);
  }
  // 3. Paragraph boundaries nest: never negative, always balanced.
  let open = 0;
  for (const { tokenType } of tokens) {
    if (tokenType.name === "ParagraphStart") open += 1;
    if (tokenType.name === "ParagraphEnd") open -= 1;
    expect(open, "ParagraphEnd without ParagraphStart").toBeGreaterThanOrEqual(
      0,
    );
  }
  expect(open, "unclosed paragraph").toBe(0);
  // 4. One ItemEnd per marker, and the list/item ends come in the order
  //    closeList emits them: DanglingContinuation? ItemEnd, then ListEnd.
  const names = tokens.map((t) => t.tokenType.name);
  const { length: markers } = names.filter((n) => n.endsWith("ListMarker"));
  expect(names.filter((n) => n === "ItemEnd")).toHaveLength(markers);
  for (const [index, name] of names.entries()) {
    if (name === "ListEnd") {
      expect(names[index - 1], "ListEnd follows ItemEnd").toBe("ItemEnd");
    }
    if (name === "DanglingContinuation") {
      expect(names[index + 1], "DanglingContinuation ends an item").toBe(
        "ItemEnd",
      );
    }
  }
  // 5. The grammar accepts the stream. This is the invariant with a
  //    consumer: the reader's output is the parser's WHOLE input, and
  //    recovery is enabled, so a mis-ordered stream that satisfies 1-4
  //    would otherwise degrade quietly to the AST builder's placeholder
  //    paragraph instead of failing here.
  asciidocParser.input = tokens;
  asciidocParser.document();
  expect(
    asciidocParser.errors.map((error) => error.message),
    "the grammar rejected the stream",
  ).toEqual([]);
}

// A malformed stream is not loud on its own — the grammar recovers and
// the printer still prints something, which is why invariant 5 above
// parses every generated document. These properties are the standing
// gate: they are what found the two ordering regressions pinned above,
// and they are SEEDED (tests/fuzz/config.ts) so the suite stays
// deterministic — `FUZZ=1 bun vitest run tests/parser/reader.test.ts`
// fuzzes forever.
// A detached `+` inside a nested list is the OUTERMOST item's, but the
// moment the inner item keeps the line after it (a sibling or nested
// marker, a dlist term, a literal paragraph) Ruby's outer loop buffers
// that line through its `continuation == :active` branch and sets
// `continuation = :inactive` — so a later blank-separated block is
// OUTSIDE the list, not the outer item's. Only metadata leaves it
// active ("let block metadata play out until we find the block").
describe("reader: a detached + an outer item took is released when the inner item keeps the next line", () => {
  const outside: Array<[string, string, RegExp]> = [
    [
      "sibling marker",
      "* a\n** b\n\n+\n** c\n\npara\n",
      /ListEnd ParagraphStart t \/ ParagraphEnd$/v,
    ],
    [
      "literal paragraph",
      "* a\n** b\n\n+\n  lit\n\npara\n",
      /ListEnd ParagraphStart t \/ ParagraphEnd$/v,
    ],
    [
      "sibling marker, then a listing",
      "* a\n** b\n\n+\n** c\n\n----\nx\n----\n",
      /ListEnd VerbatimBlockOpen VerbatimLine VerbatimBlockClose$/v,
    ],
    [
      "literal paragraph, then a listing",
      "* a\n** b\n\n+\n  lit\n\n----\nx\n----\n",
      /ListEnd VerbatimBlockOpen VerbatimLine VerbatimBlockClose$/v,
    ],
    [
      "dlist term",
      "* a\n** b\n\n+\nterm:: d\n\npara\n",
      /ListEnd ParagraphStart t \/ ParagraphEnd$/v,
    ],
    [
      "two sibling markers",
      "* a\n** b\n\n+\n** c\n** d\n\npara\n",
      /ListEnd ParagraphStart t \/ ParagraphEnd$/v,
    ],
  ];
  test.each(outside)(
    "%s: the blank-separated block is outside the list",
    (_name, input, tail) => {
      const tokens = readBlocks(input);
      expect(shape(tokens)).toMatch(tail);
      expect(count(tokens, "ItemEnd")).toBe(oracleItems(input));
    },
  );
  test("metadata after the detached + keeps it active for the outer item", () => {
    const input = "* a\n** b\n\n+\n[role]\npara\n";
    const tokens = readBlocks(input);
    // The inner list ends at the metadata line; the paragraph is a's —
    // the detached `+` speaks for the metadata it stands above, and the
    // paragraph under it is stacked (no `+` of its own).
    expect(shape(tokens)).toMatch(
      /ItemEnd ListEnd DetachedContinuation BlockAttributeLine NoContinuation ParagraphStart t \/ ParagraphEnd ItemEnd ListEnd$/v,
    );
    expect(count(tokens, "ItemEnd")).toBe(oracleItems(input));
  });
});

describe("reader: stacked detached continuations", () => {
  // Ruby's outer item erases only the LAST detached `+`
  // (`detached_continuation` is a scalar); the inner item re-reads the
  // first as its own and takes the block. Both marks ride ahead of it
  // so the printer writes both `+` lines back.
  test("the inner item takes the block, with one mark per +", () => {
    const input = "* a\n** b\n\n+\n\n+\npara\n";
    expect(shape(readBlocks(input))).toBe(
      "UnorderedListMarker ParagraphStart t / ParagraphEnd NoContinuation UnorderedListMarker ParagraphStart t / ParagraphEnd DetachedContinuation DetachedContinuation ParagraphStart t / ParagraphEnd ItemEnd ListEnd ItemEnd ListEnd",
    );
    expect(count(readBlocks(input), "ItemEnd")).toBe(oracleItems(input));
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
    expect(shape(readBlocks(input))).toBe(
      "UnorderedListMarker ParagraphStart t / ParagraphEnd NoContinuation ParagraphStart RawLine t / ParagraphEnd ItemEnd ListEnd",
    );
  });
});

describe("reader: stream invariants under fuzzing", () => {
  // 3000 runs, not a few hundred: the run count is load-bearing and was
  // chosen by mutation testing. Re-introducing either of the two fixed
  // ordering bugs (dropping the flushMetadata before AdmonitionLabel, or
  // emitting the frozen `+` without releasing metadata first) is caught
  // at 3000 and NOT at 300 — fast-check shrinks them to
  // `* a\n<<<\n[[x]]\nNOTE: x\n* a` and `* a\n[source]\n+ \n+ `. The whole
  // suite costs ~2s.
  test("reader line soup holds every invariant", () => {
    fc.assert(
      fc.property(readerDocument, (source) => {
        expectStreamInvariants(source);
      }),
      fuzzParameters({ numRuns: 3000 }),
    );
  });
  test("random Unicode input holds every invariant", () => {
    fc.assert(
      fc.property(randomInput, (source) => {
        expectStreamInvariants(source);
      }),
      fuzzParameters({ numRuns: 200 }),
    );
  });
});
