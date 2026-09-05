/**
 * Parser tests for paragraph-form blocks.
 *
 * When a block attribute list like `[source]`, `[listing]`,
 * `[verse]`, `[quote]`, etc. precedes a paragraph, the
 * paragraph becomes a paragraph-form block instead of a plain
 * paragraph. These produce `DelimitedBlockNode` with
 * `form: "paragraph"`.
 *
 * The attribute list remains as a separate `BlockAttributeListNode`
 * (just like it does for delimited blocks). The stacking behavior
 * in the printer handles the no-blank-line between them.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import type { DelimitedBlockNode } from "../../src/ast.js";
import { narrow } from "../helpers.js";

/**
 * Extracts the child at the given index as a
 * DelimitedBlockNode. Throws if the node type does not
 * match, catching test setup errors early.
 * @param children - parsed document children array
 * @param index - position of the expected delimited block
 * @returns the child narrowed to DelimitedBlockNode
 */
function delimitedBlockAt(
  children: ReturnType<typeof parse>["children"],
  index: number,
): DelimitedBlockNode {
  const { [index]: block } = children;
  narrow(block, "delimitedBlock");
  return block;
}

describe("paragraph-form source/listing blocks", () => {
  // [source] + paragraph → attr list + listing block.
  test("[source] + paragraph produces listing block", () => {
    const { children } = parse("[source]\nputs 'hello'\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("puts 'hello'");
  });

  // [source,ruby] with language parameter.
  test("[source,ruby] + paragraph produces listing block", () => {
    const { children } = parse("[source,ruby]\nputs 'hello'\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("puts 'hello'");
  });

  // [listing] + paragraph → listing block, paragraph form.
  // Paragraph-form blocks consume only the immediately following
  // paragraph. Indented lines are tokenized as a separate literal
  // paragraph node (not absorbed into the preceding paragraph), so
  // paragraph-form block content must be non-indented. Indented
  // code should use a fenced block with ---- delimiters instead.
  test("[listing] + paragraph produces listing block", () => {
    const { children } = parse("[listing]\ndef foo\nbar\nend\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("def foo\nbar\nend");
  });

  // Multi-line content in a source block.
  test("[source] with multi-line content", () => {
    const { children } = parse("[source]\nline 1\nline 2\nline 3\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.content).toBe("line 1\nline 2\nline 3");
  });
});

describe("paragraph-form literal blocks", () => {
  // [literal] + paragraph → literal block, paragraph form.
  test("[literal] + paragraph produces literal block", () => {
    const { children } = parse("[literal]\nsome literal text\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("literal");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("some literal text");
  });
});

describe("paragraph-form pass blocks", () => {
  // [pass] + paragraph → pass block, paragraph form.
  test("[pass] + paragraph produces pass block", () => {
    const { children } = parse("[pass]\n<div>raw html</div>\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("<div>raw html</div>");
  });
});

describe("paragraph-form verse blocks", () => {
  // [verse] + paragraph → verse block, paragraph form.
  // Verse preserves line breaks.
  test("[verse] + paragraph produces verse block", () => {
    const { children } = parse("[verse]\nRoses are red,\nViolets are blue.\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("Roses are red,\nViolets are blue.");
  });

  // [verse] with attribution positional attributes — the extra
  // parameters are carried in the attribute list node; the block
  // variant and content are unaffected.
  test("[verse, Author, Source] produces verse block", () => {
    const { children } = parse(
      "[verse, Robert Frost, Fire and Ice]\nSome say the world will end in fire,\nSome say in ice.\n",
    );
    expect(children).toHaveLength(2);
    // The blockAttributeList at children[0] should preserve
    // the full attribute string including positional params.
    expect(children[0].type).toBe("blockAttributeList");
    if (children[0].type !== "blockAttributeList") {
      return;
    }
    expect(children[0].value).toBe("verse, Robert Frost, Fire and Ice");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe(
      "Some say the world will end in fire,\nSome say in ice.",
    );
  });
});

describe("paragraph-form quote blocks", () => {
  // [quote] + paragraph → quote block, paragraph form.
  test("[quote] + paragraph produces quote block", () => {
    const { children } = parse("[quote]\nTo be or not to be.\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("quote");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("To be or not to be.");
  });

  // [quote] with attribution positional attributes — the extra
  // parameters are carried in the attribute list node; the block
  // variant and content are unaffected.
  test("[quote, Author, Source] produces quote block", () => {
    const { children } = parse(
      "[quote, Shakespeare, Hamlet]\nTo be or not to be.\n",
    );
    expect(children).toHaveLength(2);
    // The blockAttributeList at children[0] should preserve
    // the full attribute string including positional params.
    expect(children[0].type).toBe("blockAttributeList");
    if (children[0].type !== "blockAttributeList") {
      return;
    }
    expect(children[0].value).toBe("quote, Shakespeare, Hamlet");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("quote");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("To be or not to be.");
  });
});

describe("paragraph-form example blocks", () => {
  // [example] + paragraph → example block, paragraph form.
  test("[example] + paragraph produces example block", () => {
    const { children } = parse("[example]\nThis is an example.\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("example");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("This is an example.");
  });
});

describe("paragraph-form sidebar blocks", () => {
  // [sidebar] + paragraph → sidebar block, paragraph form.
  test("[sidebar] + paragraph produces sidebar block", () => {
    const { children } = parse("[sidebar]\nThis is sidebar content.\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("sidebar");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("This is sidebar content.");
  });
});

describe("paragraph-form block boundaries", () => {
  // A paragraph-form block followed by a blank line and
  // normal paragraph — correct boundary detection.
  test("paragraph-form block followed by normal paragraph", () => {
    const { children } = parse("[source]\nsome code\n\nNormal paragraph.\n");
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("paragraph");
    expect(block.content).toBe("some code");
    expect(children[2].type).toBe("paragraph");
  });

  // Regular attribute lists that are NOT paragraph-form styles
  // should still be standalone nodes followed by a paragraph.
  test("non-style attribute list remains standalone", () => {
    const { children } = parse("[#myid]\nSome text.\n");
    expect(children).toHaveLength(2);
    // Standalone either way; the id-only spelling builds the anchor
    // node it names (buildAttributeLine, src/parse/build/metadata.ts).
    expect(children[0].type).toBe("blockAnchor");
    expect(children[1].type).toBe("paragraph");
  });

  // Paragraph-form block with block metadata before it.
  test("block title + [source] + paragraph", () => {
    const { children } = parse(".My Code\n[source]\nsome code\n");
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("blockTitle");
    expect(children[1].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 2);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("paragraph");
  });

  // Case sensitivity: the PARAGRAPH_FORM_STYLES lookup uses exact
  // lowercase keys, so style matching is case-sensitive. [SOURCE]
  // misses the table and the paragraph is left as-is.
  test("uppercase [SOURCE] is NOT a paragraph-form block", () => {
    const { children } = parse("[SOURCE]\nsome code\n");
    // Should parse as attribute list + paragraph.
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    expect(children[1].type).toBe("paragraph");
  });
});
