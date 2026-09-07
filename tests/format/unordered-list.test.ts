import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  expectFormatted,
  expectStableRender,
  firstList,
  formatAdoc,
  narrow,
  renderedHtml,
} from "../helpers.js";

describe("unordered list formatting", () => {
  // Canonical single-item list passes through unchanged.
  test("single item preserved", async () => {
    const input = "* Item one\n";
    await expectFormatted(input, input);
    // The simplest case: a single `* item` line is a one-item list.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("unordered");
    expect(list.children).toHaveLength(1);
    expect(list.children[0].type).toBe("listItem");
    expect(list.marker).toBe("*");
  });

  // Multi-item list preserved.
  test("multi-item list preserved", async () => {
    const input = "* First\n* Second\n* Third\n";
    await expectFormatted(input, input);
    // Multiple `*` lines in succession form a single list, not
    // separate one-item lists.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("unordered");
    expect(list.children).toHaveLength(3);
  });

  // Nested list preserved with correct markers.
  test("nested list preserved", async () => {
    const input = "* Parent\n** Child\n";
    await expectFormatted(input, input);
    // `**` items nested under `*` items produce a child ListNode inside
    // the parent ListItemNode.
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
    expect(nestedList.variant).toBe("unordered");
    expect(nestedList.children).toHaveLength(1);
    expect(nestedList.marker).toBe("**");
  });

  // One blank line before a list when preceded by a paragraph.
  test("blank line between paragraph and list", async () => {
    const input = "Some text.\n\n* Item\n";
    await expectFormatted(input, input);
  });

  // One blank line after a list when followed by a paragraph.
  test("blank line between list and paragraph", async () => {
    const input = "* Item\n\nSome text.\n";
    await expectFormatted(input, input);
  });

  // Multiple blank lines between a paragraph and list are collapsed.
  test("multiple blank lines before list collapsed", async () => {
    const input = "Some text.\n\n\n\n* Item\n";
    const expected = "Some text.\n\n* Item\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Three-level nesting preserved.
  test("three-level nesting preserved", async () => {
    const input = "* Level 1\n** Level 2\n*** Level 3\n";
    await expectFormatted(input, input);
    // Three levels exercises the recursive nesting path: each
    // deeper marker (`**`, `***`) must attach to the correct
    // parent, proving the parser handles arbitrary depth.
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
    // The spelling travels verbatim: the third level's list carries
    // the `***` its items were written with.
    expect(l3List.marker).toBe("***");
  });

  // All 5 nesting levels preserved through formatting.
  test("five-level nesting preserved", async () => {
    const input = "* L1\n** L2\n*** L3\n**** L4\n***** L5\n";
    await expectFormatted(input, input);
    // AsciiDoc supports 5 nesting levels. Verify all depths parse
    // correctly and produce the right tree structure.
    const { children } = parse(input);
    const list = firstList(children);
    let current = list;
    for (let depth = 1; depth <= 5; depth += 1) {
      expect(current.children).toHaveLength(1);
      expect(current.marker).toBe("*".repeat(depth));
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
    const input = "* Parent\n** Child A\n** Child B\n";
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
    const input = "* First\n** Nested\n* Second\n";
    await expectFormatted(input, input);
  });

  // Multi-level collapse: depth 3 back to depth 1 in one step.
  test("return to root after deep nesting", async () => {
    const input = "* First\n** Nested\n*** Deep\n* Second\n";
    await expectFormatted(input, input);
    // Multi-level collapse: going from depth 3 back to depth 1
    // must land both "Nested" and "Deep" inside "First" while "First"
    // and "Second" stay siblings — the extent scan, not a stack,
    // decides where each item lands.
    const { children } = parse(input);
    const list = firstList(children);
    // First and Second are siblings at depth 1.
    expect(list.children).toHaveLength(2);
    expect(list.marker).toBe("*");
    // Nested and Deep are inside First.
    const nested = list.children[0].blocks.find(
      ({ block }) => block.type === "list",
    )?.block;
    narrow(nested, "list");
    expect(nested.children).toHaveLength(1);
    const deep = nested.children[0].blocks.find(
      ({ block }) => block.type === "list",
    )?.block;
    narrow(deep, "list");
    expect(deep.children).toHaveLength(1);
    expect(deep.marker).toBe("***");
  });

  // List item text is reflowed within printWidth.
  test("long list item text is reflowed", async () => {
    const input =
      "* This is a very long list item that should be reflowed because it exceeds the default print width of eighty characters in total\n";
    const result = await formatAdoc(input);
    // Should be reflowed (wrapped) — verify it contains a newline within the item
    const lines = result.split("\n");
    // First line starts with *, continuation lines are indented
    expect(lines[0].startsWith("* ")).toBe(true);
    expect(lines.length).toBeGreaterThan(2); // at least 2 lines + trailing newline
  });

  // The `-` marker is an alternative outermost unordered list marker,
  // and the spelling is DATA: the list carries it and the printer
  // replays it. Normalizing it to `*` used to flatten a `- Foo` /
  // `* Boo` nesting into two siblings; the render proofs live in
  // tests/format/marker-spelling.test.ts.
  test("hyphen marker replays verbatim", async () => {
    const input = "- Item\n";
    await expectFormatted(input, input);
    // AsciiDoc allows `-` as an alternative outermost unordered list
    // marker. It opens an unordered list whose spelling stays `-`.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const list = firstList(children);
    expect(list.variant).toBe("unordered");
    expect(list.children).toHaveLength(1);
    expect(list.marker).toBe("-");
    const textNode = list.children[0].text.find((c) => c.type === "text");
    narrow(textNode, "text");
    expect(textNode.value).toBe("Item");
  });

  // Every item of one `-` list shares the list's marker.
  test("multiple hyphen items keep their marker", async () => {
    const input = "- First\n- Second\n- Third\n";
    await expectFormatted(input, input);
  });

  // An ordered item after an unordered item — even across a blank
  // line — is a list NESTED in that item, never a second list: after a
  // blank line `read_lines_for_list_item` keeps the item open for any
  // NESTABLE_LIST_CONTEXTS marker. The printer replays the blank the
  // author wrote (the gap is verbatim), so the input
  // round-trips byte for byte. ORACLE: the `<ol>` is inside the `<li>`.
  test("unordered list followed by ordered list", async () => {
    const input = "* Unordered\n\n. Ordered\n";
    expect(await renderedHtml(input)).toMatch(/<li>.*<ol.*<\/li>/v);
    await expectFormatted(input, input);
  });

  // A list immediately after a section heading gets a blank-line
  // separator.
  test("list after section heading", async () => {
    const input = "== Section\n\n* Item\n";
    await expectFormatted(input, input);
  });

  // A list immediately after a comment gets a blank-line separator.
  test("list after comment", async () => {
    const input = "// A comment\n\n* Item\n";
    await expectFormatted(input, input);
  });

  // A list after a document title and header attributes.
  test("list after document header", async () => {
    const input = "= Title\n:toc:\n\n* Item\n";
    await expectFormatted(input, input);
  });

  // A list after a standalone attribute entry.
  test("list after attribute entry", async () => {
    const input = ":key: value\n\n* Item\n";
    await expectFormatted(input, input);
  });

  // Short indented continuation lines are reflowed into one
  // line when they fit within print width.
  test("short indented continuation is reflowed", async () => {
    const input = "* First line\n  continuation line\n";
    const expected = "* First line continuation line\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Short flush continuation lines are reflowed into one line.
  test("short flush continuation is reflowed", async () => {
    const input = "* First line\ncontinuation line\n";
    const expected = "* First line continuation line\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Long list item text is reflowed AND gets proper continuation
  // indentation (2 spaces for `* ` marker).
  test("reflowed list item has correct continuation indent", async () => {
    const input =
      "* This is a very long list item that should be reflowed because it exceeds the default print width of eighty characters in total\n";
    const result = await formatAdoc(input);
    const lines = result.split("\n");
    // First line starts with `* `
    expect(lines[0].startsWith("* ")).toBe(true);
    // Continuation lines start with exactly 2 spaces (matching
    // the `* ` marker width)
    for (let index = 1; index < lines.length - 1; index += 1) {
      expect(lines[index]).toMatch(/^ {2}\S/v);
    }
  });

  // Continuation indent width matches marker width for `** `.
  // Use long enough text to force a line break.
  test("continuation indent matches depth-2 marker", async () => {
    const input =
      "* Parent\n** This is a very long nested list item that should be reflowed because it exceeds the default print width of eighty characters\n";
    const result = await formatAdoc(input);
    const lines = result.split("\n");
    // First line starts with `** `
    expect(lines[1].startsWith("** ")).toBe(true);
    // Continuation lines start with exactly 3 spaces (matching
    // the `** ` marker width)
    for (let index = 2; index < lines.length - 1; index += 1) {
      expect(lines[index]).toMatch(/^ {3}\S/v);
    }
  });

  // Ordered list continuation aligns to `. ` (2 chars).
  test("ordered list continuation indent", async () => {
    const input =
      ". This is a very long ordered list item that should be reflowed because it exceeds the default print width of eighty characters total\n";
    const result = await formatAdoc(input);
    const lines = result.split("\n");
    expect(lines[0].startsWith(". ")).toBe(true);
    // Continuation lines start with exactly 2 spaces (matching
    // the `. ` marker width)
    for (let index = 1; index < lines.length - 1; index += 1) {
      expect(lines[index]).toMatch(/^ {2}\S/v);
    }
  });
});

// Issue #1: formatting must be a fixed point regardless of where
// the source happened to break lines inside a list item. The
// continuation lines of an item are indented, and the block layer used
// to classify an indented line by its shape alone, so the SAME content
// parsed differently depending on which line it sat on — and the output
// oscillated between the two layouts on every format pass. The reader
// reads the item's whole text as one run, so indentation inside it is
// just indentation.
describe("list item continuation lines parse like first-line content", () => {
  // The exact repro from issue #1: inline anchor + a link too
  // long to share the marker line.
  const joined =
    "* [[[rfd603, RFD 603]]] https://603.rfd.oxide.computer/[RFD 603 Fault Management\n" +
    "  Situation Reports]\n";
  const split =
    "* [[[rfd603, RFD 603]]]\n" +
    "  https://603.rfd.oxide.computer/[RFD 603 Fault Management\n" +
    "  Situation Reports]\n";

  test("anchor + long link formats idempotently (joined input)", async () => {
    const first = await formatAdoc(joined);
    await expectFormatted(first, first);
  });

  test("anchor + long link formats idempotently (split input)", async () => {
    const first = await formatAdoc(split);
    await expectFormatted(first, first);
  });

  test("joined and split inputs converge to the same output", async () => {
    expect(await formatAdoc(split)).toBe(await formatAdoc(joined));
  });

  // A link sitting on an indented continuation line must become
  // a link node (atomic in reflow), exactly as it would on the
  // marker line.
  test("link on continuation line stays atomic in reflow", async () => {
    const input = "* item text\n  https://example.com[link text] tail\n";
    const result = await formatAdoc(input, { printWidth: 30 });
    expect(result).toContain("https://example.com[link text]");
  });
});

// A trailing ` +` hard break must parse the same whether it sits on
// the marker line or on an indented continuation line.
// {@link tokenizeRun} appends the document's own newline to the run it
// tokenizes, so a HardLineBreak (` +` followed by `\n`) matches at the
// end of a run exactly as it does mid-line.
describe("trailing hard break is layout independent", () => {
  test("hard break on marker line is preserved", async () => {
    const input = "* b +\nmore\n\npara\n";
    expect(await formatAdoc(input)).toBe("* b +\nmore\n\npara\n");
  });

  test("hard break on continuation line is preserved", async () => {
    const input = "* a\n  b +\n  more\n\npara\n";
    await expectFormatted(input, "* a b +\nmore\n\npara\n");
  });
});

// A list item's text is greedy in the same way a paragraph's is: only a
// sibling/nested marker, a `+` continuation, a delimiter or a dlist term
// ends it (src/parse/line-shapes.ts). Everything else — including lines
// that would be block syntax at the start of a block — is item text.
describe("list item continuation (contextual classification)", () => {
  test("indented continuation lines are item text", async () => {
    const input = "* item\n  continued here\n* next\n";
    await expectStableRender(input);
  });
  test("a block-title-shaped line inside an item is item text", async () => {
    const input = "* item\n.not a title\n* next\n";
    await expectStableRender(input);
  });
  test("a sibling marker still starts a new item", async () => {
    const input = "* one\n* two\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* one\n* two\n");
  });
});

// A whole-line `[[anchor]]` inside a list item is block metadata for
// a block that never materializes, so Asciidoctor DISCARDS it. The
// formatter must keep it on its own line: reflowing it into the item
// text would turn it into an inline anchor and emit an `<a id>` the
// oracle does not have.
describe("block anchor inside a list item", () => {
  test("stays verbatim on its own line", async () => {
    const input = "* item\n[[anchor]]\npara\n* next\n";
    const out = await formatAdoc(input);
    await expectFormatted(input, input);
    // The oracle drops it, so it must not appear in the rendering.
    const html = await renderedHtml(out);
    expect(html.includes('id="anchor"')).toBe(false);
  });
});
