/**
 * The two SPACED Markdown rules, `- - -` and `* * *`, whose reading
 * is not the line's to decide (issue #182).
 *
 * Each is a thematic break to `ExtLayoutBreakRx` and an item line to
 * `UnorderedListRx`, so what decides it is where it stands: at a
 * block start `next_block` reaches its layout-break arm and the line
 * is an `<hr>`; inside a list item the arm is held off and the line
 * is a marker, except at the two positions where the line the printer
 * writes directly above the break is one it replays and no paragraph
 * is left open under it (issue #242). The tight spellings have no
 * such collision and are pinned with the rest of the breaks in
 * breaks.test.ts.
 */
import { describe, test, expect } from "vitest";
import {
  expectFormatted,
  expectStableRender,
  formatAdoc,
  renderedHtml,
} from "../helpers.js";

describe("spaced markdown thematic break formatting", () => {
  // Issue #182's own witnesses, in both spellings the line-shape
  // registry used to refuse. Red before the fix: `- - -` / `b c`
  // formatted to `- - - b c`, whose render is a one-item unordered
  // list (`<li><p>- - b c</p></li>`) where the source rendered an
  // `<hr>` above a paragraph, and `* * *` / `b c` did the same.
  test.each([
    ["a dash rule above prose", "- - -\nb c\n", "'''\n\nb c\n"],
    ["a star rule above prose", "* * *\nb c\n", "'''\n\nb c\n"],
    ["a wide dash rule above prose", "-  -  -\nb c\n", "'''\n\nb c\n"],
    ["an indented dash rule above prose", "   - - -\nb c\n", "'''\n\nb c\n"],
    ["a rule under a heading", "== S\n- - -\nb c\n", "== S\n\n'''\n\nb c\n"],
    [
      "a rule opening an open block",
      "--\n- - -\nb c\n--\n",
      "--\n'''\n\nb c\n--\n",
    ],
  ])("%s keeps its own block too", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // The other half of #182: inside an OPEN list the same two
  // spellings are marker lines, at every position the group below
  // does not name. `parse_list`'s own loop never reaches `next_block`
  // at all (parser.rb l.1119), and the item's first block is read
  // with `text_only` set (l.1367-74), which is the option
  // `next_block` skips its whole layout-break arm under. A FOREIGN
  // marker opens a nested list holding the item `- -`; a marker of
  // the list's own style is a sibling item. Both come back as the
  // author wrote them. Red the other way: reading them as breaks here
  // splits the list with a rule.
  test.each([
    ["a foreign marker nests", "* a\n- - -\n* b\n"],
    ["a sibling marker is an item", "* a\n* * *\n* b\n"],
    ["a foreign marker in a dash list", "- a\n* * *\n- b\n"],
    ["a sibling marker in a dash list", "- a\n- - -\n- b\n"],
    ["a foreign marker in an ordered list", ". a\n- - -\n. b\n"],
    ["a foreign marker two levels down", "* a\n** b\n- - -\n* c\n"],
    ["a foreign marker behind held metadata", "* a\n[[q]]\n- - -\n"],
    ["a foreign marker behind a comment", "* a\n//c\n- - -\n"],
    ["a textless term", "t::\n- - -\n"],
    ["a term with its own text", "t:: d\n- - -\n"],
    ["a sibling term below it", "t:: d\n- - -\nu:: e\n"],
    ["an indented description", "t::\n  d\n- - -\n"],
    ["a blank line above it", "* a\n\n- - -\n"],
    ["a blank line and a sibling below", "* a\n\n- - -\n* b\n"],
    ["a later block of a marker item", "* a\nimage::t.png[]\n- - -\n"],
  ])("%s inside an open list", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // THE TWO IN-ITEM POSITIONS THE BREAK IS READ AT (#242): the two
  // whose printed line above is one the printer replays and under
  // which no paragraph stands open. An ERASED `+`, which the gap in
  // front of the break writes back on its own line, and a delimited
  // block's TERMINATOR, which the block prints itself. Everywhere
  // else the canonical break is absorbed by the text above it
  // (`StartOfBlockOrListProc`, parser.rb l.40, matches no break), and
  // the rows further down pin what that costs.
  //
  // Red before the reader change: every row came back as the author
  // wrote it, spending an `<hr>` both programs render on a nested
  // `ulist` holding the item `- -`. `expectFormatted` asks all three
  // questions - the bytes, render-equality against the input, and the
  // output being its own fixed point.
  test.each([
    ["a continuation above it", "* a\n+\n- - -\n", "* a\n+\n'''\n"],
    ["a line under the rule", "* a\n+\n- - -\nlast\n", "* a\n+\n'''\nlast\n"],
    [
      "a star rule in a dash list",
      "- a\n+\n* * *\nlast\n",
      "- a\n+\n'''\nlast\n",
    ],
    ["an ordered item", ". a\n+\n- - -\nlast\n", ". a\n+\n'''\nlast\n"],
    ["a description item", "t:: d\n+\n- - -\nlast\n", "t:: d\n+\n'''\nlast\n"],
    [
      "a listing block terminator above it",
      "* a\n+\n----\nx\n----\n- - -\n",
      "* a\n+\n----\nx\n----\n'''\n",
    ],
    [
      "a listing terminator and a line under the rule",
      "* a\n+\n----\nx\n----\n- - -\nlast\n",
      "* a\n+\n----\nx\n----\n'''\nlast\n",
    ],
    [
      "an open block terminator above it",
      "* a\n+\n--\ny\n--\n- - -\n",
      "* a\n+\n--\ny\n--\n'''\n",
    ],
    [
      "a comment block terminator above it",
      "* a\n+\n////\nc\n////\n- - -\n",
      "* a\n+\n////\nc\n////\n'''\n",
    ],
    [
      "a sibling item under the rule",
      "* a\n+\n----\nx\n----\n- - -\n* b\n",
      "* a\n+\n----\nx\n----\n'''\n* b\n",
    ],
  ])("%s reads the break", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // The break's own line carries no words, so no print width reaches
  // it. What a width CAN move is the item text above the `+`, and
  // these pin that moving it moves neither the rule's reading nor its
  // render.
  test.each(
    [80, 40, 20].flatMap((printWidth) =>
      (
        [
          ["a continuation above it", "* a\n+\n- - -\nlast\n"],
          ["a terminator above it", "* a\n+\n----\nx\n----\n- - -\nlast\n"],
          [
            "a long item text above it",
            "* alpha beta gamma delta epsilon zeta\n+\n- - -\nlast\n",
          ],
        ] as const
      ).map(
        ([name, input]) =>
          [
            `${name} at width ${String(printWidth)}`,
            input,
            printWidth,
          ] as const,
      ),
    ),
  )("%s keeps its render", async (_name, input, printWidth) => {
    await expectStableRender(input, { printWidth });
  });

  // A SIBLING marker behind a `+` is NOT one of the two positions,
  // and the row stands so the pair is not read as "any `+`": the
  // item's own scan never buffers the line, because a marker of the
  // list's own style ends the item as the list's next item, so there
  // is no in-item block start for the break rows to be offered at
  // all. The join that follows is render-equal in both programs, the
  // sibling item's text being `* * last` either way.
  test("a sibling marker behind a continuation is the next item", async () => {
    await expectFormatted("* a\n+\n* * *\nlast\n", "* a\n+\n* * * last\n");
  });

  // The same reading where the printer JOINS the description onto its
  // term line: the rule keeps its own line and its own bytes, the
  // description moves up, and the render is the source's because a
  // marker line ends the description's paragraph wherever it stands.
  test.each([
    ["a textless term", "t::\nd\n- - -\n", "t:: d\n- - -\n"],
    ["two rest lines", "t::\nd\ne\n- - -\n", "t:: d e\n- - -\n"],
    ["another delimiter", "t;;\nd\n- - -\n", "t;; d\n- - -\n"],
    [
      "a rest line under a term with text",
      "t:: d\nmore\n- - -\n",
      "t:: d more\n- - -\n",
    ],
  ])("%s keeps the rule on its own line", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // THE WIDTH ROWS, and they are why the reading is the marker's at
  // every in-item position rather than at the ones a reader can call
  // safe. A break read under a description prints as `'''`, and the
  // line the `'''` lands under is not a fact the reader has: the
  // printer JOINS the description onto its term line and then WRAPS
  // the result at a print width that is the printer's option, so a
  // rule the source wrote directly under the term can end up under a
  // wrapped continuation line, where `'''` is absorbed into the
  // paragraph (`StartOfBlockOrListProc`, parser.rb l.40). Red before
  // this: each row below formatted to `'''` and lost its `<hr>` in
  // BOTH programs at 40 and 20 while passing at 80, which is why the
  // widths are named. The marker reading has no such dependence - the
  // author's own `- - -` ends the paragraph wherever the wrap puts
  // it, so the rule survives the join and the wrap alike.
  // The three shapes, at the three widths, one row per pair so the
  // width that goes red is the width the failure names.
  const WRAPPING = [
    [
      "a description that wraps",
      "t:: d\nmore words here that wrap around the budget\n- - -\n",
    ],
    [
      "a term-line description that wraps",
      "t:: alpha beta gamma delta epsilon zeta eta\n- - -\n",
    ],
    [
      "a textless term whose description wraps",
      "t::\nsome long description text here that wraps\n- - -\n",
    ],
  ] as const;
  test.each(
    WRAPPING.flatMap(([name, input]) =>
      [80, 40, 20].map(
        (printWidth) =>
          [
            `${name} at width ${String(printWidth)}`,
            input,
            printWidth,
          ] as const,
      ),
    ),
  )("%s keeps its render", async (_name, input, printWidth) => {
    await expectStableRender(input, { printWidth });
  });

  // The other direction the width can move a rule: an item whose text
  // OPENS with two more copies of its own marker. While the first
  // word after them shares their line the line is an item line, and a
  // break in front of that word leaves `- - -` alone on the marker
  // line, which both programs read as an `<hr>`. Red before the
  // guard: `- - - alpha` at width 10 printed `- - -` over `  alpha`
  // and the SECOND pass wrote `'''`, so the bytes kept moving. The
  // marker line over budget is the honest output, and it is what the
  // guard writes (markerLineGuard, src/print/list-hazard.ts).
  test.each([
    ["a dash rule and a short word", "- - - alpha\n", 10],
    ["a star rule and a short word", "* * * alpha\n", 10],
    ["more words behind it", "- - - alpha beta gamma\n", 10],
    [
      "a long word at the ordinary width",
      `- - - https://example.com/${"a".repeat(80)}\n`,
      80,
    ],
    ["the same inside a list", "* a\n- - - alpha\n", 10],
  ])(
    "%s keeps the word on the marker line",
    async (_name, input, printWidth) => {
      await expectStableRender(input, { printWidth });
    },
  );

  // WHAT THE REMAINING DIVERGENCE COSTS, pinned so it is a choice
  // with a witness. Asciidoctor reads the same line as an `<hr>`
  // INSIDE the item at every position past the item's first
  // `next_block` call: its own item scan buffers the line on
  // `AnyListRx` (parser.rb l.1530) and the arm is live again there.
  // Where nothing follows the rule the author's bytes come back and
  // only the node kind is lost - the rows above. Where a TEXT LINE
  // follows, the marker reading takes it as its item text and the
  // reflow joins the two, and the render moves: both programs render
  // the input as an `<hr>` and a paragraph inside the item, the
  // output as a fabricated nested item holding both.
  //
  // WHAT IS LEFT AFTER THE TWO POSITIONS ABOVE, named exactly. Each
  // row here stands under a line the printer may REWRITE - item text,
  // which it joins onto the marker or term line and then wraps at a
  // width of its own, and which absorbs a canonical break into itself
  // - or under a line that ENDS the item's buffer, which is the bare
  // blank. Those are two different reasons, and neither covers a line
  // comment above the rule, which is replayed like the two positions
  // above and is an unopened candidate rather than a member of this
  // group ({@link markerLineWinsAt}). Closing these takes a break
  // spelling that survives the join and the wrap, which is a printer
  // question and not the reader's. The outputs are pinned as BYTES,
  // and each is its own fixed point, so nothing walks further away.
  test.each([
    [
      "a marker item across a blank",
      "* a\n\n- - -\nlast\n",
      "* a\n\n- - - last\n",
    ],
    [
      "a dash list and a star rule",
      "- a\n\n* * *\nlast\n",
      "- a\n\n* * * last\n",
    ],
    ["an ordered item", ". a\n\n- - -\nlast\n", ". a\n\n- - - last\n"],
    [
      "a description across a blank",
      "t:: d\n\n- - -\nlast\n",
      "t:: d\n\n- - - last\n",
    ],
    [
      "a description with a line under the rule",
      "t:: d\n- - -\nlast\n",
      "t:: d\n- - - last\n",
    ],
    // THE UNOPENED CANDIDATE, pinned so the remainder is not read as
    // "text or a blank". A `//` line is replayed byte for byte and
    // leaves no paragraph open, and `* a` / `+` / `// c` / `'''` /
    // `last` measures the same render as this input in both programs,
    // so nothing about the position rules it out - it is simply not
    // one of the two the reader takes.
    [
      "a line comment above the rule",
      "* a\n+\n// c\n- - -\nlast\n",
      "* a\n+\n// c\n- - - last\n",
    ],
  ])(
    "%s moves the render, not just the node kind",
    async (_name, input, expected) => {
      const out = await formatAdoc(input);
      expect(out).toBe(expected);
      // Bytes and the fixed point, no render-equality: the two
      // renders DIFFER here, which is the loss the row exists to
      // pin, and the shared helper asserts them equal.
      // eslint-disable-next-line test-assertions/no-hand-spelled-format-trailer -- the row's subject is a render the formatter changes, asserted unequal below
      expect(await formatAdoc(out)).toBe(out);
      // The loss itself, asserted rather than described: the two
      // renders differ, and the row goes red the day a printer change
      // makes them agree.
      expect(await renderedHtml(out)).not.toBe(await renderedHtml(input));
    },
  );
});

/**
 * The PACKER moving the rule between `next_block`'s two calls (#243),
 * which is a different mechanism from the reading above: the reader
 * gives one tree at both positions, and what moves is the position.
 *
 * The item's first call carries `text_only` (`parse_list_item`,
 * parser.rb l.1367-74) and skips the layout-break arm; every later
 * call reaches it. So a spaced marker line directly under the marker
 * line is a nested `ulist` holding the item `- -`, and the same line
 * one text line lower is an `<hr>`. A reflow JOIN lifts the item's
 * text onto the marker line and moves the rule up into the first
 * call; a width WRAP pushes a second line under the marker line and
 * moves it down out of it. Both are refused: a break is held so a
 * text line stands directly under the marker line where the source
 * wrote one, and the packer writes no line of its own either way
 * (`hazard`, src/print/list-hazard.ts). A text of three lines still
 * folds to two, because one held break is all the rule's position
 * asks for; the row below says so.
 */
describe("a spaced rule under a list item's own text", () => {
  // THE JOIN. Red before the refusal: each row formatted to a joined
  // marker line and a rule that then read as a nested item, losing
  // the `<hr>` both programs render.
  test.each([
    ["an unordered item", "* a\nb\n- - -\n"],
    ["a dash list and a star rule", "- a\nb\n* * *\n"],
    ["an ordered item", ". a\nb\n- - -\n"],
    ["a nested item", "* x\n** a\nb\n- - -\n"],
    ["an indented rest line", "* a\n  b\n- - -\n"],
    ["a sibling item under the rule", "* a\nb\n- - -\n* c\n"],
  ])("%s keeps its own lines", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // TRAILING WHITESPACE on the rule line, the one place the source
  // spelling and the printed one differ: the reader's text node keeps
  // the bytes and the printer writes the line rstripped, so the
  // refusal has to ask its question of the STRIPPED line. Red before
  // the strip: each row joined, and the `- - -` the printer then
  // wrote read as a nested item where the input rendered an `<hr>`.
  // The expected bytes are the input less its trailing run, which is
  // the whole of what the printer changes.
  test.each([
    ["a trailing space", "* a\nb\n- - - \n", "* a\nb\n- - -\n"],
    ["a trailing tab", "* a\nb\n- - -\t\n", "* a\nb\n- - -\n"],
    [
      "a trailing space with no rest line",
      "* one two three\n- - - \n",
      "* one two three\n- - -\n",
    ],
  ])("%s is stripped and still keeps its lines", async (_n, input, out) => {
    await expectFormatted(input, out);
    await expectFormatted(input, out, { printWidth: 10 });
  });

  // A text whose lines outnumber the one the rule's position turns on
  // is joined down to two: the held break puts a text line directly
  // under the marker line, which is all the rule's position asks, and
  // the packer may still fold what stands above it. The render is the
  // source's, and that is what the row claims.
  test("a text of three lines keeps one rest line", async () => {
    await expectFormatted("* a\nb\nc\n- - -\n", "* a b\nc\n- - -\n");
  });

  // THE WRAP, at a width the marker line cannot hold. Red before the
  // refusal: `* one two three` wrapped to `* one two` over `  three`
  // at width 10, and the rule then read as the `<hr>` the source did
  // not have. The marker line over budget is the honest output.
  test.each([
    ["an unordered item", "* one two three\n- - -\n"],
    ["a dash list and a star rule", "- one two three\n* * *\n"],
    ["an ordered item", ". one two three\n- - -\n"],
    ["a nested item", "* x\n** one two three\n- - -\n"],
    ["a text of two lines", "* one two three\nfour\n- - -\n"],
  ])("%s refuses the wrap", async (_name, input) => {
    await expectFormatted(input, input, { printWidth: 10 });
    await expectFormatted(input, input, { printWidth: 20 });
    await expectFormatted(input, input, { printWidth: 80 });
  });

  // THE DESCRIPTION TWIN needs no refusal, and the row stands so the
  // refusal is not widened to it: a marker line ends a description's
  // paragraph at ANY position, so the join that moves it is
  // render-equal in both programs and the description is written onto
  // its term line as always.
  test.each([
    ["a textless term", "t::\nd\n- - -\n", "t:: d\n- - -\n"],
    ["a term with its own text", "t:: d\ne\n- - -\n", "t:: d e\n- - -\n"],
  ])("%s joins as always", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // NOT the shape, because the marker line under the text is an
  // ordinary item line: a word past the two marks makes it one, and
  // the packer is free again. Render-equal either way - both programs
  // read a nested item at both positions - and the row exists so the
  // refusal is not read as "any nested list under an item's text".
  test("a marker line carrying a word is packed as always", async () => {
    await expectFormatted(
      "* one two three\n- - - last\n",
      "* one two\n  three\n- - - last\n",
      { printWidth: 10 },
    );
  });
});
