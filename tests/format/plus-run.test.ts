/**
 * `+` RUNS — adjacent continuation lines and the erased detached `+`
 * behind them (#56's family). `read_lines_for_list_item` erases the
 * first `+` of a run and buffers the second as CONTENT (parser.rb
 * l.1435-46); the post-loop cleanup pops AT MOST ONE tagged line
 * (l.1580-82), so a trailing detached `+` — blanked into the erased
 * shield by l.1576 — absorbs that pop and keeps the frozen `+`
 * paragraph alive on re-read. The printer therefore writes the erased
 * tail back (one blank, one `+`) exactly when the item ends in such a
 * paragraph, and separates a still-armed metadata tail from the next
 * block with the two blanks that keep it detached. The single `+`
 * that attaches or pops cleanly lives in
 * tests/format/list-continuation.test.ts and
 * tests/format/trailing-continuation.test.ts.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

// Every row asserts the exact output, that Asciidoctor renders the
// output as it renders the input, and that a second pass is a fixed
// point.
describe("a frozen + paragraph keeps its erased shield", () => {
  test.each([
    ["the issue's flat shape", "* a\n\n+\n+\n\n+\n", "* a\n\n+\n+\n\n+\n"],
    ["the canonical adjacent run", "* a\n+\n+\n\n+\n", "* a\n+\n+\n\n+\n"],
    ["on a second sibling", "* a\n* a\n+\n+\n\n+\n", "* a\n* a\n+\n+\n\n+\n"],
    [
      "before a sibling marker",
      "* a\n+\n+\n\n+\n* a\n",
      "* a\n+\n+\n\n+\n* a\n",
    ],
    [
      "under a comment line",
      "* a\n// c\n+\n+\n\n+\n",
      "* a\n// c\n+\n+\n\n+\n",
    ],
    [
      "under a block anchor",
      "* a\n[[anc]]\n+\n+\n\n+\n",
      "* a\n[[anc]]\n+\n+\n\n+\n",
    ],
    [
      "under a block attribute line",
      "* a\n[role]\n+\n+\n\n+\n",
      "* a\n[role]\n+\n+\n\n+\n",
    ],
    // The principal text reflows; the run and its shield are untouched.
    [
      "an indented literal folded into the text",
      "* a\n  lit\n+\n+\n\n+\n",
      "* a lit\n+\n+\n\n+\n",
    ],
    [
      "a block title folded into the text",
      "* a\n.T\n+\n+\n\n+\n",
      "* a .T\n+\n+\n\n+\n",
    ],
    [
      "a second text line folded in",
      "* a\npara\n+\n+\n\n+\n",
      "* a para\n+\n+\n\n+\n",
    ],
    // Byte-inert variations normalize to the canonical spelling: the
    // shield's blank run collapses to one blank, the third `+` of a
    // run and a junk `+` behind the shield are read and dropped, a
    // trailing document blank goes.
    ["a two-blank shield", "* a\n+\n+\n\n\n+\n", "* a\n+\n+\n\n+\n"],
    [
      "a document blank after the shield",
      "* a\n+\n+\n\n+\n\n",
      "* a\n+\n+\n\n+\n",
    ],
    [
      "a junk + adjacent to the shield",
      "* a\n+\n+\n\n+\n+\n",
      "* a\n+\n+\n\n+\n",
    ],
    ["a run of three", "* a\n+\n+\n+\n\n+\n", "* a\n+\n+\n\n+\n"],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// A `+` whose activation ran through metadata only is still ARMED
// where the item ends: one blank line under it attaches the next
// block on re-read (parser.rb l.1483), so the printer keeps the two
// blanks that detach it (l.1549).
describe("a live metadata tail keeps its two-blank detachment", () => {
  test.each([
    ["under a block title", "* a\n+\n.T\n\n\npara\n", "* a\n+\n.T\n\n\npara\n"],
    [
      "under a block anchor",
      "* a\n+\n[[anc]]\n\n\npara\n",
      "* a\n+\n[[anc]]\n\n\npara\n",
    ],
    [
      "under a block attribute line",
      "* a\n+\n[role]\n\n\npara\n",
      "* a\n+\n[role]\n\n\npara\n",
    ],
    [
      "a run of three blanks collapses to the two that detach",
      "* a\n+\n[role]\n\n\n\npara\n",
      "* a\n+\n[role]\n\n\npara\n",
    ],
    // The double blank fires uniformly — a comment after the tail is
    // render-inert, but the two blanks are what keep it OUT of the
    // item on re-read.
    [
      "before a comment line",
      "* a\n+\n[role]\n\n\n// c\n",
      "* a\n+\n[role]\n\n\n// c\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// The same live tail, inside an item that ALSO holds a nested list.
// `finish()`'s l.1576 erase runs with no `within_nested_list` guard,
// so the detached `+` still reaches the output through the gap record
// and a re-read still activates through the metadata below it — the
// two blanks are what keep the paragraph OUT of the item, and
// collapsing them would attach it with the metadata applied.
describe("a live metadata tail behind a nested list detaches too", () => {
  test.each([
    [
      "under a block attribute line",
      "* a\n** b\n\n+\n[role]\n\n\npara\n",
      "* a\n** b\n\n+\n[role]\n\n\npara\n",
    ],
    [
      "under a block title",
      "* a\n** b\n\n+\n.T\n\n\npara\n",
      "* a\n** b\n\n+\n.T\n\n\npara\n",
    ],
    [
      "under a block anchor",
      "* a\n** b\n\n+\n[[anc]]\n\n\npara\n",
      "* a\n** b\n\n+\n[[anc]]\n\n\npara\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// An INDENTED line folded in behind a `+` head keeps its column. The
// fold is a paragraph to us, but a re-read hands those same lines to a
// literal block's verbatim slurp (`read_lines_until
// break_on_blank_lines, break_on_list_continuation`), which copies
// them into `<pre>` byte for byte — reflowing one off its indent
// rewrites verbatim content, or drops the `indented && !style` branch
// that made the block literal at all.
describe("an indented line folded behind a + keeps its indent", () => {
  test.each([
    [
      "inside the nested item's literal",
      "* a\n** b\n+\n  lit\n+\n+\n  lit\n",
      "* a\n** b\n+\n  lit\n+\n+\n  lit\n",
    ],
    [
      "the same literal opened by a blank instead of a +",
      "* a\n** b\n\n  lit\n+\n+\n  lit\n",
      "* a\n** b\n\n  lit\n+\n+\n  lit\n",
    ],
    [
      "the indent is what makes the inner block literal",
      "* a\n[role]\n+\n+\n** b\n+\n  lit\n",
      "* a\n[role]\n+\n+\n** b\n+\n  lit\n",
    ],
    // The depth-5 edge of the same mechanism, render-equal either way
    // — the bytes now hold there too.
    [
      "a fold that ends at a marker line",
      "* a\n+\n+\n  lit\n+\n** b\n",
      "* a\n+\n+\n  lit\n+\n** b\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// A scan that hard-stops ON an erased line ends at a SAFE boundary:
// that line is the enclosing item's own blanked `+`, whose spelling
// the enclosing gap replays around this item's tail, so a `+` printed
// there comes back shielded by exactly the run the source wrote and
// re-reads as the frozen `+` it was. Dropping the byte instead moves
// the literal from the outer item to the inner one.
describe("a tail stopping at an erased line keeps its +", () => {
  test.each([
    [
      "an adjacent run above the shield the outer item replays",
      "* a\n** b\n+\n+\n\n+\n  lit\n",
      "* a\n** b\n+\n+\n\n+\n  lit\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// The tails the two-blank arm must NOT touch.
describe("tails that are not live keep their one blank", () => {
  test.each([
    [
      "one blank attaches, and stays attached",
      "* a\n+\n[role]\n\npara\n",
      "* a\n+\n[role]\n\npara\n",
    ],
    [
      "an active tail at EOF needs no separator",
      "* a\n+\n[role]\n",
      "* a\n+\n[role]\n",
    ],
    [
      "a nested item's popped + is not a live tail",
      "* a\n** b\n+\n\n\npara\n",
      "* a\n** b\n\npara\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// A detached RUN between nested items splits the list where the JS
// oracle does: the inner scan hard-stops at the erased Placeholder,
// the sibling probe eats it, and the frozen `+` opens a
// content-adjacent paragraph that breaks at the next marker.
describe("an erased + run between nested items", () => {
  test.each([
    [
      "the run splits the nested list and survives verbatim",
      "* a\n** b\n\n+\n+\n** b\n",
      "* a\n** b\n\n+\n+\n** b\n",
    ],
    [
      "the frozen + folds nothing when a paragraph follows it",
      "* a\n** b\n\n+\n+\npara\n",
      "* a\n** b\n\n+\n+\npara\n",
    ],
    [
      "a SINGLE detached + between siblings is still eaten",
      "* a\n** b\n\n+\n** b\n",
      "* a\n** b\n** b\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// A frozen `+` opened after a skipped blank does not break at marker
// lines: the paragraph is non-content-adjacent to the oracle
// (parser.js l.1065) and folds them as raw lines, stopping only at a
// blank, a plain `+`, a block-attribute line, or a delimiter.
describe("a +-headed paragraph folds marker lines", () => {
  test.each([
    [
      "the inter-item blank survives behind the fold",
      "* a\n+\n+\n** b\n\n** b\n",
      "* a\n+\n+\n** b\n\n** b\n",
    ],
    [
      "an adjacent run and its markers hold their bytes",
      "* a\n+\n+\n** b\n** b\n",
      "* a\n+\n+\n** b\n** b\n",
    ],
    [
      "a tagged + mid-fold is run through, not a break",
      "* a\n+\n+\n** b\n+\n** b\n",
      "* a\n+\n+\n** b\n+\n** b\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// The erased tail is dropped everywhere it shields nothing: behind an
// ordinary attached block the re-read pops nothing that renders, so
// the bytes stay gone.
describe("an erased tail behind an ordinary block stays dropped", () => {
  test.each([
    ["behind an attached paragraph", "* a\n+\npara\n\n+\n", "* a\n+\npara\n"],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
