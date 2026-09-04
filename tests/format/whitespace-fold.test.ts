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
