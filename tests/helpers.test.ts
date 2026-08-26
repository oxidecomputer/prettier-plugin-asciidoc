import { describe, expect, test } from "vitest";
import { renderedHtml } from "./helpers.js";

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
});
