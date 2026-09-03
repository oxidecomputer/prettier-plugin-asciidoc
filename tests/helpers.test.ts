import { describe, expect, test } from "vitest";
import { oracleHtml, renderedHtml } from "./helpers.js";

/**
 * A source block whose attributes are substituted, so the oracle
 * renders `{plus}` as a character reference INSIDE the `<code>` the
 * normalizer shelters.
 * @param plus - what to write between the block's two words
 * @returns the block's AsciiDoc source
 */
function sourceBlockAround(plus: string): string {
  return `[source,ruby,subs="+attributes"]\n----\na ${plus} b\n----\n`;
}

// Guards the normalizer itself: the semantic-fidelity tests
// compare renderedHtml() on both sides, so a bug that mangles
// <pre> content would silently blind every literal-block
// assertion downstream rather than failing any of them.
describe("renderedHtml", () => {
  test("keeps <pre> content verbatim", async () => {
    const html = await renderedHtml("----\ncode *here*\n----\n");
    expect(html).toContain("code *here*");
    expect(html).not.toContain("undefined");
  });

  test("distinguishes documents that differ only inside <pre>", async () => {
    const a = await renderedHtml("....\nline A\n....\n");
    const b = await renderedHtml("....\nline B\n....\n");
    expect(a).not.toBe(b);
  });

  // Issue #32: whitespace collapsed where whitespace MEANS something
  // is a real failure; whitespace collapsed in prose is what
  // reflowing a paragraph does. These rows pin that split in both
  // directions, because a normalizer that folded the second half too
  // would blind #32's own coverage.
  test("collapses a whitespace run in prose", async () => {
    expect(await renderedHtml("a  b\n")).toBe(await renderedHtml("a b\n"));
  });

  test("keeps a whitespace run inside an inline code span", async () => {
    expect(await renderedHtml("`a  b`\n")).not.toBe(
      await renderedHtml("`a b`\n"),
    );
  });

  test("keeps a whitespace run inside a verbatim block", async () => {
    expect(await renderedHtml("----\na  b\n----\n")).not.toBe(
      await renderedHtml("----\na b\n----\n"),
    );
  });

  test("keeps a whitespace run inside a source block's <code>", async () => {
    expect(await renderedHtml("[source,ruby]\n----\na  b\n----\n")).not.toBe(
      await renderedHtml("[source,ruby]\n----\na b\n----\n"),
    );
  });

  // A run split by the line break it surrounds is still one run: the
  // newline rule turns `a  \n  b` into a run of spaces before the
  // intra-line rule sees it, and running them the other way round
  // would leave three spaces where a reflow put one.
  test("collapses a run that straddles a line break", async () => {
    expect(await renderedHtml("a  \n  b\n")).toBe(await renderedHtml("a b\n"));
  });

  // Issue #33: a NUMERIC character reference and the character it
  // names are one thing here. `{plus}` is the formatter's escape for
  // a `+` that must not read as a hard line break, and Asciidoctor
  // renders it `&#43;` while a literal `+` stays `+` - so without
  // this rule a respelling that changed nothing a reader can see
  // reported itself as a rendering change.
  test("reads a decimal reference as the character it names", async () => {
    expect(await renderedHtml("a {plus} b\n")).toBe(
      await renderedHtml("a + b\n"),
    );
  });

  test("reads a hex reference as the character it names", async () => {
    expect(await renderedHtml("a &#x41; b\n")).toBe(
      await renderedHtml("a A b\n"),
    );
  });

  // The three characters that carry markup meaning decode to their
  // NAMED spelling, never to the raw character, so decoding can never
  // turn text into something that reads as a tag. Both directions are
  // pinned: `&#60;b&#62;` arrives as an escaped `<b>` and stays one,
  // and the numeric and named spellings of `&` meet.
  test("a reference to a markup character decodes to its name", async () => {
    const html = await renderedHtml("a &#60;b&#62; c\n");
    expect(html).toContain("a &lt;b&gt; c");
    expect(html).not.toContain("<b>");
  });

  test("the numeric and named spellings of an ampersand meet", async () => {
    expect(await renderedHtml("a &#38; b\n")).toBe(
      await renderedHtml("a &amp; b\n"),
    );
  });

  // Each radix reads only its own alphabet, so a decimal form
  // holding a hex letter is no reference at all: it must not decode
  // to the U+0004 that reading `4a` as base-10 would truncate it to.
  // The oracle escapes such a form's `&` in prose, but a passthrough
  // hands it through raw, which is how one reaches this lens.
  test("leaves a mixed-radix form undecoded", async () => {
    expect(await renderedHtml("a pass:[&#4a;] b\n")).toContain("a &#4a; b");
  });

  // A NAMED entity is left alone. It is HTML's structural escape, and
  // decoding one would leave text that reads as markup
  // indistinguishable from markup.
  test("leaves a named entity alone", async () => {
    expect(await renderedHtml("a &amp; b\n")).toContain("a &amp; b");
  });

  // The decode runs only where the whitespace rules run. The
  // shelter is conservative, not semantic (an HTML reader decodes a
  // reference inside <code> too): keeping every normalization out of
  // verbatim regions can only report a false DIFFERENCE there, never
  // a false equality, so two documents that differ only in spelling
  // inside a code span stay apart.
  test("keeps a reference inside an inline code span verbatim", async () => {
    expect(await renderedHtml("`a {plus} b`\n")).not.toBe(
      await renderedHtml("`a + b`\n"),
    );
  });

  test("keeps a reference inside a source block verbatim", async () => {
    expect(await renderedHtml(sourceBlockAround("{plus}"))).not.toBe(
      await renderedHtml(sourceBlockAround("+")),
    );
  });
});

// The other lens: what the oracle SPELLS. A test that names an entity
// in its expectation is making a claim about Asciidoctor's bytes, and
// renderedHtml cannot carry that claim now that a reference and its
// character are one thing there.
describe("oracleHtml", () => {
  test("hands back the reference the oracle wrote", async () => {
    expect(await oracleHtml("a {plus} b\n")).toContain("a &#43; b");
  });

  test("normalizes no whitespace at all", async () => {
    expect(await oracleHtml("a\nb\n")).toContain("<p>a\nb</p>");
  });

  // The oracle's warnings for some documents reach the global console
  // rather than either installed logger, so oracleHtml mutes the
  // console for the length of the conversion. OVERLAPPING calls are
  // the hazard that muting creates: the suite runs oracle calls
  // through `Promise.all` (tests/conformance/interruption.test.ts), so
  // a second call can begin while the first still has the console
  // muted, and an implementation that saved the console per call would
  // capture the first call's no-op as "the original" and put THAT back
  // when it finished, muting the worker for every test after it. Both
  // documents warn, so both calls take the muting path.
  test("overlapping calls leave the console as they found it", async () => {
    /* eslint-disable no-console -- the console IS what this row asserts about */
    const before = console.warn;
    await Promise.all([
      oracleHtml("* item\n+\n----\ncontent\n"),
      oracleHtml("* item\n+\n----\nmore content\n"),
    ]);
    expect(console.warn).toBe(before);
    /* eslint-enable no-console */
  });
});
