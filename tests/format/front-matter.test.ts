/**
 * Format tests for YAML front matter (issue #21).
 *
 * The block comes back BYTE FOR BYTE, and the reason it must is that
 * Asciidoctor reads it two ways. With `skip-front-matter` set its
 * reader lifts the whole block off the stream; WITHOUT the attribute
 * - the default, and what {@link renderedHtml} runs - the opening
 * `---` is a thematic break and the metadata under it is a paragraph
 * that swallows the closing fence. Only the author's own bytes are
 * right under both readings, and the YAML is read by a generator that
 * is not Asciidoctor at all.
 *
 * Before the block was one, the printer reflowed those lines into
 * `--- layout: post ---`: no thematic break, no front matter, and one
 * garbled paragraph.
 *
 * Every row therefore proves four things: the bytes come back, the
 * output is a fixed point, Asciidoctor renders it the way it renders
 * the input, and it does so under `skip-front-matter` as well.
 */
import { describe, test, expect } from "vitest";
import { convert } from "@asciidoctor/core";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * The document as Asciidoctor renders it with `skip-front-matter`
 * set - the SECOND reading, the one `renderedHtml` cannot see because
 * it runs the default configuration.
 * @param input - AsciiDoc source text
 * @returns the HTML, byte for byte
 */
async function skippingFrontMatter(input: string): Promise<string> {
  const html: unknown = await convert(input, {
    safe: "safe",
    attributes: { "skip-front-matter": "" },
  });
  if (typeof html !== "string") {
    throw new TypeError("expected convert() to return a string");
  }
  return html;
}

describe("front matter formatting", () => {
  test.each([
    ["a block over a blank line", "---\nlayout: post\n---\n\nBody text.\n"],
    ["a block written tight to the body", "---\nlayout: post\n---\nBody.\n"],
    [
      "a block tight to a document header",
      "---\nlayout: post\n---\n= Title\nDoc Writer\n\nBody.\n",
    ],
    ["a block tight to a list", "---\na: 1\n---\n* item\n"],
    ["an empty block", "---\n---\n\nbody\n"],
    ["a blank line inside the block", "---\na: 1\n\nb: 2\n---\n\nbody\n"],
    [
      "indentation and quoting the author wrote",
      '---\ntags:\n  - first\n  - second\ntitle: "A: B"\n---\n\nbody\n',
    ],
    [
      "a line inside it that looks like AsciiDoc",
      "---\ntitle: = Not A Heading\nlist: * not an item\n---\n\nbody\n",
    ],
  ])("%s comes back byte for byte", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await formatAdoc(out)).toBe(out);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await skippingFrontMatter(out)).toBe(
      await skippingFrontMatter(input),
    );
  });

  // ADVERSARIAL NEIGHBOURS: `---` opens front matter only at the top
  // of a document and only with a partner fence below it. These
  // documents hold the same three characters and are NOT front
  // matter, and the pin is what the formatter makes of them instead.
  // The first two used to reflow the fence into the prose beside it,
  // which is the render loss issue #23 named; a lone `---` is the
  // Markdown thematic break the oracle reads there, so it comes back
  // as the canonical `'''` and the text below it keeps its own block.
  // Expected output, not bytes, is the assertion: a read that
  // overreached here would preserve them instead, and the row would
  // fail rather than quietly improve.
  test.each([
    [
      "no closing fence",
      "---\nlayout: post\n\nBody.\n",
      "'''\n\nlayout: post\n\nBody.\n",
    ],
    [
      "a paragraph stands above the fences",
      "para\n\n---\na: 1\n---\n",
      "para\n\n'''\n\na: 1 ---\n",
    ],
    ["the fence carries a word", "--- a\nb: 1\n---\n", "--- a b: 1 ---\n"],
  ])("%s is not front matter", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await formatAdoc(out)).toBe(out);
  });

  // The reader rstrips every line before any rule sees it, as
  // `prepare_source_string` does, so a fence with trailing blanks is
  // still a fence - and the blanks go, which is what the oracle's own
  // prepared line holds.
  test("trailing whitespace on a fence is still a fence", async () => {
    const input = "---  \na: 1\n---\t\n\nbody\n";
    const out = await formatAdoc(input);
    expect(out).toBe("---\na: 1\n---\n\nbody\n");
    expect(await formatAdoc(out)).toBe(out);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await skippingFrontMatter(out)).toBe(
      await skippingFrontMatter(input),
    );
  });

  // A document with nothing under the block is the smallest one that
  // has front matter at all, and the closing fence is the last line
  // rather than a separator before something.
  test("a document that is only front matter", async () => {
    const input = "---\na: 1\n---\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Four hyphens are a listing block, which is the neighbour whose
  // bytes and rendering both hold today.
  test("four hyphens keep their block", async () => {
    const input = "----\na: 1\n----\n\nbody\n";
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });
});
