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
});
