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
