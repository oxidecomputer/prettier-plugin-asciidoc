import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import {
  expectFormatted,
  expectStableRender,
  firstDelimitedBlock,
  formatAdoc,
} from "../helpers.js";

describe("fenced code block formatting", () => {
  // Fenced block with language normalizes to [source,lang] + ----
  test("normalizes fenced block with language to source block", async () => {
    const input = "```rust\nfn main() {}\n```\n";
    const expected = "[source,rust]\n----\nfn main() {}\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
    // Backtick-fenced code block with language hint produces a
    // listing block with the language captured.
    const { children } = parse(input);
    expect(children).toHaveLength(1);
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.language).toBe("rust");
    expect(block.content).toBe("fn main() {}");
  });

  // A fence carries implicit `source` style even without a language
  // hint — Asciidoctor renders it as `<pre class="highlight"><code>`,
  // not a plain listing. Normalizing to bare `----` would lose that.
  test("a fence without a language normalizes to [source] + listing", async () => {
    const input = "first line\n\n```\ncode\n```\n";
    await expectFormatted(input, "first line\n\n[source]\n----\ncode\n----\n");
  });

  // Multi-line content is preserved verbatim.
  test("multi-line content preserved", async () => {
    const input = '```rust\nfn main() {\n    println!("Hello");\n}\n```\n';
    const expected =
      '[source,rust]\n----\nfn main() {\n    println!("Hello");\n}\n----\n';
    expect(await formatAdoc(input)).toBe(expected);
    // Multi-line content is preserved verbatim, including internal
    // indentation — no whitespace stripping is applied to body lines.
    const { children } = parse(input);
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.language).toBe("rust");
    expect(block.content).toBe('fn main() {\n    println!("Hello");\n}');
  });

  // Empty fenced code block still carries implicit source style,
  // even with no content and no language hint.
  test("empty fenced code block", async () => {
    const input = "```\n```\n";
    const expected = "[source]\n----\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
    // A fenced block with no body lines (open fence immediately
    // followed by close fence) produces content `""`, not
    // `undefined`. Empty is a valid, distinct state.
    const { children } = parse(input);
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.content).toBe("");
    expect(block.language).toBeUndefined();
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
    // AsciiDoc-style delimiters (e.g. `----`) inside a fenced block are
    // treated as plain content, not block openers. A verbatim block's
    // extent is read by {@link delimitedExtent}, which looks only for
    // its OWN terminator, so nothing between the fences is classified at
    // all.
    const { children } = parse(input);
    const block = firstDelimitedBlock(children);
    expect(block.content).toBe("----\ncode\n----");
  });

  // Normalized output reformats to itself.
  test("normalized output round-trips", async () => {
    const normalized = "[source,rust]\n----\nfn main() {}\n----\n";
    await expectFormatted(normalized, normalized);
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
    await expectFormatted(input, "[source,rust]\n----\nfn main() {}\n----\n");
  });

  // Metadata ORDER: a block title belongs above the attribute list
  // the normalization inserts, not between it and the delimiter.
  // `.T` / `[source]` / `----` is the only stacking Asciidoctor
  // reads back as a titled source block.
  test.each([
    ["without a language", ".T\n```\ncode\n```\n", ".T\n[source]\n"],
    ["with a language", ".T\n```js\ncode\n```\n", ".T\n[source,js]\n"],
  ])("a titled fence %s keeps the title first", async (_name, input, head) => {
    await expectFormatted(input, `${head}----\ncode\n----\n`);
  });

  // A fence without a language, preceded by an explicit bare
  // [source] attribute list, must not duplicate that attribute —
  // the sibling check has to recognize a bare [source], not just
  // [source,lang].
  test("a fence preceded by an explicit [source] line does not duplicate the attribute", async () => {
    const input = "[source]\n```\ncode\n```\n";
    await expectFormatted(input, "[source]\n----\ncode\n----\n");
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
describe("fence annotation is the reader's own record", () => {
  test("a fence annotated inside a list item emits ONE [source] prefix", async () => {
    const input = "* item\n+\n[source,ruby]\n```ruby\nfoo\n```\n";
    const output = await formatAdoc(input);
    expect(output).toBe("* item\n+\n[source,ruby]\n----\nfoo\n----\n");
    // The fence-annotation proofs, re-run at execution:
    await expectStableRender(input);
  });
});

// The line the normalization emits is the block's FIRST printed line,
// and a marker list's item read swallows an attribute line where it
// would break on a delimiter (`read_lines_for_list_item`, parser.rb
// l.1453-1456 against the after-blank break at l.1549). So a fence
// whose neighbour above is a line Asciidoctor's reader eats - a `//`
// comment, an unresolved `include::` - cannot stack under it the way
// a bare `----` block can: the annotation would land inside the item
// and the listing would open below with no style at all, losing
// `<pre class="highlight">` and the language hint from the render
// (issues #170 and #209).
//
// Every row below printed WITHOUT the blank line before the change,
// and each was measured against Asciidoctor 2.0.26 and the pinned
// oracle alike: the two agree that the blank-separated spelling
// renders what the fence rendered and that the stacked one does not.
describe("a fence under a line the reader eats", () => {
  test.each([
    [
      "a comment above a fence with content (#170)",
      "* item\n+\n// c\n```\nfoo\n```\n",
      "* item\n+\n// c\n\n[source]\n----\nfoo\n----\n",
    ],
    [
      "an include above a fence with content (#170)",
      "* item\n+\ninclude::x[]\n```\nfoo\n```\n",
      "* item\n+\ninclude::x[]\n\n[source]\n----\nfoo\n----\n",
    ],
    [
      "a comment above a fence carrying a language (#209)",
      "* item\n+\n// c\n```x\n",
      "* item\n+\n// c\n\n[source,x]\n----\n----\n",
    ],
    [
      "an include above a fence carrying a language (#209)",
      "* item\n+\ninclude::p[]\n```x\n",
      "* item\n+\ninclude::p[]\n\n[source,x]\n----\n----\n",
    ],
    [
      "no continuation between the item and the comment",
      "* item\n// c\n```x\nfoo\n```\n",
      "* item\n// c\n\n[source,x]\n----\nfoo\n----\n",
    ],
    [
      "an ordered list, which reads its items the same way",
      ". item\n+\n// c\n```x\nfoo\n```\n",
      ". item\n+\n// c\n\n[source,x]\n----\nfoo\n----\n",
    ],
    [
      "a description list nested inside the marker item",
      "* a\n+\nt:: d\n+\n// c\n```x\nfoo\n```\n",
      "* a\n+\nt:: d\n+\n// c\n\n[source,x]\n----\nfoo\n----\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // The controls: a blank line here would be a byte nobody licensed,
  // so the separation is only taken where the annotation would
  // otherwise be swallowed.
  test.each([
    [
      "a listing block, whose delimiter ends the item read itself",
      "* item\n+\n// c\n----\nfoo\n----\n",
      "* item\n+\n// c\n----\nfoo\n----\n",
    ],
    [
      "a fence at the top level, where no item is reading",
      "// c\n```x\nfoo\n```\n",
      "// c\n[source,x]\n----\nfoo\n----\n",
    ],
    [
      "a description list, which unshifts the attribute line back out",
      "t:: d\n+\n// c\n```x\nfoo\n```\n",
      "t:: d\n+\n// c\n[source,x]\n----\nfoo\n----\n",
    ],
    [
      "a marker list nested inside the description item",
      "t:: d\n+\n* a\n+\n// c\n```x\nfoo\n```\n",
      "t:: d\n+\n* a\n+\n// c\n[source,x]\n----\nfoo\n----\n",
    ],
  ])("%s stacks as it did", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });
});
