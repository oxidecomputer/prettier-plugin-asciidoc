/**
 * The line directly UNDER a marker item's opening line, and the two
 * readings that turn on its standing there
 * ({@link ListItemNode.nextLineNeedsItsPosition}, carries the Ruby
 * argument for each; the printer's move is
 * {@link keepFirstSourceLineWhole}).
 *
 * BEFORE the recorded fact every row in the first block was a render
 * loss at a narrow width: the item's text wrapped, a text line landed
 * on the line the follower had held, and the follower stopped being
 * what it was. `* aaa bbb ccc` over `image::a.png[]` at width 12
 * printed `* aaa bbb` / `  ccc` / `image::a.png[]`, whose render is
 * one paragraph reading `aaa bbb ccc image::a.png[]` where the input
 * rendered an image block inside the item. The `///` rows lost the
 * other direction: the line renders as NOTHING under the item's text
 * and as the text's own last words one line lower.
 *
 * WHICH PROGRAM reads it that way differs by row, and the rows are
 * pinned against the one the suite renders through. The anchor and
 * `///` rows behave identically in the Ruby gem 2.0.26 and in the
 * pinned instrument. The block-macro rows do NOT: the gem reads a
 * macro under an item's text as prose at both positions (`text_only`,
 * parser.rb l.1368-1374) and loses nothing to the wrap, while the
 * instrument opens a block at the first position and does. The oracle
 * wins on results, the divergence is recorded at
 * {@link LIST_ITEM_FIRST_LINE_INTERRUPTERS}, and the guard inherits
 * that row rather than carrying a case for the macro.
 *
 * The second block is the over-refusal net, one row per shape family
 * the guard must leave alone: a delimiter and a nested marker end the
 * item's text from any position, a `//` comment is dropped from any
 * position, and a follower behind a blank is no follower at all.
 * Removing the width refusal reds every row of the first block, and
 * widening it to "the item holds any block" reds two rows of the
 * second (the nested marker and the block attribute line); the other
 * three hold no block at that boundary and are the net's reach
 * against a different widening.
 *
 * Every row goes through {@link expectFormatted}, so each pins the
 * bytes, render-equality against the input, and idempotence.
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

describe("a follower whose reading needs its position", () => {
  test.each([
    // A block macro the instrument reads as a block on the first line
    // under the item's text and as prose below it (the gem reads
    // prose at both; see the header), so the text may not wrap off
    // its own line however narrow the budget.
    ["* aaa bbb ccc\nimage::a.png[]\n"],
    ["* aaa bbb ccc\ntoc::[]\n"],
    [". aaa bbb ccc\nimage::a.png[]\n"],
    // Same shape behind a comment run: `next_block`'s metadata loop
    // and `read_paragraph_lines` both drop a `//` line, so the macro
    // is still the line the position decides on.
    ["* aaa bbb ccc\n// c\nimage::a.png[]\n"],
    // A block anchor is the mirror, and both programs read it so:
    // `fold_first` merges it into the item text on that line, and one
    // line lower it annotates a block of its own.
    ["* aaa bbb ccc\n[[anc]]\npara words\n"],
    // A `///` line the head drain took, again read alike by both.
    // `skip_line_comments` tests a bare `//` prefix; the paragraph
    // reader's rule does not take `///` (reader.rb l.424), so one
    // line lower it keeps the line as text.
    ["* aaa bbb ccc\n/// note\n"],
    ["* aaa bbb ccc\n//// x\n"],
  ])("keeps the item's opening line whole: %j", async (input: string) => {
    await expectFormatted(input, input, { printWidth: 12 });
  });

  test.each([
    // A delimiter ends the item's text from any position.
    [
      "* aaa bbb ccc\n----\ncode\n----\n",
      "* aaa bbb\n  ccc\n\n----\ncode\n----\n",
    ],
    // So does a nested marker.
    ["* aaa bbb ccc\n** nested\n", "* aaa bbb\n  ccc\n** nested\n"],
    // A `//` comment is dropped wherever it stands.
    ["* aaa bbb ccc\n// note\n", "* aaa bbb\n  ccc\n// note\n"],
    // A block attribute line ends the text from any position too.
    [
      "* aaa bbb ccc\n[source]\n----\nx\n----\n",
      "* aaa bbb\n  ccc\n[source]\n\n----\nx\n----\n",
    ],
    // A blank in front of the macro puts it outside the item, so no
    // line count between the two decides anything.
    [
      "* aaa bbb ccc\n\nimage::a.png[]\n",
      "* aaa bbb\n  ccc\n\nimage::a.png[]\n",
    ],
  ])("still wraps under %j", async (input: string, expected: string) => {
    await expectFormatted(input, expected, { printWidth: 12 });
  });

  test("folds an item whose macro already sits below a text line", async () => {
    // The FOLD direction of the same boundary, and it needs no guard:
    // with a text line above it the macro is prose to both programs,
    // and the join that puts it on the item's own line keeps it
    // prose.
    await expectFormatted(
      "* aaa bbb\n  ccc\nimage::a.png[]\n",
      "* aaa bbb ccc image::a.png[]\n",
      { printWidth: 40 },
    );
  });
});
