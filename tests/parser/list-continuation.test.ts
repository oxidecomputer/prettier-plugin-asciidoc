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

// Issue #6: a `+` directly before a delimited block attaches the
// block to the item, and a `+` directly after the block's close
// delimiter attaches the following paragraph. The grammar cannot
// consume delimiter lines inside a list item, so the attachment
// happens in a post-parse pass over sibling blocks.
describe("continuations around delimited blocks (issue #6)", () => {
  test("+ attaches a following delimited block to the item", () => {
    const { children } = parse("* item text:\n+\n....\nliteral\n....\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.danglingContinuation).toBe(false);
    expect(item.attachedBlocks).toHaveLength(1);
    expect(item.attachedBlocks[0]).toMatchObject({
      type: "delimitedBlock",
      variant: "literal",
      form: "delimited",
      content: "literal",
    });
  });

  test("issue #6 repro: block plus trailing paragraph both attach", () => {
    const { children } = parse(
      "* item one with some text:\n" +
        "+\n" +
        "....\n" +
        "literal block content\n" +
        "....\n" +
        "+\n" +
        "continuation paragraph after the block.\n" +
        "\n" +
        "* item two.\n",
    );
    // The literal block and trailing paragraph are absorbed into
    // item one; item two remains a separate sibling list.
    expect(children).toHaveLength(2);
    const {
      children: [item],
    } = firstList(children);
    expect(item.danglingContinuation).toBe(false);
    expect(item.attachedBlocks).toHaveLength(2);
    expect(item.attachedBlocks[0]).toMatchObject({
      type: "delimitedBlock",
      variant: "literal",
      content: "literal block content",
    });
    const attached = asParagraph(item.attachedBlocks[1]);
    expect(attached.children[0]).toMatchObject({
      type: "text",
      value: "continuation paragraph after the block.",
    });
  });

  test("+ attaches a parent block to the item", () => {
    const { children } = parse("* item:\n+\n====\nexample text\n====\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(1);
    expect(item.attachedBlocks[0]).toMatchObject({
      type: "parentBlock",
      variant: "example",
    });
  });

  test("marker lines split the trailing paragraph into blocks", () => {
    const { children } = parse(
      "* item:\n+\n----\ncode\n----\n+\npara one\n+\npara two\n",
    );
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(3);
    expect(asParagraph(item.attachedBlocks[1]).children[0]).toMatchObject({
      type: "text",
      value: "para one",
    });
    expect(asParagraph(item.attachedBlocks[2]).children[0]).toMatchObject({
      type: "text",
      value: "para two",
    });
  });

  test("trailing + after an attached block re-arms attachment", () => {
    const { children } = parse(
      "* item:\n+\n----\none\n----\n+\npara\n+\n----\ntwo\n----\n",
    );
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(3);
    expect(item.attachedBlocks[0]).toMatchObject({
      type: "delimitedBlock",
      content: "one",
    });
    expect(item.attachedBlocks[2]).toMatchObject({
      type: "delimitedBlock",
      content: "two",
    });
  });

  // A blank line between the dangling `+` and the next block
  // breaks direct adjacency: the `+` stays dangling (re-emitted
  // verbatim) and the block stays a sibling — the existing
  // conservative behavior.
  test("blank line after dangling + leaves the block unattached", () => {
    const { children } = parse("* item\n+\n\n....\nliteral\n....\n");
    expect(children).toHaveLength(2);
    const {
      children: [item],
    } = firstList(children);
    expect(item.danglingContinuation).toBe(true);
    expect(item.attachedBlocks).toHaveLength(0);
  });

  // A paragraph after an attached block only chains when it
  // begins with its own `+` marker line; otherwise it stays a
  // sibling. KNOWN FIDELITY GAP (pre-existing, not introduced
  // by the absorber): Asciidoctor keeps a directly adjacent
  // plain paragraph INSIDE the list item, so the blank line
  // the formatter prints detaches it and changes rendering.
  // Tracked in issue #17.
  test("paragraph without leading + does not chain", () => {
    const { children } = parse("* item:\n+\n....\nliteral\n....\nplain para\n");
    expect(children).toHaveLength(2);
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(1);
    expect(children[1]).toMatchObject({ type: "paragraph" });
  });

  // A `+` attaches the NEXT LOGICAL BLOCK: any metadata lines
  // (attribute list, block title, anchor paragraph) group with
  // the block they annotate and attach together under the one
  // marker. The anchor may be any block type except those that
  // terminate the list context (sections, lists, document
  // title) or are context-transparent (comments, attribute
  // entries).
  test("+ attaches [NOTE] metadata together with its block", () => {
    const { children } = parse("* i:\n+\n[NOTE]\n====\nx\n====\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.danglingContinuation).toBe(false);
    expect(item.attachedBlocks).toHaveLength(2);
    expect(item.attachedBlocks[0]).toMatchObject({
      type: "blockAttributeList",
      value: "NOTE",
    });
    expect(item.attachedBlocks[1]).toMatchObject({
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
    expect(item.attachedBlocks).toHaveLength(2);
    expect(item.attachedBlocks[0]).toMatchObject({
      type: "blockAttributeList",
    });
    expect(item.attachedBlocks[1]).toMatchObject({
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
    expect(item.attachedBlocks).toHaveLength(2);
    expect(item.attachedBlocks[0]).toMatchObject({ type: "blockTitle" });
  });

  test("+ attaches an anchor paragraph with its block", () => {
    const { children } = parse("* i:\n+\n[[id]]\n----\nc\n----\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(2);
    expect(item.attachedBlocks[0]).toMatchObject({ type: "paragraph" });
    expect(item.attachedBlocks[1]).toMatchObject({ type: "delimitedBlock" });
  });

  test("+ attaches metadata with a plain paragraph anchor", () => {
    const { children } = parse("* i:\n+\n[NOTE]\nnote para\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(2);
    expect(item.attachedBlocks[1]).toMatchObject({ type: "paragraph" });
  });

  test("+ attaches a block macro", () => {
    const { children } = parse("* i:\n+\nimage::foo.png[]\n");
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(1);
    expect(item.attachedBlocks[0]).toMatchObject({ type: "blockMacro" });
  });

  // A section heading can never be list-item content — it
  // terminates the list in Asciidoctor too. The `+` stays a
  // dangling marker, preserved verbatim.
  test("+ before a section heading does not attach", () => {
    const { children } = parse("* i:\n+\n== Heading\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(0);
    expect(item.danglingContinuation).toBe(true);
  });

  // Metadata only commits together with its anchor block; a
  // blank line between them abandons the whole group (the
  // metadata stays a sibling and the `+` stays dangling).
  test("metadata without an adjacent anchor is not attached", () => {
    const { children } = parse("* i:\n+\n[NOTE]\n\n====\nx\n====\n");
    const {
      children: [item],
    } = firstList(children);
    expect(item.attachedBlocks).toHaveLength(0);
    expect(item.danglingContinuation).toBe(true);
  });

  test("continuation block attaches to the deepest nested item", () => {
    const { children } = parse("* parent\n** nested\n+\n....\nlit\n....\n");
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
    expect(nestedItem.attachedBlocks[0]).toMatchObject({
      type: "delimitedBlock",
      content: "lit",
    });
  });
});
