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
  // TWO ROWS WHOSE BYTES MOVED with issue #262, and one reason moves
  // both: the run is the item's first BLOCK now, so the ordinary
  // block printer writes it where a replay of raw text tokens used
  // to. Neither RENDER changes - a paragraph's two lines join with
  // the space the render puts between them anyway, and a line comment
  // renders nothing at all - and both spellings are the ones every
  // other paragraph and every other line comment in the tree already
  // gets, so what moved is the run onto the same footing as its
  // neighbours.
  //
  // The second is also the control for the edge this arm could
  // over-refuse: a REAL `//` run above the same `+` takes the same
  // arm, and its line must still print where it stood rather than
  // move or vanish. The other edge - no marker item over the run at
  // all, where the classifier governs and `///c` is ordinary text -
  // is the `a plain paragraph` row of the describe above.
  test.each([
    [
      "two near-miss comments pack as the one paragraph they are",
      "* a\n///c\n///d\n+\nb\n",
      "* a\n///c ///d\n+\nb\n",
    ],
    [
      "a real comment run above the + stays where it stood (control)",
      "* a\n//c\n+\nb\n",
      "* a\n// c\n+\nb\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});

// The run is the item's first block and the printed item ends on it,
// so a re-read of those bytes alone finds the run reaching the
// buffer's end - the DROP arm, where the `<p>` the run rendered is
// gone (issues #262, #259). The `+` the author wrote under the blank
// is what stopped that drop, and the printer writes it back in the
// detached spelling: a blank line, then the byte.
//
// Every row here came back WITHOUT the `+` before that arm existed,
// so every one of them rendered an item with no paragraph in it where
// both programs render one.
describe("a marker item's drainable body keeps the + that shields it", () => {
  test.each([
    ["a bare ///", "* a\n///\n\n+\n"],
    ["a near miss with text", "* a\n///c\n\n+\n"],
    ["four slashes", "* a\n////x\n\n+\n"],
    ["an olist item", ". a\n///c\n\n+\n"],
    ["a real comment above the near miss", "* a\n// c\n///d\n\n+\n"],
    ["a real comment below the near miss", "* a\n///d\n// c\n\n+\n"],
    ["a sibling item under the shield", "* a\n///c\n\n+\n* b\n"],
    ["a nested list under the shield", "* a\n///c\n\n+\n** b\n"],
    ["a paragraph inside the item", "* a\n///c\n\n+\n\npara\n"],
    [
      "a block attribute line inside the item",
      "* a\n///c\n\n+\n[role]\npara\n",
    ],
    // Issue #267. RED until the shield read the RECORDED drain fact:
    // the two predicates it replaced asked whether every word of the
    // run's paragraph carried a `//` head, and each of these four
    // bodies carries something else - a second word, a hard break, a
    // formatting span, a macro - so the shield was withheld and every
    // one of them lost its paragraph from the render. The drain takes
    // all four by their LINE's head, which is the question the fact
    // records.
    ["a second word on the run's line", "* a\n///c x\n\n+\n"],
    ["a hard break in the run", "* a\n/// +\n\n+\n"],
    ["a formatting span in the run", "* a\n///*b*\n\n+\n"],
    ["a macro in the run", "* a\n///https://x[y]\n\n+\n"],
    ["a second word under an ordered marker", ". a\n///c x\n\n+\n"],
    ["a second word above a sibling", "* a\n///c x\n\n+\n* b\n"],
    ["a second word and a detached paragraph", "* a\n///c x\n\n+\n\n\npara\n"],
    [
      "a hard break and a detached section title",
      "* a\n/// +\n\n+\n\n\n== S\n",
    ],
  ])("%s stays byte for byte", async (_name, input) => {
    await expectFormatted(input, input);
  });
  // The blank count under the shield is the separator rule's, not the
  // writer's: the printed `+` is a live continuation, so ONE blank
  // line under it attaches the next block to the item on re-read
  // (parser.rb l.1483) and two detach it. Each row here keeps its
  // block OUTSIDE the item, which is what the source spelled; with
  // the shield written and the separator left at one blank, the
  // listing row read its `----` into the item's own buffer.
  test.each([
    ["a paragraph", "* a\n///c\n\n+\n\n\npara\n"],
    ["a listing block", "* a\n///c\n\n+\n\n\n----\nl\n----\n"],
    ["a section title", "* a\n///c\n\n+\n\n\n== S\n"],
    ["block metadata", "* a\n///c\n\n+\n\n\n[role]\npara\n"],
  ])("%s under the shield keeps its two blank lines", async (_name, input) => {
    await expectFormatted(input, input);
  });
  // The `+` the source wrote in an ADJACENT pair comes back as the
  // one detached byte instead: the pop takes the second of the pair
  // and renders neither (parser.rb l.1580-82), and what the item
  // needs is a shield the pop can absorb.
  test("an adjacent pair under the run comes back detached", async () => {
    await expectFormatted(
      "* a\n///c\n+\n+\n\npara\n",
      "* a\n///c\n\n+\n\n\npara\n",
    );
  });
  // Issue #268: the same pair BEHIND the blank. Both bytes come back,
  // adjacent, which is the shape the source wrote and the shape the
  // re-read collapses back to - the second `+` freezes on the first
  // (parser.rb l.1443-46) and the pop takes it, leaving the erased
  // one standing over the run. The item wrote ONE `+` here until the
  // reader reported the pair, and one adjacent `+` is no shield at
  // all: the pop took it and the run reached the buffer's end again,
  // so the paragraph left the render. The shield stands DOWN for a
  // tail the item already prints, because that tail ends the item on
  // a live `+` just as the shield would.
  test.each([
    ["a near miss with text", "* a\n///c\n\n+\n+\n", "* a\n///c\n+\n+\n"],
    ["a bare ///", "* a\n///\n\n+\n+\n", "* a\n///\n+\n+\n"],
    [
      "a second word on the run's line",
      "* a\n///c x\n\n+\n+\n",
      "* a\n///c x\n+\n+\n",
    ],
  ])("%s under a + pair keeps both bytes", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
  // NO BYTE IS INVENTED, and no record says so: the property is held
  // by the two clauses these rows pin between them.
  //
  // The SIBLING rows record `none`, hence `none` writes nothing: the
  // marker line under the run ends the item, so the trailing blank is
  // popped at parser.rb l.1584-85, the run reaches the buffer's end,
  // and the peek loses it (the `dropped` answer, merged into `none`).
  //
  // The NESTED-MARKER row records `detached` and is held by the other
  // clause: `** b` is the item's own second block, so the run's block
  // does not stand behind an empty gap and `bodyIsTheDrainedRun` says
  // no. That is also why a `detached` whole-body run needs no
  // recorded `+`: the trailing blank the peek stops on survives that
  // same strip only where the marker pop at l.1580-82 broke the walk
  // one line under it.
  test.each([
    ["a sibling ends the item", "* a\n///c\n\n* b\n", "* a\n///c\n* b\n"],
    ["a nested marker ends it", "* a\n///c\n\n** b\n", "* a\n///c\n\n** b\n"],
    [
      "a run of two, and a sibling",
      "* a\n///c\n///d\n\n* b\n",
      "* a\n///c\n///d\n* b\n",
    ],
  ])("%s and no + is written", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
  // WHAT THE RUN RENDERS DOES NOT ENTER. A run of true `//` lines
  // renders nothing under either reading, and the byte over it is the
  // author's all the same: a line the re-read loses is a line lost
  // whatever it renders. These rows came back WITHOUT their `+` while
  // the fact carried a `renders` field, which cost 41 documents of
  // the reading-invariant sweep their `cont` token and 7 more one of
  // two, for a rendering both programs agree is unchanged.
  test.each([
    ["a comment run renders nothing", "* a\n// c\n\n+\n"],
    ["a run of two comments renders nothing", "* a\n// c\n// d\n\n+\n"],
    ["a comment run above a detached block", "* a\n// c\n\n+\n\n\npara\n"],
  ])("%s and the byte comes back", async (_name, input) => {
    await expectFormatted(input, input);
  });
  // A run with a line under it was never drained at all, so nothing
  // shields it and the fold is what the source asked for.
  test("a line follows the run, so it folds", async () => {
    await expectFormatted("* a\n///c\nb\n", "* a ///c b\n");
  });
  // The item's own opening line keeps the words the source put on it,
  // for the reason the drop arm's rows keep theirs
  // (`nextLineNeedsItsPosition`, src/parse/lines/list-item-node.ts): a
  // width break that pushed a word down would stand between the
  // marker line and the run, the drain would stop on THAT line, and
  // the run would fold into the item's text instead of standing as
  // its first block. Each line below is 90 columns, past the 80 the
  // default width allows, and without the guard the item came back
  // wrapped, shielded, and no longer a fixed point.
  //
  // The two rows take DIFFERENT clauses of that guard, which is why
  // both are here. A `///` near miss is a line the two readers
  // disagree about, so the drained-lines clause answers it. A `// c`
  // line they agree on, and only the DETACHED arm answers: with that
  // clause gone the text wraps, the next read finds the run one line
  // lower and records `none`, and the shield's `+` is dropped on the
  // pass after.
  test.each([
    [
      "a near miss",
      "* aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee ffffffffff gggggggggg hhhhhhhhhh\n///c\n\n+\n",
    ],
    [
      "a comment the two readers agree on",
      "* aaaaaaaaaa bbbbbbbbbb cccccccccc dddddddddd eeeeeeeeee ffffffffff gggggggggg hhhhhhhhhh\n// c\n\n+\n",
    ],
  ])("a wide item text is not wrapped over %s", async (_name, input) => {
    await expectFormatted(input, input);
  });
});
