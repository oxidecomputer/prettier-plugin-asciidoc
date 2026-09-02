/**
 * The `+` an author left at a list item's END — the line that attaches
 * nothing. Ruby pops it (`buffer.pop if ListContinuationMarker ===
 * buffer[-1]`, parser.rb l.1580-82) and it renders not one character,
 * so the item is exactly what it would be without the line. The BYTE
 * still comes back: the author wrote it, a re-read of the output pops
 * it again, and printing it costs the reading nothing. What decides is
 * the tail it would be printed into: a `+` above a blank line ERASES
 * and arms instead of popping, and there the byte is dropped rather
 * than made to mean something the source did not.
 *
 * Its sibling family — a `+` that DID attach a block — lives in
 * tests/format/list-continuation.test.ts.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

// One row per place the byte can stand. Each asserts the exact
// output, that Asciidoctor renders that output as it renders the
// input, and that a second pass is a fixed point.
describe("a popped + comes back where the tail re-reads inert", () => {
  test.each([
    ["at the last item's end", "* a\n+\n", "* a\n+\n"],
    ["mid-list, before the next marker", "* a\n+\n* b\n", "* a\n+\n* b\n"],
    [
      "after a block the + DID attach",
      "* a\n+\npara\n+\n",
      "* a\n+\npara\n+\n",
    ],
    ["at an ordered item's end", ". a\n+\n. b\n", ". a\n+\n. b\n"],
    ["at a callout item's end", "<1> a\n+\n", "<1> a\n+\n"],
    // The run's SECOND `+` is the one buffered and popped; the third
    // and later are read and dropped by Ruby's own gate (l.1444), so
    // the run comes back as the one byte the pop was about.
    ["a run of two", "* a\n+\n+\n", "* a\n+\n"],
    ["a run of three", "* a\n+\n+\n+\n", "* a\n+\n"],
    ["a run of three before a sibling", "* a\n+\n+\n+\n* b\n", "* a\n+\n* b\n"],
    [
      "an item whose text wrapped onto a second line",
      "* a\nb\n+\n",
      "* a b\n+\n",
    ],
    // The same shape with a sibling behind it, and the row exists for
    // WHERE the answer comes from. The scan's own answer is that the
    // pop took a live `+` at a boundary that re-reads inert, and this
    // item has no block at all - so an answer conjoined with anything
    // about the item's BLOCKS (does one of them read on past the
    // item? is the item nested?) says drop, and the byte the author
    // wrote disappears. The block-shape conjunct is deleted and the
    // fact is recorded where it is decided, which is what this row
    // pins: `ListItemNode.trailingContinuation` is the extent's
    // answer, unqualified.
    [
      "wrapped text, a popped +, and a sibling behind it",
      "* a\nb\n+\n* b\n",
      "* a b\n+\n* b\n",
    ],
    [
      "behind a delimited block the + DID attach",
      "* a\n+\n----\nx\n----\n+\n",
      "* a\n+\n----\nx\n----\n+\n",
    ],
    // A description's body ending in held metadata: the `+` is what
    // carries the anchor's own paragraph (`<div id="anc"><p>+</p>`),
    // so dropping it deleted a rendering.
    [
      "behind a description body's block anchor",
      "t:: d\n** b\n[[anc]]\n+\n",
      "t:: d\n\n** b\n[[anc]]\n+\n",
    ],
    // Tails where an item's own re-read runs on past it: a nested
    // item read from another item's buffer, an indented literal whose
    // slurp carries the `+` into the `<pre>`, a paragraph that already
    // swallowed a marker line, a nested list. These kept the byte
    // before the pop and the boundary alone decided; they still do.
    ["at a nested item's end", "* a\n** b\n+\n", "* a\n** b\n+\n"],
    [
      "behind an indented literal",
      "* a\n\n  lit\n+\n* b\n",
      "* a\n\n  lit\n+\n* b\n",
    ],
    [
      "a nested item behind a literal",
      "* a\n** b\n+\n  lit\n+\n** b\n",
      "* a\n** b\n+\n  lit\n+\n** b\n",
    ],
    [
      "a nested item behind a blank-offset literal",
      "* a\n** b\n\n  lit\n+\n** b\n",
      "* a\n** b\n\n  lit\n+\n** b\n",
    ],
    [
      "a nested item under a frozen + run",
      "* a\n+\n+\n** b\n+\n** b\n",
      "* a\n+\n+\n** b\n+\n** b\n",
    ],
    [
      "behind a paragraph that swallowed a marker",
      "* a\n+\npara\n** b\n+\n+\n",
      "* a\n+\npara\n** b\n+\n+\n",
    ],
    [
      "behind a paragraph that is part prose, part swallowed marker",
      "* a\n+\npara\n** b\n+\n",
      "* a\n+\npara\n** b\n+\n",
    ],
    [
      "behind a literal and a raw line",
      "* a\n[role]\n  lit\n** b\n+\n+\n",
      "* a\n[role]\n  lit\n** b\n+\n+\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// The `+` an ENCLOSING scan already spent. Its byte belongs to the
// outer item's tail record, so the inner item must not claim it too.
describe("an erased shield is the enclosing item's, not the inner one's", () => {
  test.each([["a shield above a nested item", "* a\n+\n+\n** b\n"]])(
    "%s",
    async (_name, input) => {
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    },
  );

  // The tail-safety a BLOCK confers, which is the arm nothing pinned:
  // `BlockReader`'s child inherits `tailSafe` unless the block CLOSED
  // (`tailSafe: extent.close !== undefined || this.tailSafe`,
  // src/parse/lines/reader.ts). An UNCLOSED block's interior ends where
  // the stream does, so the `+` at its end is in the same position as a
  // `+` at the document's end and comes back for the same reason. The
  // printer then closes the block, which is where the difference shows:
  // with the inheritance forced off, the `+` is dropped and the block
  // closes over a shorter item. Found by mutation testing over a
  // delimiter alphabet — the list-shape sweep's alphabet has no
  // delimited blocks, so nothing in it can reach this arm.
  test.each([
    [
      "an unclosed example block",
      "====\n* a\n** b\n+\n",
      "====\n* a\n** b\n+\n====\n",
    ],
    ["an unclosed open block", "--\n* a\n** b\n+\n", "--\n* a\n** b\n+\n--\n"],
  ])("a + at the end of %s comes back", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // NOT kept: a blank run follows the `+` in the output, and a `+`
  // above a blank ERASES and arms on re-read, which would attach a
  // paragraph the source left detached. The nested list makes no
  // difference; what decides is the tail (`ItemExtent.tailSafe`).
  test.each([
    ["behind a nested list", "* a\n** b\n+\n\n\npara\n", "* a\n** b\n\npara\n"],
    ["ending a run of three", "* a\n+\n+\n+\n\npara\n", "* a\n\npara\n"],
  ])(
    "a + a following blank run would erase is dropped, %s",
    async (_name, input, expected) => {
      const out = await formatAdoc(input);
      expect(out).toBe(expected);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    },
  );
});

// Ruby recognises the poppable `+` by IDENTITY, not by text: the
// line is swapped for a String extended with `ListContinuationMarker`
// at the top of the loop (parser.rb l.1432), and only such an
// instance answers `ListContinuationMarker === buffer[-1]` at l.1580-81.
// A `+` that reached the item's buffer INSIDE a slurped delimited
// block never went through that swap, so it is block CONTENT — the
// oracle renders it as a paragraph inside the block — and the pop
// must leave it alone.
describe("a + a slurp carried in is block content, not the item's tail", () => {
  test.each([
    [
      "the last line of an unterminated example",
      "* i\n+\n====\npara\n+\n",
      "* i\n+\n====\npara\n\n+\n====\n",
    ],
    [
      "under a listing inside an unterminated example",
      "* i\n+\n====\n----\nfoo\n----\n+\n",
      "* i\n+\n====\n----\nfoo\n----\n\n+\n====\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// The other side of the same rule: the byte comes back where the
// reader cannot prove Ruby's own read ended where ours did. Four
// tails say it cannot — an item read from ANOTHER item's buffer (the
// enclosing scan reshaped the lines first), an indented literal
// (whose slurp carries the `+` into the `<pre>`), a paragraph holding
// a raw line (prose that already swallowed a line), and a nested list
// (whose own re-read re-partitions the lines). Every row is a fixed
// point that renders exactly as its source.
