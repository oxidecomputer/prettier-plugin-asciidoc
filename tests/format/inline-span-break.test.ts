/**
 * Issue #55: an inline span KEEPS the source line break inside its
 * content, and the printer replays it as the space the one-line
 * spelling has.
 *
 * The oracle's `sub_quotes` runs over the block's lines joined with
 * `\n`, and a span matched across a break carries the `\n` VERBATIM
 * into the rendered HTML, where it is whitespace
 * (substitutors.rb l.189-196; measured, not assumed). Our builder
 * used to strip a trailing InlineNewline on
 * every recursion into span content, so the break died before the
 * printer saw it; buildFromTokens now strips at the block-level
 * entry only. The printer replays an edge break as ONE SPACE inside
 * the marks - render-equal under the project's own normalization,
 * and layout-independent (the precedent is issue #1's
 * collapseSourceNewlines).
 *
 * The one exception is the BLOCK'S FIRST OUTPUT LINE
 * (`opensTheSameBlock`, src/line-verdict.ts): where the space
 * spelling would put block syntax at column 0, the layout is refused
 * and the block's own source lines come back.
 */
import { describe, expect, test } from "vitest";
import { expectFormatted, expectStableRender, formatAdoc } from "../helpers.js";

describe("an in-span source break replays as one space", () => {
  // The issue's own example: the trailing `\n` of the span content
  // (`** b\n`) survives the parse and becomes the space inside the
  // closing marks - `x ** b ** c`, which the oracle renders exactly
  // like the broken spelling (`<strong> b </strong>`, whitespace on
  // both edges).
  test("x / ** b / ** c", async () => {
    await expectFormatted("x\n** b\n** c\n", "x ** b ** c\n");
  });

  // The constrained twin, fixed at the tokenizer (#36):
  // the oracle's constrained content needs a non-space after the
  // opening mark, so `* b` after a break is no span at all - the
  // marks are literal text and the join is an ordinary space.
  test("x / * b / * c stays literal", async () => {
    await expectFormatted("x\n* b\n* c\n", "x * b * c\n");
  });

  // Mid-content breaks were already kept; promoted to a named
  // regression row so the strip fix cannot overshoot.
  test("a **b / c** d keeps its mid-content break", async () => {
    await expectFormatted("a **b\nc** d\n", "a *b c* d\n");
  });

  // A nested span inside the broken content rides along.
  test("nested span before the trailing break", async () => {
    await expectFormatted("x\n** a *b*\n** c\n", "x ** a *b* ** c\n");
  });

  // A real constrained span broken mid-content still reflows.
  test("x *b / c* d", async () => {
    await expectFormatted("x *b\nc* d\n", "x *b c* d\n");
  });

  // The one-line spelling is the fixed point the broken ones land on.
  test("x ** b ** c is a fixed point", async () => {
    await expectFormatted("x ** b ** c\n", "x ** b ** c\n");
  });
});

describe("the #55 sweep shapes, re-asserted as named rows", () => {
  // Three members of the deleted INLINE_SPAN_SWALLOWS_LINE_BREAK
  // allowlist family, one per gap kind: the sweep now holds the whole
  // family by set-equality, and these rows keep the mechanism legible
  // when the sweep's product moves.
  test.each([
    "* a\n\npara\n** b\n** b\n",
    "* a\n\npara\n* a\n* a\n",
    "* a\n\n.T\n+\n** b\n** b\n",
  ])("%j formats render-equal and idempotent", async (input) => {
    await expectStableRender(input);
  });
});

describe("the block's own lines come back where a join opens a list", () => {
  // `**\nb** c` replayed as `** b** c` would open the paragraph with
  // a ulist marker line - a measured corruption (the oracle re-reads
  // the output as a LIST). The reader refuses that first output line
  // and the block goes back as its own source lines.
  test("** / b** c round-trips byte-identically", async () => {
    await expectFormatted("**\nb** c\n", "**\nb** c\n");
  });

  // The whitespace-only span at block start: `**\n**` would replay
  // as `** **`, which is a ulist line too, and the same refusal
  // writes the author's two lines back.
  test("** / ** round-trips byte-identically", async () => {
    await expectFormatted("**\n**\n", "**\n**\n");
  });

  // The corrupted spelling must never come back: the first output
  // line may not re-read as a list.
  test("the output never opens with a marker line", async () => {
    const out = await formatAdoc("**\nb** c\n");
    expect(out.startsWith("** ")).toBe(false);
  });

  // A REFUSAL IS WHOLE-BLOCK. A second span further along the same
  // paragraph cannot reach column 0 however the packer arranges it,
  // and on its own its break would be replayed as the ordinary space;
  // but the block's first line is the one the reader refuses, and
  // what comes back then is every line the author wrote, not one of
  // them. Before the refusal was whole-block a net traded exactly one
  // space for one break and packed the rest.
  test("a later span's break comes back with the block's own lines", async () => {
    await expectFormatted("**\nb** c **\nd** e\n", "**\nb** c **\nd** e\n");
  });

  // Where a printed prefix holds column 0 the joined line is an item
  // line or a label line, which is what the source's own first line
  // was, so the join stands and the space replay is byte-stable.
  test("a list item's span is not the block's column 0", async () => {
    await expectFormatted("* ** b** c\n", "* ** b** c\n");
  });
  test("an admonition label holds column 0", async () => {
    await expectFormatted("NOTE: ** b** c\n", "NOTE: ** b** c\n");
  });

  // The same two prefixes with the source break the net trades for.
  // These are the rows that make the prefix load-bearing: the SAME
  // bytes in a paragraph keep their break (`**\nb** c` above), and
  // here they are packed away, because `* ` and `NOTE: ` already
  // hold the column the re-reader would misread. The joined line is
  // the item's own text and the label's own text, which is what the
  // source said.
  test("a list item's marker holds column 0 across a break", async () => {
    await expectFormatted("* **\nb** c\n", "* ** b** c\n");
  });
  test("an admonition label holds column 0 across a break", async () => {
    await expectFormatted("NOTE: *\nb* c\n", "NOTE: * b* c\n");
  });

  // The plain-TEXT path of the same rule: a lone `*` against a break
  // is no mark at all, so the item's text is `*` then `b* c`, and the
  // marker in front of it is why joining them is safe.
  test("a list item's marker holds column 0 on the text path", async () => {
    await expectFormatted("* *\nb* c\n", "* * b* c\n");
  });
});

describe("a raw line at a span edge keeps its line and the marks stay off it", () => {
  // A comment line kept inside a paragraph is a RawLine child; the
  // oracle deletes it before the quote pass, so the span is real and
  // the mark beside the comment sits on its own line. Fusing the
  // close onto the comment (`// c**`) hands the mark to the comment
  // and the re-reader loses everything behind it - a shape the sweep's
  // product spelled at depth 5, the last member of the deleted #55
  // family.
  test("close mark after the comment", async () => {
    const input = "* a\n\npara\n** b\n// c\n** b\n";
    await expectFormatted(input, "* a\n\npara ** b\n// c\n** b\n");
  });

  // A raw line at the OPEN edge detaches the open mark the same way.
  test("open mark before the comment", async () => {
    await expectFormatted("**\n// c\nb** c\n", "**\n// c\nb** c\n");
  });

  // A raw line MID-content never carried a mark; the span around it
  // stays unconstrained (the respell would read the comment's
  // neighbours, which the oracle deletes before the quote pass).
  test("mid-content comment keeps the unconstrained spelling", async () => {
    await expectFormatted("a **b\n// c\nd** e\n", "a **b\n// c\nd** e\n");
  });
});

describe("the refused line is the OUTPUT LINE, not a fragment", () => {
  // The break lives INSIDE a span here, which is the shape no inline
  // fragment can answer for: `**` then `*b* c` is ONE bold span whose
  // content is `*\n*b`, so the block's first node holds the break in
  // the middle of its own bytes and the break behind the block's
  // first WORD is in no node's value at all. The question is asked of
  // the LINE the packer would write instead. Each row's two lines
  // joined is block syntax the author did not write - `** *b* c` is a
  // depth-2 list item - so the author's own lines stand.
  test.each(["**\n*b* c\n", "**\nb* c\n", "**\nb c*\n"])(
    "%j keeps the author's line instead of writing a ulist",
    async (input) => {
      await expectFormatted(input, input);
    },
  );

  // The heading twin, through the same span path: `##` opens an
  // unconstrained highlight, and the joined line `## #b# c` is an
  // `<h2>` that eats the text behind the marks.
  test.each(["##\n#b# c\n", "##\nb# c\n", "##\nb c#\n"])(
    "%j keeps the author's line instead of writing a heading",
    async (input) => {
      await expectFormatted(input, input);
    },
  );

  // The deeper marker runs, where the span the first line opens takes
  // only PART of the run: `#####` is the mark `##` and a `###` the
  // span holds. The composed first atom is the whole run, so it is
  // the packed LINE that is block syntax - a `<h5>` - and the net
  // puts the source's line back.
  //
  // The `*` twin of these rows was `***`, and it left when the
  // classifier learned the Markdown thematic break (issue #23): that
  // line is a BREAK now, so no span opens on it and the net never
  // gets the question. Its row stands below, on the reading.
  test.each(["#####\nb c\n", "####\nb## c\n"])(
    "%j keeps the author's line under a longer marker run",
    async (input) => {
      await expectFormatted(input, input);
    },
  );

  // `***` alone is the thematic break the oracle reads, not the head
  // of a span: the reader takes it as a break and the text below it
  // stays a block of its own, so the canonical `'''` comes back with
  // a blank line under it.
  test("a lone *** is read as the break it is", async () => {
    await expectFormatted("***\nb c\n", "'''\n\nb c\n");
  });

  // The control: the recorded fact is TRUE here too (`**a**` is one
  // word), and the line still packs, because the trade is made only
  // where the packed line would be block syntax. A fact on its own
  // buys no break.
  test("a one-word first line that packs harmlessly still packs", async () => {
    await expectFormatted("**a**\nb c\n", "*a* b c\n");
  });

  // A HIGHLIGHT span's role prefix is the shape that made the net's
  // question the whole line's rather than the pair's (issue #96):
  // {@link spanMarks} writes the role as `[...]` in front of the mark,
  // so the opening atom carries a `[` at its head, and
  // `BLOCK_ATTRIBUTE_LINE` is decided by its head AND its `]` tail.
  // The `]` lives two atoms further along, so the pair `[.role]## b##`
  // is no block shape while the packed line `[.role]## b## c]` is one
  // - and the paragraph packed into it re-read as block METADATA and
  // rendered EMPTY. The net keeps the author's line instead.
  test("[.role]## / b## c] keeps the author's line", async () => {
    await expectFormatted("[.role]##\nb## c]\n", "[.role]##\nb## c]\n");
  });

  // The `]` glued to the closing mark, so the packed line is
  // `[.role]## b##]` and the last atom fuses rather than joining over a
  // space. The line is a block attribute list either way.
  test("[.role]## / b##] keeps the author's line", async () => {
    await expectFormatted("[.role]##\nb##]\n", "[.role]##\nb##]\n");
  });

  // The plain-TEXT twin of the same hazard: a constrained `#` against a
  // break opens no span at all (the marks stay literal), so the atoms
  // are the three words `[.role]#`, `b#` and `c]` and no span path is
  // involved. The pair `[.role]# b#` is no block shape and the packed
  // line `[.role]# b# c]` is one, which is the same under-refusal.
  test("[.role]# / b# c] keeps the author's line", async () => {
    await expectFormatted("[.role]#\nb# c]\n", "[.role]#\nb# c]\n");
  });

  // The DISCRIMINATOR for the whole-line question: the same span with a
  // word past the `]`. The packed line is `[.role]## b## c] d`, whose
  // trailing ` d` past the `]` is exactly what keeps it from being a
  // block attribute line - so the paragraph still renders as a
  // paragraph and the atoms pack. The net reads the line, not the `[`
  // at its head.
  test("[.role]## / b## c] d packs, render-equal and a fixed point", async () => {
    await expectFormatted("[.role]##\nb## c] d\n", "[.role]## b## c] d\n");
  });

  // The NEAR MISS: the same span with a word in FRONT of it. The
  // block's first atom is `x`, so the span can never reach column 0
  // however the packer arranges it, and the source break inside the
  // span replays as the ordinary space.
  test("the same span mid-paragraph still packs", async () => {
    await expectFormatted("x [.role]##\nb## c]\n", "x [.role]## b## c]\n");
  });

  // The other near miss: the author already wrote the packed line, so
  // there is nothing to keep and nothing is invented.
  test("the packed spelling with a trailing word is a fixed point", async () => {
    await expectFormatted("[.role]## b## c] d\n", "[.role]## b## c] d\n");
  });

  // The same role prefix where the opening atom is its whole first
  // source line on its own (the content's `#` is glued to the mark,
  // so nothing crossed the break into it). The PAIR `[.role]### b]`
  // is a block attribute line and the LINE `[.role]### b] c##` is
  // not, so a net reading the pair kept the break here and the reader
  // reading the line does not: the paragraph packs, renders the same
  // and is a fixed point.
  test("a role-prefixed opener packs where its whole line is prose", async () => {
    await expectFormatted("[.role]###\nb] c##\n", "[.role]### b] c##\n");
  });

  // An INNER span's opening mark at the end of a source line is no
  // block start either: the block starts at `w` and the packed line
  // is prose from end to end, so the atoms pack onto one line and
  // the format is a fixed point.
  test("a break at an inner span's mark is not a block start", async () => {
    await expectFormatted("w\n*##\nb c##* d\n", "w *## b c##* d\n");
  });
});

describe("a Markdown heading is refused the same way", () => {
  // The oracle's own section-title pattern is ExtAtxSectionTitleRx
  // (`/^(=={0,5}|##{0,5})[ \t]+(.+?)(?:[ \t]+\1)?$/`,
  // `@asciidoctor/core/build/node/index.cjs` l.266), so the `#`
  // spelling starts a section too. `##\nb## c` replayed as
  // `## b## c` turns the paragraph into a `<h2>` section and eats
  // the text behind the marks - the same corruption as the ulist
  // one, in the shape the registry did not yet carry.
  test("## / b## c round-trips byte-identically", async () => {
    await expectFormatted("##\nb## c\n", "##\nb## c\n");
  });

  // The single-`#` twin goes through the plain-TEXT path (a lone `#`
  // against a break can neither open nor close a span), and its
  // joined line is the DOCUMENT TITLE - the whole paragraph
  // disappears from the rendering.
  test("# / b# c round-trips byte-identically", async () => {
    await expectFormatted("#\nb# c\n", "#\nb# c\n");
  });

  // The refusal is about the block's FIRST OUTPUT LINE and nothing
  // further along. `# b` is a HEADING now (issue
  // #63), so the line below it is a block of its own and the
  // question is never asked: the heading comes back in the `=`
  // spelling and `c` keeps its own line.
  test("a heading's own line ends at the heading", async () => {
    await expectFormatted("# b\nc\n", "= b\nc\n");
  });

  // The other side of the same rule: a heading the AUTHOR wrote on
  // one line comes back as one line. The classifier reads the
  // Markdown spelling now (issue #63) and the printer writes every
  // level as a run of `=`, so the marks change and the heading does
  // not.
  test.each([
    ["## Section One\n\nblah\n", "== Section One\n\nblah\n"],
    ["# Title\n\nblah\n", "= Title\n\nblah\n"],
  ])("%j keeps its own line", async (input, expected) => {
    await expectFormatted(input, expected);
  });
});

describe("the net covers the plain-text path", () => {
  // A lone `*` against a break is no mark at all under the
  // directional rule (nothing precedes it to close, whitespace
  // follows it to open), so it is an ordinary text atom and the span
  // net never sees it. Reflow cannot fuse the block's FIRST word
  // backwards - there is nothing behind it - so the break is kept
  // instead: `* b* c` re-reads as a LIST.
  test("* / b* c round-trips byte-identically", async () => {
    await expectFormatted("*\nb* c\n", "*\nb* c\n");
  });

  // The ordered-list twin, same path.
  test(". / b. c round-trips byte-identically", async () => {
    await expectFormatted(".\nb. c\n", ".\nb. c\n");
  });
});

describe("a hard line break at a span's trailing edge keeps its line", () => {
  // `HardLineBreakRx` is `^(.*) \+$` (rx.rb l.627): the ` +` must END
  // a line to be a break. Fusing the closing mark behind it writes `b +**`, where
  // the `+` is literal text and the `<br>` is gone. The close mark
  // detaches onto its own line instead - the same rule the raw-line
  // edge follows, and the span stays unconstrained because a single
  // mark at column 0 with text behind it would be a list marker.
  test("a **b + / ** c keeps the break", async () => {
    await expectFormatted("a **b +\n** c\n", "a **b +\n** c\n");
  });

  // The whole content is the break.
  test("a ** + / ** c keeps the break", async () => {
    await expectFormatted("a ** +\n** c\n", "a ** +\n** c\n");
  });

  // MID-content the break is not at the span's edge: the atom behind
  // it carries the literal join, nothing detaches, and the respell
  // stays legal.
  test("a **b + / c** d reflows and respells", async () => {
    await expectFormatted("a **b +\nc** d\n", "a *b +\nc* d\n");
  });
});

describe("the same net covers the `=` section-title spelling", () => {
  // `SECTION_TITLE` is `={1,6}` plus text, and no interrupting set
  // carries it either (a section title does not end a paragraph), so
  // `=\nb= c` packed to `= b= c` used to write the DOCUMENT TITLE -
  // which the renderer lifts out of the body, leaving the paragraph
  // rendering EMPTY. Reflow now refuses to create either spelling.
  test.each(["=\nb= c\n", "==\nb== c\n"])(
    "%j round-trips byte-identically",
    async (input) => {
      await expectFormatted(input, input);
    },
  );

  // The control: an `=` mid-content, with no source break in front
  // of it, reflows exactly as before. The net preserves a break the
  // AUTHOR wrote; it invents none.
  test("a lone = mid-line is a fixed point", async () => {
    await expectFormatted("x = y and more\n", "x = y and more\n");
  });

  // A break that is NOT the block's start is still reflowed away:
  // this net guards the first output line only, and the `=` fuses
  // backwards the way every other block-syntax word does.
  test("a later break is still packed away", async () => {
    await expectFormatted("a\n= b\n", "a = b\n");
  });

  // A LATER line is not the block's start, and a paragraph at
  // document level breaks on `StartOfBlockProc` alone (parser.rb
  // l.36), which holds no section title, so a lone `=` may open one:
  // the reader reads the line as
  // the paragraph's own text and the packer takes the width break.
  // The net above is about the block's FIRST line, where the whole
  // ladder is live.
  test("a wrapped = word may open a later line", async () => {
    await expectFormatted(
      "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp = qqqq rrrr\n",
      "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp\n= qqqq rrrr\n",
    );
  });
});
