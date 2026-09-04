import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

describe("checklist formatting", () => {
  // Canonical checked marker passes through unchanged.
  test("checked item preserved", async () => {
    const input = "* [x] Done\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Unchecked marker passes through unchanged.
  test("unchecked item preserved", async () => {
    const input = "* [ ] Not done\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // `[*]` is normalized to `[x]` (both mean checked, `[x]` is
  // the canonical form).
  test("[*] normalized to [x]", async () => {
    const input = "* [*] Done\n";
    const expected = "* [x] Done\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Mixed checklist and normal items are all preserved.
  test("mixed checklist items preserved", async () => {
    const input = "* [x] Done\n* Normal\n* [ ] Todo\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Nested checklists preserved with correct markers.
  test("nested checklist preserved", async () => {
    const input = "* [x] Parent\n** [ ] Child\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // A checklist after a paragraph has one blank line separator.
  test("checklist after paragraph", async () => {
    const input = "Some text.\n\n* [x] Done\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Long checklist item text is reflowed like regular list items.
  test("long checklist item reflowed", async () => {
    const input =
      "* [x] This is a very long checklist item that should be reflowed because it exceeds the default print width of eighty characters total\n";
    const result = await formatAdoc(input);
    const lines = result.split("\n");
    expect(lines[0].startsWith("* [x] ")).toBe(true);
    expect(lines.length).toBeGreaterThan(2);
  });

  // Ordered list items with `[x]` in the text are not treated
  // as checklists — the text is preserved verbatim.
  test("ordered list [x] is not treated as checkbox", async () => {
    const input = ". [x] Not a checkbox\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // ONE printed space after the checkbox, whatever the item's text
  // opens with. A text that starts with an inline construct rather than
  // a word gives the item an empty leading text node
  // (`[text "", inlineAnchor, text " a"]`), and an empty text node is
  // whitespace the checkbox prefix already carries — it contributes no
  // second space of its own. A doubled space is NOT read the same:
  // Asciidoctor keeps it in the rendered HTML, so the single space is
  // the spelling that renders like the input, and the render assert
  // below proves it.
  // The plain-text control rows are at the top of this file.
  test.each([
    ["a formatting span", "* [x] *b* c\n"],
    ["an inline anchor", "* [ ] [[anc]] a\n"],
    ["an attribute reference", "** [ ] {attr}\n"],
  ])(
    "one space after the checkbox when the text opens with %s",
    async (_name, input) => {
      const out = await formatAdoc(input);
      expect(out).toBe(input);
      expect(await renderedHtml(out)).toBe(await renderedHtml(input));
      expect(await formatAdoc(out)).toBe(out);
    },
  );

  // A marker is a checkbox only when the item's FIRST LINE carries
  // something after it. Asciidoctor tests the prefix against that one
  // line (`item_text` is group 2 of the marker row,
  // parser.rb l.1316, and the test is
  // `item_text.start_with?('[ ] ', '[x] ', '[*] ')`,
  // parser.rb l.1330), and the reader has already taken that line's
  // trailing whitespace off (`prepare_lines`, reader.rb l.582), so
  // `* [*] ` is the literal text `[*]`
  // and text that only arrives on a continuation line arrives too
  // late. Before the first line was read this way, `* [*] ` formatted
  // to `* [x]`, respelling literal text as a checkbox glyph.
  test.each([
    ["a checked marker alone on its line", "* [*] \n"],
    ["an x marker alone on its line", "* [x] \n"],
    ["an unchecked marker alone on its line", "* [ ] \n"],
    ["a marker followed only by more spaces", "* [*]   \n"],
    ["a marker followed only by a tab", "* [*] \t\n"],
  ])("no checkbox for %s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });

  // The literal bytes matter for the checked spelling: `[*]` is only
  // respelled `[x]` where it really is a checkbox, so a `[*]` the
  // oracle reads as text must survive verbatim.
  test("a marker the oracle reads as text keeps its spelling", async () => {
    expect(await formatAdoc("* [*] \n")).toBe("* [*]\n");
  });

  // The checked marker's own `*` is a bold delimiter too, so where a
  // second `*` stands later on the line the tokenizer pairs them and
  // the item's leading text node holds only `[`. There is no
  // four-character prefix to take off that node, so the item carries
  // no checkbox and keeps every byte the author wrote. The oracle
  // does read a checked item there, so this is a divergence, and the
  // rows below prove it costs nothing: the bytes replay, and the
  // replayed bytes read back as the same document.
  test.each([
    ["the text is one span", "* [*] *b*\n"],
    ["a span follows a word", "* [*] a *b*\n"],
  ])("the marker keeps its bytes when %s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(out).toBe(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  });

  // Continuation lines of a checklist item should align under
  // the text content, not under the checkbox bracket. The full
  // prefix is "* [x] " = 6 characters, so continuations need
  // a 6-space indent.
  test("checklist continuation aligns under text, not checkbox", async () => {
    const input =
      "* [x] This is a very long checklist item that definitely needs to be reflowed to multiple lines for proper formatting\n";
    const result = await formatAdoc(input, { printWidth: 40 });
    const lines = result.trimEnd().split("\n");
    // First line starts with "* [x] "
    expect(lines[0]).toMatch(/^\* \[x\] /v);
    // Continuation lines: 6-space indent ("* " + "[x] " = 6)
    for (const continuation of lines.slice(1)) {
      expect(continuation).toMatch(/^ {6}\S/v);
    }
  });
});
