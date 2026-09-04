/**
 * Format tests for paragraph-form blocks.
 *
 * Paragraph-form blocks are blocks expressed as an attribute list
 * followed by paragraph content (no delimiters). The formatter
 * preserves them without adding delimiters.
 */
import { describe, test, expect } from "vitest";
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

describe("paragraph-form source block formatting", () => {
  // Canonical form: [source] + content preserved as-is.
  test("[source] + content preserved", async () => {
    const input = "[source]\nputs 'hello'\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // [source,ruby] with language — attribute list + content.
  test("[source,ruby] + content preserved", async () => {
    const input = "[source,ruby]\nputs 'hello'\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multi-line source content preserved verbatim.
  test("multi-line source content preserved", async () => {
    const input = "[source]\nline 1\nline 2\nline 3\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // [listing] paragraph form.
  test("[listing] + content preserved", async () => {
    const input = "[listing]\nsome listing content\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("paragraph-form literal block formatting", () => {
  // [literal] + content preserved.
  test("[literal] + content preserved", async () => {
    const input = "[literal]\nsome literal text\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("paragraph-form pass block formatting", () => {
  // [pass] + content preserved.
  test("[pass] + content preserved", async () => {
    const input = "[pass]\n<div>raw html</div>\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("paragraph-form verse block formatting", () => {
  // [verse] + content — line breaks preserved.
  test("[verse] + content with line breaks preserved", async () => {
    const input = "[verse]\nRoses are red,\nViolets are blue.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // [verse] with attribution. The blanks AROUND each attribute are
  // ones `AttributeList` skips (attribute_list.rb l.30-34, l.200-202);
  // the one INSIDE `Fire and Ice` is data and stays.
  test("[verse, Author, Source] loses only the blanks the scanner skips", async () => {
    const input =
      "[verse, Robert Frost, Fire and Ice]\nSome say the world will end in fire,\nSome say in ice.\n";
    const out = await formatAdoc(input);
    expect(out).toBe(
      "[verse,Robert Frost,Fire and Ice]\nSome say the world will end in fire,\nSome say in ice.\n",
    );
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("paragraph-form quote block formatting", () => {
  // [quote] + content preserved.
  test("[quote] + content preserved", async () => {
    const input = "[quote]\nTo be or not to be.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // [quote] with attribution — same rule as the verse row above.
  test("[quote, Author, Source] gets the one spacing", async () => {
    const input = "[quote, Shakespeare, Hamlet]\nTo be or not to be.\n";
    const out = await formatAdoc(input);
    expect(out).toBe("[quote,Shakespeare,Hamlet]\nTo be or not to be.\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

describe("paragraph-form example block formatting", () => {
  // [example] + content preserved.
  test("[example] + content preserved", async () => {
    const input = "[example]\nThis is an example.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("paragraph-form sidebar block formatting", () => {
  // [sidebar] + content preserved.
  test("[sidebar] + content preserved", async () => {
    const input = "[sidebar]\nThis is sidebar content.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("paragraph-form block context formatting", () => {
  // Paragraph-form block between paragraphs gets blank line
  // separation.
  test("between paragraphs", async () => {
    const input = "Before.\n\n[source]\nsome code\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Block metadata stacks with paragraph-form block.
  test("block title stacks with paragraph-form block", async () => {
    const input = ".My Code\n[source]\nsome code\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // A block anchor stacks with following metadata ([source]
  // attribute list), which stacks with the content.
  test("anchor + [source] + content", async () => {
    const input = "[[my-id]]\n[source]\nsome code\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Blank line between metadata and paragraph-form block
  // is removed.
  test("blank line between attr list and content is removed", async () => {
    const input = "[source,ruby]\n\nputs 'hello'\n";
    const expected = "[source,ruby]\nputs 'hello'\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Non-style attribute lists still stack normally.
  test("[#myid] before paragraph remains separate", async () => {
    const input = "[#myid]\nSome text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

// `parse_block_metadata_lines` runs on a PreprocessorReader, so a
// comment or a preprocessor directive between the style and its text
// is gone by the time the style is applied — the style still reaches
// the block. When the pairing missed that, the text stayed an ordinary
// paragraph and the formatter reflowed content that must be verbatim.
describe("a reader-eaten line between the style and its content", () => {
  const long =
    "aaa bbb ccc ddd eee fff ggg hhh iii jjj kkk lll mmm nnn ooo ppp qqq rrr sss ttt uuu vvv www xxx";
  test.each([
    ["a directive", `[listing]\nifdef::backend[]\n${long}\nendif::[]\n`],
    ["a comment", `[listing]\n// why\n${long}\n`],
    [
      "two of them",
      `[listing]\n// why\nifdef::backend[]\n${long}\nendif::[]\n`,
    ],
    [
      "a masquerade",
      "[verse]\nifdef::backend[]\n____\na\n  b\n____\nendif::[]\n",
    ],
    [
      "an admonition",
      "[NOTE]\nifdef::backend[]\n====\ntext\n====\nendif::[]\n",
    ],
  ])("%s keeps the block verbatim", async (_what, input) => {
    expect(await formatAdoc(input)).toBe(input);
    expect(await renderedHtml(await formatAdoc(input))).toBe(
      await renderedHtml(input),
    );
  });
});

// `content` holds the block's lines joined by `\n` with NO terminating
// newline. When it was rebuilt from inline nodes, a raw line (`\n…\n`)
// or a hard line break (` +\n`) at the paragraph's edge left one there,
// and the printer turned it into a blank line that grew on every pass.
// The content is a source slice now (issue #40) and a slice between two
// content tokens cannot carry an edge newline, but these shapes stay
// pinned: they are the regression, whatever produces the bytes.
describe("a boundary line in paragraph-form content", () => {
  test.each([
    "[sidebar]\nFirst.\nendif::[]\n",
    "[sidebar]\nFirst.\n// c\n",
    "[sidebar]\nFirst. +\n",
    "[sidebar]\nFirst.\ninclude::x.adoc[]\n",
    "[sidebar]\nFirst.\nendif::[]\n\npara\n",
  ])("%j round-trips byte for byte", async (input) => {
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("converted verbatim content is the author's bytes (issue #40)", () => {
  test("#40: empty attribute brackets survive", async () => {
    const input = "[source]\nhttps://x[]\n";
    await expectFormatted(input, input);
  });

  test("the [[id,reftext]] spelling survives (review A's cousin)", async () => {
    const input = "[source]\na [[x,y]] b\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  // The conversion runs per container, so the same bytes must survive
  // through the confined reader over a list item's buffer — the call
  // site the reader's own listItem() reaches, not the document's.
  test("#40: an attached block inside a list item keeps its bytes", async () => {
    const input = "* item\n+\n[source]\nhttps://x[]\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  });

  // The doubled-break shape (#39): two reader-eaten lines in a row.
  // Rebuilding content from inline nodes emitted each raw line as
  // `\n…\n`, so the pair met as `\n\n` and the printer grew a blank
  // line into the block. A slice cannot: the bytes between the two
  // lines are the one newline the author wrote.
  test("#39: two adjacent reader-eaten lines gain no blank line", async () => {
    const input = "* a\n[source]\nflush\nifdef::x[]\nifdef::x[]\n";
    await expectFormatted(input, input);
  });
});
