/**
 * Issue #75: a no-break space (U+00A0) in prose is not whitespace to
 * the oracle. Ruby's `\s` is `[ \t\r\n\f\v]` (see
 * src/parse/line-shapes.ts's ASCII_WHITESPACE); JavaScript's `\s` is
 * wider, so a `split(/\s+/)`-shaped word segmentation in the reflow
 * path used to read a no-break space as a word separator and rejoin
 * the words with a plain space, destroying the no-break property the
 * character exists for (a unit like "10\u00A0km", French punctuation
 * spacing).
 *
 * The mechanism is the same one issue #67 tracks for the other
 * Unicode spaces JS's `\s` matches and Ruby's does not (a narrow
 * no-break space, a figure space, an ideographic space, a byte-order
 * mark) - the ASCII-only class fixes all of them at once, so this
 * file also holds a few #67 rows as evidence of what that closes.
 * #67 is not chased further than that: this file does not add
 * coverage for anything outside the reflow/print path.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Byte-identical, render-equal, idempotent - the character survived
 * the round trip untouched. Mirrors whitespace-runs.test.ts's helper
 * of the same name.
 * @param input - the document
 */
async function expectByteFaithful(input: string): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(input);
  expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  expect(await formatAdoc(output)).toBe(output);
}

describe("a no-break space in prose survives byte for byte", () => {
  test.each([
    ["mid-paragraph", "a\u00A0b\n"],
    ["adjacent to a span, before it", "*x*\u00A0y\n"],
    ["adjacent to a span, after it", "x\u00A0*y*\n"],
    ["inside a span", "*x\u00A0y*\n"],
    ["inside inline code (monospace)", "`a\u00A0b`\n"],
    // A block comment line that is NOTHING but a no-break space: not
    // blank to Asciidoctor (src/print/blocks.ts's printComment), so it
    // must not be dropped the way an all-ASCII-whitespace line is.
    ["alone on a comment block's content line", "////\n\u00A0\n////\n"],
    // The listing-block arm of the same fix (src/print/blocks.ts's
    // delimited-block trim() check), pinned separately from the
    // comment-block row above so restoring blocks.ts alone still fails
    // both arms, not just one. The render check is what shows the
    // contrast: the oracle keeps the no-break space VISIBLE inside
    // `<pre>` (`<pre> </pre>`, with the actual character in it), while
    // a line holding only an ASCII space renders an EMPTY `<pre></pre>`
    // - so this row is not merely idempotent, it renders differently
    // from the all-ASCII-whitespace shape it is easy to mistake it for.
    ["alone on a listing block's content line", "----\n\u00A0\n----\n"],
  ])("%s", async (_name, input) => {
    await expectByteFaithful(input);
  });

  test("survives at any print width", async () => {
    const input = "a\u00A0b\n";
    const outputs = await Promise.all(
      [80, 40, 20, 5].map(
        async (printWidth) => await formatAdoc(input, { printWidth }),
      ),
    );
    for (const output of outputs) {
      expect(output).toBe(input);
    }
  });
});

describe("a no-break space is not a wrap point", () => {
  test("the pair it joins wraps together, never split across lines", async () => {
    // Word 7 and word 8 are joined by a no-break space; every other
    // gap is an ordinary breakable one. At printWidth 30 a plain
    // space here would let the packer break between them - this pins
    // that it does not: "word7\u00A0word8" only ever appears together.
    const input =
      "word1 word2 word3 word4 word5 word6 word7\u00A0word8 word9 word10 word11 word12 word13 word14 word15\n";
    const output = await formatAdoc(input, { printWidth: 30 });
    expect(output).toBe(
      "word1 word2 word3 word4 word5\nword6 word7\u00A0word8 word9 word10\nword11 word12 word13 word14\nword15\n",
    );
    // Every line the packer wrote is within budget, so the joined
    // pair was measured as one unbreakable unit rather than allowed
    // to overrun by accident.
    for (const line of output.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(30);
    }
  });
});

describe("the other Unicode spaces JS's whitespace class matches and Ruby's does not (issue #67, partial closure)", () => {
  test.each([
    ["narrow no-break space (U+202F)", "a\u202Fb\n"],
    ["figure space (U+2007)", "a\u2007b\n"],
    ["ideographic space (U+3000)", "a\u3000b\n"],
    ["zero-width no-break space / BOM (U+FEFF)", "a\uFEFFb\n"],
  ])("%s survives byte for byte", async (_name, input) => {
    await expectByteFaithful(input);
  });
});
