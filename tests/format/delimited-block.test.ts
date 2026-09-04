import { describe, test, expect } from "vitest";
import {
  expectFormatted,
  formatAdoc,
  oracleHtml,
  renderedHtml,
} from "../helpers.js";

describe("listing block formatting", () => {
  // Canonical listing block passes through unchanged.
  test("basic listing block preserved", async () => {
    const input = "----\nsome code\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multi-line content preserved verbatim (no reflowing).
  test("multi-line content preserved", async () => {
    const input = "----\nline 1\nline 2\nline 3\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty listing block preserved.
  test("empty listing block preserved", async () => {
    const input = "----\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended delimiters are normalized to exactly 4 characters.
  test("delimiter length normalized to 4", async () => {
    const input = "------\ncode\n------\n";
    const expected = "----\ncode\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Formatting characters inside listing blocks are NOT reflowed.
  test("formatting chars preserved verbatim", async () => {
    const input = "----\n*bold* _italic_ `mono`\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Blank line separation between paragraph and listing block.
  test("blank line between paragraph and listing block", async () => {
    const input = "Some text.\n\n----\ncode\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Blank line separation between listing block and paragraph.
  test("blank line between listing block and paragraph", async () => {
    const input = "----\ncode\n----\n\nSome text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Smart minimization: the inner `----` (4 chars) conflicts
  // with a 4-char delimiter, so output uses 5-char delimiters.
  test("extended delimiters with inner shorter delimiter", async () => {
    const input = "------\n----\nstill inside\n------\n";
    const expected = "-----\n----\nstill inside\n-----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // #125: the interior line `----- ` carries a trailing space, so its
  // raw bytes are not delimiter-shaped and used to slip past the
  // widening check - but Prettier's hardline strips that trailing
  // space from every printed line regardless (src/print/blocks.ts,
  // TRAILING_SPACE_OR_TAB), so pass one's OUTPUT line reads `-----`,
  // 5 dashes, a conflict with the 4-dash fence. Widening has to see
  // that respelling on pass one, not two passes later.
  test("fence widens for a trailing-space interior conflict on pass one", async () => {
    await expectFormatted(
      "----\nfoo\n----- \n----\n",
      "------\nfoo\n-----\n------\n",
    );
  });

  // The mirrored operator: a trailing TAB is the other byte Prettier's
  // hardline strips (getTrailingIndentionLength treats space and tab
  // alike), so it widens on pass one the same way trailing space does.
  test("fence widens for a trailing-tab interior conflict on pass one", async () => {
    await expectFormatted(
      "----\nfoo\n-----\t\n----\n",
      "------\nfoo\n-----\n------\n",
    );
  });

  // The mirrored operator in the OTHER direction: LEADING whitespace
  // is not something Prettier's hardline trims (trimIndentation scans
  // only from the end of the line), so a leading-space interior line
  // never printed delimiter-shaped and must not widen the fence - on
  // either side of the #125 fix.
  test("leading whitespace on an interior conflict does not widen the fence", async () => {
    await expectFormatted(
      "----\nfoo\n ----\n----\n",
      "----\nfoo\n ----\n----\n",
    );
  });

  // Render equality, measured rather than assumed: the trailing-space
  // spelling and the space-stripped spelling of the same interior
  // line render identically ONLY once a fence wide enough to hold
  // both as content (not as a terminator) wraps them - Asciidoctor's
  // own reader rstrips a listing line before comparing it to the
  // delimiter, so `----- ` is as much a same-length conflict as
  // `-----` is, and a 4-dash fence would let neither survive as
  // content unwidened. Both need the 6-dash fence #125 now produces.
  test("trailing-space and stripped interior spellings render identically inside a wide-enough fence", async () => {
    const withTrailingSpace = "------\nfoo\n----- \n------\n";
    const stripped = "------\nfoo\n-----\n------\n";
    expect(await renderedHtml(withTrailingSpace)).toBe(
      await renderedHtml(stripped),
    );
    // And that shared render is the single, unsplit listing block  - 
    // not two blocks the interior line accidentally terminated.
    expect(await oracleHtml(stripped)).toBe(
      '<div class="listingblock">\n<div class="content">\n<pre>foo\n-----</pre>\n</div>\n</div>',
    );
  });
});

describe("literal block formatting", () => {
  // Basic literal block preserved.
  test("basic literal block preserved", async () => {
    const input = "....\nsome text\n....\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty literal block preserved.
  test("empty literal block preserved", async () => {
    const input = "....\n....\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended literal delimiters normalized to 4.
  test("delimiter length normalized to 4", async () => {
    const input = "......\ntext\n......\n";
    const expected = "....\ntext\n....\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Smart minimization for literal blocks.
  test("extended delimiters with inner shorter delimiter", async () => {
    const input = "......\n....\nstill inside\n......\n";
    const expected = ".....\n....\nstill inside\n.....\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Regression: content inside a literal block that is entirely
  // whitespace is dropped — Prettier trims trailing whitespace
  // per line, so whitespace-only content would become blank
  // lines that re-parse as an empty block.
  test("whitespace-only content treated as empty", async () => {
    const input = "========\n....\n      ";
    expect(await formatAdoc(input)).toBe("====\n....\n....\n====\n");
  });

  // Regression: a close delimiter that is a prefix of a content
  // line must not match. `....x` inside a `....`-delimited
  // literal block should stay as content, not split the block.
  test("close delimiter requires full line match", async () => {
    const input = ".....\n....x\n";
    // `....x` is content, not the terminator, so the block runs to end of
    // input and the printer closes it directly under its last line.
    const out = await formatAdoc(input);
    expect(out).toBe("....\n....x\n....\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("passthrough block formatting", () => {
  // Basic passthrough block preserved.
  test("basic passthrough block preserved", async () => {
    const input = "++++\n<div>raw</div>\n++++\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty passthrough block preserved.
  test("empty passthrough block preserved", async () => {
    const input = "++++\n++++\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended passthrough delimiters normalized to 4.
  test("delimiter length normalized to 4", async () => {
    const input = "++++++\n<p>text</p>\n++++++\n";
    const expected = "++++\n<p>text</p>\n++++\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Smart minimization for passthrough blocks.
  test("extended delimiters with inner shorter delimiter", async () => {
    const input = "++++++\n++++\nstill inside\n++++++\n";
    const expected = "+++++\n++++\nstill inside\n+++++\n";
    expect(await formatAdoc(input)).toBe(expected);
  });
});
