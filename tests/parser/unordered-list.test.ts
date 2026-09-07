import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstList, narrow, renderedHtml } from "../helpers.js";

describe("unordered list parsing", () => {
  // A list item can span multiple lines. A plain text line that
  // follows the marker line (no blank line between them) is
  // absorbed into the item rather than starting a new block.
  // "Continuation line" here means a wrapped paragraph line, not
  // an AsciiDoc list-continuation block (`+` on its own line).
  test("list item with continuation line", () => {
    const { children } = parse("* First line\nsecond line\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [item],
    } = list;
    const textNode = item.text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toContain("First line");
    expect(textNode.value).toContain("second line");
  });

  // A blank line between two items does NOT split the list: Ruby's
  // `parse_list` skips blank lines before asking whether the next line
  // is a sibling item (`next_list`), and `read_lines_for_list_item`
  // breaks at the sibling marker either way. ORACLE: one `<ul>`.
  test("two items separated by a blank line are one list", async () => {
    const input = "* List A\n\n* List B\n";
    const html = await renderedHtml(input);
    expect(html.match(/<ul>/gv)).toHaveLength(1);
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    expect(firstList(children).children).toHaveLength(2);
  });

  // Position tracking: the list starts at the first `*` marker.
  test("list has correct start position", () => {
    const { children } = parse("* Item\n");
    expect(children[0].position.start.offset).toBe(0);
    expect(children[0].position.start.line).toBe(1);
    expect(children[0].position.start.column).toBe(1);
  });

  // List item text does not include the marker or the space after it.
  test("list item text excludes marker", () => {
    const { children } = parse("* Hello world\n");
    const list = firstList(children);
    const {
      children: [item],
    } = list;
    const textNode = item.text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Hello world");
  });

  // Indented lines are normally literal paragraphs in AsciiDoc.
  // Inside a list item they are absorbed as continuation content
  // instead, as ordinary inline text lines, indentation included in
  // the text
  // node's value — the printer splits on whitespace, so the
  // indentation never reaches the output.
  test("indented continuation lines are part of list item", () => {
    const input = "* First line\n  continuation line\n  another continuation\n";
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [item],
    } = list;
    const textNode = item.text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe(
      "First line\n  continuation line\n  another continuation",
    );
  });

  // Mixed indented and flush continuation lines are both absorbed
  // into one ordered inline stream: inside an open paragraph, an
  // indented line is text like any other.
  test("mixed indented and non-indented continuation", () => {
    const input = "* First line\n  indented continuation\nflush continuation\n";
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [item],
    } = list;
    const textNode = item.text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe(
      "First line\n  indented continuation\nflush continuation",
    );
  });

  // Indented continuation works at any nesting level, not just the
  // root. 3 spaces are used here (vs. 2 above) to confirm the
  // parser uses any non-zero indentation, not a fixed column.
  test("indented continuation in nested list item", () => {
    const input = "* Parent\n** Child first line\n   child continuation\n";
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    const {
      children: [parentItem],
    } = list;
    const nestedList = parentItem.blocks.find(
      ({ block }) => block.type === "list",
    )?.block;
    narrow(nestedList, "list");
    const {
      children: [childItem],
    } = nestedList;
    const textNode = childItem.text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Child first line\n   child continuation");
  });
});

// A continuation line is tokenized as part of its item's text run,
// and the tokens carry DOCUMENT offsets rather than fragment ones
// (`ParagraphReader.tokenizeRun` passes `run.start` as the base). Format
// tests cannot see position corruption (the printer does not
// read inline end positions), so pin both ends here: slicing
// the source with the node's own offsets must reproduce the
// construct exactly.
describe("continuation line inline node positions", () => {
  test("link on continuation line has document-absolute offsets", () => {
    const input = "* item\n  https://example.com[x] tail\n";
    const { children } = parse(input);
    const {
      children: [item],
    } = firstList(children);
    const link = item.text.find((c) => c.type === "link");
    narrow(link, "link");
    const {
      position: { start, end },
    } = link;
    expect(input.slice(start.offset, end.offset)).toBe(
      "https://example.com[x]",
    );
    expect(start.line).toBe(2);
    expect(end.line).toBe(2);
    // Columns are 1-based; the link starts after the 2-space
    // continuation indent.
    expect(start.column).toBe(3);
  });
});

// The classifier already matched the `[ \t]*` a list rx opens with,
// so the item carries those bytes rather than a width or a depth
// (`ListItemNode.markerIndent`). It is what decides whether the line
// under an indented marker is read as that marker's sibling or as its
// child, so the spelling has to survive to the printer.
describe("an item records the bytes its marker is indented by", () => {
  test.each([
    ["a flush-left marker records nothing", "* a\n", [""]],
    ["a nested marker records its spaces", "* a\n  ** z\n", ["", "  "]],
    ["a wider indent records all of it", "* a\n    ** z\n", ["", "    "]],
    ["a tab records the tab", "* a\n\t** z\n", ["", "\t"]],
    ["a top-level list records its own", "  * a\n  * b\n", ["  ", "  "]],
  ])("%s", (_name, input, expected) => {
    const indents: string[] = [];
    const walk = (list: ReturnType<typeof firstList>): void => {
      for (const item of list.children) {
        indents.push(item.markerIndent);
        for (const { block } of item.blocks) {
          if (block.type === "list") {
            walk(block);
          }
        }
      }
    };
    walk(firstList(parse(input).children));
    expect(indents).toEqual(expected);
  });
});
