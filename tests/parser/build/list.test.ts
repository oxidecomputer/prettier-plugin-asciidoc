/**
 * `build/list.ts` — list markers, item texts and item blocks to nodes.
 *
 * Table-driven because the module is `(input, index) → node` with no
 * context: the rows are the specification. They pin the callout
 * number read off `<N>` / `<.>`, the marker spelling a list carries
 * for its items, the checklist prefix that only an UNORDERED item may
 * carry, the blocks carried through gaps attached, the three-way
 * fallback for where an item ends, and the SERIALIZED key order of
 * both node shapes.
 */
import { describe, expect, test } from "vitest";
import {
  buildList,
  buildListItem,
  CHECKBOX_PREFIX_LEN,
  type ListItemInput,
} from "../../../src/parse/build/list.js";
import { parse } from "../../../src/parser.js";
import { narrow } from "../../../src/unreachable.js";
import { serializedKeys } from "../reader-helpers.js";
import type { InlineToken } from "../../../src/parse/inline/tokens.js";
import { makeLocationIndex } from "../../../src/parse/positions.js";
import type {
  BlockNode,
  GapLine,
  ItemBlock,
  ListItemNode,
} from "../../../src/ast.js";

const at = makeLocationIndex("* one\n* two\n* three\n* four\n");

/**
 * One item input with the parts a row does not care about defaulted.
 * @param overrides - the parts the row sets
 * @returns a complete input
 */
function itemInput(overrides: Partial<ListItemInput>): ListItemInput {
  return {
    marker: { image: "* ", offset: 0 },
    variant: "unordered",
    calloutNumber: undefined,
    text: [],
    blocks: [],
    trailingContinuation: false,
    ...overrides,
  };
}

/**
 * One inline text token at a document offset.
 * @param image - the token's bytes
 * @param offset - where they start
 * @returns the token
 */
function text(image: string, offset: number): InlineToken {
  return { type: "InlineText", image, offset };
}

/**
 * A block standing in for whatever the reader put inside an item.
 * @param type - the node kind to fake
 * @param end - the offset the block ends at
 * @returns the block
 */
function blockAt(type: "paragraph" | "list", end: number): BlockNode {
  const position = {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: end, line: 1, column: end + 1 },
  };
  return type === "list"
    ? {
        type: "list",
        variant: "unordered",
        marker: "*",
        children: [],
        position,
      }
    : { type: "paragraph", children: [], position };
}

/**
 * One item block behind its recorded gap.
 * @param gap - the separator lines the source wrote before it
 * @param block - the block itself
 * @returns the item block
 */
function entry(gap: readonly GapLine[], block: BlockNode): ItemBlock {
  return { gap, block };
}

/**
 * One item whose marker and text put it where the caller says.
 * @param start - the item's start offset
 * @param end - the item's end offset
 * @returns the item node
 */
function item(start: number, end: number): ListItemNode {
  return buildListItem(
    itemInput({
      marker: { image: "* ", offset: start },
      text: [text("x", end - 1)],
    }),
    at,
  );
}

// The number is PARSED by the classifier (the rows for that live in
// tests/parser/lines.test.ts, under parseListMarker); this builder
// only carries it onto the node, so these rows pin the carrying.
describe("callout numbers", () => {
  test.each([1, 9, 0])("a callout item carries number %i", (number) => {
    const node = buildListItem(
      itemInput({
        marker: { image: "<1> ", offset: 0 },
        variant: "callout",
        calloutNumber: number,
      }),
      at,
    );
    expect(node.calloutNumber).toBe(number);
  });

  test("a non-callout item has no callout number", () => {
    expect(buildListItem(itemInput({}), at).calloutNumber).toBeUndefined();
  });
});

describe("checklist prefix", () => {
  test.each([
    ["[x] done", "checked"],
    ["[*] done", "checked"],
    ["[ ] done", "unchecked"],
  ])("%j on an unordered item sets %j and is stripped", (body, checkbox) => {
    const node = buildListItem(itemInput({ text: [text(body, 2)] }), at);
    expect(node.checkbox).toBe(checkbox);
    expect(node.text).toEqual([
      expect.objectContaining({
        type: "text",
        value: body.slice(CHECKBOX_PREFIX_LEN),
      }),
    ]);
  });

  test("the same prefix on an ORDERED item is left alone", () => {
    const node = buildListItem(
      itemInput({
        marker: { image: ". ", offset: 0 },
        variant: "ordered",
        text: [text("[x] done", 2)],
      }),
      at,
    );
    expect(node.checkbox).toBeUndefined();
    expect(node.text).toEqual([
      expect.objectContaining({ type: "text", value: "[x] done" }),
    ]);
  });

  // `parse_list_item` tests `text.start_with?('[')`: the prefix is
  // only a checkbox where the item's text begins, never mid-text.
  test("the same prefix later in the text is not a checklist", () => {
    const node = buildListItem(
      itemInput({ text: [text("do [x] later", 2)] }),
      at,
    );
    expect(node.checkbox).toBeUndefined();
    expect(node.text).toEqual([
      expect.objectContaining({ type: "text", value: "do [x] later" }),
    ]);
  });

  test("an unordered item without a prefix has no checkbox", () => {
    const node = buildListItem(itemInput({ text: [text("done", 2)] }), at);
    expect(node.checkbox).toBeUndefined();
    expect(node.text).toEqual([
      expect.objectContaining({ type: "text", value: "done" }),
    ]);
  });
});

describe("the blocks an item took", () => {
  test("blocks stay in source order, nested lists among them", () => {
    const nested = blockAt("list", 9);
    const paragraph = blockAt("paragraph", 5);
    const node = buildListItem(
      itemInput({
        text: [text("one", 2)],
        blocks: [entry(["+"], paragraph), entry([""], nested)],
      }),
      at,
    );
    expect(node.text).toEqual([
      expect.objectContaining({ type: "text", value: "one" }),
    ]);
    expect(node.blocks).toEqual([
      { gap: ["+"], block: paragraph },
      { gap: [""], block: nested },
    ]);
  });

  test("each block keeps its gap verbatim", () => {
    const node = buildListItem(
      itemInput({
        blocks: [
          entry(["", "+", "", "+"], blockAt("paragraph", 5)),
          entry([""], blockAt("paragraph", 7)),
        ],
      }),
      at,
    );
    expect(node.blocks.map(({ gap }) => gap)).toEqual([
      ["", "+", "", "+"],
      [""],
    ]);
  });
});

describe("where an item ends", () => {
  test("on the last block, when it took one", () => {
    const node = buildListItem(
      itemInput({
        text: [text("one", 2)],
        blocks: [
          entry(["+"], blockAt("paragraph", 5)),
          entry(["+"], blockAt("paragraph", 11)),
        ],
      }),
      at,
    );
    expect(node.position.end).toEqual({ offset: 11, line: 1, column: 12 });
  });

  test("on the body's last content token, when it took no block", () => {
    const node = buildListItem(itemInput({ text: [text("one", 2)] }), at);
    expect(node.position).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 5, line: 1, column: 6 },
    });
  });

  test("on the marker, when it has no body either", () => {
    expect(buildListItem(itemInput({}), at).position).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 2, line: 1, column: 3 },
    });
  });
});

describe("buildList", () => {
  test("spans its first item's start to its last item's end", () => {
    const node = buildList("unordered", "*", item(0, 5), [item(6, 11)]);
    expect(node).toMatchObject({ type: "list", variant: "unordered" });
    expect(node.children).toHaveLength(2);
    expect(node.position).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 11, line: 2, column: 6 },
    });
  });

  test.each(["unordered", "ordered", "callout"] as const)(
    "carries the %j variant through",
    (variant) => {
      expect(buildList(variant, "*", item(0, 5), []).variant).toBe(variant);
    },
  );

  // The spelling is DATA, not arithmetic: whatever the classifier
  // read off the first marker travels to the node untouched, tab-gapped
  // runs included (the depth re-derivation that used to collapse them
  // is gone).
  test.each([
    ["unordered", "*"],
    ["unordered", "**"],
    ["unordered", "*****"],
    ["unordered", "-"],
    ["ordered", "."],
    ["ordered", ".."],
    ["callout", "<>"],
  ] as const)(
    "a %s list carries the %j marker spelling through",
    (variant, marker) => {
      expect(buildList(variant, marker, item(0, 5), []).marker).toBe(marker);
    },
  );
});

describe("serialized key order", () => {
  test("a list serializes type, variant, marker, children, position", () => {
    const [list] = parse("* a\n").children;
    expect(serializedKeys(list)).toEqual([
      "type",
      "variant",
      "marker",
      "children",
      "position",
    ]);
  });

  // JSON.stringify drops undefined-valued keys, so the three item
  // shapes pin the relative order around the optional pair.
  test("an item's order is the old one minus depth", () => {
    const [list] = parse("* a\n").children;
    narrow(list, "list");
    expect(serializedKeys(list.children[0])).toEqual([
      "type",
      "text",
      "blocks",
      "trailingContinuation",
      "position",
    ]);
  });

  test("a checklist item keeps checkbox in slot two", () => {
    const [list] = parse("* [x] a\n").children;
    narrow(list, "list");
    expect(serializedKeys(list.children[0])).toEqual([
      "type",
      "checkbox",
      "text",
      "blocks",
      "trailingContinuation",
      "position",
    ]);
  });

  test("a callout item keeps calloutNumber in slot three", () => {
    const [list] = parse("<1> a\n").children;
    narrow(list, "list");
    expect(serializedKeys(list.children[0])).toEqual([
      "type",
      "calloutNumber",
      "text",
      "blocks",
      "trailingContinuation",
      "position",
    ]);
  });
});
