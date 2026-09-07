import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { parentBlockAt } from "../helpers.js";

describe("open block parsing", () => {
  // The opening line's own trailing whitespace is not recorded: a
  // real, shipped-and-reverted bug (src/parse/build/delimited.ts's
  // openDelimiterFact used the Fragment's raw span, which keeps
  // trailing whitespace, instead of the rstripped text every other
  // reading site compares against). Red before the rstrip fix: this
  // built `openDelimiter: "--  "` (the trailing spaces kept), which
  // is a bug the FORMATTED OUTPUT never shows (Prettier's own core
  // printer trims trailing whitespace from every line regardless of
  // what a plugin puts there), so only a fact-level check like this
  // one, or the reparse-ledger's parse/format/reparse comparison,
  // can see it at all.
  test("the opening line's own trailing whitespace is not recorded", () => {
    const { children } = parse("--  \nOpen content.\n--\n");
    const block = parentBlockAt(children, 0);
    expect(block.openDelimiter).toBeUndefined();
  });
});

// A run of four or more tildes opens the SAME "open" content model as
// `--` (DELIMITED_BLOCKS['~~~~'], absent from the vendored Ruby
// entirely) to the pinned JS oracle, measured directly against
// @asciidoctor/core 4.0.11: MEASURED, the minimum length is four (a
// three-tilde run is ordinary text, joined into whatever paragraph
// precedes it); the terminator is EXACT-byte, so a longer opener
// needs the SAME longer closer and stays open, unterminated to EOF,
// when it does not meet one; a style tried against a tilde open,
// matched member included, still returns `context: "open"` (never a
// masquerade or an admonition rename); and `~~~~ javascript` is not a
// delimiter line at all - trailing text after the tildes fails the
// tail-uniform match Ruby's own tail-matching entry requires, so the
// whole line reads as ordinary paragraph text and carries no
// attribute the way a Markdown fence's language hint would. Red
// before `openBlockTilde` existed: every row below built a paragraph
// (or joined into one) with no ParentBlockNode at all.
describe("open block parsing via tilde (issue #64)", () => {
  // The recorded fact is the CHARACTER, not the run: a longer opener
  // still records "~", the same as the four-tilde minimum, because
  // the printer picks its own safe length rather than replaying the
  // author's count (src/print/blocks.ts, confluence gate
  // `delimiterLength/openBlockTilde`). tests/format/parent-block.test.ts
  // pins what that length comes out to.
  test("a longer tilde run records the same character fact", () => {
    const { children } = parse("~~~~~~\nContent.\n~~~~~~\n");
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("open");
    expect(block.openDelimiter).toBe("~");
    expect(block.children).toHaveLength(1);
  });

  // Below the minimum length, three tildes are not a delimiter at
  // all: they join into an ordinary paragraph the way any other text
  // line would (measured: the oracle produces one `paragraph` node
  // over all three lines, not a heading and not a block).
  test("three tildes do not open a block", () => {
    const { children } = parse("~~~\nnot a block\n~~~\n");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("paragraph");
  });

  // A style is INERT on a tilde open: the oracle's own masquerade set
  // for `~~~~` is narrower than `--`'s and neither member is a
  // variant this parser models, so every style measures back to a
  // plain "open" (this describe block's own header). The attribute
  // list still parses as its own sibling node - dropping the style
  // changes what the BLOCK models, not whether the line survives.
  test("a style does not masquerade a tilde open", () => {
    const { children } = parse("[quote]\n~~~~\nfoo\n~~~~\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = parentBlockAt(children, 1);
    expect(block.variant).toBe("open");
    expect(block.openDelimiter).toBe("~");
  });
});

describe("parent block context", () => {
  // Position tracking: all three fields (line, column, offset)
  // on the open delimiter's start position are verified.
  test("position tracking", () => {
    const { children } = parse("====\nContent.\n====\n");
    const block = parentBlockAt(children, 0);
    expect(block.position.start.line).toBe(1);
    expect(block.position.start.column).toBe(1);
    expect(block.position.start.offset).toBe(0);
  });
});

describe("delimiter length matching", () => {
  // The close delimiter must be exactly the same length as the
  // open delimiter. A shorter delimiter is NOT the close —
  // it opens a nested block of the same type instead.
  test("example block close must match open length", () => {
    // Open with 5 `=`, attempt close with 4 `=` — the 4-char
    // line is not the close delimiter for the outer block.
    // Instead it opens a nested example block. The second
    // `====` immediately closes that nested block (empty),
    // leaving the outer 5-char block unclosed.
    const { children } = parse("=====\nContent.\n====\n====\n");
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("example");
    // Children: paragraph("Content.") + nested empty example
    expect(block.children).toHaveLength(2);
    expect(block.children[0].type).toBe("paragraph");
    expect(block.children[1].type).toBe("parentBlock");
  });

  // Open with 5 `*`, attempt close with 4 `*` — the 4-char
  // line opens a nested sidebar. The second `****` closes
  // that nested block (empty), leaving the outer unclosed.
  test("sidebar block close must match open length", () => {
    const { children } = parse("*****\nContent.\n****\n****\n");
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("sidebar");
    // Children: paragraph("Content.") + nested empty sidebar
    expect(block.children).toHaveLength(2);
    expect(block.children[0].type).toBe("paragraph");
    expect(block.children[1].type).toBe("parentBlock");
  });

  // Open with 5 `_`, attempt close with 4 `_` — the 4-char
  // line opens a nested quote. The second `____` closes
  // that nested block (empty), leaving the outer unclosed.
  test("quote block close must match open length", () => {
    const { children } = parse("_____\nContent.\n____\n____\n");
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("quote");
    // Children: paragraph("Content.") + nested empty quote
    expect(block.children).toHaveLength(2);
    expect(block.children[0].type).toBe("paragraph");
    expect(block.children[1].type).toBe("parentBlock");
  });

  // Matching delimiter lengths work as expected.
  test("matching 5-char example delimiters", () => {
    const { children } = parse("=====\nContent.\n=====\n");
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  test("matching 5-char sidebar delimiters", () => {
    const { children } = parse("*****\nContent.\n*****\n");
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  test("matching 5-char quote delimiters", () => {
    const { children } = parse("_____\nContent.\n_____\n");
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });
});
