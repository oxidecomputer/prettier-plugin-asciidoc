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
import {
  conditionalDirective,
  preprocessorLineEffect,
} from "../../src/parse/line-shapes.js";
import { parse } from "../../src/parser.js";
import { asParagraph, narrow } from "../helpers.js";

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

// What each spelling does to Ruby's `@conditional_stack`, which is
// the fact the reader and the item scan count without ever resolving
// a condition. Every row is read off `preprocess_conditional_directive`
// (reader.rb l.909-1006): a region form pushes (l.991, l.1005), an
// `endif` with empty brackets pops (l.919), a single-line
// `ifdef`/`ifndef` replaces itself with its own text and pushes
// nothing (l.993-1001), and the malformed spellings are reported and
// returned from with the stack untouched (a targetless `ifdef`
// l.936-939, an `ifeval` carrying a target l.982-984 or a text that
// is not a comparison l.978-979, an `endif` carrying text
// l.914-915). The one place this answer parts company with Ruby is
// the last row, and it is a written ruling rather than an oversight:
// a targeted `endif` pops only on a target match (l.918) and logs a
// mismatch otherwise (l.922), and a count that carries no targets
// closes on it - see the reason at `conditionalDirective`.
describe("what a conditional directive line does to the stack", () => {
  test.each<[string, "opens" | "closes" | "inert" | undefined]>([
    ["ifdef::backend[]", "opens"],
    ["ifndef::attr[]", "opens"],
    ["ifdef::attr1,attr2[]", "opens"],
    ["ifeval::[{version} > 1]", "opens"],
    ["endif::[]", "closes"],
    ["endif::backend[]", "closes"],
    ["ifdef::backend[Content here]", "inert"],
    ["ifndef::attr[text]", "inert"],
    ["ifdef::[text]", "inert"],
    ["ifndef::[]", "inert"],
    ["ifeval::[]", "inert"],
    ["ifeval::[bogus]", "inert"],
    ['ifeval::[ "a" == "a" ]', "opens"],
    ["ifeval::target[expr]", "inert"],
    ["endif::[text]", "inert"],
    ["endif::other[]", "closes"],
    ["para", undefined],
    ["include::a.adoc[]", undefined],
    ["// c", undefined],
  ])("%j is %s", (line, expected) => {
    expect(conditionalDirective(line)).toBe(expected);
  });
});

// The OTHER question about the same lines, and the one the stack
// answer cannot stand in for: what the preprocessor leaves in the
// stream where the line stood. A single-line `ifdef`/`ifndef` with a
// body is `inert` to the stack above and `substitutes` here, which is
// the whole of issue #231 - the walk that reads the block boundary
// above a line counted them as deleted, and `ifndef::zz[body]` over
// `___` printed `'''` where the oracle renders an italic underscore,
// with no attribute defined and no include in the document.
//
// The two answers do NOT pair off, and the whitespace-body rows are
// where they part: `ifdef::backend[ ]` is `inert` to the stack and
// `deleted` here. It reaches l.995 like any other body-bearing
// spelling and substitutes `text.rstrip`, which for a body of spaces
// or tabs is the EMPTY string, so with the `unshift ''` on l.997 it
// leaves two blank lines and restores the boundary. Reading it as
// `substitutes` folded `ifdef::backend[ ]` over `.Title` over `___`
// into one line that renders NOTHING, where the input renders `<hr>`.
//
// A malformed spelling is `deleted` and not `substitutes` even where
// it carries text, because the arm that would substitute is below the
// log-and-return each of them takes: a targetless `ifdef`/`ifndef`
// (reader.rb l.936-939, l.952-954), an `ifeval` with a target
// (l.981-984), an `endif` with text (l.914-915).
describe("what the preprocessor leaves where a line stood", () => {
  test.each<[string, "deleted" | "substitutes" | undefined]>([
    ["include::a.adoc[]", "substitutes"],
    ["include::a.adoc[lines=1..2]", "substitutes"],
    ["ifdef::backend[Content here]", "substitutes"],
    ["ifndef::attr[text]", "substitutes"],
    ["ifdef::attr1,attr2[text]", "substitutes"],
    ["ifdef::attr1+attr2[text]", "substitutes"],
    // A body that survives the rstrip only at its head still does.
    ["ifdef::backend[x ]", "substitutes"],
    ["ifdef::backend[ x]", "substitutes"],
    // A body that does not survive it at all.
    ["ifdef::backend[ ]", "deleted"],
    ["ifdef::backend[   ]", "deleted"],
    ["ifndef::zz[\t]", "deleted"],
    ["ifndef::zz[ \t ]", "deleted"],
    ["ifdef::backend[]", "deleted"],
    ["ifndef::attr[]", "deleted"],
    ["endif::[]", "deleted"],
    ["endif::backend[]", "deleted"],
    ["ifeval::[{version} > 1]", "deleted"],
    ["ifdef::[text]", "deleted"],
    ["ifndef::[text]", "deleted"],
    ["ifeval::target[expr]", "deleted"],
    ["endif::[text]", "deleted"],
    ["// c", "deleted"],
    ["//", "deleted"],
    ["para", undefined],
    ["", undefined],
    [".Title", undefined],
    [":name: v", undefined],
    ["[NOTE]", undefined],
  ])("%j is %s", (line, expected) => {
    expect(preprocessorLineEffect(line)).toBe(expected);
  });
});
