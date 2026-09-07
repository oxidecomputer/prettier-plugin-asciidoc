import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { ListItemNode } from "../../src/ast.js";
import { narrow } from "../helpers.js";

describe("block macro parsing", () => {
  // video with youtube ID as target.
  test("video with youtube ID", () => {
    const { children } = parse("video::RvRhUHTV_8k[youtube]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "blockMacro");
    expect(node.name).toBe("video");
    expect(node.target).toBe("RvRhUHTV_8k");
    expect(node.attrlist).toBe("youtube");
  });

  // Position tracking.
  test("position tracking", () => {
    const { children } = parse("image::img.png[Alt]\n");
    const [node] = children;
    expect(node.type).toBe("blockMacro");
    expect(node.position.start.line).toBe(1);
    expect(node.position.start.column).toBe(1);
    expect(node.position.start.offset).toBe(0);
  });

  // Block macro with path containing directories.
  test("block macro with path target", () => {
    const { children } = parse("image::images/photos/sunset.jpg[Sunset]\n");
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "blockMacro");
    expect(node.target).toBe("images/photos/sunset.jpg");
  });
});

/**
 * The plain text a list item's inline run spells. Reads values rather
 * than comparing whole nodes because every inline node carries a
 * position the assertions below have no opinion about.
 * @param item - the parsed list item
 * @returns the concatenated text of its inline run
 */
function itemTextValue(item: ListItemNode): string {
  return item.text
    .map((node) => (node.type === "text" ? node.value : ""))
    .join("");
}

// A block macro on the line DIRECTLY after a list marker ends the
// item's text and becomes the item's first block; one line further
// down it is ordinary text the item reflows. Pins the
// FIRST_LINE_INTERRUPTERS.listItem row of src/parse/line-shapes.ts
// against the reader; the same row is pinned against the oracle
// itself in tests/conformance/interruption.test.ts (issue #48).
describe("a block macro after a list marker line", () => {
  test("ends the item's text and opens the item's first block", () => {
    const { children } = parse("* a\nimage::x.png[]\n");
    expect(children).toHaveLength(1);
    const [list] = children;
    narrow(list, "list");
    expect(list.children).toHaveLength(1);
    const [item] = list.children;
    expect(itemTextValue(item)).toBe("a");
    expect(item.blocks).toHaveLength(1);
    const [{ gap, block }] = item.blocks;
    // No `+` and no blank line between marker line and macro.
    expect(gap).toEqual([]);
    narrow(block, "blockMacro");
    expect(block.name).toBe("image");
    expect(block.target).toBe("x.png");
  });

  test("stays item text one line further down", () => {
    const { children } = parse("* a\nmore\nimage::x.png[]\n");
    const [list] = children;
    narrow(list, "list");
    const [item] = list.children;
    expect(item.blocks).toHaveLength(0);
  });

  test("does not stop the list: the next marker opens a sibling item", () => {
    const { children } = parse("* a\nimage::x.png[]\n* b\n");
    expect(children).toHaveLength(1);
    const [list] = children;
    narrow(list, "list");
    expect(list.children).toHaveLength(2);
  });

  // Every marker family reaches the same registry row — the position
  // rule is keyed by context, not by marker style.
  test.each([
    ["ordered", ". a\nimage::x.png[]\n"],
    ["callout", "<1> a\nimage::x.png[]\n"],
  ])("%s items split the same way", (_variant, source) => {
    const [list] = parse(source).children;
    narrow(list, "list");
    const [item] = list.children;
    expect(itemTextValue(item)).toBe("a");
    expect(item.blocks).toHaveLength(1);
  });
});
