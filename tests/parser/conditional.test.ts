/**
 * Conditional preprocessor directives (`ifdef`, `ifndef`, `ifeval`,
 * `endif`). Asciidoctor's `PreprocessorReader#process_line`
 * (reader.rb:824) matches `ConditionalDirectiveRx` and `shift`s the
 * line off the stream BEFORE `Parser.next_block` ever sees it, so a
 * directive is never a block of its own. The formatter cannot resolve
 * the condition (it has no attribute values), so it keeps the line
 * verbatim, in place, as a `preprocessorDirective` — the AST node
 * that says "a line the reader would have eaten".
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { asParagraph } from "../helpers.js";
import { narrow } from "../../src/narrow.js";

describe("conditional directive lines at block level", () => {
  test.each([
    "ifdef::backend[]",
    "ifdef::backend[Content here]",
    "ifndef::attr[]",
    "ifeval::[{version} > 1]",
    "endif::[]",
    "endif::backend[]",
    "ifdef::attr1,attr2[]",
    "ifdef::attr1+attr2[]",
  ])("%s is a verbatim preprocessorDirective", (line) => {
    const { children } = parse(`${line}\n`);
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "preprocessorDirective");
    expect(node.value).toBe(line);
    expect(node.position.start).toEqual({ offset: 0, line: 1, column: 1 });
  });

  // Between paragraphs the directive is its own child, still verbatim.
  test("between paragraphs", () => {
    const { children } = parse("Before.\n\nifdef::backend[]\n\nAfter.\n");
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    narrow(children[1], "preprocessorDirective");
    expect(children[1].value).toBe("ifdef::backend[]");
    expect(children[2].type).toBe("paragraph");
  });

  // `ConditionalDirectiveRx` anchors at end of line, so anything after
  // the closing bracket makes the line ordinary paragraph text.
  test("trailing text prevents match", () => {
    const { children } = parse("ifdef::backend[] extra\n");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("paragraph");
  });

  // Every line is rstripped before any rule runs
  // (`Helpers.prepare_source_string`), so trailing whitespace cannot
  // stop a directive from being one — and the node carries the
  // rstripped line, because that is the line Asciidoctor read.
  test.each([
    ["ifdef::backend[]  ", "ifdef::backend[]"],
    ["endif::[] ", "endif::[]"],
    ["ifeval::[{v} > 1]\t", "ifeval::[{v} > 1]"],
  ])("%j is a directive whose value is the rstripped %j", (line, value) => {
    const { children } = parse(`${line}\n`);
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "preprocessorDirective");
    expect(node.value).toBe(value);
  });

  // Inside an open paragraph the same line is a RawLineNode: the
  // reader eats it without ending the paragraph, so the text before
  // and after it stay one block.
  test("a directive line after a paragraph line is a rawLine INSIDE it", () => {
    const { children } = parse("text\nendif::[]\n");
    expect(children).toHaveLength(1);
    expect(
      asParagraph(children[0]).children.some((c) => c.type === "rawLine"),
    ).toBe(true);
  });
});
