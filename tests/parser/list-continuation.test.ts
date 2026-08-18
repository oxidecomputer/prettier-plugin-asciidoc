/**
 * Parser tests for `+` list continuations (issue #2).
 *
 * A line containing only `+` directly after a list item's text
 * attaches the following paragraph to the item as a separate
 * block, stored in the item's `blocks` array — not folded into
 * the principal text.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { asParagraph, firstList } from "../helpers.js";
import { narrow } from "../../src/unreachable.js";

describe("list continuation parsing", () => {
  test("+ attaches a paragraph to the item", () => {
    const { children } = parse("* item text.\n+\nAttached paragraph.\n");
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [item],
    } = list;
    // Principal text does not swallow the continuation.
    expect(item.children).toHaveLength(1);
    expect(item.children[0]).toMatchObject({
      type: "text",
      value: "item text.",
    });
    // The attached paragraph lands in blocks.
    expect(item.attachedBlocks).toHaveLength(1);
    const attached = asParagraph(item.attachedBlocks[0]);
    expect(attached.children[0]).toMatchObject({
      type: "text",
      value: "Attached paragraph.",
    });
  });

  test("chained + lines attach multiple paragraphs", () => {
    const { children } = parse(
      "* item text.\n+\nFirst attached.\n+\nSecond attached.\n",
    );
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(2);
    expect(asParagraph(item.attachedBlocks[0]).children[0]).toMatchObject({
      type: "text",
      value: "First attached.",
    });
    expect(asParagraph(item.attachedBlocks[1]).children[0]).toMatchObject({
      type: "text",
      value: "Second attached.",
    });
  });

  test("multi-line attached paragraph stays one block", () => {
    const { children } = parse(
      "* item text.\n+\nAttached line one\nattached line two.\n",
    );
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(1);
    expect(asParagraph(item.attachedBlocks[0]).children[0]).toMatchObject({
      type: "text",
      value: "Attached line one\nattached line two.",
    });
  });

  test("continuation attaches to the nested item it follows", () => {
    const { children } = parse("* parent\n** nested.\n+\nAttached.\n");
    const {
      children: [parentItem],
    } = firstList(children);
    expect(parentItem.attachedBlocks).toHaveLength(0);
    const nestedList = parentItem.children.find((c) => c.type === "list");
    narrow(nestedList, "list");
    const {
      children: [nestedItem],
    } = nestedList;
    expect(nestedItem.attachedBlocks).toHaveLength(1);
  });

  test("items without continuation have empty blocks", () => {
    const { children } = parse("* plain item\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(0);
  });

  // A `+` word inside the item's text (not alone on a line) is
  // ordinary content, not a continuation marker.
  test("+ mid-line is not a continuation", () => {
    const { children } = parse("* item + more text\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(0);
    expect(item.children[0]).toMatchObject({
      type: "text",
      value: "item + more text",
    });
  });

  // A trailing `+` with nothing after it cannot attach anything;
  // it is recorded as a dangling continuation so the printer can
  // re-emit the bare `+` line verbatim (Asciidoctor attaches the
  // next block even across a blank line, so the byte must
  // survive).
  test("dangling trailing + is recorded, not folded into text", () => {
    const { children } = parse("* item text\n+\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(0);
    expect(item.danglingContinuation).toBe(true);
    expect(item.children[0]).toMatchObject({
      type: "text",
      value: "item text",
    });
  });

  // A `+` line with trailing whitespace is still a marker —
  // Asciidoctor right-trims lines before matching, so one
  // invisible trailing space must not resurrect the folding
  // corruption.
  test("+ line with trailing whitespace is a marker", () => {
    const { children } = parse("* item text.\n+ \nAttached paragraph.\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(1);
    expect(item.children[0]).toMatchObject({
      type: "text",
      value: "item text.",
    });
  });

  // A `+` line DIRECTLY after a marker is content of the
  // attached paragraph, not a second marker — treating it as a
  // marker would silently delete the `+` from the rendered
  // document (Asciidoctor renders `+ Attached` here).
  test("+ line directly after a marker is content", () => {
    const { children } = parse("* item\n+\n+\nAttached\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(1);
    const attached = asParagraph(item.attachedBlocks[0]);
    expect(attached.children[0]).toMatchObject({
      type: "text",
      value: "+\nAttached",
    });
  });

  // Indented content after `+` is a literal block in
  // Asciidoctor — whitespace is significant and must not be
  // reflowed into a paragraph.
  test("indented content after + becomes a literal block", () => {
    const { children } = parse("* item\n+\n  literal line\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(1);
    expect(item.attachedBlocks[0]).toMatchObject({
      type: "delimitedBlock",
      variant: "literal",
      form: "indented",
      content: "  literal line",
    });
  });
});
