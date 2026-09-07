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
import { narrow } from "../helpers.js";

describe("line comment parsing", () => {
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

  // A comment line INSIDE a paragraph body is a rawLine leaf of the
  // paragraph. The newline that ended the line above it is structural
  // — the rawLine owns its own output line — so it is trimmed off the
  // pending text run, and trimming it must not leave an EMPTY text
  // node behind: the printer's fill() needs content and separators to
  // alternate. Compared with positions, which pins the rawLine's span
  // (exactly its line) at the same time.
  test("a comment inside a paragraph leaves no empty text run behind", () => {
    const document = parse("a *b*\n// c\n");
    const {
      children: [child0],
    } = document;
    narrow(child0, "paragraph");
    expect(child0.children).toEqual([
      {
        type: "text",
        value: "a ",
        position: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 2, line: 1, column: 3 },
        },
      },
      {
        type: "bold",
        constrained: true,
        role: undefined,
        marks: { open: { kind: "entangled" }, close: { kind: "entangled" } },
        children: [
          {
            type: "text",
            value: "b",
            position: {
              start: { offset: 3, line: 1, column: 4 },
              end: { offset: 4, line: 1, column: 5 },
            },
          },
        ],
        position: {
          start: { offset: 2, line: 1, column: 3 },
          end: { offset: 5, line: 1, column: 6 },
        },
      },
      {
        type: "rawLine",
        value: "// c",
        position: {
          start: { offset: 6, line: 2, column: 1 },
          end: { offset: 10, line: 2, column: 5 },
        },
      },
    ]);
  });
});

describe("block comment parsing", () => {
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

  // Block comment position must cover the opening delimiter so
  // Prettier's range formatting can find the node. Without correct
  // positions, `--range-start`/`--range-end` would skip comments.
  test("block comment has correct position", () => {
    const document = parse("////\ncontent\n////\n");
    expect(document.children[0].position.start.offset).toBe(0);
    expect(document.children[0].position.start.line).toBe(1);
    expect(document.children[0].position.start.column).toBe(1);
  });

  // A block comment at the very end of the file may have no trailing
  // newline after the closing delimiter. The reader splits the source
  // into lines, so the last one is a line whether or not it ends in
  // `\n` — the close delimiter must still be recognised on it.
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
});
