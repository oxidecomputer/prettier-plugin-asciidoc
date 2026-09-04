/**
 * Format tests for a `+` that stood ALONE on its own source line
 * (issue #43).
 *
 * Such a line is a list continuation, and reflow used to join it with
 * whatever followed. The joined line is not one our reader reads as a
 * continuation any more, and where the next line is a `term:: def`
 * one the join MANUFACTURES a description list the source never had.
 * The reading-invariant net (tests/format/reading-invariant.test.ts)
 * measures the same mechanism across the sweeps; these are the named
 * shapes, with the oracle's rendering asserted where the document
 * renders the same on both sides.
 */
import { describe, test, expect } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";
import { readingBreachesOf } from "../lib/reading.js";

// Issue #43. A `+` alone on a source line is a list continuation, and
// reflow used to join it with the words after it (`+ para two`,
// `+ term2:: def2`). The join deletes the reading the reader gave the
// line, and where the next line is a term line it MANUFACTURES a
// description list the source never had. Emptying this mechanism is
// what took the depth-5 reading ledger's lone-plus-join family from
// 710 rows to none.
describe("a lone + keeps the line the source gave it", () => {
  test.each([
    [
      "between two paragraphs",
      "para one\n+\npara two\n",
      "para one\n\n+\npara two\n",
    ],
    // The render-corrupting face: `+ term2:: def2` is a term line.
    [
      "before a term line, where the join would make a dlist",
      "+\nterm2:: def2\n",
      "+\nterm2:: def2\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // The `+` is the text node's ONLY word here - the two marker lines
  // after it parse as a bold span - so the join it has to survive is
  // the one between two inline siblings, not the one between two
  // words. The span's inner break replays as one space (the same
  // rule that fixed #55), which keeps this document render-equal to
  // its source, and the `+` still gets its line.
  test("before content that opens an inline span", async () => {
    const input = "+\n* a\n* a\n";
    const out = await formatAdoc(input);
    expect(out).toBe("+\n* a * a\n");
    expect(await readingBreachesOf(input)).toEqual([]);
    expect(await formatAdoc(out)).toBe(out);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });

  // The cross-node arm alone decides this shape: the span leaves the
  // text node as just "+\n", so the within-node exemption never sees
  // the join, and only the trailing boundary keeps the + on its line.
  test("a bare span after the + exercises the cross-node arm", async () => {
    const input = "+\n*a*\ntail\n";
    const out = await formatAdoc(input);
    expect(out).toBe("+\n*a* tail\n");
    expect(await readingBreachesOf(input)).toEqual([]);
    expect(await formatAdoc(out)).toBe(out);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });

  // The rule is about the line the `+` HAD, not about the character.
  // A `+` the source wrote mid-line is prose, and the ordinary
  // line-end rule still owns it: it fuses to the word after it so no
  // break can put ` +` at the end of an output line.
  test("a mid-line + is still fused to the word after it", async () => {
    const input = "alpha + beta\n";
    const narrow = { printWidth: 8 };
    const out = await formatAdoc(input, narrow);
    expect(out).toBe("alpha\n+ beta\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out, narrow)).toBe(out);
  });

  // And where no output line can be kept for it, the `+` escapes as
  // `{plus}` exactly as before: an INDENTED ` +` is not a
  // continuation marker, so it is absorbed into the item's text, and
  // there it would end an output line as a hard line break.
  test("a + that cannot keep a line escapes as {plus}", async () => {
    const input = ". item\n +\n// c\n";
    const out = await formatAdoc(input);
    expect(out).toBe(". item {plus}\n// c\n");
    expect(await formatAdoc(out)).toBe(out);
  });
});
