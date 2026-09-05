import { describe, test, expect } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

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
    await expectFormatted(input, expected);
  });
});

// A conditional pair the author wrote around a list item's tail is a
// region this formatter never evaluates: both spellings of the pair's
// interior reach the reader unchanged, so a `+` standing inside it is
// a byte to keep. Asciidoctor's own reading of these documents is the
// same either way - the reader `shift`s the whole region away and
// hands on `nil` when the condition is false (reader.rb l.879-881),
// and `preprocess_conditional_directive` takes only the two directive
// lines when it is true (reader.rb l.844-848). A `+` printed back
// inside the region is the second of an adjacent pair on re-read
// either way:
// `ListContinuationMarker === this_line` freezes it (parser.rb
// l.1443-46), and frozen is the one state `is_delimited_block?` does
// not attach under (parser.rb l.1453-56). The FIRST of the pair is
// erased right behind it with nowhere else to print (issue #181), so
// both bytes travel on the one fact and the source's own two `+`
// lines come back unchanged.
describe("a continuation inside a directive pair over an item's tail", () => {
  const input = "* a\nifdef::x[]\n+\n+\n----\nx\n----\nendif::[]\npara\n";

  test("the +s the pair holds are written back", async () => {
    expect(await formatAdoc(input)).toBe(
      "* a\nifdef::x[]\n+\n+\n\n----\nx\n----\nendif::[]\npara\n",
    );
  });

  test("every pass renders as the source, converged from the first", async () => {
    const pass1 = await formatAdoc(input);
    const pass2 = await formatAdoc(pass1);
    const pass3 = await formatAdoc(pass2);
    const source = await renderedHtml(input);
    expect(await renderedHtml(pass1)).toBe(source);
    expect(await renderedHtml(pass2)).toBe(source);
    expect(await renderedHtml(pass3)).toBe(source);
    expect(pass2).toBe(pass1);
    expect(pass3).toBe(pass2);
  });
});
