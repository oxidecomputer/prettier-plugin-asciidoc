/**
 * Format tests for `+` continuations that surround a delimited
 * block (issue #6).
 *
 * A `+` line on either side of a delimited block must stay
 * immediately next to what it attaches: no blank line inserted
 * between the `+` and the block, and no `+` folded into paragraph
 * text. The rest of the continuation axis is in
 * tests/format/list-continuation.test.ts; these rows are here
 * because the two subjects together outgrow one file.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  asParagraph,
  expectFormatted,
  expectStableRender,
  firstList,
  formatAdoc,
  renderedHtml,
} from "../helpers.js";

// Issue #6: `+` continuations around delimited blocks. The `+`
// lines must stay immediately adjacent to what they attach — no
// inserted blank lines, and never merged into paragraph text.
describe("continuations around delimited blocks (issue #6)", () => {
  test("issue #6 repro round-trips and is idempotent", async () => {
    const input =
      "* item one with some text:\n" +
      "+\n" +
      "....\n" +
      "literal block content\n" +
      "....\n" +
      "+\n" +
      "continuation paragraph after the block.\n" +
      "\n" +
      "* item two.\n";
    const first = await formatAdoc(input);
    // Item two is the second item of the same list, so the blank line
    // before it goes (see "continuation paragraphs survive round-trip").
    expect(first).toBe(input.replace("\n\n* item two", "\n* item two"));
    await expectStableRender(input);
    const { children } = parse(input);
    // The literal block and trailing paragraph are absorbed into
    // item one; item two is the second item of the SAME list (a
    // blank line between items does not split a list).
    expect(children).toHaveLength(1);
    const { children: items } = firstList(children);
    expect(items).toHaveLength(2);
    const [item] = items;
    expect(item.blocks).toHaveLength(2);
    expect(item.blocks[0].block).toMatchObject({
      type: "delimitedBlock",
      variant: "literal",
      content: "literal block content",
    });
    const attached = asParagraph(item.blocks[1].block);
    expect(attached.children[0]).toMatchObject({
      type: "text",
      value: "continuation paragraph after the block.",
    });
  });

  test("+ before a listing block stays attached", async () => {
    const input = "* item:\n+\n----\ncode here\n----\n";
    await expectFormatted(input, input);
  });

  test("+ before a parent block stays attached", async () => {
    const input = "* item:\n+\n====\nexample text\n====\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(1);
    expect(item.blocks[0].block).toMatchObject({
      type: "parentBlock",
      variant: "example",
    });
  });

  test("marker lines after the block are never merged into text", async () => {
    const input = "* item:\n+\n----\ncode\n----\n+\npara one\n+\npara two\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(3);
    expect(asParagraph(item.blocks[1].block).children[0]).toMatchObject({
      type: "text",
      value: "para one",
    });
    expect(asParagraph(item.blocks[2].block).children[0]).toMatchObject({
      type: "text",
      value: "para two",
    });
  });

  test("chain of block, paragraph, block round-trips", async () => {
    const input = "* item:\n+\n----\none\n----\n+\npara\n+\n----\ntwo\n----\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(3);
    expect(item.blocks[0].block).toMatchObject({
      type: "delimitedBlock",
      content: "one",
    });
    expect(item.blocks[2].block).toMatchObject({
      type: "delimitedBlock",
      content: "two",
    });
  });

  // Metadata lines group with the block they annotate and
  // attach together under one `+` — no blank line inserted, no
  // second marker.
  test("+ before [NOTE] admonition block round-trips", async () => {
    const input =
      "** {empty}\n+\n[NOTE]\n====\nAre these examples sufficient?\n====\n";
    await expectFormatted(input, input);
  });

  test("+ before [source] listing round-trips", async () => {
    const input = "* item:\n+\n[source,ruby]\n----\ncode\n----\n";
    await expectFormatted(input, input);
  });

  test("+ before titled block round-trips", async () => {
    const input = "* item:\n+\n.Title\n----\ncode\n----\n";
    await expectFormatted(input, input);
  });

  test("+ before anchored block round-trips", async () => {
    const input = "* item:\n+\n[[id]]\n----\ncode\n----\n";
    await expectFormatted(input, input);
  });

  // The style line and the paragraph under it are one admonition, and
  // the printer writes the label form for it wherever it stands - an
  // attached block included.
  test("+ before [NOTE] paragraph round-trips", async () => {
    const input = "* item:\n+\n[NOTE]\nnote paragraph\n";
    expect(await formatAdoc(input)).toBe("* item:\n+\nNOTE: note paragraph\n");
  });

  test("+ before a block macro round-trips", async () => {
    const input = "* item:\n+\nimage::diagram.png[]\n";
    await expectFormatted(input, input);
  });

  test("+ before a thematic break round-trips", async () => {
    const input = "* item:\n+\n'''\n";
    await expectFormatted(input, input);
  });

  test("metadata block chain continues with + paragraphs", async () => {
    const input = "* i:\n+\n[source]\n----\na\n----\n+\nafter para\n";
    await expectFormatted(input, input);
  });

  // An attached [NOTE] paragraph can itself carry `+` marker
  // lines; they split into further attached blocks instead of
  // reflowing into the paragraph text (where a trailing `+`
  // would even turn into a hard line break).
  test("markers inside a metadata-anchored paragraph split off", async () => {
    const input = "* i\n+\n[NOTE]\npara one\n+\npara two\n";
    await expectFormatted(input, "* i\n+\nNOTE: para one\n+\npara two\n");
  });

  test("trailing marker after [NOTE] paragraph re-arms attachment", async () => {
    const input = "* i\n+\n[NOTE]\npara\n+\n----\nc\n----\n";
    expect(await formatAdoc(input)).toBe(
      "* i\n+\nNOTE: para\n+\n----\nc\n----\n",
    );
  });

  // A heading line after a `+` is attached paragraph TEXT (the
  // `continuation == :active` branch buffers it, and the confined
  // list reader never makes sections), so it stays adjacent to its
  // `+`. ORACLE: `<p>== Heading</p>` inside the item.
  test("+ before a section heading attaches it as text", async () => {
    const input = "* i:\n+\n== Heading\n";
    expect(await renderedHtml(input)).toContain("<p>== Heading</p>");
    await expectFormatted(input, input);
    // A heading line after a `+` is attached PARAGRAPH TEXT: the
    // `continuation == :active` branch of `read_lines_for_list_item`
    // buffers it, and the confined list-item reader never calls
    // `next_section`. ORACLE: `<p>== Heading</p>` inside the item, no
    // `<h2>`.
    const html = await renderedHtml(input);
    expect(html).toContain("<p>== Heading</p>");
    expect(html).not.toContain("<h2");
    const { children } = parse(input);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(1);
    expect(asParagraph(item.blocks[0].block).children[0]).toMatchObject({
      type: "text",
      value: "== Heading",
    });
  });

  // One blank line between the `+` and the block: the block still
  // attaches (Asciidoctor buffers the first blank after a `+` as
  // content), and the printer replays the gap VERBATIM —
  // the byte round-trip is idempotent by construction. Rendering is
  // unchanged.
  test("a + reaches across one blank line and attaches the block", async () => {
    const input = "* item\n+\n\n....\nliteral\n....\n";
    await expectFormatted(input, input);
    // ONE blank line between the `+` and the next block still attaches
    // it: `read_lines_for_list_item` buffers the first blank after a
    // `+` as content, so the block that follows reaches the
    // `continuation == :active` branch. ORACLE: the literal block is
    // inside the item. (Two blanks would end the list instead.)
    expect(await renderedHtml(input)).toMatch(
      /<li>.*<pre>literal<\/pre>.*<\/li>/v,
    );
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const {
      children: [item],
    } = firstList(children);
    expect(item.blocks).toHaveLength(1);
    // The one buffered blank rides in the gap, verbatim.
    expect(item.blocks[0].gap).toEqual(["+", ""]);
    expect(item.blocks[0].block).toMatchObject({
      type: "delimitedBlock",
      variant: "literal",
    });
  });
});
