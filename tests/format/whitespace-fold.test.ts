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
import { formatAdoc, renderedHtml } from "../helpers.js";

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

  // The narrowness of the refusal, stated as a row. An ordinary tab
  // between two words is still folded: reflowing prose is what the
  // formatter is for, and nothing reads that run as syntax. The rows
  // above are the exception, not a new policy for tabs.
  test("an ordinary tab between two words still folds", async () => {
    expect(await formatAdoc("a\tb\n")).toBe("a b\n");
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
    [
      "a macro on the left only",
      "See https://e.com\t--\tword for more.\n",
      "See https://e.com --\tword for more.\n",
    ],
    [
      "a macro on the right only",
      "See word\t--\tsales@b.com for more.\n",
      "See word\t-- sales@b.com for more.\n",
    ],
    // An edge run with no dashes beside it at all: a tab against a
    // macro is prose to reflow, the same as anywhere else.
    [
      "an ordinary tab against a macro",
      "See https://e.com\tword now.\n",
      "See https://e.com word now.\n",
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
    expect(output).toBe(":d: --\n\n__ x {d}__\n");
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
  // formats to itself rather than growing bytes.
  test("a one-character run beside the dashes still folds", async () => {
    expect(await formatAdoc("a -- b\n")).toBe("a -- b\n");
    expect(await formatAdoc("a\tb -- c\td\n")).toBe("a b -- c d\n");
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
  // beside it is still the break opportunity it always was.
  test("a whitespace-only node with no dashes beside it still folds", async () => {
    expect(await formatAdoc("`c`\t`d`\n")).toBe("`c` `d`\n");
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
    [
      "a space between the dash and the reference",
      ":h: -\n\na\t- {h} b\n",
      ":h: -\n\na - {h} b\n",
    ],
    [
      "a dash inside a longer word",
      ":h: -\n\na\tax-{h} b\n",
      ":h: -\n\na ax-{h} b\n",
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
 * A load-bearing run the printer CANNOT keep: one carrying a line
 * break.
 *
 * Keeping a run means riding inside the atom beside it, and an atom is
 * newline-free by construction (src/print/reflow.ts). So every rule in
 * src/print/whitespace-fold.ts that would otherwise keep a run stops
 * at a break and lets the fold happen - the module says so at each
 * site, and these rows are what hold the guards there. Without them a
 * newline rides into a word and the packer writes it mid-line.
 *
 * The last row is the one that COSTS a render, and it costs the same
 * one on main: the remedy for it is a break the printer HOLDS rather
 * than bytes inside a word, which is a change to the packer and not to
 * this module. It is pinned for its BYTES alone, so the guard cannot
 * be deleted unnoticed.
 */
describe("a run carrying a line break folds, guard by guard", () => {
  test.each([
    // The node's own EDGE run, read by `edgeRun`.
    [
      "an edge run in front of the dashes",
      ":d: --\n\na  \n-- b\n",
      ":d: --\n\na -- b\n",
    ],
    // A node that is NOTHING but the run, read by `keptWholeRun`.
    [
      "a whole node between two references",
      ":d: -\n\n{d}\t\n{d}\n",
      ":d: -\n\n{d} {d}\n",
    ],
    // The run behind an opening lone dash, read by `fuseOpeningDash`.
    [
      "the run behind a fused dash",
      ":e:\n\na -{e}-\t\nb\n",
      ":e:\n\na -{e}- b\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const output = await formatAdoc(input);
    expect(output).toBe(expected);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });

  // The run in FRONT of a final lone dash, read by `fuseFinalDash`.
  // Bytes only: the fold arms the row here, and no rule in this module
  // can refuse it while the run carries the break.
  test("the run in front of a fused dash", async () => {
    expect(await formatAdoc(":h: -\n\na\n\t-{h}\n")).toBe(":h: -\n\na -{h}\n");
  });

  // The one word nothing fuses across, on the side `fuseOpeningDash`
  // reads. Its mirror is pinned by "a description-list separator in
  // front of the run" above; this is the other direction, where the
  // separator stands BEHIND the run and the fused word would hide it
  // from the anchored `DLIST_SEPARATOR_WORD` just the same.
  //
  // The separator has to arrive from a LATER source line for the fold
  // to be asked about it at all, which is what this row spells. Fusing
  // it would put `x::` on the first output line, and the paragraph
  // would come back a DESCRIPTION LIST: measured, the fused spelling
  // renders `<dt>a - x</dt><dd>y</dd>` where the input renders one
  // paragraph.
  test("a description-list separator behind the run", async () => {
    const input = ":e:\n\na\n{e}-\tx:: y\n";
    const output = await formatAdoc(input);
    expect(output).toBe(":e:\n\na {e}-\nx:: y\n");
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
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
