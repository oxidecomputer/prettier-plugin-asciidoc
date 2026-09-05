import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import { astShape } from "./reader-helpers.js";
import type { DelimitedBlockNode } from "../../src/ast.js";

/**
 * The first paragraph-form verbatim block in a parse.
 * @param source - the document
 * @returns the block
 */
function firstStyled(source: string): DelimitedBlockNode {
  const node = parse(source).children.find(
    (child) => child.type === "delimitedBlock" && child.form === "paragraph",
  );
  if (node?.type !== "delimitedBlock") {
    throw new Error(`no styled paragraph in ${JSON.stringify(source)}`);
  }
  return node;
}

// Extents are Ruby's (parser.rb:561-567, :1026-1028), oracle-probed;
// one test per probed row.
describe("verbatim-styled paragraph extents (issue #41)", () => {
  test("#41-1: a [NOTE] line is content", () => {
    expect(firstStyled("[source]\nline1\n[NOTE]\nline2\n").content).toBe(
      "line1\n[NOTE]\nline2",
    );
  });

  test("#41-2: ---- is content once the style is in hand (setext-safe shape)", () => {
    // The issue's own second example (`line1` over `----`) cannot pin
    // this claim: Asciidoctor's setext tolerance — an underline within
    // one character of the title's length — reads it as two sections
    // before the style gets a say (oracle-verified, 2026-08-22). This
    // shape keeps the length gap wide; the oracle reads ONE listing.
    expect(
      firstStyled("[source]\nfirst content line\n----\nbar\n").content,
    ).toBe("first content line\n----\nbar");
  });

  // The issue's original shape opens no styled paragraph: an
  // underline within one character of the line above is a SETEXT
  // TITLE, and `is_next_line_section?` (parser.rb l.1667) is asked
  // before `next_block` reads the style. The oracle renders two
  // sections here and so do we now (issue #16); the format twin pins
  // the bytes.
  test("the issue's original ---- shape is two setext titles", () => {
    expect(
      parse("[source]\nline1\n----\nline2\n----\n").children,
    ).toMatchObject([
      { type: "blockAttributeList" },
      { type: "heading", level: 1, title: "line1" },
      { type: "heading", level: 1, title: "line2" },
    ]);
  });

  test("an opening-line + is content (line_read still false in Ruby)", () => {
    expect(firstStyled("[source]\n+\nfoo\n").content).toBe("+\nfoo");
  });

  test("a next-line + interrupts", () => {
    expect(firstStyled("[source]\nfoo\n+\nbar\n").content).toBe("foo");
  });

  test("a later-line + interrupts", () => {
    expect(firstStyled("[source]\nfoo\nmid\n+\nbar\n").content).toBe(
      "foo\nmid",
    );
  });

  test("a // line is content and stays in the slice", () => {
    expect(firstStyled("[source]\nfoo\n// c\nbar\n").content).toBe(
      "foo\n// c\nbar",
    );
  });

  test("a blank line ends the extent ([verse])", () => {
    expect(firstStyled("[verse]\nfoo\n\nbar\n").content).toBe("foo");
    expect(firstStyled("[verse]\nfoo\n\nbar\n").variant).toBe("verse");
  });

  test("a list marker opens the styled paragraph AT that line", () => {
    expect(astShape("[source]\n* item\n")).toBe("attrs listing[1]");
  });

  test("an indented line opens the styled paragraph (style beats the literal arm)", () => {
    expect(firstStyled("[source]\n  indented\n").content).toBe("  indented");
  });

  test("a block macro line opens the styled paragraph", () => {
    expect(firstStyled("[source]\nimage::x[]\n").content).toBe("image::x[]");
  });

  // `[NOTE]` interrupts the styled paragraph, which is the point of
  // the row; what stands after the interruption is the admonition the
  // style line and its paragraph make together (open-style.ts).
  test("[pass] does NOT capture (not a VERBATIM_STYLES member)", () => {
    expect(astShape("[pass]\nfoo\n[NOTE]\nbar\n")).toBe(
      "attrs pass[1] admonition(note)",
    );
  });

  test("a section title still wins", () => {
    expect(astShape("[source]\n== Title\n")).toBe("attrs h1");
  });
});

// The recorded divergences from Ruby's style handling, pinned so a
// widening cannot land silently. Each is render-preserved by byte
// fidelity — the format twin asserts the bytes.
describe("characterization: the transparency guard and the recorded divergences", () => {
  test("a held title after the attribute line disables the style", () => {
    // Oracle: styles a single listing block WITH the title, class
    // language-ruby.
    expect(astShape("[source,ruby]\n.Title\nfoo\n")).toBe("attrs title p(t)");
  });

  test("a held anchor after the attribute line disables the style", () => {
    // Oracle: a real anchored listing block (`<div id="a"
    // class="listingblock">`).
    // Plan ruling: today the post-pass converted the ANCHOR LINE
    // itself into a one-line styled block (measured at af06b2b2:
    // `attrs listing[1] p(t)`); under the guard the style acts on
    // nothing. The formatted bytes are identical either way — the
    // format twin pins them — and the tree stops lying about a
    // listing that was never there.
    expect(astShape("[source]\n[[a]]\nfoo\n")).toBe("attrs anchor p(t)");
  });

  test("an attribute entry flushes the run and kills the style", () => {
    // Oracle: styles a single listing block whose content is "text".
    expect(astShape("[source]\n:a: b\ntext\n")).toBe("attrs attr p(t)");
  });

  test("[quote] before NOTE: stays an admonition (Ruby would style the quote)", () => {
    expect(astShape("[quote]\nNOTE: x\n")).toBe("attrs admonition(note)");
  });

  test("[quote] before an indented line stays an indented literal", () => {
    // Oracle: a quoteblock (indentation does not stop [quote]).
    expect(astShape("[quote]\n  x\n")).toBe("attrs literal-indented[1]");
  });

  test("[quote] before a dlist-term line leaves the list alone", () => {
    // Oracle: a description list with class "quote", not a quote block
    // - and a description list is what the reader now builds, so the
    // held `[quote]` stays the attribute line it was written as. Red
    // before the description reader: the term line opened a PARAGRAPH,
    // the held style converted it, and the list was gone.
    expect(astShape("[quote]\nterm:: x\n")).toBe("attrs descriptionList");
  });
});
