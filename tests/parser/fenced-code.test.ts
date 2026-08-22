import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { firstDelimitedBlock } from "../helpers.js";

describe("fenced code block parsing", () => {
  // Backtick-fenced code block with language hint produces a
  // listing block with the language captured.
  test("fenced block with language", () => {
    const { children } = parse("```rust\nfn main() {}\n```\n");
    expect(children).toHaveLength(1);
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.language).toBe("rust");
    expect(block.content).toBe("fn main() {}");
  });

  // Backtick-fenced code block without a language hint produces
  // `language: undefined`, not an empty string. This distinguishes
  // "no hint given" from "hint given but empty".
  test("fenced block without language", () => {
    const { children } = parse("```\nhello world\n```\n");
    expect(children).toHaveLength(1);
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.language).toBeUndefined();
    expect(block.content).toBe("hello world");
  });

  // Multi-line content is preserved verbatim, including internal
  // indentation — no whitespace stripping is applied to body lines.
  test("multi-line content preserved", () => {
    const input = '```rust\nfn main() {\n    println!("Hello");\n}\n```\n';
    const { children } = parse(input);
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.language).toBe("rust");
    expect(block.content).toBe('fn main() {\n    println!("Hello");\n}');
  });

  // A fenced block with no body lines (open fence immediately
  // followed by close fence) produces content `""`, not
  // `undefined`. Empty is a valid, distinct state.
  test("empty fenced code block", () => {
    const { children } = parse("```\n```\n");
    const block = firstDelimitedBlock(children);
    expect(block.variant).toBe("listing");
    expect(block.content).toBe("");
    expect(block.language).toBeUndefined();
  });

  // A fenced block surrounded by blank-line-separated paragraphs
  // produces exactly three top-level children. Verifies that blank
  // lines correctly terminate the preceding paragraph and that the
  // block is not merged into either neighbour.
  test("between paragraphs", () => {
    const { children } = parse(
      "Before.\n\n```js\nconst x = 1;\n```\n\nAfter.\n",
    );
    expect(children).toHaveLength(3);
    expect(children[0].type).toBe("paragraph");
    expect(children[1].type).toBe("delimitedBlock");
    expect(children[2].type).toBe("paragraph");
    // slice(1) drops the leading paragraph so firstDelimitedBlock
    // receives the block as its first element.
    const block = firstDelimitedBlock(children.slice(1));
    expect(block.language).toBe("js");
  });

  // Content with backticks (fewer than 3) inside is preserved.
  // Single backticks cannot match the close-fence token pattern
  // (` /```(?![^\n])/ `), so they are consumed as VerbatimContent.
  // This validates token-priority isolation inside verbatim mode.
  test("backticks inside content are preserved", () => {
    const { children } = parse("```\nuse `backtick` here\n```\n");
    const block = firstDelimitedBlock(children);
    expect(block.content).toBe("use `backtick` here");
  });

  // AsciiDoc-style delimiters (e.g. `----`) inside a fenced block
  // are treated as plain content, not block openers. A verbatim
  // block's extent is read by `readVerbatim` in
  // src/parse/lines/reader.ts, which looks only for its OWN
  // terminator, so nothing between the fences is classified at all.
  test("asciidoc delimiters inside fenced block are content", () => {
    const { children } = parse("```\n----\ncode\n----\n```\n");
    const block = firstDelimitedBlock(children);
    expect(block.content).toBe("----\ncode\n----");
  });

  // Leading whitespace before the language hint (e.g. "```  rust")
  // is trimmed by `.trim()` in the AST builder. Validates that
  // the language field contains only the clean identifier even
  // when the source has extra spaces between the backticks and
  // the language name.
  test("leading whitespace in language hint is trimmed", () => {
    const { children } = parse("```  rust\nfn main() {}\n```\n");
    const block = firstDelimitedBlock(children);
    expect(block.language).toBe("rust");
  });

  // Trailing whitespace after the language hint is trimmed via
  // `.trim()` in the AST builder (applied to the slice of the open
  // token image after the three backticks). Leading whitespace in
  // a hint (e.g. "``` rust") is not currently tested; the token
  // pattern /```[^\n]*/ would capture it, and `.trim()` would
  // handle it, but that case is left implicit.
  test("trailing whitespace on language hint is trimmed", () => {
    const { children } = parse("```rust  \nfn main() {}\n```\n");
    const block = firstDelimitedBlock(children);
    expect(block.language).toBe("rust");
  });
});
