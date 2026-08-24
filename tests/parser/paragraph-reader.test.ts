/**
 * The three paragraph-shaped extent scans, read directly: how far each
 * one reaches (`read_lines_until` with `preserve_last_line: true`, so
 * the ending line is left UNREAD) and what it hands back.
 *
 * Each is a pure function over (lines, index, a context value) — there
 * is no reader to stand up and no stream to advance, so a row is a
 * document, a start index and an expected pair. What the tokens become
 * once built is pinned by tests/parser/paragraph.test.ts and the
 * format suites; THIS table is the extent-level specification.
 */
import { describe, expect, test } from "vitest";
import {
  literalParagraphExtent,
  paragraphExtent,
  verbatimStyledExtent,
  type ParagraphScan,
} from "../../src/parse/lines/paragraph-reader.js";
import { splitLines } from "../../src/parse/lines/split.js";

/**
 * The scan a document reader would hand over: the whole source, its
 * lines, and no open list.
 * @param source - the whole document
 * @param openListStyle - the enclosing list's marker style, if any
 * @returns the scan value
 */
function scanOf(source: string, openListStyle?: string): ParagraphScan {
  return { source, lines: splitLines(source), openListStyle };
}

describe("paragraphExtent", () => {
  test("runs on through plain lines and stops at the blank, unread", () => {
    const scan = scanOf("a\nb\n\nc\n");
    const { tokens, end } = paragraphExtent(scan, 0, "paragraph", 0);
    // One run, tokenized as one: the newline between the lines is in
    // the image, because every token's image is a verbatim slice.
    expect(tokens.map((token) => token.image).join("")).toBe("a\nb\n");
    expect(end).toBe(2);
  });

  test("`from` skips the marker: the run starts at the item's text", () => {
    const scan = scanOf("* item\n", "*");
    const { tokens } = paragraphExtent(scan, 0, "listItem", 2);
    expect(tokens.map((token) => token.image).join("")).toBe("item\n");
  });

  test("an interrupting line ends the extent and is left for the reader", () => {
    // A delimiter is in every context's interrupting set.
    const scan = scanOf("a\n----\nb\n----\n");
    const { end } = paragraphExtent(scan, 0, "paragraph", 0);
    expect(end).toBe(1);
  });

  test("a comment line is kept verbatim, in place, and does not end it", () => {
    const scan = scanOf("a\n// c\nb\n");
    const { tokens, end } = paragraphExtent(scan, 0, "paragraph", 0);
    expect(tokens.map((token) => token.type)).toContain("RawLine");
    expect(end).toBe(3);
  });

  test("the extent ends at the lines' end with nothing left over", () => {
    const scan = scanOf("only\n");
    expect(paragraphExtent(scan, 0, "paragraph", 0).end).toBe(1);
  });

  test("a foreign marker inside a `+`-attached paragraph stays its own line", () => {
    // `within_nested_list` keys on the marker's COLUMN, so the line may
    // not be reflowed onto its predecessor — the scan marks it raw.
    const scan = scanOf("para\n. other\n", "*");
    const { tokens } = paragraphExtent(scan, 0, "listContinuation", 0);
    expect(tokens.at(-1)?.type).toBe("RawLine");
  });
});

describe("literalParagraphExtent", () => {
  test("keeps the indented lines, comments included, and stops at the blank", () => {
    const scan = scanOf("  lit\n// c\n  more\n\nafter\n");
    const { lines, end } = literalParagraphExtent(scan, 0);
    expect(lines.map((line) => line.text)).toEqual(["  lit", "// c", "  more"]);
    expect(end).toBe(3);
  });
});

describe("verbatimStyledExtent", () => {
  test("runs through flush lines and stops at a lone `+`", () => {
    const scan = scanOf("code\nmore\n+\nafter\n");
    const { lines, end } = verbatimStyledExtent(scan, 0);
    expect(lines.map((line) => line.text)).toEqual(["code", "more"]);
    expect(end).toBe(2);
  });

  test("a blank line is structural to the reader here", () => {
    const scan = scanOf("code\n\nmore\n");
    expect(verbatimStyledExtent(scan, 0).end).toBe(1);
  });
});
