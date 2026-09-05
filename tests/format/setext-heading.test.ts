/**
 * Underlined (setext) section titles, end to end (issue #16).
 *
 * The formatter normalizes them to the ATX spelling, which costs
 * nothing to say: the level is the whole of what the underline
 * carries, and the printer already writes a level as a run of `=`.
 * Every row proves the render is the oracle's own, because the
 * corruption this issue names is a RENDER loss and not a lost
 * structure - a `Title` over `-----` used to come back as a paragraph
 * over a listing block, so prose landed inside `<pre>`.
 */
import { describe, expect, test } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

describe("an underlined title normalizes to the ATX spelling", () => {
  // One row per SETEXT_SECTION_LEVELS mark: the mark IS the level, so
  // the marker run the printer writes is the whole assertion.
  test.each([
    ["=", "= Title"],
    ["-", "== Title"],
    ["~", "=== Title"],
    ["^", "==== Title"],
    ["+", "===== Title"],
  ])("%j underlines to %s", async (mark, expected) => {
    await expectFormatted(
      `para\n\nTitle\n${mark.repeat(5)}\n\nbody\n`,
      `para\n\n${expected}\n\nbody\n`,
    );
  });

  // The issue's own repro, and the tier-1 render loss behind it: the
  // underline used to open a listing block, so `body` was rendered
  // inside `<pre>` instead of under a heading.
  test("the issue's repro no longer buries its body in a listing block", async () => {
    await expectFormatted("Title\n-----\n\nbody\n", "== Title\n\nbody\n");
  });

  // The magnitude datum's shape: a `----` line tight under prose is a
  // two-line title, and the formatter used to insert a blank between
  // the two lines - which turns the heading back into a paragraph
  // plus a listing block.
  test("a run tight under prose keeps its heading", async () => {
    await expectFormatted(
      "para\n----\nx\n----\n",
      "== para\n\nx\n\n----\n----\n",
    );
  });

  // A title one character off in each direction, which is the whole
  // of the length rule the underline has to satisfy.
  test.each([
    ["an underline one short", "Title\n----\n\nb\n"],
    ["an underline one long", "Title\n------\n\nb\n"],
  ])("%s is still a title", async (_name, input) => {
    await expectFormatted(input, "== Title\n\nb\n");
  });

  // A level-0 underlined title is the DOCUMENT HEADER, so its author
  // line stays attached: a blank line inserted between the two would
  // demote the author to body text (issue #18's rule, reached by the
  // other spelling). Its own SPELLING is kept - see the suite below.
  test("an underlined document title keeps its author line", async () => {
    await expectFormatted(
      "Doc\n===\nAuthor Name\n\nbody\n",
      "Doc\n===\nAuthor Name\n\nbody\n",
    );
  });

  // A `[discrete]` above the pair opens no section, and the oracle
  // reads the same two lines there (`next_block`'s float arm asks
  // `is_section_title?` with the line below).
  test("a discrete underlined title normalizes too", async () => {
    await expectFormatted(
      "[discrete]\nTitle\n-----\n\nb\n",
      "[discrete]\n== Title\n\nb\n",
    );
  });
});

// An INDENTED title line. The oracle reads one (`SetextSectionTitleRx`
// forbids a leading `.` and nothing else, so `  lit` over `----` is a
// level-1 title whose text keeps the indent), and the ATX spelling
// this printer writes cannot carry that indent: the gap after the
// markers is `[ \t]+`, which the reader eats on the way back. So the
// title is recorded without it.
//
// Red before the trim: the first pass emitted `==   lit`, which the
// SECOND pass rewrote to `== lit` - a formatter that was not a fixed
// point on its own output. What is left is one recorded difference,
// pinned below rather than asserted correct: the oracle renders the
// source's heading text with the leading space and the output's
// without it. Refusing the line instead would hand it back to the
// literal-paragraph branch, which renders a `<pre>` block where the
// oracle renders a heading - strictly further from the oracle than
// the space.
//
// LEVEL >= 1 AND THE DISCRETE FORM ONLY. The doctitle arm replays its
// two lines instead of respelling them, so it keeps the indent; its
// rows are in the suite above.
describe("an indented SECTION title line loses its indent, and settles", () => {
  test.each([
    ["a two-space indent", "  lit\n----\nfoo\n----\n", "== lit\n\n== foo\n"],
    ["a deeper one", "   Title\n--------\n\nb\n", "== Title\n\nb\n"],
  ])("%s formats once and stays", async (_name, input, expected) => {
    const first = await formatAdoc(input);
    expect(first).toBe(expected);
    expect(await formatAdoc(first)).toBe(first);
  });

  // The recorded difference itself, so that a change which closes it
  // fails here rather than passing quietly.
  test("the heading text differs from the source by the indent", async () => {
    const out = await formatAdoc("  lit\n----\n");
    expect(await renderedHtml("  lit\n----\n")).toContain("> lit<");
    expect(await renderedHtml(out)).toContain(">lit<");
  });
});

describe("what the underline rule refuses", () => {
  // Two characters off in either direction: the pair is prose, and
  // the run below it is read on its own terms - the Markdown rule
  // when it is three marks, a listing delimiter when it is four or
  // more.
  test.each([
    ["two short", "Title\n---\n"],
    ["two long", "Title\n-------\n"],
  ])("an underline %s is no title", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out.startsWith("==")).toBe(false);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // A blank line between the two lines breaks the pair, which is why
  // the formatter's own output - blocks always separated by a blank
  // line - can never be re-read as a title it did not write.
  test("a blank line between the lines leaves a listing block", async () => {
    await expectFormatted(
      "Title\n\n----\nx\n----\n",
      "Title\n\n----\nx\n----\n",
    );
  });
});

/**
 * The one title this formatter may NOT respell: an underlined
 * DOCTITLE. `parse_document_header` sets `compat-mode` on the whole
 * document unless the doctitle is ATX (parser.rb l.160-61), and under
 * compat mode `+content+` renders as code and `'emphasis'` as
 * emphasis - so `= Title` written for a legacy `Title` / `=====`
 * changes what every paragraph below it renders as.
 *
 * Red before the header carried the spelling: the first row formatted
 * to `= Document Title` and its `+content+` lost its `<code>`.
 */
describe("an underlined doctitle keeps its underline", () => {
  test.each([
    ["the plus form", "Document Title\n==============\n\n+content+\n"],
    ["the quote form", "Document Title\n==============\n\n'emphasis'\n"],
    ["with an author line", "Doc\n===\nAuthor Name\n\n+c+\n"],
    ["an anchor above it", "[[a]]\nDoc\n===\n\n+c+\n"],
    // The underline may be one character off in either direction, and
    // it is replayed as written rather than re-spelled.
    ["an underline one short", "Doc\n==\n\n+c+\n"],
    ["an underline one long", "Doc\n====\n\n+c+\n"],
  ])("%s round-trips", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // An INDENTED doctitle, which is the shape the two arms part over.
  // The section arm drops a title's leading whitespace because ATX
  // cannot carry it; the header arm may NOT, because it replays the
  // two source lines and the width rule that admitted the pair was
  // applied to the line as written - trimming the text while
  // replaying the underline pushes the pair outside the rule, and the
  // title, the compat mode and the body all go (the `=====` becomes
  // an unterminated example block).
  //
  // Red before the trim was scoped to the ATX arm: every row here
  // formatted to an unindented title and lost its `<code>`.
  test.each([
    ["one space", " Doc\n=====\n\n+content+\n"],
    ["two spaces", "  Doc\n=====\n\n+content+\n"],
    ["three spaces", "   Doc\n=====\n\n+content+\n"],
    // A WIDER underline, so the indent is not what the width rule is
    // counting on: the pair is admitted either way and the replay
    // still has to keep the line as written.
    ["a wider underline", "  Doc\n======\n\n+content+\n"],
    ["a longer title", "  Title\n=======\n\nbody\n"],
    // With an author line, which the trim also swallowed.
    ["an author line under it", "  Doc\n=====\nAuthor Name\n\n+content+\n"],
  ])("%s round-trips", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // And the compat mode those rows are really about, asserted rather
  // than left to the render comparison: an indented doctitle is still
  // a setext doctitle, so `+content+` is code on both sides.
  test("an indented doctitle still holds compat mode", async () => {
    const input = " Doc\n=====\n\n+content+\n";
    expect(await renderedHtml(await formatAdoc(input))).toContain(
      "<code>content</code>",
    );
  });

  // An attribute entry above the title gains a blank line under it,
  // which the ATX spelling gains too and which the oracle reads
  // through: the row is here for the UNDERLINE, which survives.
  test("an attribute entry above it keeps the underline", async () => {
    await expectFormatted(
      ":x: y\nDoc\n===\n\n+c+\n",
      ":x: y\n\nDoc\n===\n\n+c+\n",
    );
  });

  // The compat attribute really is what the rows above are about: the
  // same document with an ATX doctitle renders `+c+` as plain text.
  test("the ATX spelling is a different document", async () => {
    expect(await renderedHtml("Doc\n===\n\n+c+\n")).not.toBe(
      await renderedHtml("= Doc\n\n+c+\n"),
    );
  });

  // The rule is the DOCTITLE's alone. A level-0 underlined heading
  // that is not the header sets no attribute (a block title above it
  // demotes the header, and a paragraph above it retires it), and an
  // underlined SECTION title never did, so both still normalize.
  test.each([
    [
      "under a paragraph",
      "para\n\nTitle\n=====\n\n+c+\n",
      "para\n\n= Title\n\n+c+\n",
    ],
    ["under a block title", ".Cap\nDoc\n===\n\n+c+\n", ".Cap\n= Doc\n\n+c+\n"],
    [
      "a level-1 title under an ATX doctitle",
      "= Doc\n\nTitle\n-----\n\nbody\n",
      "= Doc\n\n== Title\n\nbody\n",
    ],
    [
      "a level-1 title under a setext doctitle",
      "Doc\n===\n\nTitle\n-----\n\n+c+\n",
      "Doc\n===\n\n== Title\n\n+c+\n",
    ],
  ])("%s still normalizes", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});
