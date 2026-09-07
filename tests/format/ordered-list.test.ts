import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { expectFormatted, firstList, formatAdoc, narrow } from "../helpers.js";

describe("ordered list formatting", () => {
  // Canonical single-item list passes through unchanged.
  test("single item preserved", async () => {
    const input = ". Item one\n";
    await expectFormatted(input, input);
    // The simplest case: a single `. item` line is a one-item list.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("ordered");
    expect(list.children).toHaveLength(1);
    expect(list.children[0].type).toBe("listItem");
    expect(list.marker).toBe(".");
  });

  // Multi-item list preserved.
  test("multi-item list preserved", async () => {
    const input = ". First\n. Second\n. Third\n";
    await expectFormatted(input, input);
    // Multiple `.` lines in succession form a single list, not
    // separate one-item lists.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("ordered");
    expect(list.children).toHaveLength(3);
  });

  // Nested list preserved with correct markers.
  test("nested list preserved", async () => {
    const input = ". Parent\n.. Child\n";
    await expectFormatted(input, input);
    // `..` items nested under `.` items produce a child ListNode
    // inside the parent ListItemNode.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [parent],
    } = list;
    // Parent item has text + nested list
    const nestedList = parent.blocks.find(
      ({ block }) => block.type === "list",
    )?.block;
    narrow(nestedList, "list");
    expect(nestedList.variant).toBe("ordered");
    expect(nestedList.children).toHaveLength(1);
    expect(nestedList.marker).toBe("..");
  });

  // One blank line before a list when preceded by a paragraph.
  test("blank line between paragraph and list", async () => {
    const input = "Some text.\n\n. Item\n";
    await expectFormatted(input, input);
  });

  // One blank line after a list when followed by a paragraph.
  test("blank line between list and paragraph", async () => {
    const input = ". Item\n\nSome text.\n";
    await expectFormatted(input, input);
  });

  // Multiple blank lines between a paragraph and list are
  // collapsed.
  test("multiple blank lines collapsed", async () => {
    const input = "Some text.\n\n\n\n. Item\n";
    const expected = "Some text.\n\n. Item\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Three-level nesting preserved.
  test("three-level nesting preserved", async () => {
    const input = ". Level 1\n.. Level 2\n... Level 3\n";
    await expectFormatted(input, input);
    // Three levels exercises nesting more than two: the innermost scan
    // runs over a buffer that is itself a slice of an item's buffer, and
    // each nested list must land INSIDE the item that owns it.
    const { children } = parse(input);
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [l1Item],
    } = list;
    const l2List = l1Item.blocks.find(
      ({ block }) => block.type === "list",
    )?.block;
    narrow(l2List, "list");
    expect(l2List.children).toHaveLength(1);
    const {
      children: [l2Item],
    } = l2List;
    const l3List = l2Item.blocks.find(
      ({ block }) => block.type === "list",
    )?.block;
    narrow(l3List, "list");
    expect(l3List.children).toHaveLength(1);
    expect(l3List.marker).toBe("...");
  });

  // All 5 nesting levels preserved through formatting.
  test("five-level nesting preserved", async () => {
    const input = ". L1\n.. L2\n... L3\n.... L4\n..... L5\n";
    await expectFormatted(input, input);
    // AsciiDoc supports 5 nesting levels. Verify all depths parse
    // correctly and produce the right tree structure.
    const { children } = parse(input);
    const list = firstList(children);
    let current = list;
    for (let depth = 1; depth <= 5; depth += 1) {
      expect(current.children).toHaveLength(1);
      expect(current.marker).toBe(".".repeat(depth));
      if (depth < 5) {
        const nested = current.children[0].blocks.find(
          ({ block }) => block.type === "list",
        )?.block;
        narrow(nested, "list");
        current = nested;
      }
    }
  });

  // Multiple siblings at nested level.
  test("sibling items at nested level", async () => {
    const input = ". Parent\n.. Child A\n.. Child B\n";
    await expectFormatted(input, input);
    // Multiple items at the same nesting level are siblings.
    const { children } = parse(input);
    const list = firstList(children);
    const {
      children: [parentItem],
    } = list;
    const nestedList = parentItem.blocks.find(
      ({ block }) => block.type === "list",
    )?.block;
    narrow(nestedList, "list");
    expect(nestedList.children).toHaveLength(2);
  });

  // Back to parent level after nesting.
  test("return to parent level after nesting", async () => {
    const input = ". First\n.. Nested\n. Second\n";
    await expectFormatted(input, input);
  });

  // List item text is reflowed within printWidth.
  test("long list item text is reflowed", async () => {
    const input =
      ". This is a very long list item that should be reflowed because it exceeds the default print width of eighty characters in total\n";
    const result = await formatAdoc(input);
    // Should be reflowed (wrapped) — verify it contains a
    // newline within the item.
    const lines = result.split("\n");
    // First line starts with ., continuation lines are indented
    expect(lines[0].startsWith(". ")).toBe(true);
    // At least 2 lines + trailing newline
    expect(lines.length).toBeGreaterThan(2);
  });
});
