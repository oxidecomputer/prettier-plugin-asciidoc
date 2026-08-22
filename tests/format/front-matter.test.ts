import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

/**
 * Why these tests pin bytes rather than `renderedHtml`.
 *
 * Every other format test can appeal to the oracle, because
 * Asciidoctor and the formatter agree about what the input means. For
 * front matter they do not, and the disagreement is in the oracle's
 * favour only if you ask it the right question. `renderedHtml` calls
 * `asciidoctor.convert` WITHOUT the `skip-front-matter` attribute, and
 * `PreprocessorReader#process_line` only reaches `skip_front_matter!`
 * when that attribute is set — so for a front-matter document the
 * oracle's own output is `<hr>` followed by a paragraph holding the
 * mangled metadata. That is the bug in #21, rendered. Pinning against
 * it would pin the defect.
 *
 * So these rows assert the round-trip property instead: the bytes in
 * are the bytes out. It is the strongest thing that is true here —
 * front matter is not AsciiDoc, so there is no rendered form for the
 * formatter to be faithful to, only the author's bytes. The rest of
 * the suite keeps using `renderedHtml`, and the oracle is still the
 * arbiter for the `---`-in-the-body rows below, where nothing about
 * front matter is involved.
 */
describe("front matter formatting", () => {
  // The exact input and failure mode from the issue: before this
  // change the delimiters and metadata reflowed into one garbled
  // paragraph, `--- layout: post ---`.
  test("preserves a front matter block instead of reflowing it", async () => {
    const input = "---\nlayout: post\n---\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Metadata lines keep their own lines and their own spacing — the
  // content belongs to a downstream tool, so nothing about it is
  // normalized.
  test("preserves multi-line metadata verbatim", async () => {
    const input =
      "---\nlayout: post\ntitle: A rather long title that would otherwise be reflowed\ntags:\n  - one\n  - two\n---\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // A narrow printWidth is the condition that made the original
  // corruption visible, so it is worth pinning directly.
  test("is not reflowed at a narrow print width", async () => {
    const input = "---\ntitle: one two three four five six seven eight\n---\n";
    expect(await formatAdoc(input, { printWidth: 20 })).toBe(input);
  });

  // The printer joins content with `literalline` rather than
  // `hardline`, and this is the row that distinguishes them: Prettier
  // trims trailing whitespace on a line that ends in a `hardline`. We
  // do not know that a trailing byte in someone's YAML is
  // insignificant, so we do not remove it.
  test("preserves trailing whitespace inside the block", async () => {
    const input = "---\nlayout: post  \n---\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Interior blank lines survive, which is the formatter-side view of
  // the parser slicing content out of the source.
  test("preserves an interior blank line", async () => {
    const input = "---\na: 1\n\nb: 2\n---\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Front matter followed by a document: one blank line between the
  // block and what comes after, which is the separator every other
  // block already gets.
  test("separates front matter from the document body", async () => {
    const input = "---\nlayout: post\n---\n\n= Title\n\nSome text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // A missing blank line after the closing delimiter is normalized
  // to one, the same as any two adjacent blocks.
  test("inserts the standard blank line after the block", async () => {
    const input = "---\nlayout: post\n---\n= Title\n";
    const expected = "---\nlayout: post\n---\n\n= Title\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Empty front matter round-trips without gaining a blank line
  // between the two delimiters.
  test("empty front matter round-trips", async () => {
    const input = "---\n---\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Idempotency is one of the three properties the conformance suite
  // checks, and the property the old behaviour destroyed: the mangled
  // `--- layout: post ---` was stable, so a second format could never
  // recover the metadata.
  test("formatting is idempotent", async () => {
    const input = "---\nlayout: post\ntitle: Hello\n---\n\n= Doc\n\nBody.\n";
    const once = await formatAdoc(input);
    expect(await formatAdoc(once)).toBe(once);
  });

  // The offset-0 guard, from the formatter's side: `---` in the body
  // is untouched by this change and keeps its old behaviour.
  test("a dash line below the first line is unaffected", async () => {
    const input = "Text.\n\n---\nlayout: post\n---\n";
    const before = "--- layout: post ---";
    expect(await formatAdoc(input)).toContain(before);
  });

  // The other half of the same guard, and the one that would have
  // caught a reader that consumed to EOF looking for a terminator: an
  // unterminated leading `---` must leave the body formattable. If it
  // became a verbatim node the whole document would round-trip
  // untouched and this row would fail on the un-reflowed paragraph.
  test("an unterminated leading dash line leaves the body formattable", async () => {
    const input = "---\nstray\n\nBody\ntext\nhere.\n";
    expect(await formatAdoc(input)).toBe("--- stray\n\nBody text here.\n");
  });

  // Neighbouring dash constructs at offset 0 keep their meaning.
  test("a listing block at document start is unaffected", async () => {
    const input = "----\nlayout: post\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});
