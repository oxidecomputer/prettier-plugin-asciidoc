/**
 * A `//`-headed run (any slash count) at the HEAD of a MARKER item's
 * own buffer, in the two positions where it is not the item's text:
 * last in the buffer, where `Reader#skip_line_comments` drops it
 * entirely before `next_block` ever runs (parser.rb l.1362-71), and
 * ahead of a blank, where the peek puts it back but leaves the item
 * not content-adjacent, so it renders as a block of its own. Split
 * from list-item-blocks.test.ts for size (docs/coding-standards.md's
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
  // #211's fix - for AN ORDINARY TEXT follower only, which is what
  // `unless subsequent_line.empty?` (l.1367) gates. The blank
  // follower is the describe below.
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

// The peek looks past the run and finds a BLANK behind it - and an
// activated `+` is a blank, the erased `ListContinuationPlaceholder`
// of parser.rb l.1439. `unshift_lines` puts the run back, but
// `content_adjacent` stays false, because setting it is guarded by
// `unless subsequent_line.empty?` (l.1366-67). So nothing is folded
// into the item's own text (l.1384) and the run renders as the item's
// FIRST BLOCK: `* a` / `///c` / `+` / `b` is text `a` and two
// paragraphs. Our reader took only the drop arm, so the run rejoined
// the item's text and `wrap` was free to pack it onto the marker
// line, deleting a paragraph from the render (issue #234).
//
// Every row is red before that arm exists and formats to itself
// after: each one used to come back with the run joined onto the
// marker line (`* a ///c` for the first).
//
// A NEAR MISS is what the arm is reachable for. `read_lines_until`
// skips a comment line by the narrower rule - `(line.start_with?
// '//') && !(line.start_with? '///')` (reader.rb:424) - so a true
// `//` line never reached the item's text to be joined in the first
// place, and only three or more slashes survive that far.
describe("a //-headed run above a blank is a marker item's own block", () => {
  test.each([
    ["a ulist item", "* a\n///c\n+\nb\n"],
    ["an olist item", ". a\n///c\n+\nb\n"],
    ["a colist item", "----\nx // <1>\n----\n\n<1> a\n///c\n+\nb\n"],
    ["a nested item", "* a\n** b\n///c\n+\nd\n"],
    ["an item nested behind its own +", "* a\n+\n** b\n///c\n+\nd\n"],
    ["four slashes", "* a\n////c\n+\nb\n"],
    ["a bare ///", "* a\n///\n+\nb\n"],
    ["two near-miss comments in the run", "* a\n///c\n///d\n+\nb\n"],
    ["a real comment behind the near miss", "* a\n///d\n//c\n+\nb\n"],
    ["a second continuation behind the run", "* a\n///c\n+\nb\n+\nd\n"],
    ["adjacent continuations behind the run", "* a\n///c\n+\n+\nb\n"],
    ["a nested list behind the continuation", "* a\n///c\n+\n** n\n"],
    [
      "a listing block behind the continuation",
      "* a\n///c\n+\n----\nx\n----\n",
    ],
  ])("%s stays byte for byte, not joined", async (_name, input) => {
    await expectFormatted(input, input);
  });
  // ONE CONTROL, for the edge this arm could over-refuse: a REAL `//`
  // run above the same `+` takes the same arm, and its lines must
  // still print where they stood rather than move or vanish. The
  // other edge - no marker item over the run at all, where the
  // classifier governs and `///c` is ordinary text - is the `a plain
  // paragraph` row of the describe above, and adding it here again
  // would be the same input under a second name.
  test("a real comment run above the + stays where it stood (control)", async () => {
    await expectFormatted("* a\n//c\n+\nb\n", "* a\n//c\n+\nb\n");
  });
});
