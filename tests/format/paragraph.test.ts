import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("paragraph formatting", () => {
  // Round-trip baseline: well-formed input should not be changed.
  test("single paragraph preserved", async () => {
    expect(await formatAdoc("Hello world.\n")).toBe("Hello world.\n");
  });

  // AsciiDoc uses exactly one blank line to separate blocks. Multiple
  // consecutive blank lines are visual noise — the formatter collapses
  // them. This is the core formatting opinion for paragraph separation.
  test("multiple blank lines between paragraphs collapsed to one", async () => {
    const input = "First.\n\n\n\nSecond.\n";
    const expected = "First.\n\nSecond.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Trailing blank lines serve no purpose and should be stripped.
  // The document printer emits exactly one trailing hardline after content.
  test("trailing blank lines removed", async () => {
    const input = "Hello.\n\n\n";
    const expected = "Hello.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Leading blank lines before content should be stripped — the parser
  // absorbs them as BlankLine tokens that don't produce AST nodes.
  test("leading blank lines removed", async () => {
    const input = "\n\nHello.\n";
    const expected = "Hello.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Complement to the "collapsed" test: verify that a single blank line
  // between paragraphs is already canonical and is preserved unchanged.
  test("two paragraphs separated by single blank line", async () => {
    const input = "First.\n\nSecond.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Line breaks within a paragraph are reflowed — the formatter joins
  // lines and re-wraps to printWidth. Short lines that fit together
  // on one line are merged.
  test("multi-line paragraph lines reflowed", async () => {
    const input = "Line one.\nLine two.\n";
    const expected = "Line one. Line two.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Trailing whitespace is invisible and should be stripped.
  // The text printer splits on /\s+/, so trailing spaces are
  // naturally discarded during word extraction.
  test("trailing whitespace on lines removed", async () => {
    const input = "Hello world.   \n";
    const expected = "Hello world.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Edge case: empty input must produce empty output, not a lone newline.
  // The document printer returns "" when there are no children.
  test("empty input stays empty", async () => {
    expect(await formatAdoc("")).toBe("");
  });

  // Regression: a whitespace-only first line was tokenized as
  // InlineModeStart and became a paragraph. The printer rendered it
  // as empty content plus a blank-line separator, producing
  // spurious leading newlines. Now it is dropped.
  test("whitespace-only line before list item is dropped", async () => {
    const input = " \n. item";
    expect(await formatAdoc(input)).toBe(". item\n");
  });
});

// Asciidoctor's paragraphs are greedy: once a paragraph is open, every
// following line is its text until a blank line or one of a tiny
// interrupting set (src/parse/line-shapes.ts). These cases pin the
// contextual classification — each construct is block syntax at the
// START of a block but plain text in the middle of one.
describe("paragraph continuation (contextual classification)", () => {
  const cases: Array<[string, string]> = [
    ["block title line", "first line\n.A title\nlast line\n"],
    ["list marker line", "first line\n* item\nlast line\n"],
    ["attribute entry line", "first line\n:name: value\nlast line\n"],
    ["admonition label line", "first line\nNOTE: note text\nlast line\n"],
    ["indented line", "first line\n  wrapped continuation\nlast line\n"],
    ["section marker line", "first line\n== Section\nlast line\n"],
    ["block macro line", "first line\nimage::a.png[]\nlast line\n"],
    ["thematic break line", "first line\n'''\nlast line\n"],
    // A delimiter-shaped PREFIX is not a delimiter: the default-mode
    // patterns match `----` and `.Title` anywhere on a line, so these
    // two used to open a listing block / block title mid-paragraph.
    ["delimiter-prefixed dlist term", "a line\n----:: x\n"],
    ["block-title-prefixed dlist term", "a line\n.Title:: x\n"],
  ];
  for (const [name, input] of cases) {
    test(`${name} is paragraph text, not a split`, async () => {
      const out = await formatAdoc(input);
      // vitest's expect() takes an optional message as its second
      // argument; the rule's default assumes the jest signature.
      expect(out.includes("\n\n"), "must not split into two blocks").toBe(
        false,
      );
      expect(renderedHtml(out)).toBe(renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    });
  }

  test("a comment line inside a paragraph stays verbatim on its own line", async () => {
    const input = "first line\n// a comment\nlast line\n";
    const out = await formatAdoc(input);
    expect(out).toBe("first line\n// a comment\nlast line\n");
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });

  test("a conditional directive inside a paragraph stays verbatim", async () => {
    const input =
      "first line\nifdef::flag[]\nconditional text\nendif::[]\nlast line\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });

  test.each([
    ["an attribute list", "first line\n[source]\n----\ncode\n----\n"],
    ["a block anchor", "first line\n[[anchor]]\nlast line\n"],
    ["an example delimiter", "first line\n====\nex\n====\n"],
  ])("%s still interrupts", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });
});

// A delimiter OWNS its line: Asciidoctor's `is_delimited_block?`
// requires the whole line to be a uniform run of the delimiter
// character. The lexer's open tokens used to PREFIX-match, so
// `----:: x` opened a listing block and swallowed the rest of the
// document.
describe("delimiter lines are whole lines", () => {
  test("a delimiter-prefixed line does not open a block", async () => {
    const out = await formatAdoc("====text\n");
    expect(out).toBe("====text\n");
    expect(renderedHtml(out)).toBe(renderedHtml("====text\n"));
    expect(await formatAdoc(out)).toBe(out);
  });

  test("a real delimiter still opens a block", async () => {
    const input = "----\ncode\n----\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });

  test("a delimiter-prefixed dlist term in a list item is not a block", async () => {
    const input = "* item\n----:: x\n";
    const out = await formatAdoc(input);
    // The corruption this used to produce (`----` on its own line
    // opening a listing block, with `: x` stranded inside it) is
    // gone. Full fidelity still waits on description-list support
    // (#9) and on the reflow guard narrowing (#4): the term word is
    // currently glued to the item text instead of keeping its line.
    expect(out.includes("\n----\n")).toBe(false);
    expect(await formatAdoc(out)).toBe(out);
  });
});
