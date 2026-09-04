/**
 * Format tests for bibliography anchors: `[[[id]]]` and
 * `[[[id, reftext]]]` (InlineBiblioAnchorRx, rx.rb l.457). Issue #8.
 *
 * Comma-space ruling: NO normalization, unlike the two-bracket
 * anchor's `[[id,reftext]]` respelled `[[id, reftext]]`
 * (tests/format/anchor-spelling.test.ts). That normalization is free
 * there because `reftext` never reaches the HTML output at all (Ruby
 * keeps it only for DocBook's `xreflabel`). A bibliography anchor's
 * reftext IS the rendered citation text (`[[[gof, 1]]]` renders
 * `<a id="gof"></a>[1]`, measured), and Ruby's own separator consumes
 * literal SPACES only (rx.rb l.457's `, *`) - a tab right after the
 * comma is not separator, it is the reftext's own first character
 * (`[[[id,\t1]]]` renders `[<TAB>1]`, not `[1]`). Verbatim replay
 * sidesteps that whole near-miss-respell class by never attempting
 * one: this file's ruling matches the pre-existing pin in
 * tests/format/anchor-spelling.test.ts's "bibliography anchors print
 * the author's interior verbatim" suite, extended here to the
 * one-argument form and the false-positive/reflow/whitespace corners
 * that suite does not cover.
 */
import { describe, expect, test } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

describe("bibliography anchors - verbatim round-trip, every comma spelling", () => {
  test.each([
    [
      "one-argument form",
      '[bibliography]\n* [[[gof]]] Gamma, et al. "Design Patterns."\n',
    ],
    [
      "two-argument form, comma-tight",
      "[bibliography]\n* [[[gof,1]]] Gamma, et al.\n",
    ],
    [
      "two-argument form, one space",
      "[bibliography]\n* [[[gof, 1]]] Gamma, et al.\n",
    ],
    [
      "two-argument form, two spaces",
      "[bibliography]\n* [[[gof,  1]]] Gamma, et al.\n",
    ],
    [
      "two-argument form, a tab (not Ruby's separator - reftext's own byte)",
      "[bibliography]\n* [[[gof,\t1]]] Gamma, et al.\n",
    ],
    [
      "a grammar-rejected id, comma-tight",
      "[bibliography]\n* [[[3-bad,Ref]]] text\n",
    ],
    [
      "a grammar-rejected id, with a space",
      "[bibliography]\n* [[[3-bad, Ref]]] text\n",
    ],
    [
      "comma-tight empty reftext is literal text to the oracle",
      "[bibliography]\n* [[[id,]]] text\n",
    ],
    [
      "a lone space after the comma stays a live anchor",
      "[bibliography]\n* [[[id, ]]] text\n",
    ],
    [
      "the false-positive control: not at the start of the item",
      "[bibliography]\n* See [[[gof]]] for details.\n",
    ],
    [
      "the false-positive control, plain paragraph",
      "Some text [[[gof]]] more text.\n",
    ],
  ])("%s", async (_name, input) => {
    await expectFormatted(input, input);
  });
});

describe("bibliography anchors - the atom never breaks under reflow", () => {
  // The anchor is one VerbatimNode atom (verbatimText,
  // serialize-inline.ts): a narrow printWidth may wrap the words after
  // it, but the bracket run itself is one unsplittable atom, the same
  // guarantee every other atomic inline construct already has.
  test("stays on one line under a narrow width", async () => {
    const input =
      "[bibliography]\n* [[[a-very-long-bibliography-anchor-id]]] text\n";
    const out = await formatAdoc(input, { printWidth: 20 });
    const anchorLine = out
      .split("\n")
      .find((line) =>
        line.includes("[[[a-very-long-bibliography-anchor-id]]]"),
      );
    expect(anchorLine).toBe("* [[[a-very-long-bibliography-anchor-id]]]");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });
});

describe("bibliography anchors - a paragraph of only the anchor is not an anchor LINE", () => {
  // src/block-metadata.ts's `anchorOfLine` excludes `form ===
  // "bibliography"` on purpose: its printed line is `[[[x]]]`, three
  // brackets, which can never match the two-bracket `BLOCK_ANCHOR`
  // grammar `anchorLineShape` answers against. Without that guard,
  // `anchorOfLine` hands the node to the two-bracket `anchorToSource`
  // anyway, and the paragraph gets treated as a real block-anchor
  // line - the stacking rules in src/print/join.ts and
  // src/print/list-hazard.ts then fold its blank-line separation from
  // the block below, corrupting structure: a paragraph that is really
  // `[[[x]]]` alone re-reads as metadata for the list/listing that
  // follows it, and the blank line the author wrote is deleted.
  test.each([
    ["a list follows", "[[[x]]]\n\n* item\n"],
    ["a listing block follows", "[[[x]]]\n\n----\ncode\n----\n"],
  ])("%s: the blank line survives", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });
});
