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
import { asParagraph } from "../helpers.js";
import { narrow } from "../../src/narrow.js";

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
