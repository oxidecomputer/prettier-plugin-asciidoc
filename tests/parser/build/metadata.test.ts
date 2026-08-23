/**
 * `build/metadata.ts` — one-line blocks to nodes.
 *
 * Table-driven because every function here is `(span, index) → node`
 * with no context: the rows are the specification. They pin the
 * syntactic prefixes that get stripped (`//`, `[`, `.`, `:`), the
 * three attribute-entry forms, and the rstrip a preprocessor
 * directive's value goes through.
 */
import { describe, expect, test } from "vitest";
import {
  buildAttributeEntry,
  buildBlockAnchor,
  buildBlockAttributeList,
  buildBlockMacro,
  buildBlockTitle,
  buildPageBreak,
  buildRawBlockLine,
  buildThematicBreak,
} from "../../../src/parse/build/metadata.js";
import {
  makeLocationIndex,
  type Fragment,
} from "../../../src/parse/positions.js";

/**
 * A whole line at offset 0 of a one-line document, with the index
 * that document implies.
 * @param line - the line, without its newline
 * @returns the span and the index, ready to hand to a builder
 */
function lineOf(line: string): {
  span: Fragment;
  at: ReturnType<typeof makeLocationIndex>;
} {
  return {
    span: { image: line, offset: 0 },
    at: makeLocationIndex(`${line}\n`),
  };
}

describe("buildBlockAnchor", () => {
  // Its own node kind since spec D6 — no wrapper paragraph, no
  // inlineAnchor child to pattern-match.
  test("builds a blockAnchor over the whole line", () => {
    const { span, at } = lineOf("[[id]]");
    const node = buildBlockAnchor(span, at);
    expect(node).toEqual({
      type: "blockAnchor",
      id: "id",
      reftext: undefined,
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 6, line: 1, column: 7 },
      },
    });
  });

  test("keeps the reftext of `[[id,text]]`", () => {
    const { span, at } = lineOf("[[id,text]]");
    expect(buildBlockAnchor(span, at)).toMatchObject({
      id: "id",
      reftext: "text",
    });
  });
});

describe("buildBlockAttributeList", () => {
  test.each([
    ["[source,ruby]", "source,ruby"],
    ["[#myid]", "#myid"],
    ["[]", ""],
  ])("%j → value %j", (line, value) => {
    const { span, at } = lineOf(line);
    const node = buildBlockAttributeList(span, at);
    expect(node.type).toBe("blockAttributeList");
    expect(node.value).toBe(value);
    expect(node.position).toEqual({
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: line.length, line: 1, column: line.length + 1 },
    });
  });
});

describe("buildBlockTitle", () => {
  test.each([
    [".Title", "Title"],
    // No trim: the registry's BLOCK_TITLE pattern guarantees the
    // character after the dot is non-blank, and a trailing space is
    // the author's.
    [".Title ", "Title "],
  ])("%j → title %j", (line, title) => {
    const { span, at } = lineOf(line);
    const node = buildBlockTitle(span, at);
    expect(node.type).toBe("blockTitle");
    expect(node.title).toBe(title);
  });
});

describe("buildAttributeEntry", () => {
  test.each([
    [":name: value", "name", "value", false],
    [":name:  padded  ", "name", "padded", false],
    [":name:", "name", undefined, false],
    [":!name:", "name", undefined, "prefix"],
    [":name!:", "name", undefined, "suffix"],
  ])("%j → %j = %j (unset %j)", (line, name, value, unset) => {
    const { span, at } = lineOf(line);
    const node = buildAttributeEntry(span, at);
    expect(node.type).toBe("attributeEntry");
    expect(node.name).toBe(name);
    expect(node.value).toBe(value);
    expect(node.unset).toBe(unset);
  });
});

describe("buildBlockMacro", () => {
  test.each([
    ["image::a.png[Alt]", "image", "a.png", "Alt"],
    ["include::a.adoc[]", "include", "a.adoc", ""],
  ])("%j → %j::%j[%j]", (line, name, target, attrlist) => {
    const { span, at } = lineOf(line);
    const node = buildBlockMacro(span, at);
    expect(node.type).toBe("blockMacro");
    expect(node.name).toBe(name);
    expect(node.target).toBe(target);
    expect(node.attrlist).toBe(attrlist);
  });
});

describe("buildThematicBreak and buildPageBreak", () => {
  test("`'''` is a thematic break spanning its line", () => {
    const { span, at } = lineOf("'''");
    expect(buildThematicBreak(span, at)).toEqual({
      type: "thematicBreak",
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 3, line: 1, column: 4 },
      },
    });
  });

  test("`<<<` is a page break spanning its line", () => {
    const { span, at } = lineOf("<<<");
    expect(buildPageBreak(span, at)).toEqual({
      type: "pageBreak",
      position: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 3, line: 1, column: 4 },
      },
    });
  });
});

describe("buildRawBlockLine", () => {
  test.each([
    ["// c", "c"],
    ["//c", "c"],
    ["//", ""],
    ["//  two spaces", " two spaces"],
  ])("%j is a line comment with value %j", (line, value) => {
    const { span, at } = lineOf(line);
    expect(buildRawBlockLine(span, at)).toMatchObject({
      type: "comment",
      commentType: "line",
      value,
    });
  });

  test.each([
    ["ifdef::x[]", "ifdef::x[]"],
    ["endif::[]", "endif::[]"],
    ["include::a.adoc[]", "include::a.adoc[]"],
    // The value is the RSTRIPPED line: Asciidoctor strips every line
    // before any rule runs, so trailing blanks are not what it read.
    ["ifdef::x[]  ", "ifdef::x[]"],
  ])("%j is a preprocessor directive with value %j", (line, value) => {
    const { span, at } = lineOf(line);
    expect(buildRawBlockLine(span, at)).toMatchObject({
      type: "preprocessorDirective",
      value,
    });
  });

  test("a bare `+` is the raw-line paragraph", () => {
    const { span, at } = lineOf("+");
    const node = buildRawBlockLine(span, at);
    const position = {
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 1, line: 1, column: 2 },
    };
    expect(node).toEqual({
      type: "paragraph",
      children: [{ type: "rawLine", value: "+", position }],
      position,
    });
  });
});
