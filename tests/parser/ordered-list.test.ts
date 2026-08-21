import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstList } from "../helpers.js";
import { narrow } from "../../src/unreachable.js";

describe("ordered list parsing", () => {
  // The simplest case: a single `. item` line is a one-item list.
  test("single-item ordered list", () => {
    const { children } = parse(". Item one\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("ordered");
    expect(list.children).toHaveLength(1);
    expect(list.children[0].type).toBe("listItem");
    expect(list.children[0].depth).toBe(1);
  });

  // Multiple `.` lines in succession form a single list, not
  // separate one-item lists.
  test("multi-item ordered list", () => {
    const { children } = parse(". First\n. Second\n. Third\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("ordered");
    expect(list.children).toHaveLength(3);
  });

  // `..` items nested under `.` items produce a child ListNode
  // inside the parent ListItemNode.
  test("nested ordered list (. then ..)", () => {
    const { children } = parse(". Parent\n.. Child\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [parent],
    } = list;
    // Parent item has text + nested list
    const nestedList = parent.children.find((c) => c.type === "list");
    narrow(nestedList, "list");
    expect(nestedList.variant).toBe("ordered");
    expect(nestedList.children).toHaveLength(1);
    expect(nestedList.children[0].depth).toBe(2);
  });

  // A list item can span multiple lines. A flush (non-indented)
  // continuation line — one that is not a list marker and not
  // blank — is absorbed into the preceding item's text content.
  // Indented continuation lines follow a different lexer path;
  // see "indented continuation lines in ordered list".
  test("list item with continuation line", () => {
    const { children } = parse(". First line\nsecond line\n");
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    // toContain (not toBe) because continuation merges lines
    // with a newline character; exact whitespace is tested in
    // "indented continuation lines in ordered list".
    const {
      children: [item],
    } = list;
    const textNode = item.children.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toContain("First line");
    expect(textNode.value).toContain("second line");
  });

  // Two lists separated by a blank line are distinct blocks.
  test("two separate ordered lists separated by blank line", () => {
    const { children } = parse(". List A\n\n. List B\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("list");
    expect(children[1].type).toBe("list");
  });

  // Position tracking: the list starts at the first `.` marker.
  test("correct start position", () => {
    const { children } = parse(". Item\n");
    expect(children[0].position.start.offset).toBe(0);
    expect(children[0].position.start.line).toBe(1);
    expect(children[0].position.start.column).toBe(1);
  });

  // List item text does not include the marker or the space
  // after it.
  test("item text excludes marker", () => {
    const { children } = parse(". Hello world\n");
    const list = firstList(children);
    const {
      children: [item],
    } = list;
    const textNode = item.children.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Hello world");
  });

  // Three levels exercises the stack more than two: the
  // nestListItems loop must push twice and then drain twice
  // when the list ends, checking that collapseLevel wires
  // each nested list onto the right parent item.
  test("three levels of nesting", () => {
    const input = ". Level 1\n.. Level 2\n... Level 3\n";
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
    expect(l3List.children[0].depth).toBe(3);
  });

  // AsciiDoc supports 5 nesting levels. Verify all depths parse
  // correctly and produce the right tree structure.
  test("all five nesting levels", () => {
    const input = ". L1\n.. L2\n... L3\n.... L4\n..... L5\n";
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
    const input = ". Parent\n.. Child A\n.. Child B\n";
    const { children } = parse(input);
    const list = firstList(children);
    const {
      children: [parentItem],
    } = list;
    const nestedList = parentItem.children.find((c) => c.type === "list");
    narrow(nestedList, "list");
    expect(nestedList.children).toHaveLength(2);
  });

  // After nesting three levels deep (. → .. → ...), a subsequent
  // single-dot item (.) must pop back to the root list. Verifies
  // that collapseLevel correctly drains the nesting stack all the
  // way back to depth 1 rather than just one level at a time.
  test("return to root after deep nesting", () => {
    const { children } = parse(". L1\n.. L2\n... L3\n. Back to L1\n");
    const list = firstList(children);
    expect(list.children).toHaveLength(2);
    const {
      children: [first, second],
    } = list;
    expect(first.type).toBe("listItem");
    expect(second.type).toBe("listItem");
    expect(second.depth).toBe(1);
  });

  // A line with leading whitespace that immediately follows a list
  // item continues the item's text rather than starting a literal
  // paragraph. The indentation stays in the text node's value (the
  // printer splits on whitespace, so it never reaches the output).
  // This covers the real-world style of aligning wrapped text under
  // a marker, e.g. ". First line\n  continuation line".
  test("indented continuation lines in ordered list", () => {
    const input = ". First line\n  continuation line\n";
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [item],
    } = list;
    const textNode = item.children.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("First line\n  continuation line");
  });
});
