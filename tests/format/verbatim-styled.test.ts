import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

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
    await expectFormatted(input, "[source]\n[[a]]\n\nfoo\n");
  });
});

/**
 * A lone `+` INSIDE a `+`-attached styled verbatim run (issue #201).
 *
 * The two Asciidoctors read this shape differently, and the
 * difference is what these rows are pinned against. Ruby 2.0.26
 * replaces the item's `+` with `ListContinuationPlaceholder`, an
 * empty String, so `read_lines_until`'s own `line.empty?` breaks the
 * run there and the lines below it become a paragraph in the item.
 * `@asciidoctor/core` boxes the same placeholder in a String subclass
 * whose `line === ''` test fails, so the run swallows it and
 * everything under it stays inside the `<pre>`.
 *
 * The formatter answers both by keeping the bytes: the run takes the
 * placeholder as content, so nothing under it is reflowed and the
 * document formats to itself. Byte-identical output is render-equal
 * whichever of the two reads it, which is why these rows assert the
 * bytes rather than a structure.
 *
 * Before this was pinned, the run ended at the `+`, the lines under
 * it were read as a paragraph, and reflow joined them: the first four
 * rows below came back joined (`plain text b`, `** nested b`),
 * deleting a newline that is content inside the oracle's own `<pre>`.
 * The fifth CHARACTERIZES rather than pins a fix, and it is marked
 * where it stands.
 */
describe("a lone + inside a +-attached styled verbatim run", () => {
  test.each([
    ["the issue's witness", "* item\n+\n[source]\na\n+\nplain text\nb\n"],
    ["a verse run", "* item\n+\n[verse]\na\n+\nplain text\nb\n"],
    ["a description item", "term1:: desc\n+\n[source]\na\n+\nplain text\nb\n"],
    [
      "a nested marker under the +",
      "* item\n+\n[source]\na\n+\n** nested\nb\n",
    ],
    // CHARACTERIZATION, not a pin on the fix: this row was already
    // byte-faithful when the run ended at the `+`, because a run of
    // one-word lines gives reflow nothing to join. It says what the
    // structure change does NOT cost, which is why it is here at all.
    ["a second lone +", "* item\n+\n[source]\na\n+\nb\n+\nc\n"],
  ])("%s formats to itself", async (_name, input) => {
    await expectByteFaithful(input);
  });

  // The perturbation that separates the placeholder from the `+`
  // itself: a REAL blank line ends the run for both Asciidoctors
  // (`a` alone in the `<pre>`, `plain text b` a paragraph under it),
  // so the lines below it are a paragraph here too and reflow may
  // join them. Only the placeholder the item scan wrote is content.
  test("a blank line before the + still ends the run", async () => {
    await expectFormatted(
      "* item\n+\n[source]\na\n\n+\nplain text\nb\n",
      "* item\n+\n[source]\na\n\n+\nplain text b\n",
    );
  });

  // The neighbouring shape the two Asciidoctors AGREE on, pinned so
  // the placeholder rule stays off it: an INDENTED literal run inside
  // an item is slurped by the item scan itself (parser.rb l.1495),
  // not by a `read_lines_until` over the item's buffer, so the `+`
  // under it ends the run in both and the paragraph below reflows.
  test("an indented literal run under an item is untouched", async () => {
    await expectFormatted(
      "* item\n+\n lit line\n+\nplain text\nb\n",
      "* item\n+\n lit line\n+\nplain text b\n",
    );
  });
});
