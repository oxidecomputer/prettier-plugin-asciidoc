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
 * The one exception is the BLOCK-START HAZARD NET
 * (hazardAtBlockStart, src/print/block-start-hazard.ts): where the space
 * spelling would put block syntax at column 0, the source break is
 * kept.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Format once, pin the bytes, and prove render equality and
 * idempotence.
 * @param input - the row's document
 * @param expected - the exact formatted bytes
 */
async function expectRow(input: string, expected: string): Promise<void> {
  const out = await formatAdoc(input);
  expect(out).toBe(expected);
  expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  expect(await formatAdoc(out)).toBe(out);
}

describe("an in-span source break replays as one space", () => {
  // The issue's own example: the trailing `\n` of the span content
  // (`** b\n`) survives the parse and becomes the space inside the
  // closing marks - `x ** b ** c`, which the oracle renders exactly
  // like the broken spelling (`<strong> b </strong>`, whitespace on
  // both edges).
  test("x / ** b / ** c", async () => {
    await expectRow("x\n** b\n** c\n", "x ** b ** c\n");
  });

  // The constrained twin, fixed at the tokenizer (#36):
  // the oracle's constrained content needs a non-space after the
  // opening mark, so `* b` after a break is no span at all - the
  // marks are literal text and the join is an ordinary space.
  test("x / * b / * c stays literal", async () => {
    await expectRow("x\n* b\n* c\n", "x * b * c\n");
  });

  // Mid-content breaks were already kept; promoted to a named
  // regression row so the strip fix cannot overshoot.
  test("a **b / c** d keeps its mid-content break", async () => {
    await expectRow("a **b\nc** d\n", "a *b c* d\n");
  });

  // A nested span inside the broken content rides along.
  test("nested span before the trailing break", async () => {
    await expectRow("x\n** a *b*\n** c\n", "x ** a *b* ** c\n");
  });

  // A real constrained span broken mid-content still reflows.
  test("x *b / c* d", async () => {
    await expectRow("x *b\nc* d\n", "x *b c* d\n");
  });

  // The one-line spelling is the fixed point the broken ones land on.
  test("x ** b ** c is a fixed point", async () => {
    await expectRow("x ** b ** c\n", "x ** b ** c\n");
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
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("the block-start hazard net keeps the source break", () => {
  // `**\nb** c` replayed as `** b** c` would open the paragraph with
  // a ulist marker line - a measured corruption (the oracle re-reads
  // the output as a LIST). The net emits the open mark on its own
  // line and the content at column 0: the source's own bytes.
  test("** / b** c round-trips byte-identically", async () => {
    await expectRow("**\nb** c\n", "**\nb** c\n");
  });

  // The whitespace-only span at block start: `**\n**` would replay
  // as `** **`, which is a ulist line too. The net keeps the break.
  test("** / ** round-trips byte-identically", async () => {
    await expectRow("**\n**\n", "**\n**\n");
  });

  // The corrupted spelling must never come back: whatever the net
  // does, the first output line may not re-read as a list.
  test("the output never opens with a marker line", async () => {
    const out = await formatAdoc("**\nb** c\n");
    expect(out.startsWith("** ")).toBe(false);
  });

  // Only the block's FIRST node is guarded. A second span further
  // along the same paragraph cannot reach column 0 however the packer
  // arranges it - the words in front of it hold the line - so its
  // source break is replayed as the ordinary space while the first
  // span's is kept.
  test("a later span's break is still replayed as a space", async () => {
    await expectRow("**\nb** c **\nd** e\n", "**\nb** c ** d** e\n");
  });

  // Where a printed prefix holds column 0 the net stays out: a list
  // item's marker and an admonition's label protect the line, and
  // the space replay is byte-stable.
  test("a list item's span is not the block's column 0", async () => {
    await expectRow("* ** b** c\n", "* ** b** c\n");
  });
  test("an admonition label holds column 0", async () => {
    await expectRow("NOTE: ** b** c\n", "NOTE: ** b** c\n");
  });

  // The same two prefixes with the source break the net trades for.
  // These are the rows that make the prefix load-bearing: the SAME
  // bytes in a paragraph keep their break (`**\nb** c` above), and
  // here they are packed away, because `* ` and `NOTE: ` already
  // hold the column the re-reader would misread. The joined line is
  // the item's own text and the label's own text, which is what the
  // source said.
  test("a list item's marker holds column 0 across a break", async () => {
    await expectRow("* **\nb** c\n", "* ** b** c\n");
  });
  test("an admonition label holds column 0 across a break", async () => {
    await expectRow("NOTE: *\nb* c\n", "NOTE: * b* c\n");
  });

  // The plain-TEXT path of the same rule: a lone `*` against a break
  // is no mark at all, so the item's text is `*` then `b* c`, and the
  // marker in front of it is why joining them is safe.
  test("a list item's marker holds column 0 on the text path", async () => {
    await expectRow("* *\nb* c\n", "* * b* c\n");
  });
});

describe("a raw line at a span edge keeps its line and the marks stay off it", () => {
  // A comment line kept inside a paragraph is a RawLine child; the
  // oracle deletes it before the quote pass, so the span is real and
  // the mark beside the comment sits on its own line. Fusing the
  // close onto the comment (`// c**`) hands the mark to the comment
  // and the re-reader loses everything behind it - the depth-5 sweep
  // shape this suite names, the last member of the deleted #55
  // family.
  test("the depth-5 sweep shape: close mark after the comment", async () => {
    const input = "* a\n\npara\n** b\n// c\n** b\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* a\n\npara ** b\n// c\n** b\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // A raw line at the OPEN edge detaches the open mark the same way.
  test("open mark before the comment", async () => {
    await expectRow("**\n// c\nb** c\n", "**\n// c\nb** c\n");
  });

  // A raw line MID-content never carried a mark; the span around it
  // stays unconstrained (the respell would read the comment's
  // neighbours, which the oracle deletes before the quote pass).
  test("mid-content comment keeps the unconstrained spelling", async () => {
    await expectRow("a **b\n// c\nd** e\n", "a **b\n// c\nd** e\n");
  });
});

describe("the kept break is the SOURCE LINE's, not a fragment's", () => {
  // The break the net trades for lives INSIDE a span here, which is
  // the shape no inline fragment can answer for: `**` then `*b* c` is
  // ONE bold span whose content is `*\n*b`, so the block's first node
  // holds the break in the middle of its own bytes and the break
  // behind the block's first WORD is in no node's value at all. The
  // question is therefore asked of the SOURCE LINE, through the
  // reader's recorded answer (`ParagraphNode.firstWordEndsItsLine`,
  // src/ast.ts). Each row's two lines joined is block syntax the
  // author did not write - `** *b* c` is a depth-2 list item - so the
  // author's own line stands.
  test.each(["**\n*b* c\n", "**\nb* c\n", "**\nb c*\n"])(
    "%j keeps the author's line instead of writing a ulist",
    async (input) => {
      await expectRow(input, input);
    },
  );

  // The heading twin, through the same span path: `##` opens an
  // unconstrained highlight, and the joined line `## #b# c` is an
  // `<h2>` that eats the text behind the marks.
  test.each(["##\n#b# c\n", "##\nb# c\n", "##\nb c#\n"])(
    "%j keeps the author's line instead of writing a heading",
    async (input) => {
      await expectRow(input, input);
    },
  );

  // The deeper marker runs, where the span the first line opens takes
  // only PART of the run: `***` is the mark `**` and a `*` the span
  // holds, `#####` the mark `##` and a `###`. The composed first atom
  // is the whole run either way, so it is the packed LINE that is
  // block syntax - a depth-3 list item, a `<h5>` - and the net puts
  // the source's line back.
  test.each(["***\nb c\n", "#####\nb c\n", "####\nb## c\n"])(
    "%j keeps the author's line under a longer marker run",
    async (input) => {
      await expectRow(input, input);
    },
  );

  // The control: the recorded fact is TRUE here too (`**a**` is one
  // word), and the line still packs, because the trade is made only
  // where the packed line would be block syntax. A fact on its own
  // buys no break.
  test("a one-word first line that packs harmlessly still packs", async () => {
    await expectRow("**a**\nb c\n", "*a* b c\n");
  });

  // The net may only strand an atom that IS the block's first source
  // line, and a HIGHLIGHT span's role prefix is where that stops being
  // automatic: `spanMarks` (src/print/span-edges.ts) writes the role as
  // `[...]` in front of the mark, so the fused opening atom carries a
  // `[` at its head - and `BLOCK_ATTRIBUTE_LINE` is decided by its head
  // AND its `]` tail, so the packed line is block syntax while the
  // opening atom alone (`[.role]## b`) is not. Stranding the FUSED atom
  // would break between `b##` and `c]`, where the source has no
  // newline, and the line it wrote is not a one-word line either, so a
  // second format run would walk the break back. The atoms therefore
  // pack, and these rows pin the bytes and the fixed point.
  //
  // This row's own line is render-EQUAL to its source: the packed line
  // is `[.role]## b## c] d`, and the trailing ` d` past the `]` is what
  // keeps it from being a block attribute line, so the paragraph still
  // renders as a paragraph. The net declines anyway, because the line
  // it tests is the one the first TWO atoms make (`[.role]## b## c]`),
  // which is conservative by design - and that conservatism is what
  // this row pins, through the full `expectRow` triple.
  test("[.role]## / b## c] d packs, render-equal and a fixed point", async () => {
    await expectRow("[.role]##\nb## c] d\n", "[.role]## b## c] d\n");
  });

  // The same shape without the trailing word. Everything above holds,
  // and one thing more does not: the line the atoms pack into really IS
  // a block attribute list, so the whole paragraph re-reads as metadata
  // and renders EMPTY. That divergence is on this revision and on every
  // revision before it - an open corruption of the family this file's
  // other rows close - which is why this row asserts bytes and the
  // fixed point rather than going through `expectRow`.
  test("[.role]## / b## c] packs to its pre-existing reading", async () => {
    const out = await formatAdoc("[.role]##\nb## c]\n");
    expect(out).toBe("[.role]## b## c]\n");
    expect(await formatAdoc(out)).toBe(out);
  });

  // The discriminator, not a blanket refusal: same role prefix, same
  // marks, but here the opening atom IS the whole first source line
  // (the content's `#` is glued to the mark, so nothing crossed the
  // break into it). The atoms are `[.role]###`, `b]`, `c##`, and the
  // line the net tests is the one the first TWO make - `[.role]### b]`,
  // a block attribute line - so the author's own line goes back. The
  // whole output line `[.role]### b] c##` is NOT one; the net asks
  // about the pair, never about the finished line
  // (`keepBlockStartBreak`, src/print/block-start-hazard.ts).
  test("a role-prefixed opener that is its whole line keeps the break", async () => {
    await expectRow("[.role]###\nb] c##\n", "[.role]###\nb] c##\n");
  });
});

describe("the net also refuses to write a Markdown heading", () => {
  // The oracle's own section-title pattern is ExtAtxSectionTitleRx
  // (`/^(=={0,5}|##{0,5})[ \t]+(.+?)(?:[ \t]+\1)?$/`,
  // `@asciidoctor/core/build/node/index.cjs` l.266), so the `#`
  // spelling starts a section too. `##\nb## c` replayed as
  // `## b## c` turns the paragraph into a `<h2>` section and eats
  // the text behind the marks - the same corruption as the ulist
  // one, in the shape the registry did not yet carry.
  test("## / b## c round-trips byte-identically", async () => {
    await expectRow("##\nb## c\n", "##\nb## c\n");
  });

  // The single-`#` twin goes through the plain-TEXT path (a lone `#`
  // against a break can neither open nor close a span), and its
  // joined line is the DOCUMENT TITLE - the whole paragraph
  // disappears from the rendering.
  test("# / b# c round-trips byte-identically", async () => {
    await expectRow("#\nb# c\n", "#\nb# c\n");
  });

  // The break the net keeps is the one BEHIND THE BLOCK'S FIRST
  // WORD, and nothing further along: `# b` is already the whole
  // hazard on line one, so the break after `b` is an ordinary break
  // and packs away like any other. Only an author's break in front
  // of the second atom can be traded for.
  test("a break past the first word is still packed away", async () => {
    await expectRow("# b\nc\n", "# b c\n");
  });

  // The other side of the same rule: a heading the AUTHOR wrote on
  // one line is printed back as it stands. The classifier still
  // reads it as paragraph text (issue #63, which tracks reading the
  // Markdown spelling); breaking the line here would invent a line
  // break the source never had and destroy the heading the oracle
  // does read.
  test.each(["## Section One\n\nblah\n", "# Title\n\nblah\n"])(
    "%j keeps the author's own line",
    async (input) => {
      await expectRow(input, input);
    },
  );
});

describe("the net covers the plain-text path", () => {
  // A lone `*` against a break is no mark at all under the
  // directional rule (nothing precedes it to close, whitespace
  // follows it to open), so it is an ordinary text atom and the span
  // net never sees it. Reflow cannot fuse the block's FIRST word
  // backwards - there is nothing behind it - so the break is kept
  // instead: `* b* c` re-reads as a LIST.
  test("* / b* c round-trips byte-identically", async () => {
    await expectRow("*\nb* c\n", "*\nb* c\n");
  });

  // The ordered-list twin, same path.
  test(". / b. c round-trips byte-identically", async () => {
    await expectRow(".\nb. c\n", ".\nb. c\n");
  });
});

describe("a hard line break at a span's trailing edge keeps its line", () => {
  // `LineBreakRx` is `^(.*)[ \t]\+$`: the ` +` must END a line to be
  // a break. Fusing the closing mark behind it writes `b +**`, where
  // the `+` is literal text and the `<br>` is gone. The close mark
  // detaches onto its own line instead - the same rule the raw-line
  // edge follows, and the span stays unconstrained because a single
  // mark at column 0 with text behind it would be a list marker.
  test("a **b + / ** c keeps the break", async () => {
    await expectRow("a **b +\n** c\n", "a **b +\n** c\n");
  });

  // The whole content is the break.
  test("a ** + / ** c keeps the break", async () => {
    await expectRow("a ** +\n** c\n", "a ** +\n** c\n");
  });

  // MID-content the break is not at the span's edge: the atom behind
  // it carries the literal join, nothing detaches, and the respell
  // stays legal.
  test("a **b + / c** d reflows and respells", async () => {
    await expectRow("a **b +\nc** d\n", "a *b +\nc* d\n");
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
      await expectRow(input, input);
    },
  );

  // The control: an `=` mid-content, with no source break in front
  // of it, reflows exactly as before. The net preserves a break the
  // AUTHOR wrote; it invents none.
  test("a lone = mid-line is a fixed point", async () => {
    await expectRow("x = y and more\n", "x = y and more\n");
  });

  // A break that is NOT the block's start is still reflowed away:
  // this net guards the first output line only, and the `=` fuses
  // backwards the way every other block-syntax word does.
  test("a later break is still packed away", async () => {
    await expectRow("a\n= b\n", "a = b\n");
  });

  // The reflow rule, seen at a wrap: a lone `=` word may not START
  // an output line, so it travels with the word in front of it.
  test("a wrapped = word fuses backwards", async () => {
    await expectRow(
      "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp = qqqq rrrr\n",
      "aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo\npppp = qqqq rrrr\n",
    );
  });
});
