/**
 * A `//`-headed run (any slash count) that is the LAST thing in a
 * MARKER item's own buffer: `Reader#skip_line_comments` drops it
 * entirely before `next_block` ever runs (parser.rb l.1362-71), and
 * the peek restores what it took only when a line follows. Split from
 * list-item-blocks.test.ts for size (docs/coding-standards.md's
 * 450-line response).
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

// The peek takes the whole run and finds nothing behind it to
// restore, so the comment is gone from the item's render (issue
// #211). Our reader used to model `///c` (three slashes; the
// classifier's own `LINE_COMMENT` mirrors `CommentLineRx` and EXEMPTS
// it) as ordinary TEXT there, so it joined onto the item's own text
// and survived into the render the oracle drops it from - already
// the drain's own mechanism for a DESCRIPTION term
// (tests/format/list-item-blocks.test.ts's `///b::` row and
// reader-lists.test.ts); this is the same mechanism, missing for a
// marker item.
describe("a //-headed run ending a marker item's text is dropped, not joined", () => {
  test.each([
    ["a ulist item, three slashes", "* a\n///c\n"],
    ["an olist item, three slashes", "1. a\n///c\n"],
    ["nested under a textless dlist term", "term::\n* a\n///c\n"],
    ["two comments in the run, one real and one near-miss", "* a\n//c\n///d\n"],
    ["two near-miss comments in the run", "* a\n///c\n///d\n"],
  ])("%s stays byte for byte, not joined", async (_name, input) => {
    await expectFormatted(input, input);
  });
  // TWO CONTROLS, so a fix here cannot over-refuse the shapes it must
  // leave alone. Paragraph position: the classifier's narrower Rx
  // governs there (not the item-buffer peek), so `///c` is ordinary
  // text on EITHER side of the join and stays joined. Item position
  // with a line BEHIND the run: the peek restores what it took once
  // it finds a non-empty line there (parser.rb l.1364-65), so the run
  // rejoins the item's own text exactly as it already did before
  // #211's fix - for AN ORDINARY TEXT follower only. A `+`-continuation
  // follower is a different, still-open shape (`* a` / `///c` / `+` /
  // `text` joins the run where the oracle keeps it a separate block),
  // filed from this lane's review rather than covered by this control.
  test.each([
    ["a plain paragraph", "aaa\n///c\n", "aaa ///c\n"],
    ["a marker item, a line follows", "* a\n///c\nmore\n", "* a ///c more\n"],
  ])(
    "%s joins a trailing near-miss comment (control)",
    async (_n, input, expected) => {
      await expectFormatted(input, expected);
    },
  );
});
