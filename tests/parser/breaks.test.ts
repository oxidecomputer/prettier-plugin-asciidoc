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
