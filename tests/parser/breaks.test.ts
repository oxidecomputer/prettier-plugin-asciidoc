import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { asParagraph } from "../helpers.js";

describe("thematic break parsing", () => {
  // Basic thematic break: exactly three single quotes.
  test("basic thematic break", () => {
    const { children } = parse("'''\n");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("thematicBreak");
  });

  // Extended thematic break: more than three single quotes
  // is still a thematic break.
  test("extended thematic break", () => {
    const { children } = parse("''''\n");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("thematicBreak");
  });

  // Between two paragraphs.
  test("thematic break between paragraphs", () => {
    const { children } = parse("Before.\n\n'''\n\nAfter.\n");
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("thematicBreak");
    expect(children[2].type).toBe("paragraph");
  });

  // At start of document.
  test("thematic break at start of document", () => {
    const { children } = parse("'''\n\nSome text.\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("thematicBreak");
    expect(children[1].type).toBe("paragraph");
  });

  // At end of document.
  test("thematic break at end of document", () => {
    const { children } = parse("Some text.\n\n'''\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("thematicBreak");
  });

  // Position tracking.
  test("position tracking", () => {
    const { children } = parse("'''\n");
    const [node] = children;
    expect(node.type).toBe("thematicBreak");
    expect(node.position.start.line).toBe(1);
    expect(node.position.start.column).toBe(1);
    expect(node.position.start.offset).toBe(0);
  });
});

// The Markdown rules `next_block` reads through
// `HYBRID_LAYOUT_BREAK_CHARS`. Red before the registry carried them:
// every row below parsed as a paragraph, so `---` followed by prose
// joined into one line and the `<hr>` left the render (issue #23).
describe("markdown thematic break parsing", () => {
  test.each([
    ["three hyphens", "---\n"],
    ["three asterisks", "***\n"],
    ["three underscores", "___\n"],
    ["one leading space", " ---\n"],
    ["three leading spaces", "   ***\n"],
    ["spaced underscores", "_ _ _\n"],
    ["widely spaced underscores", "_  _  _\n"],
  ])("%s is a thematic break", (_name, input) => {
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("thematicBreak");
  });

  // The complement, spelling by spelling, because a break pattern is
  // only pinned when what it refuses is pinned too.
  test.each([
    // A fourth mark is a `DELIMITED_BLOCKS` key, and
    // `is_delimited_block?` runs ahead of the break arm.
    ["four hyphens open a listing block", "----\nx\n----\n", "delimitedBlock"],
    ["four asterisks open a sidebar", "****\nx\n****\n", "parentBlock"],
    ["four underscores open a quote", "____\nx\n____\n", "parentBlock"],
    // Two marks are the open-block delimiter, not a rule.
    ["two hyphens open an open block", "--\nx\n--\n", "parentBlock"],
    // A fourth leading space is `LiteralParagraphRx`'s territory:
    // `MarkdownThematicBreakRx` allows at most three. A literal
    // paragraph is a delimited block in paragraph form.
    [
      "four leading spaces are a literal paragraph",
      "    ---\n",
      "delimitedBlock",
    ],
    // The spaced `-` and `*` spellings the registry deliberately
    // leaves to the list rules: both are `UnorderedListRx` marker
    // lines, and the open list is what decides them. The spaced `_`
    // form has no such collision and IS read, so it sits with the
    // breaks above. See THEMATIC_BREAK's own note in
    // src/parse/line-shapes.ts.
    ["spaced hyphens are a list item", "- - -\n", "list"],
    ["spaced asterisks are a list item", "* * *\n", "list"],
    // Unequal gaps are no rule in any spelling: `\1\2\1` wants the
    // same run of spaces on both sides of the middle mark.
    ["unevenly spaced underscores are text", "_ _  _\n", "paragraph"],
    // Mixed marks are neither rule nor delimiter.
    ["mixed marks are text", "-*-\n", "paragraph"],
  ])("%s", (_name, input, type) => {
    const { children } = parse(input);
    expect(children[0]?.type).toBe(type);
  });
});

describe("page break parsing", () => {
  // Basic page break: exactly three less-than signs.
  test("basic page break", () => {
    const { children } = parse("<<<\n");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("pageBreak");
  });

  // Extended page break: more than three less-than signs.
  test("extended page break", () => {
    const { children } = parse("<<<<\n");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("pageBreak");
  });

  // Between two paragraphs.
  test("page break between paragraphs", () => {
    const { children } = parse("Before.\n\n<<<\n\nAfter.\n");
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("pageBreak");
    expect(children[2].type).toBe("paragraph");
  });

  // At start of document.
  test("page break at start of document", () => {
    const { children } = parse("<<<\n\nSome text.\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("pageBreak");
    expect(children[1].type).toBe("paragraph");
  });

  // At end of document.
  test("page break at end of document", () => {
    const { children } = parse("Some text.\n\n<<<\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("pageBreak");
  });

  // Position tracking.
  test("position tracking", () => {
    const { children } = parse("<<<\n");
    const [node] = children;
    expect(node.type).toBe("pageBreak");
    expect(node.position.start.line).toBe(1);
    expect(node.position.start.column).toBe(1);
    expect(node.position.start.offset).toBe(0);
  });
});

describe("hard line break parsing", () => {
  // The HardLineBreakNode IS the break, so the newline that follows
  // the ` +` is structural and must not survive into the text run
  // after it: `\nb` there is the same break counted twice, and the
  // printer would emit a blank output line for it.
  test("the newline after a hard break stays out of the next text run", () => {
    const { children } = parse("a +\nb\n");
    expect(asParagraph(children[0]).children).toEqual([
      {
        type: "text",
        value: "a",
        position: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 1, line: 1, column: 2 },
        },
      },
      {
        type: "hardLineBreak",
        position: {
          start: { offset: 1, line: 1, column: 2 },
          end: { offset: 3, line: 1, column: 4 },
        },
      },
      {
        type: "text",
        value: "b",
        position: {
          start: { offset: 4, line: 2, column: 1 },
          end: { offset: 5, line: 2, column: 2 },
        },
      },
    ]);
  });

  // `tokenizeRun` appends the document's newline to a run only when
  // the source really has one there, so that every token's image stays
  // a verbatim slice of the source. At EOF without a trailing newline
  // there is none to append, and the hard-break rule takes the end of
  // input for the end of a line anyway, because Ruby matches
  // HardLineBreakRx against the rstripped line and the last line of a
  // document is a line like any other. Asciidoctor renders this
  // `a<br>` and so do we now (issue #70).
  test("a trailing ` +` at EOF with no newline is still a hard break", () => {
    const { children } = parse("a +");
    expect(asParagraph(children[0]).children).toEqual([
      {
        type: "text",
        value: "a",
        position: {
          start: { offset: 0, line: 1, column: 1 },
          end: { offset: 1, line: 1, column: 2 },
        },
      },
      {
        type: "hardLineBreak",
        position: {
          start: { offset: 1, line: 1, column: 2 },
          end: { offset: 3, line: 1, column: 4 },
        },
      },
    ]);
  });
});
