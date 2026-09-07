/**
 * A description whose every line reads as a comment to
 * `Reader#skip_line_comments` (reader.rb l.329-346) and the erased `+`
 * that is the only reason it is still in the render.
 *
 * `parse_list_item` peeks past a run of `//`-headed lines before it
 * reads an item's first block and puts them back only when a line
 * FOLLOWS the run (parser.rb l.1362-71). A trailing `+` is what leaves
 * such a line standing: the post-loop pops the `+` and BREAKS
 * (l.1580-82), so the blank above it survives the strip that would
 * otherwise take it, the peek sees that blank and unshifts, and the
 * description stays. Print the item without the `+` and the drain
 * takes the whole body: the `<dd>` and everything in it leave the
 * render (issues #171 and #212).
 *
 * WHAT THE RUN RENDERS DOES NOT ENTER. `///`, `///c` and `////x` are
 * paragraphs to the parser and `// c` is a comment, but the drain
 * deletes all four the same way, and the byte that stops it is the
 * author's either way. The `// c` rows below are the ones whose bytes
 * move without their render moving.
 *
 * The second block below is the one the byte's MEANING lives in: a `+`
 * says something different depending on how many blank lines stand
 * under it (one arms it and attaches the next block,
 * `read_lines_for_list_item`'s `:active` arm at parser.rb l.1483; two
 * detach it, the after-blank break at l.1549), so every follower shape
 * is pinned at both counts.
 *
 * {@link expectFormatted} holds each row to the bytes, to the oracle's
 * render of the INPUT, and to the fixed point.
 */
import { describe, test } from "vitest";
import { expectFormatted } from "../helpers.js";

describe("a drainable description keeps the + that shields it", () => {
  test.each([
    // RED before the fix: each of these printed without its `\n+`
    // line, and the `<dd>` left the render with it.
    ["a three-slash line", "term::\n///\n\n+\n"],
    ["a comment-block delimiter with a tail", "term::\n////x\n\n+\n"],
    ["a three-slash line with text (issue #212)", "term::\n///c\n\n+\n"],
    ["two drainable lines", "term::\n////x\n////y\n\n+\n"],
    ["a run of a comment and a slash line", "term::\n///\n// d\n\n+\n"],
    // RED before the widening on the byte alone: a `//` line renders
    // nothing whether the drain takes it or not, so these rows keep
    // their render either way and it is the author's line that was
    // being deleted.
    ["a plain line comment", "term::\n// c\n\n+\n"],
    ["a run of two line comments", "term::\n// c\n// d\n\n+\n"],
    // The blank the greedy read pops (parser.rb l.1551-56) does not
    // reach the item's buffer, so it stops no drain and the shield is
    // still what keeps the description.
    ["a blank between the term and the body", "term::\n\n///\n\n+\n"],
    // A term line carrying its own description still leaves the rest
    // lines to the drain.
    ["a term with inline text", "term:: x\n///\n\n+\n"],
    ["a following sibling", "t::\n///\n\n+\nu:: v\n"],
    ["a preceding sibling", "a:: b\nterm::\n///\n\n+\n"],
  ])("%s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // The shield's blank RUN collapses to one blank, the same
  // normalization every gap takes.
  test("a two-blank shield", async () => {
    await expectFormatted("term::\n///\n\n\n+\n", "term::\n///\n\n+\n");
  });
});

describe("a shielded item keeps the blank count under its +", () => {
  // RED before the fix on every TWO-blank row: the item was closed
  // with a live `+` and then handed to the ordinary one-blank
  // separator, so the block the source had DETACHED was pulled into
  // the `<dd>` on re-read. The one-blank rows never moved and are
  // here as the other half of the pair: there the block really is
  // inside the item, and it prints from the recorded gap rather than
  // from the shield.
  test.each([
    ["a paragraph, detached", "term::\n///\n\n+\n\n\nnext para\n"],
    ["a paragraph, attached", "term::\n///\n\n+\n\nnext para\n"],
    ["a listing block, detached", "term::\n///\n\n+\n\n\n----\nx\n----\n"],
    ["a listing block, attached", "term::\n///\n\n+\n\n----\nx\n----\n"],
    ["a section title, detached", "term::\n///\n\n+\n\n\n== H\n"],
    ["a section title, attached", "term::\n///\n\n+\n\n== H\n"],
    ["a block title, detached", "term::\n///\n\n+\n\n\n.T\nz\n"],
    ["a block macro, detached", "term::\n///\n\n+\n\n\nimage::a.png[]\n"],
    [
      "a comment-block delimiter body and a listing block",
      "term::\n////x\n\n+\n\n\n----\nx\n----\n",
    ],
    [
      "a three-slash line with text and a paragraph (issue #212)",
      "term::\n///c\n\n+\n\n\nnext para\n",
    ],
    // The same pair over a body whose lines render nothing: the blank
    // count still decides where the follower lands, so the widened arm
    // owes these rows exactly as the rendering bodies do.
    [
      "a line-comment body and a paragraph, detached",
      "term::\n// c\n\n+\n\n\nnext para\n",
    ],
    [
      "a line-comment body and a paragraph, attached",
      "term::\n// c\n\n+\n\nnext para\n",
    ],
    [
      "a line-comment body and a listing block, detached",
      "term::\n// c\n\n+\n\n\n----\nx\n----\n",
    ],
    [
      "a line-comment body and a section title, detached",
      "term::\n// c\n\n+\n\n\n== H\n",
    ],
  ])("%s", async (_name, input) => {
    await expectFormatted(input, input);
  });

  // Block METADATA is the one follower whose own printing respells it:
  // the admonition label folds onto its paragraph. The separator above
  // it is the fact this row pins, and it is still two blank lines.
  test("an admonition label, detached", async () => {
    await expectFormatted(
      "term::\n///\n\n+\n\n\n[NOTE]\ny\n",
      "term::\n///\n\n+\n\n\nNOTE: y\n",
    );
  });
});

describe("a description the drain cannot reach writes no shield", () => {
  test.each([
    // The drain stops at the first line that is not `//`-headed, so
    // the erased `+` changes no re-read and is dropped as always.
    [
      "a block under the description",
      "term::\n///\n\nx\n\n+\n",
      "term::\n///\n\nx\n\n+\n",
    ],
    [
      "a comment block under it",
      "term::\n///\n\n// c\n\n+\n",
      "term::\n///\n\n// c\n\n+\n",
    ],
    [
      "a + paragraph under it",
      "term::\n///\n\n+\n\n+\n",
      "term::\n///\n\n+\n\n+\n",
    ],
    // Already bodyless: the drain took the run at parse time, and the
    // bytes come back through the term's own gap.
    ["a drained body with no shield", "term::\n///\n", "term::\n///\n"],
    ["an adjacent trailing +", "term::\n///\n+\n", "term::\n///\n"],
    // Not a comment line at all.
    ["an ordinary description", "term::\ndesc\n\n+\n", "term:: desc\n"],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});
