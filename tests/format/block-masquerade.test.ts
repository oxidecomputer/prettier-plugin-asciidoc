/**
 * Format tests for block masquerading (style-driven content model).
 *
 * Verifies that masqueraded blocks round-trip correctly:
 * verbatim content is NOT reflowed, compound content IS
 * formatted, and attribute lists are preserved.
 */
import { describe, test, expect } from "vitest";
import { expectFormatted, expectStableRender, formatAdoc } from "../helpers.js";

describe("[verse] on quote block formatting", () => {
  // Verse content must NOT be reflowed — line breaks are
  // semantically significant.
  test("[verse] + quote block round-trips", async () => {
    const input = "[verse]\n____\nRoses are red,\nViolets are blue.\n____\n";
    await expectFormatted(input, input);
  });

  test("verse content is NOT reflowed", async () => {
    // Each short line is intentional; the formatter must not
    // join them into a single line.
    const input = "[verse]\n____\nShort.\nAlso short.\n____\n";
    await expectFormatted(input, input);
  });

  test("empty verse block round-trips", async () => {
    const input = "[verse]\n____\n____\n";
    await expectFormatted(input, input);
  });

  test("[verse] with attribution keeps everything but the skipped blanks", async () => {
    const input =
      "[verse, Carl Sandburg, Fog]\n____\nThe fog comes\non little cat feet.\n____\n";
    await expectFormatted(
      input,
      "[verse,Carl Sandburg,Fog]\n____\nThe fog comes\non little cat feet.\n____\n",
    );
  });

  test("verse with blank lines preserved", async () => {
    const input = "[verse]\n____\nStanza one.\n\nStanza two.\n____\n";
    await expectFormatted(input, input);
  });
});

describe("[source]/[listing]/[literal] on open block formatting", () => {
  test("[source] + open block round-trips", async () => {
    const input = "[source]\n--\nputs 'hello'\n--\n";
    await expectFormatted(input, input);
  });

  // The one behaviour the parentBlock-end fix changes.
  // The extent states `contentEnd` against the block's real source;
  // the masqueraded open block below builds as a verbatim
  // delimitedBlock whose content is sliced up to that offset. Before
  // the fix, a forced close computed the offset as 0, so the slice
  // came back EMPTY and the formatter dropped the block's content on
  // the floor. No corpus or fixture case reaches this path with an
  // unterminated block, so it is pinned here.
  test("an UNTERMINATED [source] + open block keeps its content", async () => {
    const input = "[source]\n--\na\n";
    const output = await formatAdoc(input);
    expect(output.split("\n")).toContain("a");
    await expectStableRender(input);
  });

  test("[source,ruby] + open block round-trips", async () => {
    const input = "[source,ruby]\n--\nputs 'hello'\n--\n";
    await expectFormatted(input, input);
  });

  test("[listing] + open block round-trips", async () => {
    const input = "[listing]\n--\ndef foo\n  bar\nend\n--\n";
    await expectFormatted(input, input);
  });

  test("[literal] + open block round-trips", async () => {
    const input = "[literal]\n--\nfixed-width text\n--\n";
    await expectFormatted(input, input);
  });

  test("[pass] + open block round-trips", async () => {
    const input = "[pass]\n--\n<div>raw</div>\n--\n";
    await expectFormatted(input, input);
  });

  test("[comment] + open block round-trips", async () => {
    const input = "[comment]\n--\nThis is hidden.\n--\n";
    await expectFormatted(input, input);
  });

  test("[verse] + open block round-trips", async () => {
    const input = "[verse]\n--\nRoses are red,\nViolets are blue.\n--\n";
    await expectFormatted(input, input);
  });
});

describe("[stem] on quote block formatting", () => {
  test("[stem] + quote block round-trips", async () => {
    const input = "[stem]\n____\nx = y^2\n____\n";
    await expectFormatted(input, input);
  });

  test("[latexmath] + quote block round-trips", async () => {
    const input = "[latexmath]\n____\n\\frac{a}{b}\n____\n";
    await expectFormatted(input, input);
  });

  test("[asciimath] + quote block round-trips", async () => {
    const input = "[asciimath]\n____\nsum_(i=1)^n i\n____\n";
    await expectFormatted(input, input);
  });
});

describe("non-masquerade blocks unchanged", () => {
  test("plain quote block content is formatted", async () => {
    const input = "____\nContent.\n____\n";
    await expectFormatted(input, input);
  });

  test("plain open block content is formatted", async () => {
    const input = "--\nContent.\n--\n";
    await expectFormatted(input, input);
  });

  test("[#myid] on quote block is not masqueraded", async () => {
    const input = "[#myid]\n____\nContent.\n____\n";
    expect(await formatAdoc(input)).toBe("[[myid]]\n____\nContent.\n____\n");
  });
});

describe("masquerade in context", () => {
  test("verse block between paragraphs", async () => {
    const input = "Before.\n\n[verse]\n____\nRoses are red.\n____\n\nAfter.\n";
    await expectFormatted(input, input);
  });

  test("block title + verse masquerade stacks", async () => {
    const input = ".My Poem\n[verse]\n____\nRoses are red.\n____\n";
    await expectFormatted(input, input);
  });
});
