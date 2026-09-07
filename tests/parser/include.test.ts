/**
 * Include preprocessor directives (`include::target[attrlist]`).
 * `PreprocessorReader#process_line` (reader.rb:824) matches
 * `IncludeDirectiveRx` and splices the included file into the line
 * stream, so the directive line never reaches `Parser.next_block`.
 * The formatter does not resolve includes, so it keeps the line
 * verbatim as a `preprocessorDirective` — the same node the
 * conditionals use, because both are lines the reader would have
 * eaten.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { asParagraph, narrow } from "../helpers.js";

describe("include directive lines at block level", () => {
  test.each([
    "include::path/to/file.adoc[]",
    "include::file.txt[lines=5..10]",
    "include::file.txt[tag=section-name]",
    "include::file.adoc[leveloffset=+1]",
    "include::chapters/intro/getting-started.adoc[]",
    "include::file.adoc[lines=1..5,indent=0]",
    "include::https://example.com/file.adoc[]",
  ])("%s is a verbatim preprocessorDirective", (line) => {
    const { children } = parse(`${line}\n`);
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "preprocessorDirective");
    expect(node.value).toBe(line);
    expect(node.position.start).toEqual({ offset: 0, line: 1, column: 1 });
  });

  test("include between paragraphs", () => {
    const { children } = parse(
      "Before.\n\ninclude::chapter.adoc[]\n\nAfter.\n",
    );
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    narrow(children[1], "preprocessorDirective");
    expect(children[1].value).toBe("include::chapter.adoc[]");
    expect(children[2].type).toBe("paragraph");
  });

  // `IncludeDirectiveRx` anchors at end of line, so trailing text
  // leaves an ordinary paragraph.
  test("trailing text prevents include match", () => {
    const { children } = parse("include::file.adoc[] extra\n");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("paragraph");
  });

  // Rstripped before classification, and the node carries the
  // rstripped line — see the conditional test for the reasoning.
  test.each([
    ["include::a.adoc[]  ", "include::a.adoc[]"],
    ["include::a.adoc[]\t", "include::a.adoc[]"],
  ])("%j is a directive whose value is the rstripped %j", (line, value) => {
    const { children } = parse(`${line}\n`);
    expect(children).toHaveLength(1);
    const [node] = children;
    narrow(node, "preprocessorDirective");
    expect(node.value).toBe(value);
  });

  test("an include line after a paragraph line is a rawLine INSIDE it", () => {
    const { children } = parse("text\ninclude::file.adoc[]\n");
    expect(children).toHaveLength(1);
    expect(
      asParagraph(children[0]).children.some((c) => c.type === "rawLine"),
    ).toBe(true);
  });
});

// Issue #232: a block macro is read at a block boundary and nowhere
// else, and `read_paragraph_lines` does not break on one, so under an
// include's substituted content the line is paragraph text. The node
// says so: a paragraph beside the directive, with no blockMacro
// anywhere in the document.
describe("a block macro under an include", () => {
  test("is paragraph text, not a blockMacro node", () => {
    const { children } = parse("include::p[]\nimage::a.png[ alt ]\n");
    expect(children).toHaveLength(2);
    narrow(children[0], "preprocessorDirective");
    const paragraph = asParagraph(children[1]);
    expect(paragraph.children.map((child) => child.type)).toEqual(["text"]);
  });

  // A blank line puts it back at a boundary, where it is a block.
  test("is a blockMacro again past a blank line", () => {
    const { children } = parse("include::p[]\n\nimage::a.png[ alt ]\n");
    expect(children).toHaveLength(2);
    narrow(children[1], "blockMacro");
    expect(children[1].attrlist).toBe(" alt ");
  });
});

// Issue #261: a list marker and a description-list term are read at a
// block boundary and nowhere else. `read_paragraph_lines` takes
// `StartOfBlockProc` at document level (parser.rb l.36), which holds
// no marker, so under an include's substituted content the marker
// line is the paragraph's own text and only a marker past the blank
// line opens a list. Before this reading the whole document was one
// two-item list, and the printer's list normalization then dropped
// the blank line between the items.
describe("a list marker under an include", () => {
  test.each([
    ["an unordered marker", "include::p[]\n* a\n\n* b\n", "list"],
    ["an ordered marker", "include::p[]\n. a\n\n. b\n", "list"],
    ["a callout marker", "include::p[]\n<1> a\n\n<2> b\n", "list"],
    ["a description term", "include::p[]\nt:: d\n\nu:: e\n", "descriptionList"],
  ])(
    "%s is paragraph text and the line past the blank is the list",
    (_name, source, listType) => {
      const { children } = parse(source);
      expect(children).toHaveLength(3);
      narrow(children[0], "preprocessorDirective");
      expect(asParagraph(children[1]).children.map((c) => c.type)).toEqual([
        "text",
      ]);
      expect(children[2].type).toBe(listType);
    },
  );

  // A blank line puts the marker back at a boundary, where it opens
  // a list of two the way it does with no include in the document.
  test("is a list again past a blank line", () => {
    const { children } = parse("include::p[]\n\n* a\n\n* b\n");
    expect(children).toHaveLength(2);
    narrow(children[1], "list");
    expect(children[1].children).toHaveLength(2);
  });
});
