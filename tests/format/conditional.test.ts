import { describe, test, expect } from "vitest";
import {
  expectFormatted,
  expectStableRender,
  formatAdoc,
  renderedHtml,
} from "../helpers.js";

describe("conditional directive formatting", () => {
  // ifdef preserved as-is.
  test("ifdef preserved", async () => {
    const input = "ifdef::backend[]\n";
    await expectFormatted(input, input);
  });

  // ifdef with content preserved.
  test("ifdef with content preserved", async () => {
    const input = "ifdef::backend[Content here]\n";
    await expectFormatted(input, input);
  });

  // ifndef preserved.
  test("ifndef preserved", async () => {
    const input = "ifndef::attr[]\n";
    await expectFormatted(input, input);
  });

  // ifeval preserved.
  test("ifeval preserved", async () => {
    const input = "ifeval::[{version} > 1]\n";
    await expectFormatted(input, input);
  });

  // endif preserved.
  test("endif preserved", async () => {
    const input = "endif::[]\n";
    await expectFormatted(input, input);
  });

  // Comma-separated attributes preserved.
  test("comma-separated attributes preserved", async () => {
    const input = "ifdef::attr1,attr2[]\n";
    await expectFormatted(input, input);
  });

  // Between paragraphs with blank line separation.
  test("between paragraphs", async () => {
    const input = "Before.\n\nifdef::backend[]\n\nAfter.\n";
    await expectFormatted(input, input);
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
    await expectStableRender(input);
  });

  test.each([
    "ifdef::a[]\n// c\nendif::[]\n\npara\n",
    "include::a.adoc[]\ninclude::b.adoc[]\n\npara\n",
    "// c\nifdef::a[]\n// d\nendif::[]\n\npara\n",
  ])("consecutive raw lines stack without blank lines: %j", async (input) => {
    await expectFormatted(input, input);
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

  // The row's subject is the SEQUENCE: three passes, each rendering as
  // the source, and the last two moving no byte. The shared helpers
  // assert exactly one pass, so folding any line into one would leave
  // the rest hand-spelled and say less than the row does.
  /* eslint-disable test-assertions/no-hand-spelled-format-trailer -- a three-pass convergence, which no one-pass helper states */
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
  /* eslint-enable test-assertions/no-hand-spelled-format-trailer */
});

/**
 * Issue #231: a single-line conditional carrying a body is not
 * deleted from the stream, it SUBSTITUTES that body into it -
 * `replace_next_line text.rstrip` then `unshift ''` (reader.rb
 * l.993-997), the same pair of calls an include's unresolved arm
 * makes. So a rule read at a block boundary alone has the same
 * missing precondition under one of these as under an `include::`,
 * and unlike the include rows it needs no missing file and no
 * attribute set to show it: `ifndef::zz[body]` over `___` printed
 * `'''` where the oracle renders `body <em>_</em>`, with `zz`
 * undefined in every configuration the harness runs.
 *
 * The formatter never resolves the condition, so the answer has to
 * hold whichever way it goes, and holding the rules off is the arm
 * that does: the bytes are written back as they stand, and bytes that
 * stand still render the same under both readings.
 */
describe("a block-boundary construct under a body-bearing conditional", () => {
  test.each([
    ["a layout break", "ifndef::zz[body]\n___\n"],
    ["a page break near miss", "ifndef::zz[body]\n<<<\n"],
    ["a comma-delimited target", "ifndef::a,b[body]\n___\n"],
    ["a plus-delimited target", "ifndef::a+b[body]\n___\n"],
    ["an ifdef spelling", "ifdef::zz[body]\n___\n"],
  ])("%s keeps its bytes", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // The paragraph is the reading; whether its lines JOIN is a second
  // question, and the packer asks it of the line it would write. A
  // packed line that reads back as a heading or a block title is
  // refused and the block's own lines are written back, because the
  // condition may go the other way: deleted, the directive leaves
  // `.Title` standing at a block start, where a folded `.Title ___`
  // is a block title over nothing (issue #293). Where the packed line
  // reads back as text - `___ more` is a break only on a line of its
  // own - the join stands.
  test.each([
    [
      "a setext pair",
      "ifndef::zz[body]\nTitle\n-----\n",
      "ifndef::zz[body]\nTitle\n\n----\n----\n",
    ],
    [
      "a heading over text",
      "ifndef::zz[body]\n== T\nmore\n",
      "ifndef::zz[body]\n== T\nmore\n",
    ],
    [
      "a block title over a break",
      "ifndef::zz[body]\n.Title\n___\n",
      "ifndef::zz[body]\n.Title\n___\n",
    ],
    [
      "a break over text",
      "ifndef::zz[body]\n___\nmore\n",
      "ifndef::zz[body]\n___ more\n",
    ],
  ])("%s reads as the paragraph the body opened", async (_n, input, out) => {
    await expectFormatted(input, out);
  });

  // The arms that are DELETED rather than substituted keep the
  // boundary, so the break below one canonicalizes as it does with
  // nothing above it at all. Every malformed spelling is deleted too:
  // the log-and-return each takes sits above the substituting arm.
  test.each([
    ["a bodyless ifdef", "ifdef::zz[]\n___\n", "ifdef::zz[]\n'''\n"],
    ["an ifeval region", "ifeval::[1==1]\n___\n", "ifeval::[1==1]\n'''\n"],
    ["a targetless ifdef", "ifdef::[body]\n___\n", "ifdef::[body]\n'''\n"],
    ["an ifeval with a target", "ifeval::t[x]\n___\n", "ifeval::t[x]\n'''\n"],
    ["an endif with text", "endif::x[t]\n___\n", "endif::x[t]\n'''\n"],
  ])("%s restores the boundary", async (_name, input, out) => {
    await expectFormatted(input, out);
  });

  // A blank line restores it too, from the substituting arm as well.
  test("a blank line restores the canonical spelling", async () => {
    await expectFormatted(
      "ifndef::zz[body]\n\n___\n",
      "ifndef::zz[body]\n\n'''\n",
    );
  });

  // A body of nothing but whitespace substitutes `text.rstrip`, which
  // is the EMPTY string, so with the `unshift ''` under it the
  // directive leaves TWO BLANK LINES and the boundary is restored -
  // the same answer as a bodyless spelling, reached one arm further
  // down. Every row here printed the FOLDED spelling when the rstrip
  // was missing from the test, and the first of them rendered nothing
  // at all: `.Title ___` is a block title over no block, where the
  // input renders `<hr>`.
  test.each([
    [
      "a block title over a break",
      "ifdef::backend[ ]\n.Title\n___\n",
      "ifdef::backend[ ]\n.Title\n'''\n",
    ],
    [
      "a heading over text",
      "ifdef::backend[ ]\n== T\nmore\n",
      "ifdef::backend[ ]\n== T\n\nmore\n",
    ],
    [
      "a heading over text, ifndef",
      "ifndef::zz[ ]\n== T\nmore\n",
      "ifndef::zz[ ]\n== T\n\nmore\n",
    ],
    [
      "a heading over text, tab body",
      "ifdef::backend[\t]\n== T\nmore\n",
      "ifdef::backend[\t]\n== T\n\nmore\n",
    ],
    [
      "a setext pair",
      "ifdef::backend[  ]\nTitle\n-----\n",
      "ifdef::backend[  ]\n== Title\n",
    ],
    ["a layout break", "ifdef::backend[ ]\n___\n", "ifdef::backend[ ]\n'''\n"],
  ])(
    "a whitespace body restores the boundary over %s",
    async (_n, input, out) => {
      await expectFormatted(input, out);
    },
  );

  // The rstrip trims the TAIL alone, so a body with anything else in
  // it still substitutes.
  test("a body with trailing whitespace still substitutes", async () => {
    await expectFormatted(
      "ifdef::backend[x ]\n___\n",
      "ifdef::backend[x ]\n___\n",
    );
  });
});

/**
 * Issue #293: the condition goes either way and the formatter
 * resolves neither, so the only safe output is the author's own
 * lines.
 *
 * `ifdef::x[body]` with `x` undefined is DELETED from the stream, so
 * the `.Title` under it stands at a block start and is a block title
 * to both programs; with `x` defined the same line SUBSTITUTES
 * `body`, and `.Title` is prose inside the paragraph that body
 * opened. Held off, our reader reads it as prose either way, which
 * costs nothing while the line keeps its own line.
 *
 * What used to cost the render is the packer: it exempted a block
 * whose own first source line reads as a block start, so `.Title` and
 * the line under it were folded into `.Title para`, which is a block
 * title over nothing wherever the directive was deleted. Every row
 * here printed a folded line before that exemption came out, and both
 * programs read the folded line differently from the two.
 */
describe("a block title under a substituting directive", () => {
  test.each([
    ["a conditional with a body", "ifdef::x[body]\n.Title\npara\n"],
    ["an ifndef spelling", "ifndef::x[body]\n.Title\npara\n"],
    ["an include", "include::p[]\n.Title\npara\n"],
    ["a comment between", "ifdef::x[body]\n// c\n.Title\npara\n"],
    ["an endif between", "ifdef::x[body]\nendif::x[]\n.Title\npara\n"],
    [
      "a second conditional between",
      "ifdef::x[body]\nifdef::y[m]\n.Title\npara\n",
    ],
    ["two titles", "ifdef::x[body]\n.T1\n.T2\npara\n"],
    ["a title over a list", "ifdef::x[body]\n.Title\n* a\n* b\n"],
    ["a title holding a span", "ifdef::x[body]\n.Title with *bold*\npara\n"],
    [
      "a title over two paragraphs",
      "ifdef::x[body]\n.Title\npara one\n\npara two\n",
    ],
    ["a title inside a list item", "* a\n+\ninclude::p[]\n.Title\npara\n"],
    ["a document header above", "= Doc\n\nifdef::x[body]\n.Title\npara\n"],
    [
      "a title wider than the print width",
      "ifdef::x[body]\n.A very long block title that goes on and on and on past the print width limit for sure yes\npara here\n",
    ],
  ])("%s keeps every line the author wrote", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // A BLANK line under the title is the author's separation and the
  // printer keeps it: the title line is prose to our reader here, so
  // the blank ends its paragraph rather than being the separation
  // under block metadata that the printer normalizes away.
  test.each([
    ["a paragraph below", "ifdef::x[body]\n.Title\n\npara\n"],
    ["a list below", "ifdef::x[body]\n.Title\n\n* a\n* b\n"],
    [
      "a wide title over a paragraph",
      "ifdef::x[body]\n.A very long block title that goes on and on and on past the print width limit for sure yes\n\npara here\n",
    ],
  ])("a blank line under the title with %s stands", async (_n, input) => {
    await expectFormatted(input, input);
  });

  // The control: with nothing substituting above it, a block title is
  // metadata and the printer stacks it onto the block it annotates.
  test("a block title at document level stacks onto its block", async () => {
    await expectFormatted(".Title\n\npara\n", ".Title\npara\n");
  });

  // A block title inside a CONTAINER keeps the refusal, because a
  // title is metadata wherever it stands. A section title is not: a
  // compound block's interior and a list item's buffer are read
  // through `next_block`, which reaches no section arm, so `== T` is
  // that paragraph's text under every reading and the two lines fold.
  // Red the other way before the refusal asked as the reader that
  // read the block: every row here printed its lines apart, which is
  // a normalization the render never asked for.
  test.each([
    [
      "an example block",
      "====\n== T\ninner\n====\n",
      "====\n== T inner\n====\n",
    ],
    ["a sidebar", "****\n== T\ninner\n****\n", "****\n== T inner\n****\n"],
    ["a quote block", "____\n== T\ninner\n____\n", "____\n== T inner\n____\n"],
    ["an open block", "--\n== T\ninner\n--\n", "--\n== T inner\n--\n"],
    [
      "an example block in an item",
      "* item\n+\n====\n== T\ninner\n====\n",
      "* item\n+\n====\n== T inner\n====\n",
    ],
    [
      "an example block under a conditional",
      "ifdef::x[body]\n====\n== T\ninner\n====\n",
      "ifdef::x[body]\n====\n== T inner\n====\n",
    ],
  ])(
    "a heading line inside %s is the paragraph's text",
    async (_name, input, out) => {
      await expectFormatted(input, out);
    },
  );

  // The same containers with a block TITLE, which stays refused: the
  // title annotates the block under it wherever it stands, so a
  // packed `.Title para` is a title over nothing on the branch that
  // deletes the directive.
  test.each([
    ["an open block", "--\nifdef::x[body]\n.Title\npara\n--\n"],
    ["an example block", "====\nifdef::x[body]\n.Title\npara\n====\n"],
    ["a list item", "* item\n+\nifdef::x[body]\n.Title\npara\n"],
  ])("a block title inside %s keeps its lines", async (_n, input) => {
    await expectFormatted(input, input);
  });
});
