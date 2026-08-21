/**
 * BlockReader characterization: the SHAPE of the token stream, where
 * blocks END, and the exactness of every token position.
 *
 * These shape assertions are the reader's contract with the grammar,
 * which consumes the stream verbatim (the corpus gate at the bottom of
 * this file re-parses every Asciidoctor test document to prove it).
 * Where a shape is surprising, the oracle (`renderedHtml`) is asserted
 * alongside it — the oracle is Asciidoctor Ruby transpiled by Opal and
 * wins over any reading of parser.rb.
 */
import { describe, expect, test } from "vitest";
import { asciidocParser } from "../../src/parse/grammar.js";
import { readBlocks } from "../../src/parse/lines/reader.js";
import { loadCorpus } from "../conformance/loader.js";
import { renderedHtml } from "../helpers.js";
import { shape } from "./reader-helpers.js";

describe("reader: paragraphs", () => {
  test("a paragraph is ParagraphStart … ParagraphEnd with one fragment per run", () => {
    expect(shape(readBlocks("a\nb\n"))).toBe(
      "ParagraphStart t / t / ParagraphEnd",
    );
  });
  test("a raw line splits the inline runs but not the paragraph", () => {
    expect(shape(readBlocks("a\n// c\nb\n"))).toBe(
      "ParagraphStart t / RawLine t / ParagraphEnd",
    );
  });
  test("a raw line that ends the paragraph keeps ParagraphEnd after it", () => {
    expect(shape(readBlocks("a\n// c\n\nb\n"))).toBe(
      "ParagraphStart t / RawLine ParagraphEnd ParagraphStart t / ParagraphEnd",
    );
  });
  test("blank lines end a paragraph and produce no tokens", () => {
    expect(shape(readBlocks("a\n\n\nb\n"))).toBe(
      "ParagraphStart t / ParagraphEnd ParagraphStart t / ParagraphEnd",
    );
  });
  test("a +-line interrupts a plain paragraph and opens the next as text (read_lines_until line_read guard)", () => {
    expect(shape(readBlocks("a\n+\nb\n"))).toBe(
      "ParagraphStart t / ParagraphEnd ParagraphStart t / t / ParagraphEnd",
    );
  });
  test("block-shaped lines mid-paragraph are text", () => {
    expect(shape(readBlocks("a\n* item\n.Title\n== S\nNOTE: x\n"))).toBe(
      "ParagraphStart t / t / t / t / t / ParagraphEnd",
    );
  });
  test("an admonition label is its own token before the body paragraph", () => {
    expect(shape(readBlocks("NOTE: x\ny\n"))).toBe(
      "AdmonitionLabel ParagraphStart t / t / ParagraphEnd",
    );
  });
});

describe("reader: sections and metadata", () => {
  test("a heading of level <= open closes the section first", () => {
    expect(shape(readBlocks("== A\n\np\n\n=== B\n\nq\n\n== C\n"))).toBe(
      "SectionTitleLine ParagraphStart t / ParagraphEnd SectionTitleLine ParagraphStart t / ParagraphEnd SectionEnd SectionEnd SectionTitleLine SectionEnd",
    );
  });
  test("a heading does NOT interrupt an open paragraph (StartOfBlockProc has no title rule)", () => {
    // ORACLE: `p` and `=== B` render as ONE paragraph — a section title
    // must be preceded by a blank line. read_paragraph_lines breaks at
    // StartOfBlockProc, which tests only BlockAttributeLineRx and
    // is_delimited_block?.
    expect(renderedHtml("p\n=== B\n")).toContain("p === B");
    expect(shape(readBlocks("p\n=== B\n"))).toBe(
      "ParagraphStart t / t / ParagraphEnd",
    );
  });
  test("metadata (and comments) before a closing heading belong to the new section (next_section + parse_block_metadata_lines)", () => {
    // ORACLE: the anchor above `== B` becomes B's id, not A's.
    expect(renderedHtml("== A\np\n[[id]]\n// c\n\n== B\n")).toContain(
      'id="id">B',
    );
    expect(shape(readBlocks("== A\np\n[[id]]\n// c\n\n== B\n"))).toBe(
      "SectionTitleLine ParagraphStart t / ParagraphEnd SectionEnd AnchorLine RawLine SectionTitleLine SectionEnd",
    );
  });
  test("a comment before a closing heading migrates into the new section", () => {
    // parse_block_metadata_lines consumes the comment BEFORE
    // is_next_line_section? runs, so it belongs to the section the next
    // title opens. This reverses the limitation the old post-hoc
    // section nester documented; the rendering is identical (the oracle
    // emits no node for a comment either way).
    expect(shape(readBlocks("== A\n// c\n\n== B\n"))).toBe(
      "SectionTitleLine SectionEnd RawLine SectionTitleLine SectionEnd",
    );
  });
  test("[discrete] turns the heading into a leaf", () => {
    expect(shape(readBlocks("== A\n[discrete]\n=== B\np\n"))).toBe(
      "SectionTitleLine BlockAttributeLine DiscreteHeadingLine ParagraphStart t / ParagraphEnd SectionEnd",
    );
  });
  test("headings inside a compound block are paragraph text (next_block never makes sections)", () => {
    expect(shape(readBlocks("====\n== H\n====\n"))).toBe(
      "CompoundBlockOpen ParagraphStart t / ParagraphEnd CompoundBlockClose",
    );
  });
  test("a level-0 title is a document title, not a section frame", () => {
    expect(shape(readBlocks("= Doc\n\np\n"))).toBe(
      "DocumentTitleLine ParagraphStart t / ParagraphEnd",
    );
  });
});

describe("reader: delimited blocks", () => {
  test("verbatim content until the matching close; a blank line inside stays content", () => {
    expect(shape(readBlocks("----\ncode\n\n----\n"))).toBe(
      "VerbatimBlockOpen VerbatimLine VerbatimLine VerbatimBlockClose",
    );
  });
  test("the OUTERMOST matching terminator closes, even from inside a listing (read_lines_until is flat)", () => {
    expect(shape(readBlocks("====\n----\n====\n----\n"))).toBe(
      "CompoundBlockOpen VerbatimBlockOpen UnclosedEnd CompoundBlockClose VerbatimBlockOpen UnclosedEnd",
    );
  });
  test("unterminated blocks run to EOF with UnclosedEnd", () => {
    expect(shape(readBlocks("----\ncode\n"))).toBe(
      "VerbatimBlockOpen VerbatimLine UnclosedEnd",
    );
  });
  test("a fence with a language hint closes on ```", () => {
    expect(shape(readBlocks("```ruby\nx\n```\n"))).toBe(
      "VerbatimBlockOpen VerbatimLine VerbatimBlockClose",
    );
  });
  test("delimiters with trailing spaces are delimiters (rstrip)", () => {
    expect(shape(readBlocks("----  \nx\n----\n"))).toBe(
      "VerbatimBlockOpen VerbatimLine VerbatimBlockClose",
    );
  });
  test("a compound block nests blocks; a section inside it never opens a frame", () => {
    expect(shape(readBlocks("====\np\n\n----\nx\n----\n====\n"))).toBe(
      "CompoundBlockOpen ParagraphStart t / ParagraphEnd VerbatimBlockOpen VerbatimLine VerbatimBlockClose CompoundBlockClose",
    );
  });
  test("an unclosed section inside a document ends at EOF", () => {
    expect(shape(readBlocks("== A\n\n----\nx\n"))).toBe(
      "SectionTitleLine VerbatimBlockOpen VerbatimLine UnclosedEnd SectionEnd",
    );
  });
});

describe("reader: literal paragraphs", () => {
  test("a literal paragraph continues through flush lines until blank/block (read_paragraph_lines)", () => {
    expect(shape(readBlocks("  lit\nflush\n\nnext\n"))).toBe(
      "LiteralLine LiteralLine LiteralParagraphEnd ParagraphStart t / ParagraphEnd",
    );
    // Oracle corroboration: one literal block containing both lines.
    expect((renderedHtml("  lit\nflush\n").match(/<pre>/gv) ?? []).length).toBe(
      1,
    );
  });
  test("a comment inside a document-level literal paragraph stays in place", () => {
    // ORACLE SURPRISE recorded in classify.ts: read_paragraph_lines is
    // called with `skip_line_comments: text_only`, so the `//` line is
    // NOT dropped — Asciidoctor renders it as literal content, and the
    // literal paragraph runs on THROUGH it.
    expect(renderedHtml("  lit\n// c\nmore\n")).toContain("  lit\n// c\nmore");
    expect(shape(readBlocks("  lit\n// c\nmore\n"))).toBe(
      "LiteralLine LiteralLine LiteralLine LiteralParagraphEnd",
    );
  });
  test("a preprocessor directive inside a literal paragraph is kept, though the oracle drops it", () => {
    // ORACLE DISAGREEMENT, kept deliberately: PreprocessorReader eats
    // `ifdef::x[]` before the parser sees it, and with `x` unset it eats
    // everything up to the matching endif too — the oracle renders
    // `<pre>lit</pre>` and `more` is GONE. A formatter may never delete
    // source, so the reader keeps all three lines; the rendered text is
    // a subset of ours, never a reordering of it. See the same reasoning
    // at the rule in src/parse/lines/paragraph-reader.ts.
    expect(renderedHtml("  lit\nifdef::x[]\nmore\n")).not.toContain("more");
    expect(shape(readBlocks("  lit\nifdef::x[]\nmore\n"))).toBe(
      "LiteralLine LiteralLine LiteralLine LiteralParagraphEnd",
    );
  });
});

describe("reader: leaves and totality", () => {
  test.each([
    ["'''\n", "ThematicBreakLine"],
    ["<<<\n", "PageBreakLine"],
    [":name: v\n", "AttributeEntryLine"],
    ["image::a.png[]\n", "BlockMacroLine"],
    ["// c\n", "RawLine"],
    ["ifdef::x[]\n", "RawLine"],
    [".Title\np\n", "BlockTitleLine ParagraphStart t / ParagraphEnd"],
  ])("%j reads as %s", (source, expected) => {
    expect(shape(readBlocks(source))).toBe(expected);
  });
  test("the empty document produces no tokens", () => {
    expect(readBlocks("")).toEqual([]);
  });
});

describe("reader: corpus invariants", () => {
  const cases = loadCorpus().flatMap((g) => g.cases);
  // Position invariants every emitted token must satisfy: the image is
  // the exact source slice, and line/column agree with the offset. Run
  // over the whole corpus so the rebasing of inline fragments is
  // exercised by every construct Asciidoctor's own tests contain.
  test.each(cases.map((c) => [c.id, c.input] as const))(
    "%s: positions exact",
    (_id, source) => {
      let previous = -1;
      for (const t of readBlocks(source)) {
        const { startOffset } = t;
        const end = t.endOffset ?? startOffset - 1;
        expect(
          source.slice(startOffset, end + 1),
          `${t.tokenType.name} image`,
        ).toBe(t.image);
        const before = source.slice(0, startOffset);
        const { length: line } = before.split("\n");
        const column = startOffset - (before.lastIndexOf("\n") + 1) + 1;
        expect(
          [t.startLine, t.startColumn],
          `${t.tokenType.name} position`,
        ).toEqual([line, column]);
        expect(startOffset, "tokens are offset-sorted").toBeGreaterThanOrEqual(
          previous,
        );
        previous = startOffset;
      }
    },
  );
});

// The reader's output is the grammar's WHOLE input, so the grammar must
// accept it without recovery on every document Asciidoctor's own tests
// contain. A parse error here means the reader's emission order is wrong
// — fix the reader, never the grammar's strictness.
describe("reader output is always grammatical", () => {
  const cases = loadCorpus().flatMap((g) => g.cases);
  test.each(cases.map((c) => [c.id, c.input] as const))(
    "%s: zero parser errors",
    (_id, input) => {
      asciidocParser.input = readBlocks(input);
      asciidocParser.document();
      expect(asciidocParser.errors.map((error) => error.message)).toEqual([]);
    },
  );
});
