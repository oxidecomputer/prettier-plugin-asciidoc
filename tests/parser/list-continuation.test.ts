/**
 * Parser tests for `+` list continuations (issues #2 and #6).
 *
 * A line containing only `+` directly after a list item's text
 * attaches the following paragraph to the item as a separate
 * block, stored in the item's `blocks` array — not folded into
 * the principal text.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  asParagraph,
  expectFormatted,
  firstList,
  narrow,
  renderedHtml,
} from "../helpers.js";

describe("list continuation parsing", () => {
  test("+ attaches a paragraph to the item", () => {
    const { children } = parse("* item text.\n+\nAttached paragraph.\n");
    const list = firstList(children);
    expect(list.children).toHaveLength(1);
    const {
      children: [item],
    } = list;
    // Principal text does not swallow the continuation.
    expect(item.text).toHaveLength(1);
    expect(item.text[0]).toMatchObject({
      type: "text",
      value: "item text.",
    });
    // The attached paragraph lands in blocks, behind its verbatim gap.
    expect(item.blocks).toHaveLength(1);
    expect(item.blocks[0].gap).toEqual(["+"]);
    const attached = asParagraph(item.blocks[0].block);
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
    expect(item.blocks).toHaveLength(2);
    expect(asParagraph(item.blocks[0].block).children[0]).toMatchObject({
      type: "text",
      value: "First attached.",
    });
    expect(asParagraph(item.blocks[1].block).children[0]).toMatchObject({
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
    expect(item.blocks).toHaveLength(1);
    expect(asParagraph(item.blocks[0].block).children[0]).toMatchObject({
      type: "text",
      value: "Attached line one\nattached line two.",
    });
  });

  test("continuation attaches to the nested item it follows", () => {
    const { children } = parse("* parent\n** nested.\n+\nAttached.\n");
    const {
      children: [parentItem],
    } = firstList(children);
    // The parent holds the nested list and nothing else.
    expect(parentItem.blocks).toHaveLength(1);
    const {
      blocks: [{ block: nestedList }],
    } = parentItem;
    narrow(nestedList, "list");
    const {
      children: [nestedItem],
    } = nestedList;
    expect(nestedItem.blocks).toHaveLength(1);
  });

  test("items without continuation have empty blocks", () => {
    const { children } = parse("* plain item\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(0);
  });

  // A `+` word inside the item's text (not alone on a line) is
  // ordinary content, not a continuation marker.
  test("+ mid-line is not a continuation", () => {
    const { children } = parse("* item + more text\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(0);
    expect(item.text[0]).toMatchObject({
      type: "text",
      value: "item + more text",
    });
  });

  // A trailing `+` with nothing after it cannot attach anything, and
  // Ruby pops it — at 2.0.26 by IDENTITY and BEFORE the trailing-blank
  // strip: `if ListContinuationMarker === (last_line = buffer[-1])` /
  // `buffer.pop` / `break` is the FIRST arm of the until-loop
  // (parser.rb l.1578-89), ahead of the `elsif last_line.empty?` that
  // strips blanks. 2.0.20 compared text and ran the pop in the else
  // arm, after the strip. The difference matters for an ERASED `+`,
  // which is an empty tagged String: 2.0.26 pops it and breaks where
  // 2.0.20 stripped it as an ordinary blank. Nothing about the pop
  // reaches the item's BLOCKS: it attached nothing, so the item holds
  // what it would hold without the line. But the byte the author
  // wrote is recorded on the node and printed back
  // (`trailingContinuation`, list-item-node.ts).
  test("a trailing + attaches nothing and is recorded, not folded", () => {
    const { children } = parse("* item text\n+\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(0);
    expect(item.text[0]).toMatchObject({
      type: "text",
      value: "item text",
    });
    expect(item.trailingContinuation).toBe("single");
    const {
      children: [without],
    } = firstList(parse("* item text\n").children);
    expect(without.trailingContinuation).toBe(false);
    expect({ ...item, trailingContinuation: false }).toEqual(without);
  });
});

// Issue #6: a `+` directly before a delimited block attaches the
// block to the item, and a `+` directly after the block's close
// delimiter attaches the following paragraph. The list layer does not
// read a delimited block's extent itself — the confined reader over
// the item's buffer opens the block like any other — so the
// attachment is decided from the `+` marks the item recorded.
describe("continuations around delimited blocks (issue #6)", () => {
  test("+ attaches a following delimited block to the item", () => {
    const { children } = parse("* item text:\n+\n....\nliteral\n....\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(1);
    expect(item.blocks[0].block).toMatchObject({
      type: "delimitedBlock",
      variant: "literal",
      form: "delimited",
      content: "literal",
    });
  });

  // A plain paragraph directly after an attached block is INSIDE the
  // item: `read_lines_for_list_item` keeps reading adjacent lines as
  // item content (no blank line has ended it), so no `+` is needed.
  // This closes the #17 gap the old absorber recorded here. ORACLE:
  // one `<li>` holding the literal block and the paragraph.
  test("a paragraph adjacent to an attached block stays in the item", async () => {
    const input = "* item:\n+\n....\nliteral\n....\nplain para\n";
    expect(await renderedHtml(input)).toMatch(
      /<li>.*<pre>literal<\/pre>.*<p>plain para<\/p>.*<\/li>/v,
    );
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(2);
    expect(item.blocks[1].block).toMatchObject({ type: "paragraph" });
  });

  // A `+` attaches the NEXT LOGICAL BLOCK: any metadata lines
  // (attribute list, block title, block anchor) group with
  // the block they annotate and attach together under the one
  // marker. The annotated block may be any block type except those that
  // terminate the list context (sections, lists, document
  // title) or are context-transparent (comments, attribute
  // entries).
  test("+ attaches [NOTE] metadata together with its block", () => {
    const { children } = parse("* i:\n+\n[NOTE]\n====\nx\n====\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(2);
    expect(item.blocks[0].block).toMatchObject({
      type: "blockAttributeList",
      value: "NOTE",
    });
    expect(item.blocks[1].block).toMatchObject({
      type: "admonition",
      variant: "note",
    });
  });

  test("+ attaches [source] metadata with its listing block", () => {
    const { children } = parse("* i:\n+\n[source,ruby]\n----\nc\n----\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(2);
    expect(item.blocks[0].block).toMatchObject({
      type: "blockAttributeList",
    });
    expect(item.blocks[1].block).toMatchObject({
      type: "delimitedBlock",
      variant: "listing",
    });
  });

  test("+ attaches a block title with its block", () => {
    const { children } = parse("* i:\n+\n.Title\n----\nc\n----\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(2);
    expect(item.blocks[0].block).toMatchObject({ type: "blockTitle" });
  });

  test("+ attaches a block anchor with its block", () => {
    const { children } = parse("* i:\n+\n[[id]]\n----\nc\n----\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(2);
    expect(item.blocks[0].block).toMatchObject({ type: "blockAnchor" });
    expect(item.blocks[1].block).toMatchObject({
      type: "delimitedBlock",
    });
  });

  // ONE attached block, not two: the style line and the paragraph
  // under it are one admonition, and the style line has no node of its
  // own to attach (buildParagraphNode, src/parse/build/paragraph.ts).
  test("+ attaches metadata with a plain paragraph anchor", () => {
    const { children } = parse("* i:\n+\n[NOTE]\nnote para\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(1);
    expect(item.blocks[0].block).toMatchObject({
      type: "admonition",
      variant: "note",
      form: "paragraph",
    });
  });

  test("+ attaches a block macro", () => {
    const { children } = parse("* i:\n+\nimage::foo.png[]\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(1);
    expect(item.blocks[0].block).toMatchObject({ type: "blockMacro" });
  });

  // Block metadata after a `+` "plays out until we find the block"
  // without consuming the continuation, and a blank line after it is
  // buffered as content (the blank budget is one), so the block two
  // lines down still attaches — together with its metadata. ORACLE:
  // the admonition is inside the item.
  test("metadata separated from its block by one blank line still attaches", async () => {
    const input = "* i:\n+\n[NOTE]\n\n====\nx\n====\n";
    expect(await renderedHtml(input)).toMatch(/<li>.*admonitionblock.*<\/li>/v);
    const { children } = parse(input);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(2);
    expect(item.blocks[0].block).toMatchObject({
      type: "blockAttributeList",
      value: "NOTE",
    });
    expect(item.blocks[1].block).toMatchObject({ type: "admonition" });
  });

  test("continuation block attaches to the deepest nested item", () => {
    const { children } = parse("* parent\n** nested\n+\n....\nlit\n....\n");
    const {
      children: [parentItem],
    } = firstList(children);
    // The parent holds the nested list and nothing else.
    expect(parentItem.blocks).toHaveLength(1);
    const {
      blocks: [{ block: nestedList }],
    } = parentItem;
    narrow(nestedList, "list");
    const {
      children: [nestedItem],
    } = nestedList;
    expect(nestedItem.blocks).toHaveLength(1);
    expect(nestedItem.blocks[0].block).toMatchObject({
      type: "delimitedBlock",
      content: "lit",
    });
  });
});

// A comment and a sibling list are anchors a `+` attaches like any
// other: each is the item's own block, behind the `+` its gap
// replays, exactly as Asciidoctor reads the source, and the printed
// document is the source byte for byte. A comment is the case a
// rendered-HTML comparison cannot carry on its own, because the
// oracle emits nothing for it either way, so the gap and the block
// type are read off the item and the round-trip is asserted beside
// them.
describe("a + attaches a comment or a sibling list like any anchor", () => {
  test.each([
    ["a line comment", "* a\n+\n// c\n\nb\n", "comment"],
    ["a comment block", "* a\n+\n////\nc\n////\n", "comment"],
    ["an ordered sibling list", "* a\n+\n. one\n. two\n", "list"],
    ["a callout list", "* a\n+\n<1> n\n", "list"],
  ])("%s", async (_name, source, type) => {
    const {
      children: [item],
    } = firstList(parse(source).children);
    expect(item.blocks).toHaveLength(1);
    expect(item.blocks[0].gap).toEqual(["+"]);
    expect(item.blocks[0].block.type).toBe(type);
    await expectFormatted(source, source);
  });
});
