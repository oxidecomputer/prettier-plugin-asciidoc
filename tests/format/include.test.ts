import { describe, test, expect } from "vitest";
import { expectFormatted, formatAdoc } from "../helpers.js";

describe("include directive formatting", () => {
  // Basic include preserved as-is.
  test("basic include preserved", async () => {
    const input = "include::path/to/file.adoc[]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Include with lines option preserved.
  test("include with lines option preserved", async () => {
    const input = "include::file.txt[lines=5..10]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Include with tag option preserved.
  test("include with tag option preserved", async () => {
    const input = "include::file.txt[tag=section-name]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Include with leveloffset preserved.
  test("include with leveloffset preserved", async () => {
    const input = "include::file.adoc[leveloffset=+1]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Include between paragraphs has blank line separation.
  test("include between paragraphs", async () => {
    const input = "Before.\n\ninclude::chapter.adoc[]\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

/**
 * Issues #210 and #213: a layout break and a setext title are read at a
 * BLOCK BOUNDARY and nowhere else, and an `include::` line is the one
 * line above which no formatter can prove there is one. Every other
 * line the reader consumes is either content (which opens a paragraph
 * the line below then sits inside) or DELETED from the stream by the
 * preprocessor (a `//` comment, an `ifdef::`/`endif::` pair), while an
 * include is REPLACED by the target's own lines - the unresolved
 * spelling the oracle here substitutes included - and whatever those
 * end with stands directly above the next line.
 *
 * So the two canonicalizers that destroy a spelling (`___` -> `'''`,
 * `Title` over `-----` -> `== Title`) are the two that must not fire
 * there. Both rows below were fidelity failures before the
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
