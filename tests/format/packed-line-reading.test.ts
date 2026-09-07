/**
 * THE LINE THE PACKER IS ABOUT TO WRITE, read back by the reader that
 * read the source.
 *
 * Every row here is a document whose greedy layout holds a line the
 * reader does not read as the block's own text, so the block is
 * written back from its own source lines instead. They are byte pins
 * for what the packer now refuses, and each was a corruption before
 * the refusal existed: the whole-line question cannot be asked of a
 * WORD, which is all the print-side predicates ever had.
 *
 * Each row states what the line the packer would otherwise have
 * written reads as, because that is the fact the pin is about; the
 * bytes are the same either way once the block is replayed.
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

describe("a packed line the reader would read as something else", () => {
  // Issue #109's own repro, and the FIRST output line rather than a
  // wrapped one: the paragraph is one source line, the packer wraps
  // it at 80 columns, and what it writes first ends at the `yy]` that
  // closes the `[x]` its first word opened. That line is a block
  // attribute list, so the paragraph became metadata and a second
  // paragraph. No question about a WORD reaches it - the `[` and the
  // `]` are fourteen words apart - and no question about a
  // CONTINUATION line reaches it either, because the line is the
  // block's first.
  test("a first output line that ends at a bracket is not written", async () => {
    const witness =
      "[x] wwww wwww wwww wwww wwww wwww wwww wwww wwww wwww wwww wwww wwww wwww yy] zzzz zzzz\n";
    await expectFormatted(witness, witness, { printWidth: 80 });
  });

  // The mirror: the same shape one word shorter on the first line, so
  // the `]` does not close it, and the paragraph packs as prose.
  test("and the same words pack where the line they make is prose", async () => {
    await expectFormatted("[x] aaa yy] bbb ccc\n", "[x] aaa yy] bbb ccc\n", {
      printWidth: 80,
    });
  });

  // Issue #109. The greedy layout at this width is `aaa bbb`, then
  // `[x y]`, then `ccc`; the middle line is a BLOCK ATTRIBUTE LINE,
  // which is decided by a `[` at its head AND a `]` at its end, so no
  // rule over the word a line STARTS with can see it. Before the
  // refusal the paragraph came out as prose, a block attribute list
  // and more prose, and the `[x y]` annotated the block below it.
  test("a wrapped line that ends at a bracket is not written", async () => {
    await expectFormatted("aaa bbb [x\ny] ccc\n", "aaa bbb [x\ny] ccc\n", {
      printWidth: 8,
    });
  });

  // The same block one width wider, so the whole of it fits on one
  // line: `aaa bbb [x y] ccc` is not a block attribute line (its `]`
  // is not at the end), the layout is accepted, and the join happens.
  // The pair is what stops the row above from passing on a formatter
  // that refuses every bracket.
  test("and the same words join where the line they make is prose", async () => {
    await expectFormatted("aaa bbb [x\ny] ccc\n", "aaa bbb [x y] ccc\n", {
      printWidth: 80,
    });
  });

  // Issue #121. The `+` opens a paragraph whose second source line is
  // an INDENTED `----`. Written back at column 0 the line opens a
  // listing block, and the space that kept it prose is gone; the
  // No per-word probe could trade the break away: the `----` is a
  // delimiter only once its indent is gone, which is a fact about the
  // LINE the packer would write and not about a word.
  test("a de-indented delimiter under a lone plus is not written", async () => {
    await expectFormatted("+\n ----\n", "+\n ----\n");
  });

  // Issue #161's whole family. `  ** z` inside a `+`-attached
  // paragraph is a marker line of a list that is not open around it:
  // the reader keeps it on its own line because
  // `read_lines_for_list_item` flips `within_nested_list` on it, and
  // a packer that moves a marker onto a line the author did not write
  // it on changes what the next `+` means.
  test("a foreign marker line keeps the column the author gave it", async () => {
    await expectFormatted(
      "* a\n+\npara\n** b\n  ** z\n",
      "* a\n+\npara\n** b\n  ** z\n",
    );
  });

  // The same family with a comment where the marker's neighbour was,
  // which is the arm whose signature the reading ledger recorded as
  // `[] -> [textv]` rather than `[text] -> [textv]`.
  test("and does so under a comment line as well", async () => {
    await expectFormatted(
      "* a\n+\npara\n// c\n  ** z\n",
      "* a\n+\npara\n// c\n  ** z\n",
    );
  });

  // The mirror rows: a line the reader DOES read as the block's own
  // text is written, and the refusal is not a blanket one. At
  // document level a paragraph breaks on `StartOfBlockProc`
  // (parser.rb l.36), which holds a delimited-block line and a block
  // attribute line and nothing else, so a marker line mid-paragraph
  // is prose to Asciidoctor and to this formatter alike.
  test("a marker line mid-paragraph is the paragraph's own words", async () => {
    await expectFormatted(
      "aaa bbb ccc ddd\n* eee\n",
      "aaa bbb ccc\nddd * eee\n",
      {
        printWidth: 12,
      },
    );
  });
});
