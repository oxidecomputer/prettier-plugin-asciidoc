import { describe, expect, test } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Byte-identical, render-equal, idempotent — the passthrough triple.
 * @param input - the document
 */
async function expectByteFaithful(input: string): Promise<void> {
  await expectFormatted(input, input);
}

describe("verbatim-styled paragraphs keep their extent (issues #41, #39)", () => {
  test("#41-1: [NOTE] inside a [source] paragraph", async () => {
    await expectByteFaithful("[source]\nline1\n[NOTE]\nline2\n");
  });

  test("#41-2: ---- inside a [source] paragraph (setext-safe shape)", async () => {
    await expectByteFaithful("[source]\nfirst content line\n----\nbar\n");
  });

  // The issue's original shape is not a styled paragraph at all: an
  // underline within one character of the line above it is a SETEXT
  // TITLE, and `is_next_line_section?` decides that before the style
  // gets a say. Both titles come back in the ATX spelling, and the
  // render is the oracle's own two sections (issue #16).
  test("the issue's original ---- shape is two setext titles", async () => {
    await expectFormatted(
      "[source]\nline1\n----\nline2\n----\n",
      "[source]\n== line1\n\n== line2\n",
    );
  });

  test("#39: stacked preprocessor lines gain no blank line", async () => {
    await expectByteFaithful("* a\n[source]\nflush\nifdef::x[]\nifdef::x[]\n");
  });

  test("#39 class (e): the doubled break at a raw-line join is gone", async () => {
    await expectByteFaithful("[source]\nflush\nifdef::x[]\nifdef::x[]\n");
  });

  test("the opening-line + is content", async () => {
    await expectByteFaithful("[source]\n+\nfoo\n");
  });

  test("a list marker line under [source] keeps its bytes", async () => {
    await expectByteFaithful("[source]\n* item\n");
  });

  test("the (c)-guard characterization: a held title stays unconverted", async () => {
    await expectByteFaithful("[source,ruby]\n.Title\nfoo\n");
  });

  test("the (c)-guard characterization: a held anchor keeps today's bytes", async () => {
    const input = "[source]\n[[a]]\nfoo\n";
    const output = await formatAdoc(input);
    expect(output).toBe("[source]\n[[a]]\n\nfoo\n");
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });
});
