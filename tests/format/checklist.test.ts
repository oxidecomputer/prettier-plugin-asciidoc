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
