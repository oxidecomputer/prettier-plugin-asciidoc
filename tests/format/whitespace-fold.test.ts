/**
 * Issue #87: a whitespace run the ORACLE reads as syntax.
 *
 * Reflow folds every run of source whitespace between two words to one
 * space, which is what a formatter is for. Asciidoctor's em-dash
 * replacement spells its boundary as the literal space character
 * (`(?: |\n|^|\\)--(?: |\n|$)`, asciidoctor.rb l.498), so a TAB beside
 * a lone `--` refuses the replacement and the folded spelling admits
 * it: `a<TAB>--<TAB>b` renders its dashes literally, `a -- b` renders
 * a thin space, an em dash and a thin space.
 *
 * Red before the fix: every row in the first group formatted to
 * `a -- b`, an em dash the author's bytes had not got. The run is
 * load-bearing now (src/print/whitespace-fold.ts) and the two words
 * around it travel as one.
 *
 * Each row asserts all three things a fold refusal has to be: the
 * bytes come back, the document renders as it did, and a second format
 * moves nothing.
 */
import { describe, expect, test } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Byte-identical, render-equal, idempotent - the run survived.
 * @param input - the document
 */
async function expectByteFaithful(input: string): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(input);
  expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  expect(await formatAdoc(output)).toBe(output);
}

describe("a run beside a lone `--` keeps its bytes", () => {
  test.each([
    ["a tab on each side", "a\t--\tb\n"],
    ["a tab on the right only", "a --\tb\n"],
    ["a tab on the left only", "a\t-- b\n"],
    // Two tabs, which is the row that separates the run pattern from a
    // single-character class: a class without the quantifier would
    // record the run's LAST character as the whole run and the fused
    // word would come back a tab short.
    ["a run of two tabs", "a\t\t--\tb\n"],
    // Nothing follows the dashes, so the right boundary is the end of
    // the line - which the replacement accepts. Only the tab in front
    // of them refuses it.
    ["a tab and then the end of the line", "a\t--\n"],
    ["words on both sides of the pair", "x a\t--\tb y\n"],
    // The backslash is the replacement's own left boundary, so these
    // two rows turn on the run behind the dashes alone.
    ["dashes behind a backslash", "a\\--\tb\n"],
    ["a backslash the source spaced away", "a \\--\tb\n"],
    ["inside a list item", "* a\t--\tb\n"],
    ["inside an admonition", "NOTE: a\t--\tb\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });
});

describe("the spellings the refusal must not touch", () => {
  // The fixed points: a run the replacement already reads, and dashes
  // that are not a word of their own. Neither has a run whose fold
  // changes anything, and both were fixed points before the refusal
  // existed - they are here so a wider rule cannot land unnoticed.
  test.each([
    ["a space on each side, which IS the em dash", "a -- b\n"],
    ["dashes inside a word", "a--b\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });

  // A TAB is now kept wherever it stands, not only beside the
  // dashes: the whitespace record's tab row (`factOfRun`,
  // src/whitespace-fact.ts) is deliberately wider than its authority,
  // because the em-dash row, the hard-break row and the macro targets
  // all spell their boundary as the literal SPACE and none of them
  // has a neighbour test that could tell a tab it reads from a tab it
  // does not.
  //
  // Red before that row: `a<TAB>b` formatted to `a b`. The render is
  // the same either way (HTML collapses both), so what the row buys
  // is the author's own bytes and a rule with no neighbour test; what
  // it costs is 2 of 5,175 corpus prose lines.
  test("an ordinary tab between two words is kept", async () => {
    expect(await formatAdoc("a\tb\n")).toBe("a\tb\n");
  });
});

/**
 * Issue #145: the same run, standing at a NODE boundary.
 *
 * `splitWords` cuts one text node, and the runs at that node's two
 * EDGES are not between two of its words - each stands between the
 * node and the inline sibling beside it, where the printer's join
 * decides what gets written. So a lone `--` with an inline macro
 * against it lost the very character the replacement reads.
 *
 * Red before the fix, measured: the first row formatted to
 * `See https://e.com -- sales@b.com for more.`, whose render is not
 * two links beside an em dash but ONE anchor - the thin-space
 * entities the replacement writes extend the bare-URL match until the
 * first anchor swallows the em dash and the whole second anchor.
 * Every other row in the group lost its tab to a space the same way.
 */
describe("a run beside a lone `--` keeps its bytes across a node edge", () => {
  test.each([
    // The issue's own document: a macro on each side, so BOTH tabs are
    // edge runs and the node holds nothing but the dashes.
    ["a macro on each side", "See https://e.com\t--\tsales@b.com for more.\n"],
    // One edge run is enough to arm the replacement where the source
    // already spelled the other side's boundary itself.
    ["a macro and then a source space", "See https://e.com\t-- more.\n"],
    ["a source space and then a macro", "See more --\thttps://e.com now.\n"],
    // The end of the block is the row's own right boundary, so the tab
    // in front of the dashes is the only thing refusing the match.
    ["a macro and then the end of the block", "See https://e.com\t--\n"],
    // The backslash carries the row's left boundary, which leaves the
    // edge run behind the dashes deciding the match alone.
    ["dashes behind a backslash", "See a \\--\thttps://e.com now.\n"],
    // Not only macros: every inline node ends the text node the same
    // way, and the span's own marks stand where the tab has to go.
    ["a formatting span on the left", "See *bold*\t--\tsales@b.com now.\n"],
    ["a monospace span on the left", "See `mono`\t--\tsales@b.com now.\n"],
    // The whole run comes back, not just the one character the row
    // reads.
    ["a space beside each tab", "See https://e.com \t--\t sales@b.com y.\n"],
    ["inside a list item", "* See https://e.com\t--\tsales@b.com now.\n"],
    ["inside an admonition", "NOTE: See https://e.com\t--\tsales@b.com y.\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });
});

describe("the node edges the refusal must not touch", () => {
  // The narrowness, and here it costs nothing to state: where the
  // OTHER side of the dashes is a run INSIDE the node, the interior
  // rule has already fused it, so the node's first word is
  // `--<TAB>word` rather than `--` and no edge question arises. The
  // macro-side tab folds and the render does not move, because the
  // interior tab is still the character the replacement reads.
  //
  // These three kept today's behaviour through the fix; the pins are
  // here so a wider rule cannot land unnoticed.
  test.each([
    // Every tab is kept now, on the macro side as well as the dash
    // side: the record's tab row reads the run alone and asks no
    // neighbour. Red before it, these three folded the macro-side tab
    // to a space.
    [
      "a macro on the left only",
      "See https://e.com\t--\tword for more.\n",
      "See https://e.com\t--\tword for more.\n",
    ],
    [
      "a macro on the right only",
      "See word\t--\tsales@b.com for more.\n",
      "See word\t--\tsales@b.com for more.\n",
    ],
    [
      "an ordinary tab against a macro",
      "See https://e.com\tword now.\n",
      "See https://e.com\tword now.\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const output = await formatAdoc(input);
    expect(output).toBe(expected);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });
});

/**
 * Issue #147: the same run, standing at a SPAN CONTENT edge.
 *
 * A span's content is its own run of nodes, so the run in front of its
 * first word has no atom already emitted to ride against and the run
 * behind its last word has no inline sibling following it. Both edge
 * rules read those facts and dropped the bytes, and the fold then
 * armed the row the source had refused: `b**<TAB>--<TAB>**b**` came
 * out `b** -- **b**`, an em dash inside the strong element.
 *
 * The span's own MARKS are what the run stands against - they are
 * written flush onto the content they enclose - so the bytes have
 * somewhere to go after all, and it is the enclosing span that says
 * so.
 */
describe("a run beside a lone `--` keeps its bytes at a span edge", () => {
  test.each([
    // The issue's own two documents: the leading edge of a doubled
    // span's content, once with the dashes alone in the node and once
    // with a word behind them.
    ["a doubled mark on the left", "b**\t--\t**b**\n"],
    ["a doubled mark and a word behind", "__\t-- x__\n"],
    // The trailing half of the same family (the issue's comment): the
    // run stands between the content and the closing mark.
    ["a run in front of the closing mark", "**a --\t** b\n"],
    ["a run at both ends of the content", "x **\t-- y** z\n"],
    ["inside a list item", "* b**\t--\t**b**\n"],
    ["inside an admonition", "NOTE: b**\t--\t**b**\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });
});

/**
 * Issue #149: the dashes the printer cannot see, because they are an
 * attribute's VALUE.
 *
 * `NORMAL_SUBS` substitutes attributes before the replacement pass
 * (`[:specialcharacters, :quotes, :attributes, :replacements,
 * :macros, :post_replacements]`, substitutors.rb l.16), so `{d}` is
 * already `--` when the em-dash row reads its boundaries. No rule
 * over the printer's own runs can see that: the dashes stand in no
 * text node at all.
 *
 * So the refusal is about the NEIGHBOUR and not about the bytes: a
 * run beside an attribute reference keeps what the author wrote,
 * because what the reference expands to is not a fact this tree
 * holds. It costs the author's own bytes where the value spells no
 * dashes and no render anywhere.
 */
describe("a run beside an attribute reference keeps its bytes", () => {
  test.each([
    ["a run on each side", ":d: --\n\nSee a\t{d}\tb now.\n"],
    ["a run behind the reference", ":d: --\n\nSee a {d}\tb now.\n"],
    ["a run in front of it", ":d: --\n\nSee a\t{d} b now.\n"],
    ["the reference opens the block", ":d: --\n\n{d}\tb now.\n"],
    // The reference ENDS the block, so the run in front of it is the
    // only boundary the row can read: the fold spells `See a --` at
    // the end of a line, which the row's `$` accepts.
    ["the reference ends the block", ":d: --\n\nSee a\t{d}\n"],
    // The value spells no dashes at all, and the run is kept anyway:
    // the printer does not model attribute values, so the refusal
    // reads the neighbour and stops. Bytes, and only the author's.
    ["a value that is not the dashes", ":d: xy\n\nSee a\t{d}\tb now.\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });

  // The node in FRONT of the run is the one the refusal reads, and at
  // the head of a span's content there is none. A span's first child
  // sits at index 0 among its siblings, where reading "one before"
  // off the end of the array answers with the span's LAST child - a
  // node that stands nowhere near the run. Here that last child is
  // the reference, and the run in front of `x` folds like the prose
  // run it is.
  test("a reference behind the run is not the node in front of it", async () => {
    const input = ":d: --\n\n__\tx {d}__\n";
    const output = await formatAdoc(input);
    // The tab is kept by the record's TAB row, which reads the run
    // alone; what this pins is that the REFERENCE rule stayed silent
    // here, which the byte-faithful rows above would not distinguish.
    // Red before that row, the run folded to a single space.
    expect(output).toBe(":d: --\n\n__\tx {d}__\n");
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });

  // A run BEHIND the reference at the end of a line is the reader's,
  // not the printer's: `prepare_lines` rstrips it (reader.rb l.582)
  // before any pass reads it, so the row sees `$` beside the dashes
  // whether the printer writes the bytes or not.
  test("a run the reader has already rstripped is nobody's to keep", async () => {
    const input = ":d: --\n\nSee {d}\t\n";
    const output = await formatAdoc(input);
    expect(output).toBe(":d: --\n\nSee {d}\n");
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });
});

/**
 * Issue #155: the character the row EATS.
 *
 * The em-dash row is replaced whole - `(?: |\n|^|\\)--(?: |\n|$)`
 * becomes a thin space, an em dash and a thin space (asciidoctor.rb
 * l.498) - so the boundary character it matched is gone from the
 * output and whatever else the run held stands beside the em dash.
 * A run of two characters therefore leaves one and a run of one leaves
 * none, and folding the wider run to a single space spends that
 * character a second time.
 *
 * Red before the fix, measured: `a  -- b` came out `a -- b`, whose
 * render is `a&#8201;&#8212;&#8201;b` where the input's is
 * `a &#8201;&#8212;&#8201;b` - a space short. `a<TAB> --` and
 * `-- <TAB>a` lost theirs the same way.
 *
 * The runs here stand at NODE edges rather than between two words: a
 * row that fired is a `characterReference` in the tree
 * (src/parse/inline/replacements.ts), so the dashes are not a word any
 * splitter sees and the run beside them is an edge run. That is also
 * what bounds the rule - dashes standing as a WORD are dashes no row
 * matched, and there the run only decides whether the fold ARMS one.
 */
describe("a run the em-dash row has already eaten from keeps the rest", () => {
  test.each([
    ["a two-space run in front of the dashes", "a  -- b\n"],
    ["a two-space run behind them", "a --  b\n"],
    ["a wide run at both ends", "a  --  b\n"],
    // The tab is not what the row read - the space beside the dashes
    // was - so this run is kept for its WIDTH alone.
    ["a tab and a space in front", "a\t --\n"],
    ["a space and a tab behind", "-- \ta\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });

  // The narrowness: a run that is ALREADY the single character the
  // fold writes is a fixed point on both counts, so `a -- b` still
  // formats to itself rather than growing bytes. The tabs away from
  // the dashes are kept by the record's tab row, not by this one (red
  // before it: they folded to spaces).
  test("a one-character run beside the dashes still folds", async () => {
    expect(await formatAdoc("a -- b\n")).toBe("a -- b\n");
    expect(await formatAdoc("a\tb -- c\td\n")).toBe("a\tb -- c\td\n");
  });
});

/**
 * The same run, in a text node that is NOTHING but the run.
 *
 * Two inline siblings with only whitespace between them leave a text
 * node with no words, so there is no atom for an edge run to ride
 * inside and neither edge rule can be asked. `--  --  a` is one: the
 * em-dash row fires twice, and the two-space run between the two
 * references it wrote is a whole text node.
 *
 * Red before the fix, measured: the run folded to the printer's own
 * single space, and the second reference then had no boundary
 * character of its own left - `--  --  a` came out `-- --  a`, which
 * renders ONE em dash and two literal dashes, and formatting that
 * again moved it a second time.
 */
describe("a run with no word of its own to ride inside keeps its bytes", () => {
  test.each([
    ["two em dashes the row wrote, one run apart", ":d: --\n\n--  --  a\n"],
    ["the same pair mid-line", "a --  -- b\n"],
    // The reference whose value the printer cannot resolve, at a node
    // with no words either: the run between a span and a reference is
    // a whole text node the same way.
    ["a run between a span and a reference", ":d: --\n\n`c`\t{d}\tx\n"],
    [
      "a run between a macro and a reference",
      ":d: --\n\nhttps://e.com\t{d}\tsales@b.com\n",
    ],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });

  // The narrowness: an all-whitespace node with no dashes anywhere
  // beside it is still the break opportunity it always was - the
  // TAB's own bytes aside, which the record's tab row keeps (red
  // before that row: the node folded to a single space).
  test("a whitespace-only node with no dashes beside it keeps only its tab", async () => {
    expect(await formatAdoc("`c`\t`d`\n")).toBe("`c`\t`d`\n");
    expect(await formatAdoc("`c` `d`\n")).toBe("`c` `d`\n");
  });
});

/**
 * A run the fold would write back UNCHANGED is not kept.
 *
 * The refusals above ride a run inside the atom beside it, which takes
 * the break opportunity that run stood for away. Where the run is
 * already the single character the fold writes, there is nothing to
 * keep and the break must stay: the set membership answers both, since
 * every run it holds is one character.
 *
 * The witness is a WRAP, because that is the only place a kept space
 * differs from a folded one: the em dash below sits where the packer
 * wants a line break, and keeping the space in front of it would fuse
 * `a -- z...` into one unbreakable word and move the break to the
 * front of `a`.
 */
describe("a run the fold writes back unchanged keeps no bytes", () => {
  test("the break stays where the packer put it", async () => {
    const input = `${"w".repeat(58)} a -- ${"z".repeat(30)}\n`;
    const output = await formatAdoc(input);
    expect(output).toBe(`${"w".repeat(58)} a --\n${"z".repeat(30)}\n`);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });
});

/**
 * Issue #154: HALF the dashes in the tree, half in a reference.
 *
 * The refusal above reads the node beside the run, which covers a
 * reference standing where the whole pattern would. It does not cover
 * a reference that FUSES with the author's own bytes to spell it:
 * `a<TAB>-{h} b` with `:h: -` puts one dash in the text and one in the
 * value, and the word the splitter saw beside the tab was a single
 * dash - a word no rule over `--` can recognise.
 *
 * Red before the fix, measured: every row in the first group folded
 * its tab and rendered an em dash the input had not got, where the
 * input's own render keeps the two dashes literal. The dash beside a
 * reference now reads as the pattern, and the run against it is kept
 * exactly where the pattern's own bytes would have kept it.
 */
describe("a lone dash flush against a reference reads as the dashes", () => {
  test.each([
    // The issue's own three documents: the value supplies the second
    // dash, an empty value lets two source dashes meet, and the same
    // pair with the run on the other side.
    ["the value is the other dash", ":h: -\n\na\t-{h} b\n"],
    ["an empty value between two dashes", ":e:\n\na\t-{e}- b\n"],
    ["the run behind the pair", ":e:\n\na -{e}-\tb\n"],
    ["a run at both ends of the pair", ":e:\n\na\t-{e}-\tb\n"],
    // The dash is the node's ONLY word, so the run against it is an
    // EDGE run rather than one between two words of the node.
    ["a span in front of the dash", ":h: -\n\nx *b*\t-{h} c\n"],
    ["a span behind the pair", ":e:\n\nx -{e}-\t*b*\n"],
    // The value spells no dashes at all and the bytes are kept anyway:
    // the printer does not resolve attribute values, so the refusal
    // reads the neighbour and stops.
    ["a value that is not a dash", ":h: zz\n\na\t-{h} b\n"],
    ["inside a list item", "* a\t-{h} b\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });
});

describe("the dashes a reference cannot complete", () => {
  // The narrowness. A dash the source spaced away from the reference
  // cannot fuse with it, a longer word carries characters between the
  // run and any dashes the value adds, and a description-list
  // separator is the one word nothing may fuse across (the anchored
  // DLIST_SEPARATOR_WORD stops recognising it inside a longer word,
  // and reflow could then pack a live term onto the first line).
  test.each([
    // The tab in each of these is kept by the record's TAB row rather
    // than by the fused-dash clause, which is what these rows are
    // about: the dash cannot reach the reference, so the clause is
    // silent and the run is not fused into a word. Red before the tab
    // row, both folded to a space.
    [
      "a space between the dash and the reference",
      ":h: -\n\na\t- {h} b\n",
      ":h: -\n\na\t- {h} b\n",
    ],
    [
      "a dash inside a longer word",
      ":h: -\n\na\tax-{h} b\n",
      ":h: -\n\na\tax-{h} b\n",
    ],
    [
      "a description-list separator in front of the run",
      ":h: -\n\nz\n\nx::\t-{h} b\n",
      ":h: -\n\nz\n\nx:: -{h} b\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const output = await formatAdoc(input);
    expect(output).toBe(expected);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });
});

/**
 * A load-bearing run carrying a LINE BREAK: the break is what the
 * printer holds in its place.
 *
 * Bytes cannot ride inside an atom here - an atom is newline-free by
 * construction (src/print/reflow.ts) - so what is left of the run is
 * its SPELLING, and the record says so: a run carrying a break can
 * take no arm stronger than `bound` to a newline
 * (`noWidthToRead`, src/whitespace-fact.ts). The packer then writes
 * the author's own break back rather than a space.
 *
 * Red before that reading (issue #180's join half): every row here
 * folded its break to a space, and a break between two edges that can
 * each spell the dashes is what arms the em-dash row twice - the
 * folded spelling renders one em dash where the input renders two.
 *
 * That the reduction is to the BREAK and not to the bytes is also
 * what makes the record a fixed point: the run the next read sees is
 * the one newline this wrote, and it takes the same row and the same
 * arm.
 */
describe("a run carrying a line break keeps the break", () => {
  test.each([
    // A node's own EDGE run, where the em-dash row has already
    // consumed the source's newline: what is left is two spaces, and
    // those DO ride inside the atom.
    [
      "an edge run in front of the dashes",
      ":d: --\n\na  \n-- b\n",
      ":d: --\n\na -- b\n",
    ],
    // A node that is NOTHING but the run, between two references.
    [
      "a whole node between two references",
      ":d: -\n\n{d}\t\n{d}\n",
      ":d: -\n\n{d}\n{d}\n",
    ],
    // The run behind a lone dash fused to a reference.
    [
      "the run behind a fused dash",
      ":e:\n\na -{e}-\t\nb\n",
      ":e:\n\na -{e}-\nb\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const output = await formatAdoc(input);
    expect(output).toBe(expected);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });

  // The run in FRONT of a final lone dash. The break the record holds
  // is DROPPED here, and deliberately: the word behind it is a lone
  // `-`, which is a list marker at a line start, so the packer fuses
  // it backwards and the block-start net is what decides whether the
  // author's line comes back (src/print/block-start-hazard.ts). Bytes
  // only, because what the record asked for is not what is written.
  test("the run in front of a fused dash", async () => {
    expect(await formatAdoc(":h: -\n\na\n\t-{h}\n")).toBe(":h: -\n\na -{h}\n");
  });

  // A separator standing BEHIND the run, where the fused word holds it
  // and the anchored `DLIST_SEPARATOR_WORD` alone would not see it.
  // The run rides, so the word is `{e}-<TAB>x::`, and the guard that
  // keeps such a word off the block's first output line asks about the
  // word's own words rather than the whole
  // (`holdsDescriptionSeparatorWord`, src/parse/line-shapes.ts). Here
  // the reference clause holds the break in front of `{e}-` anyway, so
  // the run's bytes come back where the author wrote them.
  test("a description-list separator behind the run", async () => {
    const input = ":e:\n\na\n{e}-\tx:: y\n";
    await expectFormatted(input, input);
  });

  // The same separator behind a run where NOTHING else holds the line:
  // the guard is the only thing keeping the fused word off the label's
  // line. Red before it asked about the fused word's words, when the
  // output was `NOTE: a b<TAB>x:: y` and the oracle read a description
  // list where the input renders one admonition (issue #294).
  test("a fused separator may not reach the first output line", async () => {
    await expectFormatted("NOTE: a\nb\tx:: y\n", "NOTE: a\nb\tx:: y\n");
  });

  // The separator standing on a line the READER already records as a
  // description list is nobody's fold to make: the term is the reader's
  // (src/parse/lines/description-list.ts) and the printer writes it
  // back, so every byte stands whatever this module would have said.
  // This row held the fold before that reading existed, and it holds
  // the bytes now.
  test("a separator the reader records as a term keeps its bytes", async () => {
    const input = ":e:\n\nz\n\n{e}-\tx::\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });
});

/**
 * Issue #167: the character the row eats out of a run beside a
 * REFERENCE.
 *
 * `sub_replacements` (substitutors.rb l.282-286) runs each row of the
 * table as a gsub, and `do_replacement` (substitutors.rb l.1450-1457)
 * answers a `:none` row with the replacement text alone - so the
 * whole match is written over, boundary character included, and a run
 * of two characters beside the dashes leaves one where a run of one
 * leaves none.
 *
 * Where the dashes arrive by attribute expansion the printer cannot
 * see them at all: `:attributes` runs before `:replacements` in
 * `NORMAL_SUBS` (substitutors.rb l.16), so the row reads a value this
 * tree does not hold. The refusal is therefore about the NEIGHBOUR,
 * and the question asked of it is now whether the fold rewrites the
 * run's bytes at all rather than only whether it changes what the row
 * MATCHES.
 *
 * Red before the fix, measured: `See a  {d} b` formatted to
 * `See a {d} b`, whose render is `See a&#8201;&#8212;&#8201;b` where
 * the input's is `See a &#8201;&#8212;&#8201;b` - a space short.
 * Every row of the first group lost its character the same way.
 */
describe("a run beside a reference keeps what the row would leave", () => {
  // Both boundary classes of the em-dash row are non-capturing and its
  // replacement is three bare entities and nothing else
  // (`(?: |\n|^|\\)--(?: |\n|$)`, asciidoctor.rb l.498), which is what
  // leaves the row nothing to write its boundary back from.
  test.each([
    ["a two-space run in front of the reference", ":d: --\n\nSee a  {d} b\n"],
    ["a two-space run behind it", ":d: --\n\nSee a {d}  b\n"],
    ["a wide run at both ends", ":d: --\n\nSee a  {d}  b\n"],
    ["a three-space run", ":d: --\n\nSee a   {d} b\n"],
    // The value spells only half the dashes and the author's own byte
    // spells the other half, so the run stands against a word the
    // splitter saw as a single dash (issue #154's fused spelling).
    ["the reference supplies the second dash", ":h: -\n\na  -{h} b\n"],
    ["the reference supplies the first", ":h: -\n\na  {h}- b\n"],
    // A run with no word of its own to ride inside: the whole text
    // node between two siblings is the run.
    ["a run between two references", ":d: --\n\nx {d}  {d} y\n"],
    ["a run between a span and a reference", ":d: --\n\nx `c`  {d} y\n"],
    // The value spells no dashes at all and the bytes are kept anyway:
    // the printer does not resolve attribute values.
    ["a value that is not a dash", ":d: zz\n\nSee a  {d} b\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });

  // The narrowness: a run that is ALREADY the single character the
  // fold writes is a fixed point, so the common spellings do not grow
  // bytes, and a run that ends the block is rstripped by the reader
  // (`prepare_lines`, reader.rb l.582) before any row reads it.
  test.each([
    [
      "one space on each side",
      ":d: --\n\nSee a {d} b\n",
      ":d: --\n\nSee a {d} b\n",
    ],
    [
      "a run the reader strips off the end of the block",
      ":d: --\n\nSee a {d}   \n",
      ":d: --\n\nSee a {d}\n",
    ],
    // Kept by the record's TAB row rather than by this one, which is
    // what the row pins: the reference rule is silent this far away.
    // Red before that row, both tabs folded to spaces.
    [
      "a tab away from any reference",
      ":d: --\n\nSee a\tb {d} c\td\n",
      ":d: --\n\nSee a\tb {d} c\td\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // The block-end refusal costs bytes nowhere the printer would have
  // written them, so only a WIDTH can tell it from keeping the run:
  // the atom `{d}` and four spaces is seven wide and does not fit
  // beside `aaaa bbbb`, while the reference alone does. Keeping the
  // run therefore breaks the line, the printer strips the run off the
  // end it now stands at, and the shorter line joins back on the next
  // format - measured without the refusal: `aaaa bbbb\n{d}`, which
  // formats to `aaaa bbbb {d}` and is no fixed point.
  test("a run at the end of the block does not widen its atom", async () => {
    await expectFormatted(
      ":d: --\n\naaaa bbbb {d}    \n",
      ":d: --\n\naaaa bbbb {d}\n",
      { printWidth: 13 },
    );
  });
});

/**
 * The break the packer writes is not the space the fold writes.
 *
 * A row CONSUMES the character it matches, so one space can bound one
 * row and no more: in `w -- {d} y` with `:d: --` the first pair's
 * match takes the space behind it and the second pair, left with a
 * dash in front of its own, renders literally. A newline is consumed
 * the same way - but the position behind it is a line start, and the
 * row's `^` alternative (asciidoctor.rb l.498) bounds a row there
 * while consuming nothing. So a break between two things that can
 * each spell the dashes arms a row the author's space left disarmed.
 *
 * Red before the fix, measured at printWidth 10: `wwwwwwww -- {d} y`
 * formatted to `wwwwwwww --` and `{d} y` on two lines, whose render
 * carries TWO em dashes where the input's carries one and a literal
 * pair. Keeping the run is what forbids the break; where the run is
 * already one space that costs no bytes, only the break opportunity.
 */
describe("no break stands between two spellings of the dashes", () => {
  // Each row carries the width at which the packer chose the break
  // that armed the row; the shapes are otherwise the same document.
  test.each([
    [
      "dashes the row wrote, then a reference",
      ":d: --\n\nwwwwwwww -- {d} y\n",
      10,
    ],
    ["two references", ":d: --\n\nwwwwwwwwwwww {d} {d} y\n", 16],
    [
      "an escaped pair, then a reference",
      ":d: --\n\nwwwwwwww \\-- {d} y\n",
      14,
    ],
    ["a word between them", ":d: --\n\nwwwwwwww a -- {d} y\n", 14],
  ])("%s", async (_name, input, printWidth) => {
    // No byte pin: what the rule owes is a render, and which line the
    // packer moves the break to is its own business.
    const output = await formatAdoc(input, { printWidth });
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output, { printWidth })).toBe(output);
  });

  // A break in front of a lone reference is refused too, and that is
  // the record's reference clause paying its stated cost: the value
  // is not resolved, so a reference on ONE side binds the run to the
  // spelling the source gave it and the packer may not write a break
  // there. Red before the clause, this formatted to two lines.
  //
  // What the clause buys is the shape above it: a break beside a
  // reference whose value spells the dashes arms the row twice. What
  // it costs is measured - 141 of 38,110 corpus prose runs stand
  // beside a reference, and each loses a break opportunity.
  test("a break in front of a lone reference is refused too", async () => {
    expect(
      await formatAdoc(":d: --\n\nwwwwwwwwww {d} y\n", { printWidth: 10 }),
    ).toBe(":d: --\n\nwwwwwwwwww {d} y\n");
  });
});
