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
import { delimitedBlockAt } from "../helpers.js";

describe("paragraph-form source/listing blocks", () => {
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
