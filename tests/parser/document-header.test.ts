/**
 * Parser tests for the AsciiDoc document header.
 *
 * The header is `= Title` plus the lines Asciidoctor reads with it -
 * attribute entries, comments and preprocessor lines, then an AUTHOR
 * line and a REVISION line - up to the first blank line. It is ONE
 * node (issue #18): the title alone was a leaf, and the lines under
 * it were read as body paragraphs, which is what let the printer put
 * a blank line after the title and demote them.
 *
 * The oracle rows that pin these readings against Asciidoctor live in
 * tests/conformance/document-header.test.ts; the byte rows live in
 * tests/format/document-header.test.ts.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/narrow.js";
import { astShape } from "./reader-helpers.js";
import type { DocumentHeaderNode } from "../../src/ast.js";

/**
 * The document header of a source that has one.
 * @param source - the document
 * @returns the header node
 */
function header(source: string): DocumentHeaderNode {
  const {
    children: [first],
  } = parse(source);
  narrow(first, "documentHeader");
  return first;
}

describe("document title parsing", () => {
  // The document title opens a HEADER, not a heading leaf: its level
  // is implied by the node kind, because a header exists at level 0
  // and nowhere else.
  test("= Title parses as a document header", () => {
    const document = parse("= My Document\n");
    expect(document.children).toHaveLength(1);
    expect(header("= My Document\n").title).toBe("My Document");
  });

  // Extra whitespace between the `=` marker and the title text should
  // be normalized during parsing, just like section headings.
  test("extra whitespace in title is trimmed", () => {
    expect(header("=  Extra Spaces  \n").title).toBe("Extra Spaces");
  });

  // Position tracking: the header starts at offset 0, line 1,
  // column 1. Important for Prettier's locStart/locEnd.
  test("document header has correct position", () => {
    const { position } = header("= Title\n");
    expect(position.start.offset).toBe(0);
    expect(position.start.line).toBe(1);
    expect(position.start.column).toBe(1);
  });

  // With no lines under it the header IS the title line: its end is
  // the title line's end, not the document's.
  test("a bare title's header ends at the title line", () => {
    const { position } = header("= Title\n\nbody\n");
    expect(position.end.offset).toBe("= Title".length);
    expect(position.end.line).toBe(1);
  });

  // The header's extent RUNS THROUGH its last line - this is the span
  // the printer's blank-line decisions and Prettier's range
  // formatting read.
  test("the header's span covers its last line", () => {
    const source = "= T\nA U Thor\nv1.0\n\nbody\n";
    const { position } = header(source);
    expect(source.slice(position.start.offset, position.end.offset)).toBe(
      "= T\nA U Thor\nv1.0",
    );
  });

  // The document title followed by attribute entries (no blank line)
  // is the standard header pattern. They are the HEADER'S lines now,
  // not siblings of the title.
  test("document title followed by attribute entries", () => {
    const input = "= My Document\n:toc:\n:source-highlighter: rouge\n";
    expect(parse(input).children).toHaveLength(1);
    expect(header(input).lines.map((line) => line.type)).toEqual([
      "attributeEntry",
      "attributeEntry",
    ]);
  });

  // A blank line after the title separates the header from the body.
  // The body paragraph is a sibling of the header, not one of its
  // lines.
  test("blank line after title separates header from body", () => {
    const input = "= My Document\n\nBody text.\n";
    const document = parse(input);
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("documentHeader");
    expect(document.children[1].type).toBe("paragraph");
    expect(header(input).lines).toEqual([]);
  });

  // Document title with attribute entries, then a blank line, then
  // body.
  test("full header with attributes then body", () => {
    const input = "= My Document\n:toc:\n\nBody text.\n";
    const document = parse(input);
    expect(document.children).toHaveLength(2);
    expect(document.children[1].type).toBe("paragraph");
    expect(header(input).lines.map((line) => line.type)).toEqual([
      "attributeEntry",
    ]);
  });

  // The document title must not be confused with deeper headings:
  // `==` is a section heading leaf and opens no header.
  test("== is a level-1 heading, not the document title", () => {
    const document = parse("== Section\n");
    expect(document.children).toHaveLength(1);
    const [child0] = document.children;
    narrow(child0, "heading");
    expect(child0.level).toBe(1);
  });

  // Document title followed by a section heading. The section is not
  // a child of the header - both are top-level blocks.
  test("document title followed by a section heading", () => {
    const input = "= My Document\n\n== First Section\n";
    const document = parse(input);
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("documentHeader");
    expect(document.children[1].type).toBe("heading");
  });

  // A document title at EOF without a trailing newline exercises the
  // line splitter's tolerance for a missing final newline.
  test("document title at EOF without trailing newline", () => {
    const document = parse("= Title");
    expect(document.children).toHaveLength(1);
    expect(header("= Title").title).toBe("Title");
  });

  // `AtxSectionTitleRx` is matched against the RSTRIPPED line and
  // requires a non-empty title, so `=` followed by nothing but
  // whitespace is not a title at all — the oracle renders `=  ` as a
  // paragraph containing `=`.
  test("= followed by only whitespace is a paragraph, not a title", () => {
    const document = parse("=  \n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    expect(child0.type).toBe("paragraph");
  });
});

describe("header attribution lines", () => {
  // The whole point of #18: the line under the title is the AUTHOR
  // line, not the document's first paragraph.
  test("the line under the title is the author line", () => {
    const { lines } = header("= T\nAuthor Name <a@b.c>\n\nbody\n");
    expect(lines).toHaveLength(1);
    const [author] = lines;
    narrow(author, "authorLine");
    expect(author.value).toBe("Author Name <a@b.c>");
  });

  // The value is the line VERBATIM. `AuthorInfoLineRx` splits a name
  // into first/middle/last/email and the split is lossy
  // (`First_Name Last` reaches the attribute table as `First Name
  // Last`), so a formatter can only put the author's own bytes back.
  test("the author line is carried verbatim, not re-spelled", () => {
    const { lines } = header("= T\nFirst_Name Last <f@l.c>\n\nbody\n");
    const [author] = lines;
    narrow(author, "authorLine");
    expect(author.value).toBe("First_Name Last <f@l.c>");
  });

  // Multiple authors are one line to us, semicolons and all.
  test("semicolon-separated authors stay one line", () => {
    const [author] = header("= T\nA One <a@b.c>; B Two <d@e.f>\n").lines;
    narrow(author, "authorLine");
    expect(author.value).toBe("A One <a@b.c>; B Two <d@e.f>");
  });

  // The SECOND attribution line is the revision line.
  test("the second attribution line is the revision line", () => {
    const { lines } = header("= T\nA U Thor\nv1.0, 2026-08-26\n\nbody\n");
    expect(lines.map((line) => line.type)).toEqual([
      "authorLine",
      "revisionLine",
    ]);
    const [, revision] = lines;
    narrow(revision, "revisionLine");
    expect(revision.value).toBe("v1.0, 2026-08-26");
  });

  // `reader.read_line` takes whatever is there: the author slot is
  // filled by a line no pattern was asked about. `* item` reaches the
  // oracle's `author` attribute unchanged (measured).
  test("a list-marker line in the author slot is still the author", () => {
    const [author] = header("= T\n* item\n\nbody\n").lines;
    narrow(author, "authorLine");
    expect(author.value).toBe("* item");
  });

  // Same for a line that looks like block metadata.
  test("an attribute-list line in the author slot is still the author", () => {
    expect(astShape("= T\n[foo]\nAuthor Name\n\nbody\n")).toBe(
      "header(h0 author revision) p(t)",
    );
  });

  // There is no third slot: past the revision line the header ends
  // and the next line opens a body block.
  test("the line past the revision slot is body", () => {
    expect(astShape("= T\nA\nB\nC\n\nbody\n")).toBe(
      "header(h0 author revision) p(t) p(t)",
    );
  });

  // Attribute entries and comments are transparent, before the author
  // line and between the two attribution lines alike
  // (`process_attribute_entries` runs three times in
  // `parse_header_metadata`).
  test("attribute entries and comments do not fill a slot", () => {
    expect(astShape("= T\n:toc:\n// c\nA U Thor\n:x: y\nv1.0\n\nbody\n")).toBe(
      "header(h0 attr comment author attr revision) p(t)",
    );
  });

  // A `////` block is skipped by `skip_comment_lines` exactly as a
  // `//` line is - the blank lines INSIDE it included, which is why
  // the scan takes the whole extent rather than stopping at the blank.
  test("a block comment inside the header does not end it", () => {
    expect(astShape("= T\n////\n\nc\n////\nA U Thor\n\nbody\n")).toBe(
      "header(h0 commentBlock[2] author) p(t)",
    );
  });

  // A preprocessor line is eaten by the reader before the header
  // parse ever runs, so it is transparent too.
  test("a preprocessor directive inside the header does not end it", () => {
    expect(astShape("= T\nifdef::x[]\nA U Thor\nendif::[]\n\nbody\n")).toBe(
      "header(h0 directive author directive) p(t)",
    );
  });
});

describe("where a header can open", () => {
  // Blank lines, comments, attribute entries and anchors are all
  // eaten by `parse_block_metadata_lines` before
  // `parse_document_header` looks for the title, so the header is
  // still reachable across them (measured for each).
  test.each([
    ["blank lines before", "\n\n= T\nA U Thor\n"],
    ["a line comment before", "// c\n= T\nA U Thor\n"],
    ["an attribute entry before", ":a: b\n= T\nA U Thor\n"],
    ["a block anchor before", "[[id]]\n= T\nA U Thor\n"],
  ])("a header still opens across %s", (_name, source) => {
    expect(
      parse(source).children.some((block) => block.type === "documentHeader"),
    ).toBe(true);
  });

  // A block attribute list or a block title before the title is a
  // BARRIER: the oracle builds a level-0 SECTION there, with no
  // doctitle and no author (measured).
  test.each([
    ["an attribute list", "[foo]\n= T\nA U Thor\n\nbody\n"],
    ["a block title", ".Cap\n= T\nA U Thor\n\nbody\n"],
  ])("%s before the title blocks the header", (_name, source) => {
    const shapes = parse(source).children.map((block) => block.type);
    expect(shapes).toContain("heading");
    expect(shapes).not.toContain("documentHeader");
  });

  // A level-0 title deeper in the document is a SECTION: Asciidoctor
  // reads the header once, at the top.
  test("a level-0 title after body content is a heading", () => {
    expect(astShape("para\n\n= T\nA U Thor\n\nbody\n")).toBe(
      "p(t) h0 p(t) p(t)",
    );
  });

  // ...including a second one under a real header.
  test("a second level-0 title is a heading, not a header", () => {
    expect(astShape("= T\nA\n\n= T2\nB\n\nbody\n")).toBe(
      "header(h0 author) h0 p(t) p(t)",
    );
  });

  // `[discrete]` wins outright: the oracle makes a floating title and
  // reads no header at all.
  test("a discrete level-0 title opens no header", () => {
    expect(astShape("[discrete]\n= T\nA U Thor\n\nbody\n")).toBe(
      "attrs heading p(t) p(t)",
    );
  });

  // Inside a list item or a compound block there is no header: the
  // title line is not even a heading there.
  test("a level-0 title inside a block is not a header", () => {
    expect(astShape("--\n= T\nA U Thor\n--\n")).toBe("open(p(t / t))");
  });
});
