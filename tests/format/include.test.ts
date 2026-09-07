import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

describe("include directive formatting", () => {
  // Basic include preserved as-is.
  test("basic include preserved", async () => {
    const input = "include::path/to/file.adoc[]\n";
    await expectFormatted(input, input);
  });

  // Include with lines option preserved.
  test("include with lines option preserved", async () => {
    const input = "include::file.txt[lines=5..10]\n";
    await expectFormatted(input, input);
  });

  // Include with tag option preserved.
  test("include with tag option preserved", async () => {
    const input = "include::file.txt[tag=section-name]\n";
    await expectFormatted(input, input);
  });

  // Include with leveloffset preserved.
  test("include with leveloffset preserved", async () => {
    const input = "include::file.adoc[leveloffset=+1]\n";
    await expectFormatted(input, input);
  });

  // Include between paragraphs has blank line separation.
  test("include between paragraphs", async () => {
    const input = "Before.\n\ninclude::chapter.adoc[]\n\nAfter.\n";
    await expectFormatted(input, input);
  });
});

/**
 * Issues #210 and #213: a layout break and a setext title are read at a
 * BLOCK BOUNDARY and nowhere else, and an `include::` line is one of
 * the two above which no formatter can prove there is one. A line the
 * reader consumes is either content (which opens a paragraph the line
 * below then sits inside) or DELETED from the stream by the
 * preprocessor (a `//` comment, an `ifdef::`/`endif::` pair), while an
 * include is REPLACED by the target's own lines - the unresolved
 * spelling the oracle here substitutes included - and whatever those
 * end with stands directly above the next line. A single-line
 * conditional carrying a body substitutes it the same way; those rows
 * are below, with issue #231.
 *
 * So the two canonicalizers that destroy a spelling (`___` -> `'''`,
 * `Title` over `-----` -> `== Title`) are two of the rules that must
 * not fire there. Both rows below were fidelity failures before the
 * precondition: the oracle renders `include::p[] <em>_</em>` where our
 * output said `include::p[] '''`.
 */
describe("a block-boundary construct directly under an include", () => {
  // The layout-break spellings, every one the printer would respell.
  // `'''` and `<<<` are here too: their bytes never moved, and the
  // point is that the precondition does not move them either.
  test.each([
    ["a markdown quote near miss", "include::p[]\n___\n"],
    ["a markdown listing near miss", "include::p[]\n---\n"],
    ["a markdown sidebar near miss", "include::p[]\n***\n"],
    ["a spaced markdown break", "include::p[]\n_ _ _\n"],
    ["the AsciiDoc break", "include::p[]\n'''\n"],
    ["a longer AsciiDoc break", "include::p[]\n''''\n"],
    ["a page break", "include::p[]\n<<<\n"],
    ["a longer page break", "include::p[]\n<<<<\n"],
  ])("%s keeps its bytes", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // The same, inside the two containers issue #210 measured: a list
  // item's `+`-attached block and a compound interior.
  test.each([
    ["a list item", "* item\n+\ninclude::p[]\n___\n"],
    ["an open block", "--\ninclude::p[]\n___\n--\n"],
    ["a document body", "before\n\ninclude::p[]\n___\n"],
  ])(
    "a near miss under an include in %s keeps its bytes",
    async (_name, input) => {
      await expectFormatted(input, input);
    },
  );

  // A line the preprocessor DELETES does not restore the boundary: the
  // include's own content still ends up directly above the break.
  test("a comment line between does not restore the boundary", async () => {
    const input = "include::p[]\n// c\n___\n";
    await expectFormatted(input, input);
  });

  // A conditional directive is deleted the same way. The pinned oracle
  // cannot discriminate this row - it defines no attribute, so the
  // whole region is dropped and both renders are the paragraph alone -
  // and the reading is the one the deletion forces.
  test("a conditional directive between does not restore it", async () => {
    const input = "include::p[]\nifdef::x[]\n___\n";
    await expectFormatted(input, input);
  });

  // A BLANK line does restore it: the include's content cannot reach
  // past one, so the break is at a boundary and canonicalizes.
  test("a blank line restores the canonical spelling", async () => {
    await expectFormatted("include::p[]\n\n___\n", "include::p[]\n\n'''\n");
  });

  // And so does an ordinary block between, which ends wherever it ends.
  test("a paragraph between restores the canonical spelling", async () => {
    await expectFormatted(
      "include::p[]\n\nx\n\n___\n",
      "include::p[]\n\nx\n\n'''\n",
    );
  });

  // Text on the line below joins the break into one paragraph, which
  // is what the oracle reads: the break is not a block of its own to
  // put a blank line under.
  test("a break under an include folds with the text below it", async () => {
    await expectFormatted(
      "include::p[]\n___\nmore\n",
      "include::p[]\n___ more\n",
    );
  });

  // Issue #213: the setext pair. `-----` is five dashes, so once
  // `Title` is paragraph text the underline is a listing DELIMITER -
  // an empty, unterminated listing block, which is exactly what the
  // oracle reads and what the printer now spells with a closed pair.
  test("a setext title under an include is not a heading", async () => {
    await expectFormatted(
      "include::p[]\nTitle\n-----\n",
      "include::p[]\nTitle\n\n----\n----\n",
    );
  });

  // The other four underline characters, one per level.
  test.each([
    [
      "level 0",
      "include::p[]\nTitle\n=====\n",
      "include::p[]\nTitle\n\n====\n====\n",
    ],
    [
      "level 2",
      "include::p[]\nTitle\n~~~~~\n",
      "include::p[]\nTitle\n\n~~~~\n~~~~\n",
    ],
    ["level 3", "include::p[]\nTitle\n^^^^^\n", "include::p[]\nTitle ^^^^^\n"],
    [
      "level 4",
      "include::p[]\nTitle\n+++++\n",
      "include::p[]\nTitle\n\n++++\n++++\n",
    ],
  ])(
    "a %s setext underline under an include is not a heading",
    async (_name, input, expected) => {
      await expectFormatted(input, expected);
    },
  );

  // A blank line restores the setext reading too.
  test("a blank line restores the setext heading", async () => {
    await expectFormatted(
      "include::p[]\n\nTitle\n-----\n",
      "include::p[]\n\n== Title\n",
    );
  });
});

/**
 * Issue #229: the ATX heading, where the SPELLING survives and the
 * blank line the printer puts under a heading is what moves the
 * render. `include::p[]` over `== Title` over `more` came back as the
 * same three lines with a blank inserted between the title and the
 * text, and the oracle reads all three as ONE paragraph, so the blank
 * split one paragraph into a paragraph and a section.
 *
 * Held off, the title line drops to the ladder's text fallback and
 * joins the paragraph the substituted content opened, which is what
 * the fold below is: the bytes move by a newline turning into a
 * space, and that is the trade the layout-break rows already make one
 * line up ("a break under an include folds with the text below it").
 */
describe("a heading directly under an include", () => {
  test.each([
    ["a level 1 heading", "include::p[]\n== Title\nmore\n"],
    ["a level 0 heading", "include::p[]\n= Title\nmore\n"],
    ["a level 5 heading", "include::p[]\n====== Title\nmore\n"],
  ])("%s folds with the text below it", async (_name, input) => {
    await expectFormatted(input, input.replace(/\n(?=more)/v, " "));
  });

  // Mid-document and in the two containers, the same three shapes the
  // layout-break rows are measured in.
  test.each([
    [
      "a document body",
      "before\n\ninclude::p[]\n== Title\nmore\n",
      "before\n\ninclude::p[]\n== Title more\n",
    ],
    [
      "an open block",
      "--\ninclude::p[]\n== Title\nmore\n--\n",
      "--\ninclude::p[]\n== Title more\n--\n",
    ],
    [
      "a list item",
      "* item\n+\ninclude::p[]\n== Title\nmore\n",
      "* item\n+\ninclude::p[]\n== Title more\n",
    ],
  ])("a heading under an include in %s folds", async (_name, input, out) => {
    await expectFormatted(input, out);
  });

  // With nothing below it there is nothing to fold into, so the bytes
  // stand exactly as written.
  test.each([
    ["nothing below", "include::p[]\n== Title\n"],
    ["a blank line below", "include::p[]\n== Title\n\nmore\n"],
  ])(
    "a heading under an include with %s keeps its bytes",
    async (_n, input) => {
      await expectFormatted(input, input);
    },
  );

  // A blank line above restores the boundary, and with it the heading
  // and the blank line the printer puts under one.
  test("a blank line restores the heading", async () => {
    await expectFormatted(
      "include::p[]\n\n== Title\nmore\n",
      "include::p[]\n\n== Title\n\nmore\n",
    );
  });

  // The section BELOW the folded one is a real section: the blank
  // line before it is the boundary the oracle reads too.
  test("a later heading past a blank line is still a section", async () => {
    await expectFormatted(
      "include::p[]\n== A\nmore\n\n== B\nbody\n",
      "include::p[]\n== A more\n\n== B\n\nbody\n",
    );
  });
});

/**
 * Issue #230: block metadata between the include and the construct.
 * `parse_block_metadata_line` takes four line shapes before
 * `next_block`'s ladder starts, and the oracle's paragraph swallows
 * two of them: a `.Title` and an attribute entry are plain text
 * inside an open paragraph, while a block anchor and an attribute
 * list END one (`StartOfBlockProc`, parser.rb l.36, whose
 * `BlockAttributeLineRx` arm matches `[[a]]` as well as `[NOTE]`).
 *
 * So the two that do not end it are held off with the rest, and the
 * two that do keep their reading. Before that, `include::p[]` over
 * `.Title` over `___` printed `'''` where the oracle renders an
 * italic underscore, and the same shape with `:name: v` printed the
 * break AND a blank line above it.
 */
describe("block metadata between an include and the construct", () => {
  test.each([
    [
      "a block title",
      "include::p[]\n.Title\n___\n",
      "include::p[]\n.Title ___\n",
    ],
    [
      "an attribute entry",
      "include::p[]\n:name: v\n___\n",
      "include::p[]\n:name: v ___\n",
    ],
    [
      "two attribute entries",
      "include::p[]\n:a: 1\n:b: 2\n___\n",
      "include::p[]\n:a: 1 :b: 2 ___\n",
    ],
    [
      "a comment and a block title",
      "include::p[]\n// c\n.Title\n___\n",
      "include::p[]\n// c\n.Title ___\n",
    ],
    [
      "a block title over a setext pair",
      "include::p[]\n.Title\nTitle\n-----\n",
      "include::p[]\n.Title Title\n\n----\n----\n",
    ],
    [
      "a block title over a heading",
      "include::p[]\n.Title\n== T\nmore\n",
      "include::p[]\n.Title == T more\n",
    ],
  ])("%s does not restore the boundary", async (_name, input, out) => {
    await expectFormatted(input, out);
  });

  // The two that END the oracle's paragraph put the break back at a
  // real boundary, so it canonicalizes exactly as it does with no
  // include in the document at all.
  test.each([
    [
      "an attribute list",
      "include::p[]\n[NOTE]\n___\n",
      "include::p[]\n[NOTE]\n'''\n",
    ],
    [
      "a block anchor",
      "include::p[]\n[[a]]\n___\n",
      "include::p[]\n[[a]]\n'''\n",
    ],
  ])("%s restores it", async (_name, input, out) => {
    await expectFormatted(input, out);
  });

  // A blank line after the metadata restores it too, and the title
  // keeps the blank the oracle needs to read it as one.
  test("a blank line under the metadata restores it", async () => {
    await expectFormatted(
      "include::p[]\n.Title\n\n___\n",
      "include::p[]\n.Title\n\n'''\n",
    );
  });
});
