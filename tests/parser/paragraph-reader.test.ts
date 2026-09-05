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
  type TextOpen,
} from "../../src/parse/lines/paragraph-reader.js";
import { splitLines } from "../../src/parse/lines/split.js";

/**
 * The scan a document reader would hand over: the whole source, its
 * lines, and no open list.
 * @param source - the whole document
 * @param markerStyle - the enclosing marker list's style, if any
 * @returns the scan value
 */
function scanOf(source: string, markerStyle?: string): ParagraphScan {
  return {
    source,
    lines: splitLines(source),
    openList:
      markerStyle === undefined
        ? undefined
        : { kind: "marker", style: markerStyle },
  };
}

// The reader's own answer for a block-level paragraph: text at column
// 0, and a `//` line inside it is the comment it looks like.
const PLAIN_TEXT: TextOpen = { from: 0, comments: "skipped" };

describe("paragraphExtent", () => {
  test("runs on through plain lines and stops at the blank, unread", () => {
    const scan = scanOf("a\nb\n\nc\n");
    const { tokens, end } = paragraphExtent(scan, 0, "paragraph", PLAIN_TEXT);
    // One run, tokenized as one: the newline between the lines is in
    // the image, because every token's image is a verbatim slice.
    expect(tokens.map((token) => token.image).join("")).toBe("a\nb\n");
    expect(end).toBe(2);
  });

  test("`from` skips the marker: the run starts at the item's text", () => {
    const scan = scanOf("* item\n", "*");
    const { tokens } = paragraphExtent(scan, 0, "listItem", {
      from: 2,
      comments: "skipped",
    });
    expect(tokens.map((token) => token.image).join("")).toBe("item\n");
  });

  test("an interrupting line ends the extent and is left for the reader", () => {
    // A delimiter is in every context's interrupting set.
    const scan = scanOf("a\n----\nb\n----\n");
    const { end } = paragraphExtent(scan, 0, "paragraph", PLAIN_TEXT);
    expect(end).toBe(1);
  });

  test("a comment line is kept verbatim, in place, and does not end it", () => {
    const scan = scanOf("a\n// c\nb\n");
    const { tokens, end } = paragraphExtent(scan, 0, "paragraph", PLAIN_TEXT);
    expect(tokens.map((token) => token.type)).toContain("RawLine");
    expect(end).toBe(3);
  });

  test("the extent ends at the lines' end with nothing left over", () => {
    const scan = scanOf("only\n");
    expect(paragraphExtent(scan, 0, "paragraph", PLAIN_TEXT).end).toBe(1);
  });

  // Issue #101. `TextOpen.comments` is the reader's answer to
  // `read_paragraph_lines`'s `skip_line_comments:` argument, and the
  // literal-plus rule is where it shows: with the comment counted,
  // the flush-left `// c` takes the common indent to 0, the ` +`
  // keeps the space `HardLineBreakRx` needs and stays a break; with
  // it skipped, the ` +` line is the only line the indent is taken
  // over and the plus is literal text.
  test("a comment lowers the common indent only where it is content", () => {
    const scan = scanOf("t:: item\n +\n// c\n");
    const breaks = (comments: "content" | "skipped"): number =>
      paragraphExtent(scan, 0, "dlistItem", {
        from: 0,
        comments,
      }).tokens.filter((token) => token.type === "HardLineBreak").length;
    expect(breaks("content")).toBe(1);
    expect(breaks("skipped")).toBe(0);
  });

  // Issue #105. `TextOpen.comments` is only the CALLER's half of the
  // answer. The extent supplies the other: `next_block` reads the
  // caller's argument in one arm alone (parser.rb l.753-754), and
  // which arm runs is decided by the line after the block's own, so
  // an unindented one leaves the comment the comment it looks like
  // whatever the caller said. Where the arm does fold it in, the line
  // is text, and a text line joins the reflowable run rather than
  // standing as a RawLine the printer replays at column 0.
  test.each([
    ["the indented arm reads it as text", "t:: item\n  x\n// c\n", 0],
    ["the arm beside it does not", "t:: item\n// c\ncontinued\n", 1],
  ])("%s, whatever the caller said", (_name, source, rawLines) => {
    const { tokens } = paragraphExtent(scanOf(source), 0, "dlistItem", {
      from: 0,
      comments: "content",
    });
    expect(tokens.filter((token) => token.type === "RawLine")).toHaveLength(
      rawLines,
    );
  });

  test("a foreign marker inside a `+`-attached paragraph stays its own line", () => {
    // `within_nested_list` keys on the marker's COLUMN, so the line may
    // not be reflowed onto its predecessor — the scan marks it raw.
    const scan = scanOf("para\n. other\n", "*");
    const { tokens } = paragraphExtent(scan, 0, "listContinuation", PLAIN_TEXT);
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
