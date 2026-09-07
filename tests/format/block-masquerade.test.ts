/**
 * Format tests for block masquerading (style-driven content model).
 *
 * Verifies that masqueraded blocks round-trip correctly:
 * verbatim content is NOT reflowed, compound content IS
 * formatted, and attribute lists are preserved.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  delimitedBlockAt,
  expectFormatted,
  expectStableRender,
  formatAdoc,
  parentBlockAt,
} from "../helpers.js";

describe("[verse] on quote block formatting", () => {
  // Verse content must NOT be reflowed — line breaks are
  // semantically significant.
  test("[verse] + quote block round-trips", async () => {
    const input = "[verse]\n____\nRoses are red,\nViolets are blue.\n____\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.form).toBe("delimited");
    expect(block.sourceDelimiter).toBe("quote");
    expect(block.content).toBe("Roses are red,\nViolets are blue.");
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
    const { children } = parse(input);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.content).toBe("");
  });

  test("[verse] with attribution keeps everything but the skipped blanks", async () => {
    const input =
      "[verse, Carl Sandburg, Fog]\n____\nThe fog comes\non little cat feet.\n____\n";
    await expectFormatted(
      input,
      "[verse,Carl Sandburg,Fog]\n____\nThe fog comes\non little cat feet.\n____\n",
    );
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    // The full attribute string including positional params
    // (author, source) is preserved in the blockAttributeList
    // value, not in a dedicated field on the verse block.
    // Attribution is reconstructed from the attribute list at
    // render time, not stored as structured data.
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.content).toBe("The fog comes\non little cat feet.");
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
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("listing");
    expect(block.form).toBe("delimited");
    expect(block.sourceDelimiter).toBe("open");
    expect(block.content).toBe("puts 'hello'");
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
    // The `ruby` language hint is a second positional attribute.
    // `parseAttrlist` takes only the first token before the comma,
    // so `[source,ruby]` resolves to style "source" and triggers
    // the same masquerade as plain `[source]`. The `language`
    // field is NOT populated here — that field is only set by
    // fenced-code syntax (```lang), not by attribute lists.
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("listing");
    expect(block.content).toBe("puts 'hello'");
  });

  test("[listing] + open block round-trips", async () => {
    const input = "[listing]\n--\ndef foo\n  bar\nend\n--\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("listing");
    expect(block.content).toBe("def foo\n  bar\nend");
  });

  test("[literal] + open block round-trips", async () => {
    const input = "[literal]\n--\nfixed-width text\n--\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("literal");
    expect(block.content).toBe("fixed-width text");
  });

  test("[pass] + open block round-trips", async () => {
    const input = "[pass]\n--\n<div>raw</div>\n--\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.content).toBe("<div>raw</div>");
  });

  test("[comment] + open block round-trips", async () => {
    const input = "[comment]\n--\nThis is hidden.\n--\n";
    await expectFormatted(input, input);
    // `[comment]` maps to the `pass` variant rather than a
    // dedicated `comment` variant. Both represent content the
    // renderer suppresses entirely. Re-using `pass` avoids
    // adding a variant that behaves identically in the printer.
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.content).toBe("This is hidden.");
  });

  test("[verse] + open block round-trips", async () => {
    const input = "[verse]\n--\nRoses are red,\nViolets are blue.\n--\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("verse");
    expect(block.content).toBe("Roses are red,\nViolets are blue.");
  });
});

describe("[stem] on quote block formatting", () => {
  test("[stem] + quote block round-trips", async () => {
    const input = "[stem]\n____\nx = y^2\n____\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.form).toBe("delimited");
    expect(block.content).toBe("x = y^2");
  });

  test("[latexmath] + quote block round-trips", async () => {
    const input = "[latexmath]\n____\n\\frac{a}{b}\n____\n";
    await expectFormatted(input, input);
  });

  test("[asciimath] + quote block round-trips", async () => {
    const input = "[asciimath]\n____\nsum_(i=1)^n i\n____\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const block = delimitedBlockAt(children, 1);
    expect(block.variant).toBe("pass");
    expect(block.content).toBe("sum_(i=1)^n i");
  });
});

describe("non-masquerade blocks unchanged", () => {
  test("plain quote block content is formatted", async () => {
    const input = "____\nContent.\n____\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("quote");
  });

  test("plain open block content is formatted", async () => {
    const input = "--\nContent.\n--\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("open");
  });

  test("[#myid] on quote block is not masqueraded", async () => {
    const input = "[#myid]\n____\nContent.\n____\n";
    expect(await formatAdoc(input)).toBe("[[myid]]\n____\nContent.\n____\n");
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAnchor");
    const block = parentBlockAt(children, 1);
    expect(block.variant).toBe("quote");
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
