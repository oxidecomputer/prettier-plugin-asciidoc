/**
 * Parser tests for the AsciiDoc document title and header.
 *
 * The document title uses `= Title` (single `=` marker) — distinct
 * from section headings which use `==` through `======`. The header
 * is the document title plus any contiguous attribute entries (no
 * blank lines between them).
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/unreachable.js";

describe("document title parsing", () => {
  // The document title is a level-0 heading using a single `=` marker.
  // It should parse as its own node type, separate from section headings.
  test("= Title parses as documentTitle", () => {
    const document = parse("= My Document\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "documentTitle");
    expect(child0.title).toBe("My Document");
  });

  // Extra whitespace between the `=` marker and the title text should
  // be normalized during parsing, just like section headings.
  test("extra whitespace in title is trimmed", () => {
    const document = parse("=  Extra Spaces  \n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "documentTitle");
    expect(child0.title).toBe("Extra Spaces");
  });

  // Position tracking: the document title starts at offset 0, line 1,
  // column 1. Important for Prettier's locStart/locEnd.
  test("document title has correct position", () => {
    const document = parse("= Title\n");
    const {
      children: [title],
    } = document;
    expect(title.position.start.offset).toBe(0);
    expect(title.position.start.line).toBe(1);
    expect(title.position.start.column).toBe(1);
  });

  // The document title followed by attribute entries (no blank line)
  // is the standard header pattern. Both should be parsed as separate
  // block nodes — grouping is handled by the printer's
  // `joinBlocks` function.
  test("document title followed by attribute entries", () => {
    const input = "= My Document\n:toc:\n:source-highlighter: rouge\n";
    const document = parse(input);
    expect(document.children).toHaveLength(3);
    expect(document.children[0].type).toBe("documentTitle");
    expect(document.children[1].type).toBe("attributeEntry");
    expect(document.children[2].type).toBe("attributeEntry");
  });

  // A blank line after the title separates the header from the body.
  // The body paragraph should be a sibling, not grouped under the title.
  test("blank line after title separates header from body", () => {
    const input = "= My Document\n\nBody text.\n";
    const document = parse(input);
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("documentTitle");
    expect(document.children[1].type).toBe("paragraph");
  });

  // Document title with attribute entries, then a blank line, then body.
  // The attribute entries are contiguous with the title (no blank
  // line), so they are part of the header. In the AST they are flat
  // siblings of the title, not grouped under a header node — the
  // header is a semantic concept, not a structural container.
  test("full header with attributes then body", () => {
    const input = "= My Document\n:toc:\n\nBody text.\n";
    const document = parse(input);
    expect(document.children).toHaveLength(3);
    expect(document.children[0].type).toBe("documentTitle");
    expect(document.children[1].type).toBe("attributeEntry");
    expect(document.children[2].type).toBe("paragraph");
  });

  // The document title must not be confused with section headings.
  // `== Title` is a section (level 1), not a document title.
  // Disambiguation works because the DocumentTitle token (`= `)
  // has higher priority than SectionMarker (`== `..`======`)
  // in the Chevrotain lexer, so `= Title` always matches first.
  test("== is a section, not a document title", () => {
    const document = parse("== Section\n");
    expect(document.children).toHaveLength(1);
    expect(document.children[0].type).toBe("section");
  });

  // Document title followed by a section heading. The section is not
  // a child of the title — both are top-level blocks.
  test("document title followed by section", () => {
    const input = "= My Document\n\n== First Section\n";
    const document = parse(input);
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("documentTitle");
    expect(document.children[1].type).toBe("section");
  });

  // A document title at EOF without a trailing newline exercises the
  // line splitter's tolerance for a missing final newline: the last
  // line is still a line, so the reader classifies it and emits a
  // DocumentTitleLine like any other.
  test("document title at EOF without trailing newline", () => {
    const document = parse("= Title");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "documentTitle");
    expect(child0.title).toBe("Title");
  });

  // `AtxSectionTitleRx` is matched against the RSTRIPPED line and
  // requires a non-empty title, so `=` followed by nothing but
  // whitespace is not a title at all — the oracle renders `=  ` as a
  // paragraph containing `=`. (This used to produce a documentTitle
  // with an empty string.)
  test("= followed by only whitespace is a paragraph, not a title", () => {
    const document = parse("=  \n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    expect(child0.type).toBe("paragraph");
  });
});
