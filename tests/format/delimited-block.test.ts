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

  // An interior line LONGER than the minimum fence constrains
  // nothing: `read_lines_until` (`reader.rb:396-438`) closes on
  // `line == terminator`, an equality, so a 6-dash line inside a 4-dash
  // fence is content and the fence stays at the minimum. Growing past
  // the longest conflict instead bought a 7-dash fence here that
  // nothing needed.
  test("an interior line longer than the fence does not lengthen it", async () => {
    await expectFormatted(
      "----\nfoo\n------\n----\n",
      "----\nfoo\n------\n----\n",
    );
  });

  // #125: the interior line `---- ` carries a trailing space, so its
  // raw bytes are not the fence's spelling and used to slip past the
  // collision check - but Prettier's hardline strips that trailing
  // space from every printed line, and Asciidoctor's reader rstrips
  // before comparing anyway (`prepare_source_string`), so pass one's
  // OUTPUT line reads `----` and IS what a 4-dash fence would be. The
  // collision has to be seen on pass one, not two passes later.
  test("fence widens for a trailing-space interior conflict on pass one", async () => {
    await expectFormatted(
      "-----\nfoo\n---- \n-----\n",
      "-----\nfoo\n----\n-----\n",
    );
  });

  // The mirrored operator: a trailing TAB is the other byte Prettier's
  // hardline strips (getTrailingIndentionLength treats space and tab
  // alike), so it collides on pass one the same way trailing space
  // does.
  test("fence widens for a trailing-tab interior conflict on pass one", async () => {
    await expectFormatted(
      "-----\nfoo\n----\t\n-----\n",
      "-----\nfoo\n----\n-----\n",
    );
  });

  // The two bytes the READER calls whitespace and Prettier's trim does
  // not: a vertical tab and a form feed survive into the output, and
  // the next read rstrips them off before comparing the line to the
  // terminator. So the collision is real even though the emitted bytes
  // differ from the fence, and the interior keeps its own bytes while
  // the fence clears them. Reading the interior through Prettier's
  // narrower trim missed this pair entirely (12 registry-sweep rows
  // under the trailing-vt and trailing-ff operators, which the wider
  // rstrip closes).
  test.each([
    ["a vertical tab", "\v"],
    ["a form feed", "\f"],
  ])(
    "fence widens for an interior conflict spelled with %s",
    async (_name, whitespace) => {
      await expectFormatted(
        `-----\nfoo\n----${whitespace}\n-----\n`,
        `-----\nfoo\n----${whitespace}\n-----\n`,
      );
    },
  );

  // The mirrored operator in the OTHER direction: LEADING whitespace
  // is not something either trim touches, so a leading-space interior
  // line never printed delimiter-shaped and must not widen the fence.
  test("leading whitespace on an interior conflict does not widen the fence", async () => {
    await expectFormatted(
      "----\nfoo\n ----\n----\n",
      "----\nfoo\n ----\n----\n",
    );
  });

  // Render equality, measured rather than assumed: the trailing-space
  // spelling and the space-stripped spelling of the same interior
  // line render identically ONLY once a fence that is not their own
  // spelling wraps them - Asciidoctor's own reader rstrips a listing
  // line before comparing it to the delimiter, so `---- ` is as much
  // a collision with a 4-dash fence as `----` is, and neither would
  // survive as content inside one. Both need the 5-dash fence.
  test("trailing-space and stripped interior spellings render identically inside a wide-enough fence", async () => {
    const withTrailingSpace = "-----\nfoo\n---- \n-----\n";
    const stripped = "-----\nfoo\n----\n-----\n";
    expect(await renderedHtml(withTrailingSpace)).toBe(
      await renderedHtml(stripped),
    );
    // And that shared render is the single, unsplit listing block  -
    // not two blocks the interior line accidentally terminated.
    expect(await oracleHtml(stripped)).toBe(
      '<div class="listingblock">\n<div class="content">\n<pre>foo\n----</pre>\n</div>\n</div>',
    );
  });

  // The reading this coordinate turns on, measured rather than
  // assumed: a level-0 title takes the two lines under it as the
  // author line and the revision line, so the `----` directly beneath
  // the title opens nothing. The block the oracle sees opens on the
  // interior `-----`, never terminates, and its whole content is the
  // one line the closing delimiter spells once rstripped.
  test("a document title's author and revision lines swallow the opening delimiter", async () => {
    expect(await oracleHtml("= T\n----\nfoo\n-----\n---- \n")).toBe(
      '<div class="listingblock">\n<div class="content">\n<pre>----</pre>\n</div>\n</div>',
    );
  });

  // The same widening rule, at the coordinate where the content that
  // needs it is the CLOSING delimiter line rather than an interior
  // one. Before the fence was spelled from the interior as pass one
  // will print it, the block took the minimum 4-dash fence, its one
  // content line printed as `----` with the trailing whitespace
  // trimmed, and that line then read as the terminator: a block
  // holding `----` came back as two empty blocks and the content was
  // gone.
  test.each([
    ["a space", " "],
    ["a tab", "\t"],
  ])(
    "a block under a document title keeps content past %s on the close",
    async (_name, whitespace) => {
      await expectFormatted(
        `= T\n----\nfoo\n-----\n----${whitespace}\n`,
        "= T\n----\nfoo\n-----\n----\n-----\n",
      );
    },
  );
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

  // The dot-delimiter half of the listing coordinate above: the
  // delimiter character is not what decides the widening, so the same
  // shape under a document title has to survive here too.
  test("a block under a document title keeps content past a space on the close", async () => {
    await expectFormatted(
      "= T\n....\nfoo\n.....\n.... \n",
      "= T\n....\nfoo\n.....\n....\n.....\n",
    );
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
