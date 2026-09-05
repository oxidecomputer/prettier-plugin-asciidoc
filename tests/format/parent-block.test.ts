import { describe, test, expect } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

describe("example block formatting", () => {
  // Canonical example block passes through unchanged.
  test("basic example block preserved", async () => {
    const input = "====\nSome content.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty example block preserved.
  test("empty example block preserved", async () => {
    const input = "====\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extended example delimiters are normalized to 4 characters.
  test("delimiter length normalized to 4", async () => {
    const input = "======\nContent.\n======\n";
    const expected = "====\nContent.\n====\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Multiple inner paragraphs separated by blank lines.
  test("multiple inner paragraphs", async () => {
    const input = "====\nFirst paragraph.\n\nSecond paragraph.\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Example block between paragraphs.
  test("between paragraphs", async () => {
    const input = "Before.\n\n====\nInside.\n====\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
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
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty sidebar block preserved.
  test("empty sidebar block preserved", async () => {
    const input = "****\n****\n";
    expect(await formatAdoc(input)).toBe(input);
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
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("open block formatting", () => {
  // Canonical open block passes through unchanged.
  test("basic open block preserved", async () => {
    const input = "--\nOpen content.\n--\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty open block preserved.
  test("empty open block preserved", async () => {
    const input = "--\n--\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Open block delimiter is always exactly `--` (2 dashes).
  test("open block always uses 2 dashes", async () => {
    const input = "--\nContent.\n--\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multiple inner paragraphs preserved.
  test("multiple inner paragraphs", async () => {
    const input = "--\nFirst.\n\nSecond.\n--\n";
    expect(await formatAdoc(input)).toBe(input);
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
  });

  test("empty tilde open block preserved", async () => {
    const input = "~~~~\n~~~~\n";
    await expectFormatted(input, input);
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
    expect(await renderedHtml(await formatAdoc(input))).toBe(
      await renderedHtml(input),
    );
    expect(await formatAdoc(await formatAdoc(input))).toBe(
      await formatAdoc(input),
    );
  });
});

describe("quote block formatting", () => {
  // Canonical quote block passes through unchanged.
  test("basic quote block preserved", async () => {
    const input = "____\nQuoted text.\n____\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Empty quote block preserved.
  test("empty quote block preserved", async () => {
    const input = "____\n____\n";
    expect(await formatAdoc(input)).toBe(input);
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
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("nested parent block formatting", () => {
  // Example inside sidebar — no blank lines between delimiter
  // and content; the delimiter is framing, not a block separator.
  test("example inside sidebar", async () => {
    const input = "****\n====\nNested content.\n====\n****\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Listing block (leaf) inside example block.
  test("leaf block inside parent block", async () => {
    const input = "====\n----\ncode\n----\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Nested same-type blocks: outer delimiter must be longer
  // than inner to preserve nesting on re-parse.
  test("nested same-type example blocks", async () => {
    const input = "======\n====\nNested content.\n====\n======\n";
    const expected = "=====\n====\nNested content.\n====\n=====\n";
    expect(await formatAdoc(input)).toBe(expected);
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
