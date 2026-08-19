/**
 * Format tests for `+` list continuations (issues #2 and #6).
 *
 * A line containing only `+` directly after a list item's text
 * attaches the following paragraph to the item as a separate
 * block. The formatter must keep the `+` alone on its line and
 * print the attached paragraph flush left — folding them into
 * the item's principal paragraph destroys the document
 * structure (the item renders as one paragraph with stray `+`
 * characters).
 */
import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("list continuation formatting", () => {
  test("continuation paragraphs survive round-trip", async () => {
    const input =
      "* first item text.\n" +
      "+\n" +
      "First continuation paragraph.\n" +
      "+\n" +
      "Second continuation paragraph.\n" +
      "\n" +
      "* second item.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("issue #2 repro is preserved and idempotent", async () => {
    const input =
      "* first item: a paragraph that is part of a bulleted list, long enough to wrap\n" +
      "  across more than one line in the source.\n" +
      "+\n" +
      "A continuation paragraph attached to the first item with a `+` line. It should\n" +
      "render as a second paragraph of the same list item.\n" +
      "+\n" +
      "A second continuation paragraph, also attached.\n" +
      "\n" +
      "* second item, unrelated.\n";
    const first = await formatAdoc(input);
    // The `+` lines survive as continuations: alone on their
    // lines, with the attached paragraphs flush left.
    expect(first).toBe(input);
    expect(await formatAdoc(first)).toBe(first);
  });

  test("attached paragraph reflows flush left", async () => {
    const input =
      "* item text.\n" +
      "+\n" +
      "This attached paragraph is long enough that the formatter needs to wrap it across more than one line.\n";
    const result = await formatAdoc(input);
    const lines = result.trimEnd().split("\n");
    expect(lines[0]).toBe("* item text.");
    expect(lines[1]).toBe("+");
    // Attached paragraph lines are flush left (no continuation
    // indent — they belong to the attached block, not to the
    // item's principal paragraph).
    for (const line of lines.slice(2)) {
      expect(line).toMatch(/^\S/v);
    }
    expect(await formatAdoc(result)).toBe(result);
  });

  test("continuation works on ordered list items", async () => {
    const input = ". item text.\n+\nAttached paragraph.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("continuation attaches to a nested item", async () => {
    const input = "* parent\n** nested item.\n+\nAttached to nested.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("inline code span containing + is not escaped", async () => {
    const input = "* item with a `+` code span.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("plus code span in continuation paragraph is not escaped", async () => {
    const input = "* item text.\n+\nAttached with a `+` span.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // A `+` line at the very end of an item (no block follows
  // inside the item) attaches nothing here, but Asciidoctor
  // attaches whatever block comes NEXT — even across a blank
  // line. The bare `+` line is therefore re-emitted verbatim so
  // the rendered document is unchanged.
  test("dangling trailing + is preserved verbatim", async () => {
    const input = "* item text\n+\n\nA separate paragraph.\n";
    const first = await formatAdoc(input);
    expect(first).toBe(input);
    expect(await formatAdoc(first)).toBe(first);
  });

  // Asciidoctor renders `+` after `+` at the end of an item as
  // nothing at all — the second `+` is not content. Emitting it
  // as a `{plus}` paragraph would render new text, so trailing
  // marker-only lines collapse into one dangling marker.
  test("trailing consecutive + markers collapse to one dangling +", async () => {
    const input = "* item\n+\n+\n";
    const first = await formatAdoc(input);
    expect(first).toBe("* item\n+\n");
    expect(await formatAdoc(first)).toBe(first);
  });

  // KNOWN DIVERGENCE from Asciidoctor: a lone `+` line inside a
  // plain (non-list) paragraph terminates the paragraph there
  // (two paragraphs, the second starting with `+`); we merge
  // everything into one paragraph with a mid-text `+`. Tracked
  // in issue #17 — this test pins the
  // current behavior so a future fix updates it consciously,
  // not silently.
  test("plus line between plain paragraphs is merged (known gap)", async () => {
    const input = "para one\n+\npara two\n";
    const first = await formatAdoc(input);
    expect(first).toBe("para one + para two\n");
    expect(await formatAdoc(first)).toBe(first);
  });

  // Asciidoctor right-trims lines before matching the
  // continuation marker, so `+ ` (trailing space) must attach
  // exactly like `+`. The output normalizes it to a bare `+`.
  test("+ line with trailing whitespace attaches", async () => {
    const input = "* item text.\n+ \nAttached paragraph.\n";
    const first = await formatAdoc(input);
    expect(first).toBe("* item text.\n+\nAttached paragraph.\n");
    expect(await formatAdoc(first)).toBe(first);
  });

  // A `+` line directly after a marker is content of the
  // attached paragraph (Asciidoctor renders `+ Attached`); it
  // must not be swallowed as a second marker.
  test("consecutive + lines do not delete content", async () => {
    const input = "* item\n+\n+\nAttached\n";
    const first = await formatAdoc(input);
    expect(first).toBe("* item\n+\n+ Attached\n");
    expect(await formatAdoc(first)).toBe(first);
  });

  // Indented content after `+` is a literal block: whitespace
  // is significant and must survive byte-for-byte (no reflow,
  // no re-indentation — a tab must stay a tab).
  test("indented content after + is preserved as a literal block", async () => {
    const input = "* item\n+\n  literal line\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("tab-indented content after + is preserved and idempotent", async () => {
    const input = "* item\n+\n\tliteral tab line\n";
    const first = await formatAdoc(input);
    expect(first).toBe(input);
    expect(await formatAdoc(first)).toBe(first);
  });

  test("continuation works on callout list items", async () => {
    const input = "<1> note text.\n+\nAttached paragraph.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Reflow must never break directly after a `+` inside a
  // formatting span: ` +` at end of line is a hard line break,
  // which both inserts a break and swallows the `+` from the
  // rendered text. The `+` glues forward to the next inline
  // sibling so fill() can only break before it.
  test("plus inside a span never lands at end of line", async () => {
    const input = "words `code + {attr}` after\n";
    const result = await formatAdoc(input, { printWidth: 14 });
    for (const outputLine of result.trimEnd().split("\n")) {
      expect(outputLine).not.toMatch(/ \+$/v);
    }
    expect(await formatAdoc(result, { printWidth: 14 })).toBe(result);
  });

  // A bare `+` word inside an attached paragraph must survive
  // narrow-width reflow without becoming continuation syntax or
  // a hard break.
  test("attached paragraph with + word reflows safely", async () => {
    const input =
      "* item text.\n+\nAttached words + more attached words here.\n";
    const result = await formatAdoc(input, { printWidth: 20 });
    for (const outputLine of result.trimEnd().split("\n")) {
      expect(outputLine).not.toMatch(/ \+$/v);
    }
    // Exactly one bare `+` line: the continuation marker. If
    // reflow ever isolated the paragraph's `+` word on its own
    // line, re-parsing would see a second marker.
    const bareMarkers = result
      .trimEnd()
      .split("\n")
      .filter((outputLine) => outputLine === "+");
    expect(bareMarkers).toHaveLength(1);
    expect(await formatAdoc(result, { printWidth: 20 })).toBe(result);
  });
});

// Issue #6: `+` continuations around delimited blocks. The `+`
// lines must stay immediately adjacent to what they attach — no
// inserted blank lines, and never merged into paragraph text.
describe("continuations around delimited blocks (issue #6)", () => {
  test("issue #6 repro round-trips and is idempotent", async () => {
    const input =
      "* item one with some text:\n" +
      "+\n" +
      "....\n" +
      "literal block content\n" +
      "....\n" +
      "+\n" +
      "continuation paragraph after the block.\n" +
      "\n" +
      "* item two.\n";
    const first = await formatAdoc(input);
    expect(first).toBe(input);
    expect(await formatAdoc(first)).toBe(first);
  });

  test("+ before a listing block stays attached", async () => {
    const input = "* item:\n+\n----\ncode here\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("+ before a parent block stays attached", async () => {
    const input = "* item:\n+\n====\nexample text\n====\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("marker lines after the block are never merged into text", async () => {
    const input = "* item:\n+\n----\ncode\n----\n+\npara one\n+\npara two\n";
    const first = await formatAdoc(input);
    expect(first).toBe(input);
    expect(await formatAdoc(first)).toBe(first);
  });

  test("chain of block, paragraph, block round-trips", async () => {
    const input = "* item:\n+\n----\none\n----\n+\npara\n+\n----\ntwo\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Blank line between the `+` and the block: the dangling `+`
  // is preserved verbatim and the block stays separate (existing
  // behavior — Asciidoctor still attaches across the blank line,
  // so the bytes must survive).
  test("blank line after dangling + is preserved verbatim", async () => {
    const input = "* item\n+\n\n....\nliteral\n....\n";
    const first = await formatAdoc(input);
    expect(first).toBe(input);
    expect(await formatAdoc(first)).toBe(first);
  });
});

// Semantic fidelity: byte-level round-trips can still lie about
// meaning (a `+` folded into text may LOOK harmless), so assert
// that Asciidoctor renders the formatted output to the same HTML
// as the input for the whole continuation corpus. Entries the
// formatter normalizes are the load-bearing ones (they prove the
// rewrite preserved meaning); entries the formatter leaves
// byte-identical only guard against future output changes.
describe("list continuation formatting preserves rendered HTML", () => {
  const corpus: Record<string, string> = {
    "paragraph continuation": "* item text.\n+\nAttached paragraph.\n",
    "chained continuations":
      "* item.\n+\nFirst attached.\n+\nSecond attached.\n",
    "trailing-whitespace marker": "* item text.\n+ \nAttached paragraph.\n",
    "consecutive + lines": "* item\n+\n+\nAttached\n",
    "trailing consecutive + markers": "* item\n+\n+\n",
    "indented literal after +": "* item\n+\n  literal line\n",
    "mixed indented-then-flush segment":
      "* item\n+\n  literal line\nflush paragraph line\n",
    "alternating indented and flush lines": "* item\n+\n  lit\nflush\n  lit2\n",
    "tab-indented literal after +": "* item\n+\n\tliteral tab line\n",
    "dangling + before paragraph": "* item text\n+\n\nA separate paragraph.\n",
    "ordered list continuation": ". item text.\n+\nAttached paragraph.\n",
    "callout continuation": "<1> note text.\n+\nAttached paragraph.\n",
    "nested item continuation":
      "* parent\n** nested item.\n+\nAttached to nested.\n",
    "code span with plus": "* item with a `+` code span.\n",
    "attached literal block":
      "* item:\n+\n....\nliteral block content\n....\n+\nafter the block.\n\n* item two.\n",
    "attached listing block": "* item:\n+\n----\ncode here\n----\n",
    "attached parent block": "* item:\n+\n====\nexample text\n====\n",
    "block then split paragraphs":
      "* item:\n+\n----\ncode\n----\n+\npara one\n+\npara two\n",
    "block paragraph block chain":
      "* item:\n+\n----\none\n----\n+\npara\n+\n----\ntwo\n----\n",
    "dangling + before block across blank line":
      "* item\n+\n\n....\nliteral\n....\n",
  };

  for (const [name, input] of Object.entries(corpus)) {
    test(`renders identically: ${name}`, async () => {
      const formatted = await formatAdoc(input);
      expect(renderedHtml(formatted)).toBe(renderedHtml(input));
    });
  }
});
