/**
 * Format tests for the `// prettier-ignore` pragma.
 *
 * The pragma is an AsciiDoc line comment standing above a block, with
 * block metadata lines allowed between the two. The block it names,
 * and everything nested inside it, is written back from the source
 * instead of being formatted. These rows pin what that means for each
 * block shape, that the pragma line itself renders nothing, and that a
 * second format pass finds the same pragma on the same block.
 *
 * The pragma exists for users of the plugin. Nothing else in this
 * repository may reach for it to sidestep a formatting defect, so
 * every fixture here is about the pragma itself: each one pairs an
 * IGNORED spelling with the same input formatted normally, so the row
 * fails if the pragma stops changing anything.
 */
import { describe, expect, test } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Five successive formats of one input. The bug these rows exist for
 * grew the output by one blank line per pass, so a pair of passes
 * could agree while the third moved; naming every pass says which one
 * first did. Chained rather than looped because a loop here is an
 * `await` inside one.
 * @param input - the document to format
 * @returns the five outputs, in pass order
 */
async function fivePasses(input: string): Promise<string[]> {
  const first = await formatAdoc(input);
  const second = await formatAdoc(first);
  const third = await formatAdoc(second);
  const fourth = await formatAdoc(third);
  const fifth = await formatAdoc(fourth);
  return [first, second, third, fourth, fifth];
}

describe("the ignore pragma writes a block's source back", () => {
  // A paragraph is the leaf case: reflow is the formatter's most
  // visible opinion, and the pragma turns it off for this one block
  // while the paragraph below it still reflows.
  test("a paragraph keeps its own line breaks and spacing", async () => {
    const input =
      "// prettier-ignore\nsome    text\nmore   text\n\nafter    here\n";
    await expectFormatted(
      input,
      "// prettier-ignore\nsome    text\nmore   text\n\nafter here\n",
    );
    expect(await formatAdoc(input.slice("// prettier-ignore\n".length))).toBe(
      "some text more text\n\nafter here\n",
    );
  });

  // "The block plus its children": a delimited block's extent covers
  // its delimiters and every block nested inside it, so one pragma
  // above the opening delimiter freezes the whole interior.
  test("a delimited block keeps its nested blocks", async () => {
    const input =
      "// prettier-ignore\n====\nnested   para\n\n*   a\n*    b\n====\n\nafter\n";
    await expectFormatted(input, input);
    expect(await formatAdoc(input.slice("// prettier-ignore\n".length))).toBe(
      "====\nnested para\n\n*   a\n*    b\n====\n\nafter\n",
    );
  });

  // A list is one block, so the pragma covers every item and every
  // nested list under it.
  test("a whole list keeps its item text", async () => {
    const input =
      "// prettier-ignore\n* item   one\n* item    two\n** nested   item\n\nafter\n";
    await expectFormatted(input, input);
    expect(await formatAdoc(input.slice("// prettier-ignore\n".length))).toBe(
      "* item one\n* item two\n** nested item\n\nafter\n",
    );
  });

  // A table's cell padding is the formatter's own layout decision;
  // under the pragma the author's columns stand as written.
  test("a table keeps its cell spacing", async () => {
    const input =
      "// prettier-ignore\n|===\n| a |   b\n| c | d\n|===\n\nafter\n";
    await expectFormatted(input, input);
    expect(await formatAdoc(input.slice("// prettier-ignore\n".length))).toBe(
      "|===\n|a |b\n|c |d\n|===\n\nafter\n",
    );
  });

  // Sections are not modeled: a heading is a leaf block (see the AST
  // section of docs/architecture.md), so the pragma covers the heading
  // LINE and nothing under it. The body paragraph below still reflows,
  // which is what this row pins.
  test("a heading is the leaf its extent covers, not the section", async () => {
    const input = "// prettier-ignore\n==   Sec\n\nbody    here\n\n== Next\n";
    await expectFormatted(
      input,
      "// prettier-ignore\n==   Sec\n\nbody here\n\n== Next\n",
    );
  });

  // Metadata lines between the pragma and the block go back as they
  // were written too: the attribute list keeps its space after the
  // comma, which the formatter otherwise removes, and the block title
  // keeps its run of spaces.
  test("metadata lines between the pragma and the block replay", async () => {
    const input =
      "// prettier-ignore\n[source, ruby]\n.A   Title\n----\nputs   1\n----\n\nafter\n";
    await expectFormatted(input, input);
    expect(await formatAdoc(input.slice("// prettier-ignore\n".length))).toBe(
      "[source,ruby]\n.A   Title\n----\nputs   1\n----\n\nafter\n",
    );
  });

  // The pragma reaches wherever blocks are read, not only the top
  // level: a delimited block's interior is read by a reader of its
  // own, and the pragma inside it covers one interior block.
  test("a pragma inside a delimited interior covers one interior block", async () => {
    const input =
      "====\n// prettier-ignore\nkept    as    written\n\nreflowed    here\n====\n";
    await expectFormatted(
      input,
      "====\n// prettier-ignore\nkept    as    written\n\nreflowed here\n====\n",
    );
  });

  // A list item's attached blocks are read by a confined reader too,
  // so a pragma under a `+` continuation covers the block it attaches.
  test("a pragma inside a list item covers the attached block", async () => {
    const input =
      "* item\n+\n// prettier-ignore\nattached    para\n\nafter    here\n";
    await expectFormatted(
      input,
      "* item\n+\n// prettier-ignore\nattached    para\n\nafter here\n",
    );
  });
});

describe("what the ignore pragma does not do", () => {
  // Prettier's convention is an exact pragma. A comment that merely
  // mentions it is an ordinary comment, and the paragraph below it
  // reflows.
  test("a comment that only contains the pragma text is not one", async () => {
    await expectFormatted(
      "// prettier-ignore please\nsome    text\n",
      "// prettier-ignore please\nsome text\n",
    );
  });

  // The pragma names the block BELOW it. A trailing pragma names
  // nothing and is just a comment.
  test("a pragma with no block under it changes nothing", async () => {
    await expectFormatted(
      "some    text\n\n// prettier-ignore\n",
      "some text\n\n// prettier-ignore\n",
    );
  });

  // One pragma, one block: the block after the ignored one formats
  // normally.
  test("the pragma covers exactly one block", async () => {
    await expectFormatted(
      "// prettier-ignore\nfirst    para\n\nsecond    para\n",
      "// prettier-ignore\nfirst    para\n\nsecond para\n",
    );
  });

  // A list ITEM is not a block, and a comment line between two items
  // is not one either: Asciidoctor reads it into the item above as
  // part of that item's own lines, so the tree holds it as a `rawLine`
  // inside the first item's text. There is nothing for a pragma to
  // attach to there, and the second item reflows. Pinned so the answer
  // is recorded rather than rediscovered: the unit a pragma names is a
  // block, and covering an item would mean a different unit.
  test("a pragma between two list items names no block", async () => {
    await expectFormatted(
      "* a\n// prettier-ignore\n* b    c\n",
      "* a\n// prettier-ignore\n* b c\n",
    );
  });
});

describe("a block that runs to end of input", () => {
  // RED BEFORE THE TRAILING-NEWLINE STRIP in ignoredSource
  // (src/print/printer.ts). A block the author never closed has an
  // extent that reaches end of input, its trailing newline included,
  // so splitting the slice on newlines produced a trailing empty
  // string and the printer wrote it as a blank line. The next pass
  // then sliced one more newline than the last: the output grew a
  // blank line per pass, with no limit. Measured that way for every
  // unterminated opener (`====`, `----`, `--`, `****`, `____`, `|===`,
  // `////`); two openers are pinned here and a third below.
  test("an unterminated example block is a fixed point", async () => {
    const input = "// prettier-ignore\n====\ninner    text\n";
    await expectFormatted(input, input);
  });

  test("an unterminated listing block is a fixed point", async () => {
    const input = "// prettier-ignore\n----\ninner    text\n";
    await expectFormatted(input, input);
  });

  // Five passes rather than the two expectFormatted runs: the growth
  // was one blank line per pass, so a pair of passes that agreed would
  // still have left the third moving.
  test("five passes of an unterminated block change nothing", async () => {
    const input = "// prettier-ignore\n****\ninner    text\n";
    expect(await fivePasses(input)).toEqual([
      input,
      input,
      input,
      input,
      input,
    ]);
  });
});

describe("blank lines at end of file", () => {
  // A block the author left OPEN is force-closed at end of input, so
  // the blank lines standing above that point are its verbatim
  // INTERIOR: block bytes, which the pragma exists to preserve. They
  // come back exactly as written, however many there are.
  test("an open block replays its trailing blanks", async () => {
    const plusTwo = "// prettier-ignore\n----\ninner    text\n\n\n";
    const plusThree = "// prettier-ignore\n----\ninner    text\n\n\n\n";
    await expectFormatted(plusTwo, plusTwo);
    await expectFormatted(plusThree, plusThree);
  });

  // Five passes rather than the two expectFormatted runs, for the
  // reason the row above this describe gives: the bug this guards
  // moved the output by one blank line per pass.
  test("five passes of either spelling change nothing", async () => {
    const plusTwo = "// prettier-ignore\n----\ninner    text\n\n\n";
    const plusThree = "// prettier-ignore\n----\ninner    text\n\n\n\n";
    expect(await fivePasses(plusTwo)).toEqual([
      plusTwo,
      plusTwo,
      plusTwo,
      plusTwo,
      plusTwo,
    ]);
    expect(await fivePasses(plusThree)).toEqual([
      plusThree,
      plusThree,
      plusThree,
      plusThree,
      plusThree,
    ]);
  });

  // The one newline the replay drops is the one the document printer
  // writes back: a closed block's extent stops at its closing
  // delimiter, so the blanks below it are the document's and normalize
  // to one final newline, pragma or no pragma.
  test("a closed block ends its extent, so the pragma changes nothing", async () => {
    const ignored = "// prettier-ignore\n----\ninner    text\n----\n";
    await expectFormatted(`${ignored}\n\n`, ignored);
    await expectFormatted(`${ignored}\n\n\n`, ignored);
    const plain = "----\ninner    text\n----\n";
    await expectFormatted(`${plain}\n\n`, plain);
    await expectFormatted(`${plain}\n\n\n`, plain);
  });

  // The same open block without a pragma, so the row says what the
  // pragma does and does not change here: the formatter supplies the
  // closing delimiter the author omitted, and that is the whole
  // difference. Every interior byte, the two blank lines included, is
  // the same either way.
  test("without a pragma the same block differs only by its closing delimiter", async () => {
    const source = "// prettier-ignore\n----\ninner    text\n\n\n";
    const ignored = await formatAdoc(source);
    const plain = await formatAdoc("----\ninner    text\n\n\n");
    await expectFormatted(source, source);
    const interior = ignored.slice("// prettier-ignore\n".length);
    expect(plain).toBe(`${interior}----\n`);
  });
});

describe("which block the pragma reaches", () => {
  // A comment and a preprocessor directive are lines Asciidoctor's
  // reader eats before block parsing, so the pragma reads through them
  // to the block the parser itself would attach the run to.
  test("reads through a comment to the block below it", async () => {
    await expectFormatted(
      "// prettier-ignore\n// a note\nsome    text\n",
      "// prettier-ignore\n// a note\nsome    text\n",
    );
  });

  // A blank line is not a node, so the run crosses it: the pragma
  // still names the paragraph below. Asciidoctor's own metadata run
  // ends at a blank line, so this reaches FURTHER than that loop does.
  // Pinned because it is a boundary a reader would otherwise have to
  // rediscover.
  test("crosses a blank line to the block below it", async () => {
    const input = "// prettier-ignore\n\npara    here\n";
    await expectFormatted(input, input);
  });

  // The other direction of the same gap: an attribute entry is a line
  // Asciidoctor's metadata loop reads through, and this run stops at
  // it, because it is neither block metadata nor a line the reader
  // eats. So the entry is the block the pragma names and the paragraph
  // under it formats normally.
  test("stops at an attribute entry", async () => {
    await expectFormatted(
      "// prettier-ignore\n:attr:   v\npara   here\n",
      "// prettier-ignore\n:attr:   v\n\npara here\n",
    );
  });

  // A `////` comment BLOCK is the second such line, and it stops the
  // run the same way: `skip_line_comments` skips `//` lines only, so
  // the block is a block like any other here.
  test("stops at a comment block", async () => {
    await expectFormatted(
      "// prettier-ignore\n////\ncomment   text\n////\npara   here\n",
      "// prettier-ignore\n////\ncomment   text\n////\n\npara here\n",
    );
  });

  // A document header owns its own lines, and it is a block like any
  // other as far as the pragma is concerned: the author line and the
  // attribute entry under the title go back as written.
  test("covers a document header's whole run of lines", async () => {
    await expectFormatted(
      "// prettier-ignore\n=   Title\nAuthor   Name\n:attr:   v\n\nbody    text\n",
      "// prettier-ignore\n=   Title\nAuthor   Name\n:attr:   v\n\nbody text\n",
    );
  });
});

describe("the pragma line itself", () => {
  // The pragma is an AsciiDoc line comment, so the oracle renders
  // nothing for it: adding one to a document cannot change what the
  // document means.
  test("renders as nothing", async () => {
    // The document with the pragma line against the document without
    // it: two documents, which neither helper compares.
    // eslint-disable-next-line test-assertions/no-hand-spelled-format-trailer -- two documents, not a format row's own input and output
    expect(await renderedHtml("// prettier-ignore\nsome text\n")).toBe(
      await renderedHtml("some text\n"),
    );
  });

  // The comment printer normalizes a missing space after the slashes,
  // so the pragma's own bytes can move. What matters is that the
  // pragma SURVIVES that respelling: the second pass finds the same
  // pragma above the same block, which expectFormatted's fixed-point
  // assertion is what checks.
  test("survives the comment printer's own spelling", async () => {
    await expectFormatted(
      "//prettier-ignore\nsome    text\n",
      "// prettier-ignore\nsome    text\n",
    );
  });
});
