import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("fenced code block formatting", () => {
  // Fenced block with language normalizes to [source,lang] + ----
  test("normalizes fenced block with language to source block", async () => {
    const input = "```rust\nfn main() {}\n```\n";
    const expected = "[source,rust]\n----\nfn main() {}\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Fenced block without language normalizes to bare ----
  test("normalizes fenced block without language to bare listing", async () => {
    const input = "```\nhello world\n```\n";
    const expected = "----\nhello world\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Multi-line content is preserved verbatim.
  test("multi-line content preserved", async () => {
    const input = '```rust\nfn main() {\n    println!("Hello");\n}\n```\n';
    const expected =
      '[source,rust]\n----\nfn main() {\n    println!("Hello");\n}\n----\n';
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Empty fenced code block normalizes to empty listing block.
  test("empty fenced code block", async () => {
    const input = "```\n```\n";
    const expected = "----\n----\n";
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
    const expected = "-----\n----\ncode\n----\n-----\n";
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
});
