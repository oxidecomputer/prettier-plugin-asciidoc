import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { ParentBlockNode } from "../../src/ast.js";
import { narrow } from "../helpers.js";

/**
 * Extracts the first child as a ParentBlockNode. Throws
 * if it is not a parent block, surfacing test setup
 * errors early with a clear message.
 * @param children - parsed document children array
 * @returns the first child narrowed to ParentBlockNode
 */
function firstParentBlock(
  children: ReturnType<typeof parse>["children"],
): ParentBlockNode {
  const [block] = children;
  narrow(block, "parentBlock");
  return block;
}

describe("example block parsing", () => {
  // Basic example block with paragraph content.
  test("basic example block", () => {
    const { children } = parse("====\nSome content.\n====\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty example block (no content between delimiters).
  test("empty example block", () => {
    const { children } = parse("====\n====\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(0);
  });

  // Example block with multiple paragraphs separated by
  // blank lines.
  test("multiple inner paragraphs", () => {
    const { children } = parse(
      "====\nFirst paragraph.\n\nSecond paragraph.\n====\n",
    );
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(2);
    expect(block.children[0].type).toBe("paragraph");
    expect(block.children[1].type).toBe("paragraph");
  });

  // 6-character example delimiter: confirms any repeat length
  // >= 4 is accepted, not just exactly 4.
  test("extended delimiter length", () => {
    const { children } = parse("======\nContent.\n======\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });
});

describe("sidebar block parsing", () => {
  // Basic sidebar block with paragraph content.
  test("basic sidebar block", () => {
    const { children } = parse("****\nSidebar content.\n****\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty sidebar block.
  test("empty sidebar block", () => {
    const { children } = parse("****\n****\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(0);
  });

  // Sidebar block with multiple inner paragraphs.
  test("multiple inner paragraphs", () => {
    const { children } = parse("****\nFirst.\n\nSecond.\n****\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(2);
  });
});

describe("open block parsing", () => {
  // Basic open block with paragraph content.
  test("basic open block", () => {
    const { children } = parse("--\nOpen content.\n--\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty open block.
  test("empty open block", () => {
    const { children } = parse("--\n--\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(0);
  });

  // Open block with multiple inner paragraphs.
  test("multiple inner paragraphs", () => {
    const { children } = parse("--\nFirst.\n\nSecond.\n--\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(2);
  });

  // The conventional spelling records no fact - the printer's fallback
  // is what makes it conventional. Red before the field existed, since
  // `openDelimiter` did not exist to read.
  test("the conventional spelling carries no openDelimiter", () => {
    const { children } = parse("--\nOpen content.\n--\n");
    const block = firstParentBlock(children);
    expect(block.openDelimiter).toBeUndefined();
  });

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
    const block = firstParentBlock(children);
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
  test("a bare four-tilde run opens an open block", () => {
    const { children } = parse("~~~~\nOpen content.\n~~~~\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("open");
    expect(block.openDelimiter).toBe("~");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty tilde open block.
  test("empty tilde open block", () => {
    const { children } = parse("~~~~\n~~~~\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("open");
    expect(block.openDelimiter).toBe("~");
    expect(block.children).toHaveLength(0);
  });

  // The recorded fact is the CHARACTER, not the run: a longer opener
  // still records "~", the same as the four-tilde minimum, because
  // the printer picks its own safe length rather than replaying the
  // author's count (src/print/blocks.ts, confluence gate
  // `delimiterLength/openBlockTilde`). tests/format/parent-block.test.ts
  // pins what that length comes out to.
  test("a longer tilde run records the same character fact", () => {
    const { children } = parse("~~~~~~\nContent.\n~~~~~~\n");
    const block = firstParentBlock(children);
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

  // The corpus shape issue #64 tracks: a fenced-code-LOOKING opener
  // with a trailing word carries no attribute and is ordinary
  // paragraph text (measured against the oracle - see this describe
  // block's own header), so it joins the paragraph above the trailing
  // bare `~~~~` line, which is the one line that actually opens
  // anything: an EMPTY open block, unterminated at EOF.
  test("corpus/blocks_test.rb#should not recognize fenced code blocks with more than three delimiters", () => {
    const { children } = parse(
      'first paragraph.\n\n~~~~ javascript\nalert("Hello, World!")\n~~~~\n',
    );
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("paragraph");
    const block = firstParentBlock(children.slice(2));
    expect(block.variant).toBe("open");
    expect(block.openDelimiter).toBe("~");
    expect(block.children).toHaveLength(0);
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
    const block = firstParentBlock(children.slice(1));
    expect(block.variant).toBe("open");
    expect(block.openDelimiter).toBe("~");
  });
});

describe("quote block parsing", () => {
  // Basic quote block with paragraph content.
  test("basic quote block", () => {
    const { children } = parse("____\nQuoted text.\n____\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty quote block.
  test("empty quote block", () => {
    const { children } = parse("____\n____\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(0);
  });

  // Quote block with multiple inner paragraphs.
  test("multiple inner paragraphs", () => {
    const { children } = parse("____\nFirst.\n\nSecond.\n____\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(2);
  });
});

describe("parent block context", () => {
  // Parent block between paragraphs.
  test("between paragraphs", () => {
    const { children } = parse("Before.\n\n====\nInside.\n====\n\nAfter.\n");
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("parentBlock");
    expect(children[2].type).toBe("paragraph");
  });

  // Position tracking: all three fields (line, column, offset)
  // on the open delimiter's start position are verified.
  test("position tracking", () => {
    const { children } = parse("====\nContent.\n====\n");
    const block = firstParentBlock(children);
    expect(block.position.start.line).toBe(1);
    expect(block.position.start.column).toBe(1);
    expect(block.position.start.offset).toBe(0);
  });

  // Nested parent blocks: example inside sidebar.
  test("nested parent blocks", () => {
    const { children } = parse("****\n====\nNested content.\n====\n****\n");
    const outer = firstParentBlock(children);
    expect(outer.variant).toBe("sidebar");
    expect(outer.children).toHaveLength(1);
    const inner = firstParentBlock(outer.children);
    expect(inner.variant).toBe("example");
    const { children: innerChildren } = inner;
    expect(innerChildren).toHaveLength(1);
    expect(innerChildren[0]).toHaveProperty("type", "paragraph");
  });

  // A listing block (leaf) inside a parent block.
  test("leaf block inside parent block", () => {
    const { children } = parse("====\n----\ncode\n----\n====\n");
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("delimitedBlock");
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
    const block = firstParentBlock(children);
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
    const block = firstParentBlock(children);
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
    const block = firstParentBlock(children);
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
    const block = firstParentBlock(children);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  test("matching 5-char sidebar delimiters", () => {
    const { children } = parse("*****\nContent.\n*****\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  test("matching 5-char quote delimiters", () => {
    const { children } = parse("_____\nContent.\n_____\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Nested same-type blocks with different delimiter lengths.
  // Outer uses 6-char, inner uses 4-char.
  test("nested same-type example blocks", () => {
    const { children } = parse("======\n====\nNested content.\n====\n======\n");
    expect(children).toHaveLength(1);
    const outer = firstParentBlock(children);
    expect(outer.variant).toBe("example");
    expect(outer.children).toHaveLength(1);
    const inner = firstParentBlock(outer.children);
    expect(inner.variant).toBe("example");
    expect(inner.children).toHaveLength(1);
    expect(inner.children[0].type).toBe("paragraph");
  });

  // Open blocks use a fixed `--` delimiter (not a repeating
  // pattern), so delimiter-length matching doesn't apply.
  // This test confirms open blocks parse correctly alongside
  // the variable-length example/sidebar/quote blocks.
  test("open blocks are unaffected", () => {
    const { children } = parse("--\nContent.\n--\n");
    expect(children).toHaveLength(1);
    const block = firstParentBlock(children);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });
});
