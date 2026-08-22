/**
 * The frame layer's pure units: `fragmentOfLine` and `heldMetadataNode`
 * in src/parse/lines/frames.ts, the list item's inbox —
 * `pushIntoItem` in src/parse/lines/list-frames.ts over `Item.markNext`
 * / `Item.takeMark` in src/parse/lines/list-item.ts — and the rest of
 * `Item`'s per-item state machine: the body context it hands the
 * paragraph reader, its block count, its held-metadata run and its `+`
 * ladder. Those are `read_lines_for_list_item`'s bookkeeping, and each
 * is a question with an answer, so the rows state the answers here
 * rather than leaving them to be inferred from a document's shape.
 *
 * Table-driven because each is `(input) → value` with no context: the
 * rows are the specification. The reader's characterization suites
 * (reader.test.ts, reader-lists.test.ts) pin what the reader DOES with
 * these; this file pins what they are.
 */
import { describe, expect, test } from "vitest";
import type { BlockNode } from "../../src/ast.js";
import {
  classifyLine,
  BLOCK_START_CONTEXT,
} from "../../src/parse/lines/classify.js";
import {
  fragmentOfLine,
  heldMetadataNode,
  isHeldMetadata,
} from "../../src/parse/lines/frames.js";
import {
  pushIntoItem,
  type ListFrame,
} from "../../src/parse/lines/list-frames.js";
import { Item, PLUS_MARK } from "../../src/parse/lines/list-item.js";
import { splitLines, type SourceLine } from "../../src/parse/lines/split.js";
import { makeLocationIndex } from "../../src/parse/positions.js";

// A one-line block at `offset`, for the inbox rows.
const block = (offset: number): BlockNode => ({
  type: "thematicBreak",
  position: {
    start: { offset, line: 1, column: offset + 1 },
    end: { offset: offset + 3, line: 1, column: offset + 4 },
  },
});

// An open unordered list reading `item`.
const frameWith = (item: Item): ListFrame => ({
  kind: "list",
  variant: "unordered",
  style: "*",
  item,
  items: [],
});

describe("fragmentOfLine", () => {
  // The third line carries trailing whitespace: `raw` keeps it, `text`
  // does not, and a node is built from RAW.
  const [first, second, third] = splitLines("ab\ncde\nfg  \n");

  const rows: Array<
    [string, { line: SourceLine; from?: number; to?: number }, string, number]
  > = [
    ["the whole first line", { line: first }, "ab", 0],
    ["the whole second line", { line: second }, "cde", 3],
    ["the third line, trailing space included", { line: third }, "fg  ", 7],
    ["from a column to the end", { line: second, from: 1 }, "de", 4],
    ["a slice inside the line", { line: second, from: 1, to: 2 }, "d", 4],
    [
      "an empty slice at the line's end",
      { line: second, from: 3, to: 3 },
      "",
      6,
    ],
  ];
  test.each(rows)("%s", (_name, { line, from, to }, image, offset) => {
    expect(fragmentOfLine(line, from, to)).toEqual({ image, offset });
  });
});

describe("heldMetadataNode / isHeldMetadata", () => {
  // One line per kind `parse_block_metadata_line` claims, plus the
  // kinds it does not: an attribute ENTRY is processed where it stands,
  // and text, a marker and a title open blocks of their own. A block
  // anchor is a paragraph holding the inline anchor (build/metadata.ts).
  const held: Array<[string, BlockNode["type"]]> = [
    ["[[id]]", "paragraph"],
    ["[source]", "blockAttributeList"],
    [".Title", "blockTitle"],
    ["// comment", "comment"],
    ["ifdef::x[]", "preprocessorDirective"],
  ];
  const notHeld = [":name: value", "text", "* item", "== Title", "----"];

  test.each(held)("%j is held, as a %s node", (text, type) => {
    const source = `${text}\n`;
    const [line] = splitLines(source);
    const kind = classifyLine(line.text, BLOCK_START_CONTEXT);
    expect(isHeldMetadata(kind)).toBe(true);
    const node = heldMetadataNode(kind, line, makeLocationIndex(source));
    expect(node?.type).toBe(type);
    // Built from the line's own span: the node starts where the line does.
    expect(node?.position.start).toEqual({ offset: 0, line: 1, column: 1 });
  });

  test.each(notHeld)("%j is not held", (text) => {
    const source = `${text}\n`;
    const [line] = splitLines(source);
    const kind = classifyLine(line.text, BLOCK_START_CONTEXT);
    expect(isHeldMetadata(kind)).toBe(false);
    expect(heldMetadataNode(kind, line, makeLocationIndex(source))).toBe(
      undefined,
    );
  });
});

describe("pushIntoItem", () => {
  const marker = { image: "* ", offset: 0 };

  test("an unmarked block was introduced by a `+` directly above it", () => {
    const item = new Item(splitLines("* a\n")[0], marker);
    pushIntoItem(frameWith(item), block(4));
    expect(item.attached).toEqual([
      { block: block(4), continuation: "plus", pluses: 1 },
    ]);
    expect(PLUS_MARK).toEqual({ continuation: "plus", pluses: 1 });
  });

  test.each([
    ["detached, two pluses", { continuation: "detached", pluses: 2 }],
    ["none", { continuation: "none", pluses: 0 }],
    ["blank", { continuation: "blank", pluses: 0 }],
  ] as const)("a marked block carries its mark (%s)", (_name, mark) => {
    const item = new Item(splitLines("* a\n")[0], marker);
    item.markNext(mark);
    pushIntoItem(frameWith(item), block(4));
    expect(item.attached).toEqual([{ block: block(4), ...mark }]);
  });

  test("a mark is consumed by the one block it was set for", () => {
    const item = new Item(splitLines("* a\n")[0], marker);
    item.markNext({ continuation: "none", pluses: 0 });
    const frame = frameWith(item);
    pushIntoItem(frame, block(4));
    pushIntoItem(frame, block(8));
    expect(item.attached.map(({ continuation }) => continuation)).toEqual([
      "none",
      "plus",
    ]);
  });

  test("the marker line number and span are the item's", () => {
    const [line] = splitLines("  * a\n");
    const item = new Item(line, fragmentOfLine(line, 2, 4));
    expect(item.markerLine).toBe(1);
    expect(item.marker).toEqual({ image: "* ", offset: 2 });
  });
});

// The three lines every Item row below is built from: the marker line
// and two `+` lines, so a row can name WHICH `+` an item kept.
const [MARKER_LINE, PLUS_A, PLUS_B] = splitLines("* a\n+\n+\n");
const MARKER = { image: "* ", offset: 0 };

/**
 * A fresh item on the shared marker line.
 * @returns the item
 */
function freshItem(): Item {
  return new Item(MARKER_LINE, MARKER);
}

describe("Item.takeBodyContext", () => {
  // `next_block` reads an item's block as `read_paragraph_lines reader,
  // skipped == 0 && options[:list_type]`: with no `+` above it the
  // paragraph is adjacent to the item text and the list-item
  // interrupting set applies; after a `+` — pending or erased — the
  // marker became a blank line and the plain set applies.
  test("a fresh item reads its body with the list-item set", () => {
    expect(freshItem().takeBodyContext()).toBe("listItem");
  });

  test("a pending `+` makes it the continuation set", () => {
    const item = freshItem();
    item.attach(PLUS_A);
    expect(item.takeBodyContext()).toBe("listContinuation");
  });

  test("an erased `+` makes it the continuation set for the NEXT block only", () => {
    const item = freshItem();
    item.attach(PLUS_A);
    item.claim();
    expect(item.takeBodyContext()).toBe("listContinuation");
    expect(item.takeBodyContext()).toBe("listItem");
  });

  test("claiming with no `+` pending erases nothing", () => {
    const item = freshItem();
    item.claim();
    expect(item.takeBodyContext()).toBe("listItem");
  });
});

describe("Item.countBlock", () => {
  // `startHeldRun` reads `blockCount === EMPTY` to decide whether the
  // run it is about to hold is still the item's first block.
  test("an item starts with no blocks and counts each one it takes", () => {
    const item = freshItem();
    expect(item.blockCount).toBe(0);
    item.countBlock();
    item.countBlock();
    expect(item.blockCount).toBe(2);
  });
});

describe("Item.beginHeldRun / Item.countHeldLine", () => {
  // The run needs an explicit `+` only when it BOTH ended multi-line
  // item text and carries a block title: reflowed onto the first rest
  // line an attribute line or anchor is still read as metadata, while a
  // title after it is read as text (oracle: `* a para` / `[role]` /
  // `.T` renders `a para .T`, `[role]` / `[role]` renders `a para`).
  test("a run that ended item text needs an explicit `+` only once it has a title", () => {
    const item = freshItem();
    item.beginHeldRun(true);
    expect(item.countHeldLine(false)).toBe(false);
    expect(item.countHeldLine(true)).toBe(true);
  });

  test("a run that did not end item text never needs one", () => {
    const item = freshItem();
    item.beginHeldRun(false);
    expect(item.countHeldLine(true)).toBe(false);
  });

  test("a new run forgets the previous run's title", () => {
    const item = freshItem();
    item.beginHeldRun(true);
    expect(item.countHeldLine(true)).toBe(true);
    item.beginHeldRun(true);
    expect(item.countHeldLine(false)).toBe(false);
  });
});

describe("Item's `+` ladder", () => {
  test("a `+` directly above its block spells the block `plus`", () => {
    const item = freshItem();
    item.attach(PLUS_A);
    expect(item.takePlus()).toBe("plus");
  });

  test("a `+` after a blank line spells it `detached`", () => {
    const item = freshItem();
    item.attach(PLUS_A, true);
    expect(item.takePlus()).toBe("detached");
  });

  test("a pending `+` speaks for the first block it introduces only", () => {
    const item = freshItem();
    item.attach(PLUS_A);
    expect(item.takePlus()).toBe("plus");
    expect(item.takePlus()).toBeUndefined();
  });

  // Ruby's outer loop keeps only the LAST detached `+` out of its
  // buffer, so the inner item takes its own EARLIER `+` back and the
  // block is spelled with both.
  test("stacking a detached `+` with none pending takes the item's earlier `+` back", () => {
    const item = freshItem();
    item.separate(PLUS_A, freshItem());
    item.stackDetached(PLUS_B, freshItem());
    expect(item.pendingPlus).toBe(PLUS_A);
    expect(item.takePlus()).toBe("detached");
    expect(item.takeDetachedPluses()).toBe(2);
  });

  test("stacking onto an item that already has one pending keeps the first", () => {
    const item = freshItem();
    item.attach(PLUS_A);
    item.stackDetached(PLUS_B, freshItem());
    expect(item.pendingPlus).toBe(PLUS_A);
    expect(item.takePlus()).toBe("plus");
    expect(item.takeDetachedPluses()).toBe(2);
  });
});
