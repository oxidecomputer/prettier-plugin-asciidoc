/**
 * The indent a paragraph's SECOND source line carries is DATA, the way
 * `ParagraphNode.firstWordEndsItsLine` is: the reader measured the
 * line, `ParagraphNode.secondLineIndent` carries the run's bytes, and
 * the block-start hazard net writes them back in front of the atom
 * whose break it keeps.
 *
 * The indent is load-bearing because of where Ruby tests it.
 * `next_block` decides a line's shape from the line INCLUDING its
 * leading whitespace - `indented = this_line.start_with? ' ', TAB`
 * (parser.rb l.572) - and every delimiter, table and comment-block
 * opener is anchored at column 0: `is_delimited_block?` keys on
 * `line.slice 0, 2` (parser.rb l.976-978), which is the line's FIRST
 * two bytes and not its first two non-blank ones. So ` ----` is
 * paragraph text and `----` is a listing delimiter, ` |===` is text
 * and `|===` opens a table, ` ////` is text and `////` opens a
 * comment block.
 *
 * The net (src/print/block-start-hazard.ts) is what exposes them. It
 * fires exactly where the packed line `atoms[0] atoms[1]` would
 * re-read as block syntax - `.` then `[x]` packs to `. [x]`, an
 * ordered list item; `===` then `====` packs to `=== ====`, a section
 * title - and its remedy is to put the source's own break back. Before
 * the indent was recorded the net had nothing to write in front of the
 * atom it stranded, so it traded one corruption for another: the
 * second line went to column 0 and became the very block the author's
 * single space had kept it from opening (issue #121).
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

describe("a paragraph's indented second line keeps its indent", () => {
  // Red before `secondLineIndent`: all twenty rows printed their second
  // line at column 0. SEVENTEEN of the twenty changed what the document
  // renders as - the three exceptions are the group labelled
  // "Render-equal today" below, and they are named there - and sixteen
  // lost their fixed point as well, the second pass reading a real
  // block where the first had read prose.
  test.each([
    // The issue's own two repros, re-verified on main 8a3abeb2f2ff.
    ["a block attribute list", ".\n [x]\n"],
    ["an example delimiter", "===\n ====\n"],
    // The delimiter, table and comment-block family the reopened
    // issue names: one leading space is the whole of what keeps each
    // line from opening its construct.
    ["a listing delimiter", ".\n ----\n"],
    ["a comment block", ".\n ////\n"],
    ["a psv table", ".\n |===\n"],
    ["a csv table", ".\n ,===\n"],
    ["a sidebar delimiter", "-\n ****\n"],
    ["an open block", ".\n --\n"],
    ["a listing delimiter under a heading near-miss", "===\n ----\n"],
    ["a listing delimiter under a list-marker near-miss", "*\n ----\n"],
    ["an example delimiter under a level-1 near-miss", "==\n ====\n"],
    ["a comment block under a hash", "#\n ////\n"],
    ["a block anchor", ".\n [[a]]\n"],
    ["a line comment", ".\n // c\n"],
    // Render-equal today, byte-losing all the same: the run is the
    // author's and the printer has no reason left to drop it. These
    // THREE are the whole of the render-equal set - a block title with
    // no block under it renders nothing either way, an attribute entry
    // sets an attribute nobody reads either way, and
    // `MarkdownThematicBreakRx` (rx.rb l.638) opens ` {0,3}`, so ` ***`
    // and `***` are the same `<hr>`.
    ["a block title", ".\n .Title\n"],
    ["an attribute entry", ".\n :a: v\n"],
    ["a markdown thematic break", ".\n ***\n"],
    // Perturbations of the run itself. A TAB is `indented` to
    // parser.rb l.572 exactly as a space is, and a wider run is the
    // same line; the bytes travel rather than a width, so each comes
    // back as written.
    ["a tab", ".\n\t[x]\n"],
    ["a wider run", ".\n   [x]\n"],
    ["a space then a tab", ".\n \t[x]\n"],
  ])("%s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // The net's precondition is unchanged, so a paragraph it does not
  // fire on reflows as it always did: the indent of a line that gets
  // JOINED is whitespace between two words, and the join writes the
  // one space Asciidoctor renders anyway.
  test.each([
    ["a joined second line", "para\n ----\n", "para ----\n"],
    ["a joined table opener", "para\n |===\n", "para |===\n"],
    ["no indent to keep", ".\n[x] y\n", ".\n[x] y\n"],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});
