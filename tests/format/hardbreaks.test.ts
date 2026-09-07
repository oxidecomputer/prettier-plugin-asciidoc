/**
 * The hardbreaks option, in every form a document can spell it, and
 * the two macro targets whose runs the converter reads.
 *
 * Both are rows of the whitespace record (src/whitespace-fact.ts),
 * and both are pinned HERE through the printer rather than only over
 * the record, because what the issues are about is the bytes the
 * formatter writes: a record that says "keep this newline" and a
 * packer that folds it anyway is the shape both bugs had.
 *
 * `expectFormatted` asserts three things per row - the exact output,
 * that both programs render the output as they render the input, and
 * that a second format moves nothing - so a row that is a fixed point
 * here is one the reader can trust.
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

/**
 * Issue #80: a hardbreaks paragraph was reflow-joined.
 *
 * `sub_post_replacements` reads every newline of such a block as a
 * `<br>`, so joining two lines deletes a rendered break. Red before
 * the record's hardbreaks row, measured on the base tree:
 * `formatAdoc("[%hardbreaks]\nLine one\nLine two\n")` printed
 * `"[%hardbreaks]\nLine one Line two\n"`, whose render carries no
 * `<br>` where the input's carries one. Every row below printed its
 * body as one joined line before the row landed.
 *
 * The option is read from the DOCUMENT'S OWN TEXT and from nowhere
 * else (docs/architecture.md states the contract), which is why the
 * block form and the two document-attribute spellings each get a row.
 */
describe("a hardbreaks block keeps its line breaks (#80)", () => {
  test.each([
    ["the block attribute", "[%hardbreaks]\nLine one\nLine two\n"],
    ["the long options form", "[options=hardbreaks]\nLine one\nLine two\n"],
    ["the document attribute", ":hardbreaks-option:\n\nLine one\nLine two\n"],
    ["the legacy document attribute", ":hardbreaks:\n\nLine one\nLine two\n"],
  ])("%s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // The run's WIDTH still folds, and that is the row saying `bound`
  // and not `verbatim`: the option reads whether a line boundary
  // stands there, never how wide the run beside it was.
  test("the option binds the spelling, not the width", async () => {
    await expectFormatted(
      "[%hardbreaks]\nLine  one\nLine   two\n",
      "[%hardbreaks]\nLine one\nLine two\n",
    );
  });

  // The attribute line need not be the LAST line of the metadata run
  // over the block. Asciidoctor reads every attribute line of the run
  // onto the block that follows, so a title or a second attribute
  // line between them changes nothing.
  //
  // Red before `contextAbove` walked the run: it read only the block
  // directly above, so both rows printed `Line one Line two` and lost
  // the `<br>` in both programs.
  test.each([
    ["a block title under it", "[%hardbreaks]\n.T\nLine one\nLine two\n"],
    ["a second attribute line", "[%hardbreaks]\n[.role]\nLine one\nLine two\n"],
    [
      "an attribute line over it",
      "[.role]\n[%hardbreaks]\nLine one\nLine two\n",
    ],
    ["an anchor over it", "[[a]]\n[%hardbreaks]\nLine one\nLine two\n"],
  ])("%s", async (_name, input) => {
    await expectFormatted(input, input);
  });
});

/**
 * Issue #224, the FOLD direction: the converter URL-encodes an
 * `image:`/`icon:` target's whitespace into `src`, so folding a run
 * inside one rewrites the address.
 *
 * Red before the record's macro-target row, measured on the base
 * tree: `x image:a  b.png[] y` printed `x image:a b.png[] y`, whose
 * `<img src="a%20b.png">` is a different address from the input's
 * `a%20%20b.png`. At a narrow width the base broke INSIDE the target
 * as well, which splits the macro in two.
 *
 * The JOIN direction of the same issue - a reflow join fusing two
 * lines into a target neither line held - is untouched here and stays
 * open: a target spanning a line break is a target in neither
 * program, so no run of the record lies inside one.
 */
describe("a macro target's run is written back (#224)", () => {
  test.each([
    ["an image target", "x image:a  b.png[] y\n"],
    ["an icon target", "x icon:a  b.png[] y\n"],
    ["a tab in an image target", "x image:a\tb.png[] y\n"],
  ])("%s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // The target may not be broken across a line either, which is what
  // the run being an atom of its own buys: at width 10 the packer
  // puts the whole macro on its own line rather than inside it.
  test("a narrow width breaks around the target, not inside it", async () => {
    await expectFormatted(
      "x image:a  b.png[] y\n",
      "x\nimage:a  b.png[]\ny\n",
      { printWidth: 10 },
    );
  });

  // A `menu:` target is BOUND and not verbatim: its class admits no
  // newline, so no break may land inside it, but its width is not
  // read and still folds.
  test("a menu target admits no break, and its width folds", async () => {
    await expectFormatted(
      "x menu:File  Edit[New] y\n",
      "x menu:File Edit[New] y\n",
    );
  });
});
