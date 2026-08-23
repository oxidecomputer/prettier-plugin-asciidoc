import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("fenced code block formatting", () => {
  // Fenced block with language normalizes to [source,lang] + ----
  test("normalizes fenced block with language to source block", async () => {
    const input = "```rust\nfn main() {}\n```\n";
    const expected = "[source,rust]\n----\nfn main() {}\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // A fence carries implicit `source` style even without a language
  // hint — Asciidoctor renders it as `<pre class="highlight"><code>`,
  // not a plain listing. Normalizing to bare `----` would lose that.
  test("a fence without a language normalizes to [source] + listing", async () => {
    const input = "first line\n\n```\ncode\n```\n";
    const out = await formatAdoc(input);
    expect(out).toBe("first line\n\n[source]\n----\ncode\n----\n");
    expect(renderedHtml(out)).toBe(renderedHtml(input));
  });

  // Multi-line content is preserved verbatim.
  test("multi-line content preserved", async () => {
    const input = '```rust\nfn main() {\n    println!("Hello");\n}\n```\n';
    const expected =
      '[source,rust]\n----\nfn main() {\n    println!("Hello");\n}\n----\n';
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Empty fenced code block still carries implicit source style,
  // even with no content and no language hint.
  test("empty fenced code block", async () => {
    const input = "```\n```\n";
    const expected = "[source]\n----\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Fenced block between paragraphs.
  test("fenced block between paragraphs", async () => {
    const input = "Some text.\n\n```js\nconst x = 1;\n```\n\nMore text.\n";
    const expected =
      "Some text.\n\n[source,js]\n----\nconst x = 1;\n----\n\nMore text.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Content with ---- inside gets smart delimiter minimization.
  test("content with dashes gets smart delimiters", async () => {
    const input = "```\n----\ncode\n----\n```\n";
    const expected = "[source]\n-----\n----\ncode\n----\n-----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Normalized output reformats to itself.
  test("normalized output round-trips", async () => {
    const normalized = "[source,rust]\n----\nfn main() {}\n----\n";
    expect(await formatAdoc(normalized)).toBe(normalized);
  });

  // When [source,python] precedes ```python, the printer
  // should deduplicate the attribute list, not emit it twice.
  test("deduplicates [source,lang] when fenced block already has language", async () => {
    const input = "[source,python]\n```python\nprint('hello')\n```\n";
    const result = await formatAdoc(input);
    // The [source,python] attribute list should appear exactly once.
    expect(result).toBe("[source,python]\n----\nprint('hello')\n----\n");
  });

  // A fence WITH a language still gets its [source,lang] attribute
  // (not merely [source]) and round-trips both textually and
  // semantically — the language-specific prefix logic must not
  // regress when the fenced-implies-source behavior is added.
  test("a fence with a language still emits [source,lang] + listing", async () => {
    const input = "```rust\nfn main() {}\n```\n";
    const out = await formatAdoc(input);
    expect(out).toBe("[source,rust]\n----\nfn main() {}\n----\n");
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // Metadata ORDER: a block title belongs above the attribute list
  // the normalization inserts, not between it and the delimiter.
  // `.T` / `[source]` / `----` is the only stacking Asciidoctor
  // reads back as a titled source block.
  test.each([
    ["without a language", ".T\n```\ncode\n```\n", ".T\n[source]\n"],
    ["with a language", ".T\n```js\ncode\n```\n", ".T\n[source,js]\n"],
  ])("a titled fence %s keeps the title first", async (_name, input, head) => {
    const out = await formatAdoc(input);
    expect(out).toBe(`${head}----\ncode\n----\n`);
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // A fence without a language, preceded by an explicit bare
  // [source] attribute list, must not duplicate that attribute —
  // the sibling check has to recognize a bare [source], not just
  // [source,lang].
  test("a fence preceded by an explicit [source] line does not duplicate the attribute", async () => {
    const input = "[source]\n```\ncode\n```\n";
    const out = await formatAdoc(input);
    expect(out).toBe("[source]\n----\ncode\n----\n");
    expect(renderedHtml(out)).toBe(renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// ONE row, deliberately: the document-level controls this change also
// needs are already asserted above and a second spelling of them would
// pin nothing new — "deduplicates [source,lang] when fenced block
// already has language" is the annotated-at-document-level control,
// and "empty fenced code block" plus "a fence without a language
// normalizes to [source] + listing" are the unannotated ones (first in
// the document and after a sibling respectively, so both sides of the
// old scan's `index < 1` guard are covered). The class NO existing row
// reached is the one below: inside a list item the old
// `path.getParentNode()` cast landed on an `ItemBlock`, which has no
// `children`, so the sibling scan saw nothing and the printer emitted
// its implied prefix ON TOP of the author's line.
describe("fence annotation is the reader's own record (spec D5a)", () => {
  test("a fence annotated inside a list item emits ONE [source] prefix", async () => {
    const input = "* item\n+\n[source,ruby]\n```ruby\nfoo\n```\n";
    const output = await formatAdoc(input);
    expect(output).toBe("* item\n+\n[source,ruby]\n----\nfoo\n----\n");
    // The d5-fence-annotation proofs (spec D9.2), re-run at execution:
    expect(renderedHtml(output)).toBe(renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
  });
});
