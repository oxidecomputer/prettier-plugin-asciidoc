/**
 * The `+` an author left at a list item's END — the line that attaches
 * nothing. Ruby pops it (`buffer.pop if ListContinuationMarker ===
 * buffer[-1]`, parser.rb l.1580-81) and it renders not one character, so
 * the printer writes it nowhere and the reader records it nowhere.
 * Its sibling family — a `+` that DID attach a block — lives in
 * tests/format/list-continuation.test.ts.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

// One row per place the byte can stand. Each asserts the exact
// output, that Asciidoctor renders that output as it renders the
// input, and that a second pass is a fixed point.
describe("a + that attached nothing does not come back", () => {
  test.each([
    ["at the last item's end", "* a\n+\n", "* a\n"],
    ["mid-list, before the next marker", "* a\n+\n* b\n", "* a\n* b\n"],
    ["after a block the + DID attach", "* a\n+\npara\n+\n", "* a\n+\npara\n"],
    ["at an ordered item's end", ". a\n+\n. b\n", ". a\n. b\n"],
    ["at a callout item's end", "<1> a\n+\n", "<1> a\n"],
    ["a run of two", "* a\n+\n+\n", "* a\n"],
    ["a run of three", "* a\n+\n+\n+\n", "* a\n"],
    ["a run of three before a sibling", "* a\n+\n+\n+\n* b\n", "* a\n* b\n"],
    [
      "a run of three before a blank and a paragraph",
      "* a\n+\n+\n+\n\npara\n",
      "* a\n\npara\n",
    ],
    ["an item whose text wrapped onto a second line", "* a\nb\n+\n", "* a b\n"],
    [
      // A DELIMITED block re-reads inside its own delimiters, so it
      // cannot carry the `+` past the item the way an indented literal's
      // slurp does — only `form === "indented"` keeps the byte.
      "behind a delimited block the + DID attach",
      "* a\n+\n----\nx\n----\n+\n",
      "* a\n+\n----\nx\n----\n",
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
describe("a + the reader cannot prove inert comes back", () => {
  test.each([
    ["at a nested item's end", "* a\n** b\n+\n"],
    ["behind an indented literal", "* a\n\n  lit\n+\n* b\n"],
    ["a nested item behind a literal", "* a\n** b\n+\n  lit\n+\n** b\n"],
    [
      "a nested item behind a blank-offset literal",
      "* a\n** b\n\n  lit\n+\n** b\n",
    ],
    ["a nested item under a frozen + run", "* a\n+\n+\n** b\n+\n** b\n"],
    [
      "behind a paragraph that swallowed a marker",
      "* a\n+\npara\n** b\n+\n+\n",
    ],
    [
      // The same tail with NOTHING frozen behind it, so the item's one
      // block is the mixed paragraph itself: prose plus the raw line it
      // swallowed. ONE raw child among them is what reads on past the
      // item — the block does not have to be raw lines throughout.
      "behind a paragraph that is part prose, part swallowed marker",
      "* a\n+\npara\n** b\n+\n",
    ],
    ["behind a literal and a raw line", "* a\n[role]\n  lit\n** b\n+\n+\n"],
  ])("%s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

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

  // NOT kept, even behind a nested list: a blank run follows the `+`
  // in the output, and a `+` above a blank ERASES and arms on re-read
  // — which would attach the paragraph the source left detached.
  test("a + a following blank run would erase is dropped", async () => {
    const input = "* a\n** b\n+\n\n\npara\n";
    const out = await formatAdoc(input);
    expect(out).toBe("* a\n** b\n\npara\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
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
