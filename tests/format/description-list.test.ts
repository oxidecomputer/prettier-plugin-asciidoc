/**
 * Description lists, end to end: the bytes, the render and the fixed
 * point, for every surface a `term:: description` item has.
 *
 * A description ITEM is read by the list machinery and its recorded
 * lines are written back, so nearly every row here is a ROUND TRIP -
 * the input is its own output. That is the point rather than an
 * accident: a formatter that replays what it read cannot lose an
 * indent, a comment's column, a hard break's space or a `+` the
 * oracle's own read discards, and each of those was a defect before
 * this reader existed. Where a row's output is NOT its input the
 * comment says which of the two allowed reasons it is: a separator
 * line the reader owns rather than the author (a blank between
 * sibling items, which neither side's read keeps), or a block printed
 * by the machinery it shares with a marker item.
 *
 * Ruby line numbers cite parser.rb at Asciidoctor core 2.0.26, the
 * revision the oracle runs.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Format an input and hold it to all three bars at once: the exact
 * bytes, the oracle's render against the INPUT's, and the fixed
 * point. A row that asserts only bytes is a row that can go green
 * while the render moves.
 * @param input - the source document, newline terminated
 * @param expected - the expected formatted bytes; omit for a
 *   round-trip row, where the input is its own output
 * @param options - Prettier options, for the width-sensitive rows
 * @param options.printWidth - the column budget for an output line
 */
async function expectStable(
  input: string,
  expected: string = input,
  options: { printWidth?: number } = {},
): Promise<void> {
  const once = await formatAdoc(input, options);
  expect(once).toBe(expected);
  expect(await renderedHtml(once)).toBe(await renderedHtml(input));
  expect(await formatAdoc(once, options)).toBe(once);
}

describe("the term line", () => {
  // rx.rb:336's four delimiters, and the two shapes of description a
  // term line can open: one on its own line, one on the next.
  test.each([
    ["the `::` delimiter", "t:: d\n"],
    ["the `:::` delimiter", "t::: d\n"],
    ["the `::::` delimiter", "t:::: d\n"],
    ["the `;;` delimiter", "t;; d\n"],
  ])("%s round-trips", async (_name, input) => {
    await expectStable(input);
  });

  // A description on the NEXT line is a run every reflow condition
  // clears, so it joins its term line. The row keeps no author bytes
  // and claims no replay: what it pins is the join, which is
  // render-equal because `t::` with no inline text reads its
  // description greedily off the lines under it (parser.rb:1551-1556)
  // and both spellings answer the same `dd`.
  test("a description on the next line joins its term line", async () => {
    await expectStable("t::\ndesc\n", "t:: desc\n");
  });

  // `DescriptionListRx` reaches the description through `[ \t]+` or
  // ends the line, so all three spellings are one item to the oracle.
  // WHICH of them comes back turns on the verdict, and the two rows
  // are here together because they are the two answers. `t::d` is no
  // term line at all - the pattern needs a blank or the line's end
  // after the delimiter - so it is a paragraph and its bytes are its
  // own. `t::   d` IS one, its run clears every condition, and the
  // packer writes one space between two words exactly as it does
  // inside the description: the run of spaces the pattern consumes is
  // not part of what it captured.
  test.each([
    ["no term line at all", "t::d\n", "t::d\n"],
    ["a run the packer collapses", "t::   d\n", "t:: d\n"],
  ])("%s decides the spacing", async (_name, input, want) => {
    await expectStable(input, want);
  });

  // The term is a non-greedy group starting at a non-blank
  // (rx.rb:336), so it carries inline formatting, an attribute
  // reference, a leading inline anchor that catalogs on the TERM item
  // (parser.rb:1301-1303), and - binding at the FIRST delimiter - the
  // whole of `a` in `a::b:: c`.
  test.each([
    ["an attribute reference", "{foo}:: bar\n"],
    ["a bold span", "*bold*:: d\n"],
    ["a leading inline anchor", "[[id]]t:: d\n"],
    ["a second delimiter inside the term group", "a::b:: c\n"],
    ["an indent the pattern swallows", "  t:: d\n"],
  ])("with %s the term line is replayed", async (_name, input) => {
    await expectStable(input);
  });
});

describe("the sibling rule", () => {
  // rx.rb:341-343: for `::`, `:::` and `::::` the character before
  // the delimiter must not be a colon, so `a::: y` is NOT a `::`
  // sibling and opens a nested list instead. Three items, two lists.
  test("a longer delimiter opens a nested list", async () => {
    await expectStable("a:: x\na::: y\nb:: z\n");
  });

  // parser.rb:1230-1235: the pair stays open while its description
  // half is nil, so a run of term-only siblings is ONE item.
  test.each([
    ["adjacent term lines", "a::\nb::\nc:: shared\n"],
    ["blank lines between them", "a::\n\nb::\n\nc:: shared\n"],
  ])("a run of textless terms folds, with %s", async (_name, input) => {
    await expectStable(input);
  });

  // The lines BETWEEN two folded term lines belong to the item and to
  // no term's text, and each of the three the gap alphabet spells is
  // a line Ruby deletes and a formatter may not: a comment the head
  // drain took (parser.rb:1363-1371), and a `+` the read loop
  // buffered (:1557-1559) that the post-loop pop discarded
  // (:1580-1582).
  test.each([
    ["a comment", "t::\n///c\nu:: x\n"],
    ["a bare +", "a::\n+\nb:: y\n"],
    ["a blank and a +", "a::\n\n+\nb:: y\n"],
  ])("%s between two folded terms is replayed", async (_name, input) => {
    await expectStable(input);
  });

  // A `+` BETWEEN two items and a `+` INSIDE one are different bytes,
  // and the three rows keep them apart. Behind no blank the `+` is
  // the first item's own trailing continuation and comes back; behind
  // a blank it is detached, attaches to nothing, and Ruby erases it
  // where it stands (:1576), so the printer writes none and the
  // output is a fixed point. Inside a term's gap it is the author's
  // byte the gap alphabet replays, which is the row below it.
  test.each([
    ["adjacent, the first item's own tail", "a:: d\n+\nb:: y\n", undefined],
    ["detached, erased by the read", "a:: d\n\n+\nb:: y\n", "a:: d\nb:: y\n"],
    ["inside a term's gap, replayed", "a::\n\n+\nb:: y\n", undefined],
  ])("a + %s", async (_n, input, want) => {
    await expectStable(input, want);
  });

  // The same gap, inside a marker item's `+`-attached interior, where
  // that read ERASES the `+` it activated (parser.rb:1439, :1576) and
  // leaves the line blank in the copy this scan reads. Red before the
  // gap was spelled from the line's RAW bytes: the `+` came back as a
  // blank, the byte was gone, and the second pass collapsed the two
  // blanks so the document was not a fixed point.
  test.each([
    ["a * item", "* item\n+\na::\n\n+\nb:: y\n"],
    ["a . item", ". item\n+\na::\n\n+\nb:: y\n"],
    ["a - item", "- item\n+\na::\n\n+\nb:: y\n"],
    ["a <1> item", "<1> item\n+\na::\n\n+\nb:: y\n"],
  ])("a term gap inside %s keeps its erased +", async (_n, input) => {
    await expectStable(input);
  });

  // parser.rb:1387: the pair carries nil where the item has neither
  // text nor blocks, which is reachable only on a list's LAST item.
  test("a trailing textless term keeps its own line", async () => {
    await expectStable("d:: x\ne::\n");
  });

  // Both halves of one rule, the blanks and where the list ends.
  // `parse_description_list` has no
  // `skip_blank_lines` between siblings (parser.rb:1228, against
  // :1119-1128 for a marker list) because the item's own read
  // consumed the blanks and its buffer popped them (:1584). So a
  // blank between two items belongs to neither, and the printer
  // writes none; what follows the blanks decides where the list ends,
  // exactly as it does under a marker.
  test("blanks between two items are the reader's, not the author's", async () => {
    await expectStable("a:: x\n\n\nb:: y\n", "a:: x\nb:: y\n");
  });

  test("blanks before a paragraph end the list", async () => {
    await expectStable("a:: x\n\n\nplain\n", "a:: x\n\nplain\n");
  });
});

describe("the item's extent", () => {
  // parser.rb:1551-1556, the greedy arm: a term with no inline
  // description keeps reading PAST a blank line until it has text, so
  // the `'''` a document-level read would call a thematic break is
  // this item's description.
  test("a textless term reads greedily across a blank", async () => {
    await expectStable("== Lists\n\nterm1::\n\n'''\ncontinued\n");
  });

  // parser.rb:1462-1482, both arms of the `[...]` look-ahead. A list
  // item behind the run concatenates it into the item; anything else
  // unshifts it and breaks the item in front of it - and there the
  // attribute line is a block of the document, which the printer
  // separates from the list the way it separates any two blocks.
  test.each([
    ["a nested list follows", "t:: d\n[square]\n* one\n", undefined],
    [
      "a paragraph follows",
      "t:: d\n[square]\npara\n",
      "t:: d\n\n[square]\npara\n",
    ],
  ])("the block-attribute look-ahead, where %s", async (_n, input, want) => {
    await expectStable(input, want);
  });

  // parser.rb:1490-1493: inside a dlist the literal slurp stops at a
  // sibling term ("we may be in an indented list disguised as a
  // literal paragraph"), so the `:::` line - which the `::` sibling
  // pattern does not match - is swallowed by the literal instead.
  test("the literal slurp is sibling-guarded", async () => {
    await expectStable("== Lists\n\nterm1::\n+\n  literal\nnotnestedterm:::\n");
  });
});

describe("what an item attaches", () => {
  test.each([
    ["a + continuation", "t:: d\n+\npara\n"],
    ["a detached +", "t:: d\n\n+\npara\n"],
    ["a stacked detached pair", "t:: d\n\n+\n\n+\npara\n"],
    // The erased shield: the post-loop blanks the last detached `+`
    // (parser.rb:1576) and the tail walk pops the blank cell, so the
    // byte comes back as one blank line and a `+` under the frozen
    // pair it shields. Drop it and the pair's paragraph goes with it
    // on the next read.
    ["a shield behind a frozen + pair", "t:: d\n+\n+\n\n+\n"],
    ["a delimited block", "t:: d\n+\n----\nx\n----\n"],
    ["a titled block", "t:: d\n+\n.Title\npara\n"],
  ])("%s is replayed where it stands", async (_name, input) => {
    await expectStable(input);
  });

  test.each([
    ["a nested description list", "t:: d\nu::: e\n"],
    ["a description list inside a ulist item", "* a\nt:: d\n"],
    ["a ulist inside a description, at column 0", "t:: d\n+\n* one\n* two\n"],
  ])("%s is replayed", async (_name, input) => {
    await expectStable(input);
  });

  // A nested list's markers print at the column the author wrote them
  // at, the same as a marker item's blocks (src/print/list.ts). Under
  // a `+` the indent is not decoration: it decides whether the line
  // below the marker reads as that marker's sibling or as its child
  // (`ListItemNode.markerIndent`), so it is replayed here too.
  test("a ulist inside a description keeps its indent", async () => {
    await expectStable("t:: d\n+\n  * one\n");
  });

  // The enclosing `::` list's sibling pattern would match the JOINED
  // line `b::: item z // p:: q` with the term `b::: item z // p`,
  // which destroys the nested list and mangles the term. Nothing is
  // joined, so nothing is destroyed.
  test("a nested sibling pattern is not given a line to match", async () => {
    await expectStable("a:: x\nb::: item\n  z\n// p:: q\n");
  });
});

describe("an armed + tail under a description", () => {
  // A `+` whose activation ran through block METADATA only keeps
  // `:active` (parser.rb:1499-1501) and never meets the block it was
  // waiting for, so the item's printed tail still shows it. One blank
  // line under such a tail ATTACHES the next block to the item on
  // re-read (the `:active` arm, :1483); only a second detaches it
  // (the after-blank break, :1549). The separator is therefore two
  // blank lines, and the rule is the one a marker item already had -
  // reached for a description item through `lastItemOf`
  // (src/print/join.ts).
  //
  // Red before that: `joinBlocks` read the armed tail off a `list`
  // and off nothing else, so a description list fell through to the
  // one-blank separator, `para` rendered INSIDE the `dd`, and the
  // output was a fixed point, which is why no idempotence or byte
  // pin could have caught it.
  //
  // The textless row is the one whose bytes MOVE, and only above the
  // tail: its run clears every reflow condition, so `a` joins the term
  // line. What the row is about is the two blank lines under `[role]`,
  // and they are the same two either way.
  test.each([
    ["an attribute line", "t:: a\n+\n[role]\n\n\npara\n", undefined],
    ["a block title", "t:: a\n+\n.T\n\n\npara\n", undefined],
    ["a block anchor", "t:: a\n+\n[[anc]]\n\n\npara\n", undefined],
    ["a `;;` term", "t;; a\n+\n[role]\n\n\npara\n", undefined],
    [
      "a textless term",
      "t::\na\n+\n[role]\n\n\npara\n",
      "t:: a\n+\n[role]\n\n\npara\n",
    ],
    ["a folded term pair", "a::\nt:: a\n+\n[role]\n\n\npara\n", undefined],
    [
      "the list inside a ulist item",
      "* o\nt:: a\n+\n[role]\n\n\npara\n",
      undefined,
    ],
  ])("%s keeps both blanks under it", async (_name, input, want) => {
    await expectStable(input, want);
  });
});

describe("the defects the item model dissolves", () => {
  // #89 red-then-green: `t:: d` / `+` / `+` / `** b` / blank / `** c`
  // used to turn the literal `+` and `**` lines of the description
  // into a real nested list, because the description was a paragraph
  // and not an item. As an item, itemExtent's adjacent-`+` freeze
  // (parser.rb:1443-1448) and the reader's continuation fold run, and
  // `** b` folds as prose exactly as it does under a `*` marker.
  test("#89 a frozen + pair keeps its literal lines", async () => {
    await expectStable("t:: d\n+\n+\n** b\n\n** c\n");
  });

  // #115 red-then-green: `t:: item` / `// a` / `  x` / `// b` used to
  // leave the first comment outside the description and drop the
  // later one from the render, because commentsAreContent asked the
  // line at `at + 1` rather than the first non-comment rest line
  // (parser.rb:519-523 drains the comments first). Both comments now
  // keep their lines and their positions, and no comment is moved.
  test("#115 comments around a description keep their lines", async () => {
    await expectStable("t:: item\n// a\n  x\n// b\n");
  });

  // #116 red-then-green: `t:: item` / `yy` / ` +` respelled the hard
  // break's `+` as `{plus}` on the second pass. An indented rest line
  // makes the run a replay, and a replay is a fixed point by
  // construction.
  test("#116 an indented hard break survives a second pass", async () => {
    await expectStable("t:: item\nyy\n +\n");
  });

  // #117 red-then-green: `t::` / `  +` / `more` lost the space in
  // front of the hard break, so the render lost the break. The two
  // spaces are replayed.
  test("#117 a textless term keeps its description's indent", async () => {
    await expectStable("t::\n  +\nmore\n");
  });

  // #120 red-then-green: one long description line ending `x:: y`
  // wrapped so that `ttt x:: y` began an output line and re-read as a
  // term, fabricating a dt. Nothing wraps here: every item replays.
  test("#120 a long description with a term word does not wrap", async () => {
    const words = "aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn";
    await expectStable(`t:: ${words} ooo ppp qqq rrr sss ttt x:: y\n`);
  });

  // #121 red-then-green: `term::` / `:a: v` / ` ----` de-indented the
  // rest lines, and the de-indented lines read as an attribute entry
  // and a delimiter. The recorded lines are replayed at their own
  // columns.
  test("#121 a description's rest lines keep their indentation", async () => {
    await expectStable("term::\n:a: v\n ----\n");
  });

  // #122 red-then-green: `term::` / `text` / `<1> a` gained a blank
  // line in front of the callout list, which detached it. The callout
  // list is a BLOCK of the item behind a ZERO-line gap, and the gap
  // spelling opens with a hardline and nothing else for [].
  //
  // `text` joins the term line, since its run clears every reflow
  // condition; the callout list still opens on the very next line,
  // which is what the row is about.
  test("#122 a zero-line gap prints no blank line", async () => {
    await expectStable("term::\ntext\n<1> a\n", "term:: text\n<1> a\n");
  });

  // #123 red-then-green: `term::` / `///c` / blank / `text` folded
  // the comment into the description, where it became visible text. A
  // `///` line is a comment to Reader#skip_line_comments
  // (reader.rb:337-339) and ordinary text to CommentLineRx, and the
  // reader's spelling is the one that decides here.
  test("#123 a /// line is not folded into a description", async () => {
    await expectStable("term::\n///c\n\ntext\n");
  });

  // #124 red-then-green: `term::` / `.` / `[+1]` joined into a line
  // that was itself a construct it had not been. Nothing joins here.
  test("#124 a . rest line is not joined onto the term", async () => {
    await expectStable("term::\n.\n[+1]\n");
  });

  // #128 red-then-green: `t:: d` / `+` / `.Title` / `para` lost the
  // whole attached paragraph from the render, because nothing owned
  // the item's attached blocks. The `+` and its block are the item's
  // blocks now, printed by the item printer that is already correct
  // under a `*` marker.
  test("#128 a titled block attached by + survives", async () => {
    await expectStable("t:: d\n+\n.Title\npara\n");
  });

  // #129 red-then-green: `term:: text` / `+` / `nested term::: text`
  // was split by the width guard's first-line hazard, which destroyed
  // the nested list. Inside an item the nested term line is read by
  // next_block as a nested description list (parser.rb:704), so it is
  // a list node printed as a term line and never prose the guard may
  // split.
  test("#129 a nested term behind a + stays a nested list", async () => {
    await expectStable("term:: text\n+\nnested term::: text\n\nparagraph\n");
  });
});

describe("what the item model does NOT close", () => {
  // #119, MEASURED against the issue's own claim. The claim is that
  // the run `t:: item` / `  x` / `// x:: y` loses its comment from
  // the render, because a formatter that refuses the join leaves the
  // comment standing at column 0 where a re-read takes it as a
  // comment. A replayed item leaves it standing where the AUTHOR put
  // it, which is the position the input's own render already agrees
  // with, so the loss is not reachable from this input any more and
  // both sides render `item x // x:: y`.
  //
  // What #119 still names is the JOIN this formatter refuses, not a
  // lost byte: the run carries a word ending in `::`, and joining it
  // hands the ENCLOSING list's sibling pattern a line to match
  // (`is_sibling_list_item?`, parser.rb:1430, :2281). The row pins
  // the refusal as a round trip; the day the join lands, its output
  // changes here.
  test("#119 a separator-carrying comment keeps its own line", async () => {
    await expectStable("t:: item\n  x\n// x:: y\n");
  });

  // #107, the same way. The oracle preprocesses `include::` before
  // parsing, so the shape it parses is not the shape our reader sees,
  // and no fix inside a description reader is correct in isolation.
  // A replay is faithful at this input all the same - the oracle's
  // "Unresolved directive" line renders identically on both sides -
  // so what the row pins is the bytes, and the divergence it names is
  // in the reader's model rather than in these. Recorded in
  // docs/coding-standards.md as a standing divergence.
  test("#107 an include under a description is replayed", async () => {
    await expectStable("t:: item\n +\ninclude::x[]\n");
  });
});

// A description that wraps at width 40 and at nothing wider, shared
// by the follower rows so each one differs from its neighbours only
// in the line under it.
const LONG_DESCRIPTION =
  "the quick brown fox jumps over the lazy dog and keeps running";

describe("the boundaries of the reflow verdict", () => {
  // A run every condition clears is joined onto its term line and
  // packed to the print width, which is the whole of what the verdict
  // buys. One word under the width the join stays on one line; one
  // word over, the packer breaks it where a paragraph's would break.
  test("a run one word under the width joins", async () => {
    await expectStable("t:: alpha\nbravo\n", "t:: alpha bravo\n", {
      printWidth: 20,
    });
  });

  test("a run one word over the width joins and wraps", async () => {
    await expectStable(
      "t:: alpha\nbravo charlie\n",
      "t:: alpha bravo\ncharlie\n",
      { printWidth: 20 },
    );
  });

  // S: `bravo x:: charlie` carries a word ending in the delimiter, and
  // the joined line would hand the list's own sibling pattern a term
  // to match (`is_sibling_list_item?`, parser.rb:1430, :2281).
  test("the same run carrying a separator word replays", async () => {
    await expectStable("t:: alpha\nbravo x:: charlie\n", undefined, {
      printWidth: 20,
    });
  });

  // The boundary #119's body pins: a separator INSIDE a word matches
  // neither `DescriptionListRx`'s term group nor any sibling variant,
  // both of which end at a delimiter preceded by a non-blank run or by
  // nothing, so `x::y` is ordinary text and the run still joins.
  test("a separator inside a word still joins", async () => {
    await expectStable("t:: alpha\nx::y bravo\n", "t:: alpha x::y bravo\n", {
      printWidth: 40,
    });
  });

  // C: a rest line's common indent is the input to
  // `adjust_indentation!` and decides literal against paragraph, so an
  // indented rest line is refused rather than normalized.
  test("a run with an indented rest line replays", async () => {
    await expectStable("t:: alpha\n  bravo\n", undefined, { printWidth: 20 });
  });

  // B, asked of a whole line: `.` alone is ordinary text to the
  // classifier and `. [+1]` is an ordered list item, which is the
  // second spelling `startsBlockAtLineStart` probes.
  test("a run whose only rest line is a dot replays", async () => {
    await expectStable("t:: alpha\n.\n", undefined, { printWidth: 20 });
  });

  // B is the condition that guards the shape C cannot see. Each of
  // these four descriptions lives entirely on its term line, so there
  // is no rest line for C to read, and the only new line start is the
  // packer's own. At width 24 the wrap would put the hazard word at
  // column 0, where the item's confined `next_block` drains it: a
  // comment through `skip_line_comments` (parser.rb:1363-1371) and an
  // attribute entry or a block title through the metadata loop
  // (:519-523). Each row lost everything after the wrap point before
  // the verdict existed.
  test.each([
    ["a /// word", "t:: aaaa bbbb cccc /// dddd\n"],
    ["a bare attribute entry", "t:: aaaa bbbb cccc :a: dddd\n"],
    ["an attribute entry with a value", "t:: aaaa bbbb :a: v dddd\n"],
    ["a block title word", "t:: aaaa bbbb cccc .x dddd\n"],
  ])("a single-line description carrying %s replays", async (_n, input) => {
    await expectStable(input, undefined, { printWidth: 24 });
  });

  // E: a wrap makes a line START and a line END at the same point, and
  // safety at every start is not safety at every end. `t:: alpha bravo
  // charlie x[]` is `name:: target[attrlist]`, so the wrapped TERM
  // line classifies as a block macro, the item stops existing, and the
  // second pass loses `y`. The pass-1 output was render-equal, which
  // is why only a fixed-point bar could have caught it.
  test("a run whose wrap would end the term line at a bracket replays", async () => {
    await expectStable("t:: alpha bravo charlie x[] y\n", undefined, {
      printWidth: 28,
    });
  });

  // The spelling E refuses is narrow and measured: an open bracket, a
  // close bracket, and the two other bracket pairs all stay ordinary
  // text on the wrapped term line, so all four keep joining AND keep
  // wrapping. Each row carries the width that puts its own token at
  // the END of the wrapped term line, which is the position E is
  // about: a two-character token reaches it one column earlier than a
  // three-character one.
  test.each([
    [
      "x[",
      "t:: alpha bravo charlie x[ y\n",
      "t:: alpha bravo charlie x[\ny\n",
      26,
    ],
    [
      "x]",
      "t:: alpha bravo charlie x] y\n",
      "t:: alpha bravo charlie x]\ny\n",
      26,
    ],
    [
      "x{}",
      "t:: alpha bravo charlie x{} y\n",
      "t:: alpha bravo charlie x{}\ny\n",
      28,
    ],
    [
      "x()",
      "t:: alpha bravo charlie x() y\n",
      "t:: alpha bravo charlie x()\ny\n",
      28,
    ],
  ])(
    "the stable %s spelling keeps reflowing",
    async (_n, input, want, printWidth) => {
      await expectStable(input, want, { printWidth });
    },
  );

  // E's PAIR clause: no per-word probe carries the opener, so a `[`
  // opened in one word and closed in a later one is invisible to both
  // spellings B and E ask. At width 12 the run wraps to `t:: [a b]` /
  // `ccc`, which is `BLOCK_MACRO` with the target `" "` and the
  // attrlist `"a b"` (line-shapes.ts), and the description's tail
  // leaves the `dd` on the second pass.
  test("a bracket opened and closed in two words replays", async () => {
    await expectStable("t:: [a b] ccc\n", undefined, { printWidth: 12 });
  });

  // The realistic spelling of the same pair, and the over-refusal the
  // clause knowingly accepts. A width sweep of the second from 8 to
  // 300 columns finds no width that loses a render or a fixed point;
  // a word-PAIR test cannot tell that, so it refuses whenever an
  // opener could meet a closer.
  test.each([
    [
      "an xref with a spaced label",
      "t:: xref:x.adoc#p[P stylesheet section]\n",
    ],
    [
      "the measured over-refusal",
      "pygments-css:: see xref:x.adoc#pygments[Pygments stylesheet section]\n",
    ],
  ])("%s replays", async (_n, input) => {
    await expectStable(input, undefined, { printWidth: 40 });
  });

  // The packer's own guard on the same hazard word
  // (`wordsToAtoms`'s `firstLineWordCount`, src/print/reflow.ts) and
  // the separator condition answer for two different constructs
  // inside one item, and these two rows are the measurement that says
  // WHICH construct each `+`-fold is. Asserted rather than assumed,
  // because the answer decides which of the two guards has to hold.
  //
  // A fold whose FIRST line is a nested term line is a nested LIST
  // (`next_block`, parser.rb:704), which no packer touches. A fold
  // whose LATER line carries one is PROSE, so the packer's guard IS
  // reached, and it is what keeps the word off the fold's first line:
  // counterfactual, with the guard removed the second row prints
  // `t:: d` / `+` / `aaa x::: y` and the render loses the nested list.
  test.each([
    ["the fold's first line, a nested list", "t:: d\n+\nx::: y\n\npara\n"],
    ["a later line of the fold, prose", "t:: d\n+\naaa\nx::: y\n"],
  ])("a term word on %s keeps its own line", async (_n, input) => {
    await expectStable(input);
  });

  // F, the follower. A WRAP does not only respell the description: it
  // writes a text line into the region the item's first block opens
  // in, and four shapes stop being a block the moment a text line
  // stands above them. `parse_list_item` hands the item's lines to
  // `next_block`, which reads the block's own FIRST line to pick a
  // context, and once that context is "normal paragraph" the rest go
  // through `read_paragraph_lines`, whose break condition knows none
  // of them.
  //
  // Red before the condition existed: each of these four printed a
  // wrapped description with the follower still under it, the
  // follower re-read as the last words of that paragraph, and the
  // block left the render. Pass 1 was already wrong and the output
  // was a fixed point, so only a render bar could catch it.
  test.each([
    ["an admonition label", "NOTE: watch out."],
    ["a block macro", "image::y[]"],
    ["a thematic break", "'''"],
    ["a page break", "<<<"],
  ])("a description over %s replays", async (_n, follower) => {
    await expectStable(`t:: ${LONG_DESCRIPTION}\n${follower}\n`, undefined, {
      printWidth: 40,
    });
  });

  // The other half of the same condition, and the half a BLANKET
  // refusal would cost: a shape that ends the description from ANY
  // position survives a text line above it, so the item still joins
  // and still wraps. These are byte rows because the render bar
  // cannot see an over-refusal - replaying is always render-equal.
  test.each([
    ["a callout list", "<1> a"],
    ["a nested list", "* one"],
    ["an attached block", "+\npara here"],
  ])("a description over %s still wraps", async (_n, follower) => {
    await expectStable(
      `t:: ${LONG_DESCRIPTION}\n${follower}\n`,
      `t:: the quick brown fox jumps over the\nlazy dog and keeps running\n${follower}\n`,
      { printWidth: 40 },
    );
  });

  // The gap is what the condition turns on, not the shape alone: one
  // blank line between the description and the block puts the block
  // out of the wrap's way, and the same follower joins again.
  test("a blank line under the description lets the run join", async () => {
    await expectStable(
      `t:: ${LONG_DESCRIPTION}\n\nNOTE: watch out.\n`,
      `t:: the quick brown fox jumps over the\nlazy dog and keeps running\n\nNOTE: watch out.\n`,
      { printWidth: 40 },
    );
  });

  // WHICH CLAUSE answers for a `///` line, kept apart row by row so a
  // later change cannot collapse them. All three replay, and each for
  // a different reason:
  //
  // - `term::` / `///c` never reaches a condition at all. The head
  //   drain reads the line with `Reader#skip_line_comments`' bare
  //   `//` prefix (reader.rb:337-339, wider than `CommentLineRx`,
  //   which exempts `///`) and records it as the TERM's gap, so the
  //   run has no rest line and the gap rule refuses the join.
  // - `///c` as a real REST LINE is refused twice, by C asking the
  //   whole line and by B asking its only word.
  // - a `///` WORD on the term line is B's alone, where C is vacuous.
  test.each([
    ["the gap rule, a drained /// line", "term::\n///c\n"],
    ["C and B, a /// rest line", "t:: alpha\nbravo\n///c\ndelta\n"],
    ["B, a /// word on the term line", "t:: alpha /// bravo\n"],
  ])("%s replays", async (_n, input) => {
    await expectStable(input, undefined, { printWidth: 20 });
  });

  // Rest lines Asciidoctor opens a block on and this registry's
  // classifier reads as text, so no composition of the interrupting
  // sets can refuse them. Red before the registry carried the shape
  // rule: `t:: def` / `---` joined and the `<hr>` went with it, and
  // `t:: def` / `~~~~` joined and the OPEN block went with it. The
  // first two are also the two rows the whole-LINE test answers for
  // alone, since their hazard spans words.
  test.each([
    ["a spaced markdown rule", "t:: def\n_ _ _\n"],
    ["a markdown blockquote", "t:: def\n> quote\n"],
    ["a bare markdown rule", "t:: def\n---\n"],
    ["the underscore rule", "t:: def\n___\n"],
    ["a four-character fence", "t:: def\n~~~~\n"],
    ["a longer one", "t:: def\n~~~~~~\n"],
  ])("%s replays", async (_n, input) => {
    await expectStable(input, undefined, { printWidth: 40 });
  });

  // A `\u{2022}` bullet is a third unordered marker to `UnorderedListRx`
  // (rx.rb:284) and to `AnyListRx` (:274), and this parser's marker
  // patterns carry neither. So it is a LIST to the oracle and text
  // here, which is the same class as the block heads above and the
  // half no shape rule reaches: the line is letter-bearing.
  //
  // Red before the registry named it: the first row joined to
  // `t:: alpha bravo charlie delta \u{2022} item` and the `ulist` left
  // the render, and the second WRAPPED so that the bare bullet word
  // opened a line, which is the same loss reached from the other side.
  test.each([
    [
      "a bullet rest line",
      "t:: alpha bravo charlie delta\n\u{2022} item\n",
      80,
    ],
    [
      "a bullet word a wrap moves",
      "t:: alpha bravo charlie \u{2022} delta echo\n",
      24,
    ],
  ])("%s replays", async (_n, input, printWidth) => {
    await expectStable(input, undefined, { printWidth });
  });

  // The boundary, pinned from the other side so a later widening that
  // swept these in would cost a join and have to say so: this
  // Asciidoctor's alternation holds ONE bullet, not a class, and the
  // three lookalikes are ordinary text on both sides.
  test.each([
    ["a hyphen bullet", "\u{2043}"],
    ["a bullet operator", "\u{2219}"],
    ["an interpunct", "\u{00B7}"],
  ])("%s is not a marker and still joins", async (_n, mark) => {
    await expectStable(
      `t:: alpha bravo\n${mark} item\n`,
      `t:: alpha bravo ${mark} item\n`,
      { printWidth: 80 },
    );
  });

  // C's own domain, the INDENT, which nothing else answers for.
  test("an indented rest line replays", async () => {
    await expectStable("t:: alpha\n  bravo\n", undefined, {
      printWidth: 20,
    });
  });
});
