import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  expectFormatted,
  expectStableRender,
  formatAdoc,
  parentBlockAt,
} from "../helpers.js";

describe("example block formatting", () => {
  // Canonical example block passes through unchanged.
  test("basic example block preserved", async () => {
    const input = "====\nSome content.\n====\n";
    await expectFormatted(input, input);
    // Basic example block with paragraph content.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty example block preserved.
  test("empty example block preserved", async () => {
    const input = "====\n====\n";
    await expectFormatted(input, input);
    // Empty example block (no content between delimiters).
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(0);
  });

  // Extended example delimiters are normalized to 4 characters.
  test("delimiter length normalized to 4", async () => {
    const input = "======\nContent.\n======\n";
    const expected = "====\nContent.\n====\n";
    expect(await formatAdoc(input)).toBe(expected);
    // 6-character example delimiter: confirms any repeat length
    // >= 4 is accepted, not just exactly 4.
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Multiple inner paragraphs separated by blank lines.
  test("multiple inner paragraphs", async () => {
    const input = "====\nFirst paragraph.\n\nSecond paragraph.\n====\n";
    await expectFormatted(input, input);
    // Example block with multiple paragraphs separated by
    // blank lines.
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(2);
    expect(block.children[0].type).toBe("paragraph");
    expect(block.children[1].type).toBe("paragraph");
  });

  // Example block between paragraphs.
  test("between paragraphs", async () => {
    const input = "Before.\n\n====\nInside.\n====\n\nAfter.\n";
    await expectFormatted(input, input);
    // Parent block between paragraphs.
    const { children } = parse(input);
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("parentBlock");
    expect(children[2].type).toBe("paragraph");
  });

  // Inner paragraph text is reflowed.
  test("inner paragraph text is reflowed", async () => {
    const input =
      "====\nThis is a long sentence that should be reflowed by the formatter.\n====\n";
    const result = await formatAdoc(input, { printWidth: 40 });
    // Should be reflowed within the delimiters.
    expect(result).toContain("====\n");
    // The content should be split across multiple lines.
    const lines = result.split("\n");
    // At least 4 lines: delimiter, 2+ content lines, delimiter, trailing newline.
    expect(lines.length).toBeGreaterThanOrEqual(5);
  });
});

describe("sidebar block formatting", () => {
  // Canonical sidebar block passes through unchanged.
  test("basic sidebar block preserved", async () => {
    const input = "****\nSidebar content.\n****\n";
    await expectFormatted(input, input);
    // Basic sidebar block with paragraph content.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty sidebar block preserved.
  test("empty sidebar block preserved", async () => {
    const input = "****\n****\n";
    await expectFormatted(input, input);
    // Empty sidebar block.
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(0);
  });

  // Extended sidebar delimiters normalized to 4.
  test("delimiter length normalized to 4", async () => {
    const input = "******\nContent.\n******\n";
    const expected = "****\nContent.\n****\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Multiple inner paragraphs preserved.
  test("multiple inner paragraphs", async () => {
    const input = "****\nFirst.\n\nSecond.\n****\n";
    await expectFormatted(input, input);
    // Sidebar block with multiple inner paragraphs.
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("sidebar");
    expect(block.children).toHaveLength(2);
  });
});

describe("open block formatting", () => {
  // Canonical open block passes through unchanged.
  test("basic open block preserved", async () => {
    const input = "--\nOpen content.\n--\n";
    await expectFormatted(input, input);
    // Basic open block with paragraph content.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
    // The conventional spelling records no fact - the printer's fallback
    // is what makes it conventional. Red before the field existed, since
    // `openDelimiter` did not exist to read.
    expect(block.openDelimiter).toBeUndefined();
  });

  // Empty open block preserved.
  test("empty open block preserved", async () => {
    const input = "--\n--\n";
    await expectFormatted(input, input);
    // Empty open block.
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(0);
  });

  // Open block delimiter is always exactly `--` (2 dashes).
  test("open block always uses 2 dashes", async () => {
    const input = "--\nContent.\n--\n";
    await expectFormatted(input, input);
    // Open blocks use a fixed `--` delimiter (not a repeating
    // pattern), so delimiter-length matching doesn't apply.
    // This test confirms open blocks parse correctly alongside
    // the variable-length example/sidebar/quote blocks.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Multiple inner paragraphs preserved.
  test("multiple inner paragraphs", async () => {
    const input = "--\nFirst.\n\nSecond.\n--\n";
    await expectFormatted(input, input);
    // Open block with multiple inner paragraphs.
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("open");
    expect(block.children).toHaveLength(2);
  });
});

// A tilde-opened block prints back the tilde CHARACTER rather than
// the conventional `--` (issue #64): the two are not interchangeable
// to the oracle (ParentBlockNode.openDelimiter, src/ast.ts). Red
// before the field existed: the printer had one fixed spelling for
// every "open" variant and would have normalized every row below to
// `--`. The RUN LENGTH, unlike the character, is not replayed - see
// "a longer tilde run normalizes to 4" below, the same shape as every
// other compound delimiter.
describe("open block formatting via tilde (issue #64)", () => {
  test("a four-tilde open block keeps its own spelling", async () => {
    const input = "~~~~\nOpen content.\n~~~~\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("open");
    expect(block.openDelimiter).toBe("~");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  test("empty tilde open block preserved", async () => {
    const input = "~~~~\n~~~~\n";
    await expectFormatted(input, input);
    // Empty tilde open block.
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("open");
    expect(block.openDelimiter).toBe("~");
    expect(block.children).toHaveLength(0);
  });

  // A longer run IS normalized down to the four-tilde minimum, like
  // every OTHER compound delimiter (see "delimiter length normalized
  // to 4" above for the same shape on `====`) - the run length is
  // render-irrelevant to the oracle (confluence gate,
  // `delimiterLength/openBlockTilde`), so replaying the author's
  // count was a spelling choice, not a reading one. Red before this
  // fix: formatAdoc left the eight-tilde run exactly as long as
  // written.
  test("a longer tilde run normalizes to 4", async () => {
    const input = "~~~~~~~~\nContent.\n~~~~~~~~\n";
    const expected = "~~~~\nContent.\n~~~~\n";
    await expectFormatted(input, expected);
  });

  // An unterminated tilde open block still gets an explicit close on
  // reformat - the same synthesis an unterminated `--` block already
  // gets (issue #64's own corpus shape).
  test("an unterminated tilde open block gets an explicit close", async () => {
    const input =
      'first paragraph.\n\n~~~~ javascript\nalert("Hello, World!")\n~~~~\n';
    // The paragraph's two lines reflow-join with a space (ordinary
    // paragraph wrapping) - `~~~~ javascript` carries no attribute
    // to break on, it is plain text (this describe block's header).
    const expected =
      'first paragraph.\n\n~~~~ javascript alert("Hello, World!")\n\n~~~~\n~~~~\n';
    expect(await formatAdoc(input)).toBe(expected);
    await expectStableRender(input);
    await expectFormatted(await formatAdoc(input), await formatAdoc(input));
    // The corpus shape issue #64 tracks: a fenced-code-LOOKING opener
    // with a trailing word carries no attribute and is ordinary
    // paragraph text (measured against the oracle - see this describe
    // block's own header), so it joins the paragraph above the trailing
    // bare `~~~~` line, which is the one line that actually opens
    // anything: an EMPTY open block, unterminated at EOF.
    const { children } = parse(input);
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("paragraph");
    const block = parentBlockAt(children, 2);
    expect(block.variant).toBe("open");
    expect(block.openDelimiter).toBe("~");
    expect(block.children).toHaveLength(0);
  });
});

describe("quote block formatting", () => {
  // Canonical quote block passes through unchanged.
  test("basic quote block preserved", async () => {
    const input = "____\nQuoted text.\n____\n";
    await expectFormatted(input, input);
    // Basic quote block with paragraph content.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("paragraph");
  });

  // Empty quote block preserved.
  test("empty quote block preserved", async () => {
    const input = "____\n____\n";
    await expectFormatted(input, input);
    // Empty quote block.
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(0);
  });

  // Extended quote delimiters normalized to 4.
  test("delimiter length normalized to 4", async () => {
    const input = "______\nText.\n______\n";
    const expected = "____\nText.\n____\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Multiple inner paragraphs preserved.
  test("multiple inner paragraphs", async () => {
    const input = "____\nFirst.\n\nSecond.\n____\n";
    await expectFormatted(input, input);
    // Quote block with multiple inner paragraphs.
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("quote");
    expect(block.children).toHaveLength(2);
  });
});

describe("nested parent block formatting", () => {
  // Example inside sidebar — no blank lines between delimiter
  // and content; the delimiter is framing, not a block separator.
  test("example inside sidebar", async () => {
    const input = "****\n====\nNested content.\n====\n****\n";
    await expectFormatted(input, input);
    // Nested parent blocks: example inside sidebar.
    const { children } = parse(input);
    const outer = parentBlockAt(children, 0);
    expect(outer.variant).toBe("sidebar");
    expect(outer.children).toHaveLength(1);
    const inner = parentBlockAt(outer.children, 0);
    expect(inner.variant).toBe("example");
    const { children: innerChildren } = inner;
    expect(innerChildren).toHaveLength(1);
    expect(innerChildren[0]).toHaveProperty("type", "paragraph");
  });

  // Listing block (leaf) inside example block.
  test("leaf block inside parent block", async () => {
    const input = "====\n----\ncode\n----\n====\n";
    await expectFormatted(input, input);
    // A listing block (leaf) inside a parent block.
    const { children } = parse(input);
    const block = parentBlockAt(children, 0);
    expect(block.variant).toBe("example");
    expect(block.children).toHaveLength(1);
    expect(block.children[0].type).toBe("delimitedBlock");
  });

  // Nested same-type blocks: outer delimiter must be longer
  // than inner to preserve nesting on re-parse.
  test("nested same-type example blocks", async () => {
    const input = "======\n====\nNested content.\n====\n======\n";
    const expected = "=====\n====\nNested content.\n====\n=====\n";
    expect(await formatAdoc(input)).toBe(expected);
    // Nested same-type blocks with different delimiter lengths.
    // Outer uses 6-char, inner uses 4-char.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const outer = parentBlockAt(children, 0);
    expect(outer.variant).toBe("example");
    expect(outer.children).toHaveLength(1);
    const inner = parentBlockAt(outer.children, 0);
    expect(inner.variant).toBe("example");
    expect(inner.children).toHaveLength(1);
    expect(inner.children[0].type).toBe("paragraph");
  });

  // Nested same-type blocks already at minimum length.
  test("nested same-type quote blocks normalized", async () => {
    const input = "______\n____\nInner text.\n____\n______\n";
    const expected = "_____\n____\nInner text.\n____\n_____\n";
    expect(await formatAdoc(input)).toBe(expected);
  });
});

/**
 * A wrapper delimiter is chosen from the BYTES about to be written
 * between its two delimiter lines, and a line that is delimiter-shaped
 * closes the wrapper whatever node it belongs to.
 *
 * Asciidoctor's read says so directly: `is_delimited_block?`
 * (`parser.rb:976-1010`) hands the whole opening LINE back as the
 * block's terminator (`parser.rb:536-538`) and `read_lines_until`
 * (`reader.rb:396-438`) closes on `line == terminator`, a raw line
 * scan that never asks which block the line was written inside. So a
 * `____` line standing as VERBATIM
 * content of a nested listing block really does close an enclosing
 * quote - the oracle reports an unterminated listing block and ends
 * the quote there.
 */
describe("a delimiter-shaped line in nested verbatim content", () => {
  // Issue #143. The quote's delimiter used to be measured by walking
  // the child nodes for the deepest same-variant descendant, which
  // found none here (the `____` is a listing block's content, not a
  // quote node) and shortened the quote to `____` - the very line its
  // own interior writes. The input renders quote > listing("____") >
  // "after"; the shortened output renders quote > empty listing, with
  // the rest dumped into a second listing block.
  test("a quote keeps a delimiter its nested listing's content cannot close", async () => {
    const input = "_____\nbefore\n\n----\n____\n----\n\nafter\n_____\n";
    await expectFormatted(input, input);
  });

  // The same hole one level in and in the other variant: a `****`
  // line inside a nested literal block is what an enclosing sidebar
  // has to clear.
  test("a sidebar keeps a delimiter its nested literal's content cannot close", async () => {
    const input = "*****\n....\n****\n....\n*****\n";
    await expectFormatted(input, input);
  });

  // A delimiter-shaped line inside a nested block that is NOT the
  // wrapper's own character constrains nothing, so the wrapper takes
  // the minimum: the rule reads the interior lines it is about to
  // write, not the nesting depth.
  test("an unrelated delimiter shape in nested content leaves the minimum", async () => {
    const input = "____\n----\n****\n----\n____\n";
    await expectFormatted(input, input);
  });
});
