/**
 * BlockReader characterization: the SHAPE of the parsed document and
 * where blocks END.
 *
 * These shape assertions are the reader's contract: every row is
 * pinned as `astShape(input)` over the AST `parse()` builds, so the
 * rows survive the reader's move off the token stream unchanged. Where
 * a shape is surprising, the oracle (`renderedHtml`) is asserted
 * alongside it — the oracle is Asciidoctor Ruby transpiled by Opal and
 * wins over any reading of parser.rb. Position exactness over the
 * whole corpus lives in tests/parser/ast-invariants.test.ts.
 */
import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/narrow.js";
import { renderedHtml } from "../helpers.js";
import { astShape } from "./reader-helpers.js";

describe("reader: paragraphs", () => {
  test("a paragraph is one node with one fragment per text run", () => {
    expect(astShape("a\nb\n")).toBe("p(t / t)");
  });
  test("a raw line splits the inline runs but not the paragraph", () => {
    expect(astShape("a\n// c\nb\n")).toBe("p(t raw t)");
  });
  test("a raw line that ends the paragraph stays inside it", () => {
    expect(astShape("a\n// c\n\nb\n")).toBe("p(t raw) p(t)");
  });
  test("blank lines end a paragraph and leave no node of their own", () => {
    expect(astShape("a\n\n\nb\n")).toBe("p(t) p(t)");
  });
  test("a +-line interrupts a plain paragraph and opens the next as text (read_lines_until line_read guard)", () => {
    expect(astShape("a\n+\nb\n")).toBe("p(t) p(t / t)");
  });
  test("block-shaped lines mid-paragraph are text", () => {
    expect(astShape("a\n* item\n.Title\n== S\nNOTE: x\n")).toBe(
      "p(t / t / t / t / t)",
    );
  });
  test("a NOTE: label makes the whole paragraph an admonition", () => {
    expect(astShape("NOTE: x\ny\n")).toBe("admonition(note)");
  });
});

describe("reader: headings and metadata", () => {
  test("headings are leaves at every level; nothing nests", () => {
    expect(astShape("== A\n\np\n\n=== B\n\nq\n\n== C\n")).toBe(
      "h1 p(t) h2 p(t) h1",
    );
  });
  test("a heading does NOT interrupt an open paragraph (StartOfBlockProc has no title rule)", async () => {
    // ORACLE: `p` and `=== B` render as ONE paragraph — a section title
    // must be preceded by a blank line. read_paragraph_lines breaks at
    // StartOfBlockProc, which tests only BlockAttributeLineRx and
    // is_delimited_block?.
    expect(await renderedHtml("p\n=== B\n")).toContain("p === B");
    expect(astShape("p\n=== B\n")).toBe("p(t / t)");
  });
  test("metadata (and comments) before a closing heading belong to the new section (next_section + parse_block_metadata_lines)", async () => {
    // ORACLE: the anchor above `== B` becomes B's id, not A's.
    expect(await renderedHtml("== A\np\n[[id]]\n// c\n\n== B\n")).toContain(
      'id="id">B',
    );
    expect(astShape("== A\np\n[[id]]\n// c\n\n== B\n")).toBe(
      "h1 p(t) anchor comment h1",
    );
  });
  test("a comment before a closing heading migrates into the new section", () => {
    // parse_block_metadata_lines consumes the comment BEFORE
    // is_next_line_section? runs, so it belongs to the section the next
    // title opens. This reverses the limitation the old post-hoc
    // section nester documented; the rendering is identical (the oracle
    // emits no node for a comment either way).
    expect(astShape("== A\n// c\n\n== B\n")).toBe("h1 comment h1");
  });
  test("[discrete] turns the heading into a leaf", () => {
    expect(astShape("== A\n[discrete]\n=== B\np\n")).toBe(
      "h1 attrs heading p(t)",
    );
  });
  test("[discrete ] with trailing blanks is still discrete (the style is trimmed)", async () => {
    // ORACLE: Asciidoctor trims the first positional attribute, so
    // `[discrete ]` styles the heading exactly as `[discrete]` does —
    // a `<h2 class="discrete">`, never a section. The reader reads the
    // style off the raw attribute LINE, so the trim in
    // `parseAttrlist` is what makes the two spellings agree.
    expect(await renderedHtml("[discrete ]\n== H\n")).toContain(
      'class="discrete"',
    );
    expect(astShape("[discrete ]\n== H\n")).toBe("attrs heading");
  });
  test("headings inside a compound block are paragraph text (next_block never makes sections)", () => {
    expect(astShape("====\n== H\n====\n")).toBe("example(p(t))");
  });
  test("a level-0 title is a heading leaf like any other", () => {
    expect(astShape("= Doc\n\np\n")).toBe("h0 p(t)");
  });
});

describe("reader: delimited blocks", () => {
  test("verbatim content until the matching close; a blank line inside stays content", () => {
    expect(astShape("----\ncode\n\n----\n")).toBe("listing[2]");
  });
  test("the OUTERMOST matching terminator closes, even from inside a listing (read_lines_until is flat)", () => {
    expect(astShape("====\n----\n====\n----\n")).toBe(
      "example(listing[0]) listing[0]",
    );
  });
  test("a forced-closed block ends where the line that took it begins", () => {
    // The inner listing never met its own terminator: the outer `====`
    // claimed the line, so the listing has no content and ends at the
    // start of that terminator line (offset 10), not at its end and not
    // at the document end. `astShape` cannot show "unclosed", so the
    // information the token stream's UnclosedEnd carried is pinned here.
    const {
      children: [outer],
    } = parse("====\n----\n====\n----\n");
    narrow(outer, "parentBlock");
    const {
      children: [inner],
    } = outer;
    narrow(inner, "delimitedBlock");
    expect(inner.content).toBe("");
    expect(inner.position.end.offset).toBe(10);
    // …and the parent block that took the line ends ON its terminator.
    expect(outer.position.end.offset).toBe(14);
  });
  test("an unterminated block still keeps its content lines", () => {
    expect(astShape("----\ncode\n")).toBe("listing[1]");
  });
  test("a block unterminated at EOF ends at the document end", () => {
    const {
      children: [block],
    } = parse("----\ncode\n");
    narrow(block, "delimitedBlock");
    expect(block.content).toBe("code");
    expect(block.position.end.offset).toBe(10);
  });
  test("a fence with a language hint closes on ```", () => {
    expect(astShape("```ruby\nx\n```\n")).toBe("listing[1]");
  });
  test("delimiters with trailing spaces are delimiters (rstrip)", () => {
    expect(astShape("----  \nx\n----\n")).toBe("listing[1]");
  });
  test("a compound block nests blocks; a heading inside it is a leaf", () => {
    expect(astShape("====\np\n\n----\nx\n----\n====\n")).toBe(
      "example(p(t) listing[1])",
    );
  });
  test("an unterminated block after a heading ends at EOF", () => {
    expect(astShape("== A\n\n----\nx\n")).toBe("h1 listing[1]");
  });
  test("EOF forces an unterminated block shut; the heading before it is a sibling leaf", () => {
    const source = "== A\n\n----\nx\n";
    const {
      children: [, block],
    } = parse(source);
    narrow(block, "delimitedBlock");
    expect(block.content).toBe("x");
    expect(block.position.end.offset).toBe(source.length);
  });
});

describe("reader: literal paragraphs", () => {
  test("a literal paragraph continues through flush lines until blank/block (read_paragraph_lines)", async () => {
    expect(astShape("  lit\nflush\n\nnext\n")).toBe("literal-indented[2] p(t)");
    // Oracle corroboration: one literal block containing both lines.
    const html = await renderedHtml("  lit\nflush\n");
    expect((html.match(/<pre>/gv) ?? []).length).toBe(1);
  });
  test("a comment inside a document-level literal paragraph stays in place", async () => {
    // ORACLE SURPRISE recorded in classify.ts: read_paragraph_lines is
    // called with `skip_line_comments: text_only`, so the `//` line is
    // NOT dropped — Asciidoctor renders it as literal content, and the
    // literal paragraph runs on THROUGH it.
    expect(await renderedHtml("  lit\n// c\nmore\n")).toContain(
      "  lit\n// c\nmore",
    );
    expect(astShape("  lit\n// c\nmore\n")).toBe("literal-indented[3]");
  });
  test("a preprocessor directive inside a literal paragraph is kept, though the oracle drops it", async () => {
    // ORACLE DISAGREEMENT, kept deliberately: PreprocessorReader eats
    // `ifdef::x[]` before the parser sees it, and with `x` unset it eats
    // everything up to the matching endif too — the oracle renders
    // `<pre>lit</pre>` and `more` is GONE. A formatter may never delete
    // source, so the reader keeps all three lines; the rendered text is
    // a subset of ours, never a reordering of it. See the same reasoning
    // at the rule in src/parse/lines/paragraph-reader.ts.
    expect(await renderedHtml("  lit\nifdef::x[]\nmore\n")).not.toContain(
      "more",
    );
    expect(astShape("  lit\nifdef::x[]\nmore\n")).toBe("literal-indented[3]");
  });
});

describe("reader: leaves and totality", () => {
  test.each([
    ["'''\n", "thematic"],
    ["<<<\n", "pagebreak"],
    [":name: v\n", "attr"],
    ["image::a.png[]\n", "macro"],
    ["// c\n", "comment"],
    ["ifdef::x[]\n", "directive"],
    [".Title\np\n", "title p(t)"],
  ])("%j reads as %s", (source, expected) => {
    expect(astShape(source)).toBe(expected);
  });
  test("the empty document produces no blocks", () => {
    expect(astShape("")).toBe("");
    expect(parse("").children).toEqual([]);
  });
});
