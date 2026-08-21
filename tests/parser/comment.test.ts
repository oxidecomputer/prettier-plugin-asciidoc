/**
 * Parser tests for AsciiDoc comments.
 *
 * Comments are not part of the AsciiDoc ASG -- they're discarded by the
 * reference toolchain. But a formatter must preserve them, so our AST
 * includes CommentNode for both line and block comments.
 *
 * Line comment: `//` not followed by another slash — Asciidoctor's
 * CommentLineRx. `//` alone on a line is an empty comment, `//path`
 * is a comment too, and `///text` is ordinary text.
 *
 * Block comment: delimited by `////` (4+ slashes) on its own line.
 * Content inside is verbatim and not parsed further.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { renderedHtml } from "../helpers.js";
import { narrow } from "../../src/unreachable.js";

describe("line comment parsing", () => {
  // Verifies the fundamental contract: `// text` becomes a comment node,
  // not a paragraph. Without this, comments would be treated as prose.
  test("// text parses as a line comment", () => {
    const document = parse("// this is a comment\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("line");
    expect(child0.value).toBe("this is a comment");
  });

  // `//` alone is a valid empty comment in AsciiDoc. The lexer's negative
  // lookahead `(?!\S)` must accept end-of-line, not just space-then-text.
  test("// alone on a line is an empty comment", () => {
    const document = parse("//\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("line");
    expect(child0.value).toBe("");
  });

  // `//path` IS a comment: Asciidoctor's rule is `//` not followed by
  // another `/`, and the oracle drops the line. (A `//` inside a URL
  // is never at the start of a line, which is the only place this
  // token fires.) `///text` keeps three slashes out of it and stays
  // ordinary text.
  test("//path (no space) is a comment", () => {
    const document = parse("//path\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.value).toBe("path");
  });

  test("///text (three slashes) is NOT a comment", () => {
    const document = parse("///text\n");
    expect(document.children).toHaveLength(1);
    expect(document.children[0].type).toBe("paragraph");
  });

  // A tab after `//` is a valid line comment.
  // `buildLineComment` strips only
  // a leading space from the raw image (`raw.startsWith(" ")`), so
  // a tab-prefixed comment has the tab preserved in `value`.
  test("//[tab] (tab after slashes) is a valid line comment", () => {
    const tab = "\t";
    const document = parse(`//${tab}indented remark\n`);
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("line");
    expect(child0.value).toBe(`${tab}indented remark`);
  });

  // Authors often stack line comments. Each must be its own AST node so
  // the printer can emit them individually — merging would lose the
  // per-line `//` markers and change the document's meaning.
  test("consecutive line comments are separate nodes", () => {
    const document = parse("// first\n// second\n");
    expect(document.children).toHaveLength(2);
    const {
      children: [child0, child1],
    } = document;
    narrow(child0, "comment");
    narrow(child1, "comment");
    expect(child0.value).toBe("first");
    expect(child1.value).toBe("second");
  });

  // Prettier uses locStart/locEnd for cursor tracking and range
  // formatting. The comment's position must start at the `//` marker
  // (not the text after it) so Prettier can correctly locate the
  // node in the source.
  test("line comment has correct position", () => {
    const document = parse("// hello\n");
    expect(document.children[0].position.start.offset).toBe(0);
    expect(document.children[0].position.start.line).toBe(1);
    expect(document.children[0].position.start.column).toBe(1);
    // End offset is exclusive, after "// hello" (8 chars)
    expect(document.children[0].position.end.offset).toBe(8);
  });

  // Comments must survive as block-level nodes between paragraphs.
  // If the parser swallowed them during blank-line handling, they'd
  // disappear from the formatted output.
  test("comment between paragraphs is preserved", () => {
    const document = parse("First.\n\n// comment\n\nSecond.\n");
    expect(document.children).toHaveLength(3);
    expect(document.children[0].type).toBe("paragraph");
    expect(document.children[1].type).toBe("comment");
    expect(document.children[2].type).toBe("paragraph");
  });

  // The AST builder's section-grouping logic must treat comments as
  // children of the preceding section, just like paragraphs. A comment
  // between a heading and its content shouldn't break the section.
  test("comment inside a section", () => {
    const document = parse("== Title\n\n// remark\n\nText.\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "section");
    expect(child0.children).toHaveLength(2);
    expect(child0.children[0].type).toBe("comment");
    expect(child0.children[1].type).toBe("paragraph");
  });
});

describe("block comment parsing", () => {
  // The core block comment contract: `////` delimiters wrap verbatim
  // content that must not be parsed as AsciiDoc. If the `push_mode`
  // on BlockCommentDelimiter fails, the content falls through to
  // default-mode tokenization (headings, inline text, etc.).
  test("block comment with content", () => {
    const document = parse("////\nblock content\n////\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("block content");
  });

  // Empty block comments (`////\n////`) are valid: the reader opens a
  // verbatim frame on the first line and the second closes it with no
  // content lines in between.
  test("empty block comment", () => {
    const document = parse("////\n////\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("");
  });

  // Multi-line content must be preserved with its internal newlines
  // intact. `extractBlockCommentContent` slices raw source text between
  // the open and close delimiter byte offsets — internal newlines are
  // preserved automatically because no token reassembly is involved.
  test("block comment with multiple lines", () => {
    const document = parse("////\nline one\nline two\nline three\n////\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("line one\nline two\nline three");
  });

  // Block comments can contain blank lines (e.g. separating paragraphs
  // of commented-out prose). The verbatim content extraction must
  // preserve internal blank lines exactly — losing them would silently
  // alter the commented-out content when formatting.
  test("block comment preserves internal blank lines", () => {
    const document = parse("////\nline one\n\nline three\n////\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("line one\n\nline three");
  });

  // Same structural test as for line comments: block comments between
  // paragraphs must appear as their own block-level nodes, not get
  // absorbed into the adjacent paragraphs.
  test("block comment between paragraphs", () => {
    const document = parse("Before.\n\n////\nhidden\n////\n\nAfter.\n");
    expect(document.children).toHaveLength(3);
    expect(document.children[0].type).toBe("paragraph");
    expect(document.children[1].type).toBe("comment");
    expect(document.children[2].type).toBe("paragraph");
  });

  // Block comment position must cover the opening delimiter so
  // Prettier's range formatting can find the node. Without correct
  // positions, `--range-start`/`--range-end` would skip comments.
  test("block comment has correct position", () => {
    const document = parse("////\ncontent\n////\n");
    expect(document.children[0].position.start.offset).toBe(0);
    expect(document.children[0].position.start.line).toBe(1);
    expect(document.children[0].position.start.column).toBe(1);
  });

  // AsciiDoc allows delimiters longer than 4 slashes (`//////`).
  // The lexer pattern `/{4,}` must accept these without creating a
  // mismatch between open and close delimiter lengths.
  test("block comment with extended delimiter (5+ slashes)", () => {
    const document = parse("//////\ncontent\n//////\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("content");
  });

  // A block comment at the very end of the file may have no trailing
  // newline after the closing delimiter. This exercises the grammar's
  // `OPTION(() => this.CONSUME2(Newline))` — the optional newline
  // after the close delimiter must not be required.
  test("block comment at EOF without trailing newline", () => {
    const document = parse("////\ncontent\n////");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("content");
  });

  // Mismatched delimiter lengths do NOT close a block: `read_lines_until
  // terminator:` compares whole lines against the opening delimiter, so
  // a 6-slash line inside a 4-slash comment block is content and the
  // block runs on to end of input (Asciidoctor warns "unterminated
  // comment block"). ORACLE: nothing of it renders either way.
  test("mismatched delimiter lengths (4-open, 6-close) leave the block unclosed", () => {
    const input = "////\ncontent\n//////\n";
    expect(renderedHtml(input)).not.toContain("content");
    const document = parse(input);
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "comment");
    expect(child0.commentType).toBe("block");
    expect(child0.value).toBe("content\n//////");
  });
});
