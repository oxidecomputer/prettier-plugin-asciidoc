import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("conditional directive formatting", () => {
  // ifdef preserved as-is.
  test("ifdef preserved", async () => {
    const input = "ifdef::backend[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // ifdef with content preserved.
  test("ifdef with content preserved", async () => {
    const input = "ifdef::backend[Content here]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // ifndef preserved.
  test("ifndef preserved", async () => {
    const input = "ifndef::attr[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // ifeval preserved.
  test("ifeval preserved", async () => {
    const input = "ifeval::[{version} > 1]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // endif preserved.
  test("endif preserved", async () => {
    const input = "endif::[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Comma-separated attributes preserved.
  test("comma-separated attributes preserved", async () => {
    const input = "ifdef::attr1,attr2[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Between paragraphs with blank line separation.
  test("between paragraphs", async () => {
    const input = "Before.\n\nifdef::backend[]\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

// A preprocessor line is TRANSPARENT to attachment (#28): Asciidoctor's
// reader removes it (`PreprocessorReader#process_line`, reader.rb:824)
// before block metadata, a list continuation `+` or a section title is
// read, so everything on both sides of it belongs together. Both sides
// of each assertion go through the same oracle, which RESOLVES the
// conditional — `backend` is always set, so `ifdef::backend[]` keeps
// its content and the comparison is about real rendered content.
describe("preprocessor lines are transparent to attachment (#28)", () => {
  test.each([
    [
      "between + and its block",
      "* a\n+\nifdef::backend[]\npara\nendif::[]\n* b\n",
    ],
    [
      "between metadata and a delimited block",
      "[source]\nifdef::backend[]\n----\ncode\n----\nendif::[]\n",
    ],
    [
      "between metadata and a paragraph-form block",
      "[sidebar]\nifdef::backend[]\nFirst line.\nendif::[]\n",
    ],
    [
      "between metadata and a verbatim paragraph-form block",
      "[listing]\nifdef::backend[]\naaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss ttt uuu vvv www xxx\nendif::[]\n",
    ],
    [
      "between section metadata and its heading",
      "[[id]]\nifdef::backend[]\n== H\n\ntext\nendif::[]\n",
    ],
    [
      "the issue #28 sidebar",
      "ifdef::asciidoctor-version[]\n[sidebar]\nFirst line of sidebar.\nifdef::backend[The backend is {backend}.]\nLast line of sidebar.\nendif::[]\n",
    ],
    [
      "an include between metadata and its block",
      "[sidebar]\ninclude::x.adoc[]\nFirst line.\n",
    ],
  ])("%s round-trips render-equal and idempotent", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  test.each([
    "ifdef::a[]\n// c\nendif::[]\n\npara\n",
    "include::a.adoc[]\ninclude::b.adoc[]\n\npara\n",
    "// c\nifdef::a[]\n// d\nendif::[]\n\npara\n",
  ])("consecutive raw lines stack without blank lines: %j", async (input) => {
    expect(await formatAdoc(input)).toBe(input);
  });
});

// `Helpers.prepare_source_string` rstrips every line before any rule
// runs, so trailing whitespace on a directive line is invisible to
// Asciidoctor — and to the transparency rules that depend on
// recognizing the line. The formatter drops it (Prettier trims trailing
// whitespace before a break in any case).
describe("trailing whitespace on a directive line", () => {
  const long =
    "aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss ttt uuu vvv www xxx";
  test.each([
    ["ifdef::backend[]  \n", "ifdef::backend[]\n"],
    ["include::a.adoc[]\t\n", "include::a.adoc[]\n"],
    ["endif::[] \n", "endif::[]\n"],
    [
      `[listing]\nifdef::backend[]  \n${long}\nendif::[] \n`,
      `[listing]\nifdef::backend[]\n${long}\nendif::[]\n`,
    ],
  ])("%j formats to %j", async (input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
