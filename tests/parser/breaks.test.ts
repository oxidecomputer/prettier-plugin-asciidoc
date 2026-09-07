import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { asParagraph, firstList, narrow } from "../helpers.js";

describe("thematic break parsing", () => {
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
    // The spaced `-` and `*` spellings, read at a block start since
    // #182. The line alone does not settle them - each is also an
    // `UnorderedListRx` marker line - but at a block start
    // `next_block` reaches the layout-break arm first.
    ["spaced hyphens", "- - -\n"],
    ["spaced asterisks", "* * *\n"],
    ["widely spaced hyphens", "-  -  -\n"],
    ["widely spaced asterisks", "*  *  *\n"],
    ["an indented spaced rule", "   - - -\n"],
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
    // A TAB is no gap either pattern accepts (`( *)` in both), so a
    // tab-gapped run of marks is a list item, not a rule.
    ["tab-gapped hyphens are a list item", "-\t-\t-\n", "list"],
    ["tab-gapped asterisks are a list item", "*\t*\t*\n", "list"],
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

// Inside an OPEN list the two spaced spellings are marker lines, not
// breaks: `parse_list`'s own loop (parser.rb l.1119) never reaches
// `next_block`, and an item's first block is read with `text_only`
// set (`parse_list_item`, parser.rb l.1367-74), which holds the
// layout-break arm off. Two in-item positions read the break anyway,
// and they are the two a printed `'''` re-reads at
// ({@link ReaderContext.markerLineWins}, src/parse/line-shapes.ts).
// These pin the SHAPE the oracle renders; the bytes are pinned in
// tests/format/spaced-thematic-break.test.ts.
describe("a spaced marker line inside an open list", () => {
  // `* a` / `- - -` / `* b`: the foreign `-` marker opens a NESTED
  // list holding one item whose text is `- -`, and `* b` is the outer
  // list's second item.
  test("a foreign marker opens a nested list", () => {
    const list = firstList(parse("* a\n- - -\n* b\n").children);
    expect(list.marker).toBe("*");
    expect(list.children).toHaveLength(2);
    const [first] = list.children;
    expect(first.blocks).toHaveLength(1);
    const nested = first.blocks[0].block;
    narrow(nested, "list");
    expect(nested.marker).toBe("-");
    expect(nested.children).toHaveLength(1);
    expect(nested.children[0].text[0]).toMatchObject({ value: "- -" });
  });

  // `* a` / `* * *` / `* b`: the same style, so the middle line is a
  // SIBLING item whose text is `* *` - three items, no nesting.
  test("a sibling marker is an item of the open list", () => {
    const list = firstList(parse("* a\n* * *\n* b\n").children);
    expect(list.children).toHaveLength(3);
    expect(list.children[1].text[0]).toMatchObject({ value: "* *" });
    expect(list.children[1].blocks).toHaveLength(0);
  });

  // A blank line above it puts `next_block`'s `skipped` above zero,
  // which nulls `text_only` - and Asciidoctor reads the line as an
  // `<hr>` inside the item there. This reader keeps the marker
  // reading instead, the knowing divergence
  // ({@link ReaderContext.markerLineWins}, src/parse/line-shapes.ts):
  // no break it could print reads back at that position.
  test("a blank line above it keeps the marker reading", () => {
    const list = firstList(parse("* a\n\n- - -\n").children);
    expect(list.children).toHaveLength(1);
    const [only] = list.children;
    expect(only.blocks).toHaveLength(1);
    const nested = only.blocks[0].block;
    narrow(nested, "list");
    expect(nested.children[0].text[0]).toMatchObject({ value: "- -" });
  });

  // A `'''` in the same position is no marker line, so nothing
  // collides and the break is read.
  test("a break that is no marker line is read after a blank", () => {
    const list = firstList(parse("* a\n+\n'''\n").children);
    const [only] = list.children;
    expect(only.blocks[0].block.type).toBe("thematicBreak");
  });

  // THE TWO POSITIONS THE BREAK IS READ AT (#242). Red before the
  // change: each of these gave a nested `list` holding the item `- -`
  // where both programs render an `<hr>` inside the item. What lets
  // the reader take them is what the PRINTER writes above the break:
  // an erased `+`, replayed as the gap in front of the block, and a
  // delimited block's terminator, replayed by the block itself.
  test("an erased continuation above it reads the break", () => {
    const list = firstList(parse("* a\n+\n- - -\n").children);
    const [only] = list.children;
    expect(only.blocks).toHaveLength(1);
    expect(only.blocks[0].block.type).toBe("thematicBreak");
  });

  test("a delimited block's terminator above it reads the break", () => {
    const list = firstList(parse("* a\n+\n----\nx\n----\n- - -\n").children);
    const [only] = list.children;
    expect(only.blocks.map((each) => each.block.type)).toEqual([
      "delimitedBlock",
      "thematicBreak",
    ]);
  });

  // The line UNDER the rule is its own paragraph once the break is
  // read, which is what the marker reading was spending: it took that
  // line as the nested item's text and the reflow joined the two.
  test("the line under the rule is its own block", () => {
    const list = firstList(parse("* a\n+\n- - -\nlast\n").children);
    const [only] = list.children;
    expect(only.blocks.map((each) => each.block.type)).toEqual([
      "thematicBreak",
      "paragraph",
    ]);
  });

  // A DESCRIPTION item is no different: `text_only` is dead there
  // past the term line (`has_text = true if (item_text = match[3])`,
  // parser.rb l.1304, and no adjacency clause, l.1369), so
  // Asciidoctor reads the break, and this reader still keeps the
  // marker reading. The line the printed `'''` would land under is
  // not a fact the reader has - the printer joins the description
  // onto the term line and then wraps it - so the rule holds wherever
  // the line above the break is text.
  test("a term with its own text keeps the marker reading", () => {
    const [node] = parse("t:: d\n- - -\n").children;
    narrow(node, "descriptionList");
    const nested = node.children[0].blocks[0].block;
    narrow(nested, "list");
    expect(nested.children[0].text[0]).toMatchObject({ value: "- -" });
  });

  // The same where the printer JOINS the description onto the term
  // line, which is the shape that made a source-side answer unsound:
  // a reading that turned on the term line carrying text read one way
  // on the first pass and the other on the second.
  test("a description the printer joins keeps the marker reading", () => {
    const [node] = parse("t::\nd\n- - -\n").children;
    narrow(node, "descriptionList");
    const nested = node.children[0].blocks[0].block;
    narrow(nested, "list");
    expect(nested.children[0].text[0]).toMatchObject({ value: "- -" });
  });
});

describe("page break parsing", () => {
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
