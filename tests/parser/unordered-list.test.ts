import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstList } from "../helpers.js";
import { narrow } from "../../src/unreachable.js";

describe("unordered list parsing", () => {
  // The simplest case: a single `* item` line is a one-item list.
  test("single-item list", () => {
    const { children } = parse("* Item one\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("unordered");
    expect(list.children).toHaveLength(1);
    expect(list.children[0].type).toBe("listItem");
    expect(list.children[0].depth).toBe(1);
  });

  // Multiple `*` lines in succession form a single list, not
  // separate one-item lists.
  test("multi-item list", () => {
    const { children } = parse("* First\n* Second\n* Third\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("unordered");
    expect(list.children).toHaveLength(3);
  });

  // `**` items nested under `*` items produce a child ListNode inside
  // the parent ListItemNode.
  test("nested list (* then **)", () => {
    const { children } = parse("* Parent\n** Child\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [parent],
    } = list;
    // Parent item has text + nested list
    const nestedList = parent.children.find((c) => c.type === "list");
    narrow(nestedList, "list");
    expect(nestedList.variant).toBe("unordered");
    expect(nestedList.children).toHaveLength(1);
    expect(nestedList.children[0].depth).toBe(2);
  });

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
    const textNode = item.children.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toContain("First line");
    expect(textNode.value).toContain("second line");
  });

  // Two lists separated by a blank line are distinct blocks.
  test("two separate lists separated by blank line", () => {
    const { children } = parse("* List A\n\n* List B\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("list");
    expect(children[1].type).toBe("list");
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
    const textNode = item.children.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Hello world");
  });

  // Three levels exercises the recursive nesting path: each
  // deeper marker (`**`, `***`) must attach to the correct
  // parent, proving the parser handles arbitrary depth.
  test("three levels of nesting", () => {
    const input = "* Level 1\n** Level 2\n*** Level 3\n";
    const { children } = parse(input);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [l1Item],
    } = list;
    const l2List = l1Item.children.find((c) => c.type === "list");
    narrow(l2List, "list");
    expect(l2List.children).toHaveLength(1);
    const {
      children: [l2Item],
    } = l2List;
    const l3List = l2Item.children.find((c) => c.type === "list");
    narrow(l3List, "list");
    expect(l3List.children).toHaveLength(1);
    // Depth is derived from the marker length: `***` → length
    // 3, so depth = marker.length (1-based).
    expect(l3List.children[0].depth).toBe(3);
  });

  // AsciiDoc supports 5 nesting levels. Verify all depths parse
  // correctly and produce the right tree structure.
  test("all five nesting levels", () => {
    const input = "* L1\n** L2\n*** L3\n**** L4\n***** L5\n";
    const { children } = parse(input);
    const list = firstList(children);
    let current = list;
    for (let depth = 1; depth <= 5; depth += 1) {
      expect(current.children).toHaveLength(1);
      expect(current.children[0].depth).toBe(depth);
      if (depth < 5) {
        const nested = current.children[0].children.find(
          (c) => c.type === "list",
        );
        narrow(nested, "list");
        current = nested;
      }
    }
  });

  // Multiple items at the same nesting level are siblings.
  test("sibling items at nested level", () => {
    const input = "* Parent\n** Child A\n** Child B\n";
    const { children } = parse(input);
    const list = firstList(children);
    const {
      children: [parentItem],
    } = list;
    const nestedList = parentItem.children.find((c) => c.type === "list");
    narrow(nestedList, "list");
    expect(nestedList.children).toHaveLength(2);
  });

  // Multi-level collapse: going from depth 3 back to depth 1
  // exercises the ascending loop's collapseLevel call twice
  // in a single pass (popping levels 3 and 2).
  test("return to root after deep nesting", () => {
    const input = "* First\n** Nested\n*** Deep\n* Second\n";
    const { children } = parse(input);
    const list = firstList(children);
    // First and Second are siblings at depth 1.
    expect(list.children).toHaveLength(2);
    expect(list.children[0].depth).toBe(1);
    expect(list.children[1].depth).toBe(1);
    // Nested and Deep are inside First.
    const nested = list.children[0].children.find((c) => c.type === "list");
    narrow(nested, "list");
    expect(nested.children).toHaveLength(1);
    const deep = nested.children[0].children.find((c) => c.type === "list");
    narrow(deep, "list");
    expect(deep.children).toHaveLength(1);
    expect(deep.children[0].depth).toBe(3);
  });

  // AsciiDoc allows `-` as an alternative level-1 unordered list
  // marker. The parser treats it like `*` at depth 1.
  test("hyphen marker parses as depth-1 unordered item", () => {
    const { children } = parse("- Item\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("unordered");
    expect(list.children).toHaveLength(1);
    expect(list.children[0].depth).toBe(1);
    const textNode = list.children[0].children.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Item");
  });

  // Indented lines are normally literal paragraphs in AsciiDoc.
  // Inside a list item they are absorbed as continuation content
  // instead. Since the paragraph lexer mode landed they are
  // ordinary inline text lines, indentation included in the text
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
    const textNode = item.children.find((c) => c.type === "text");
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
    const textNode = item.children.find((c) => c.type === "text");
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
    const nestedList = parentItem.children.find((c) => c.type === "list");
    narrow(nestedList, "list");
    const {
      children: [childItem],
    } = nestedList;
    const textNode = childItem.children.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Child first line\n   child continuation");
  });
});

// The continuation sub-lexer re-maps token positions from
// fragment coordinates back to document coordinates. Format
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
    const link = item.children.find((c) => c.type === "link");
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
