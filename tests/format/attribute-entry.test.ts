/**
 * Format tests for AsciiDoc attribute entries.
 *
 * The formatter preserves attribute entries with normalized spacing:
 * `:name: value` (single space after the closing colon). No-value
 * entries like `:toc:` are left as-is. Unset forms (`:!name:` and
 * `:name!:`) are preserved in their original form.
 *
 * Consecutive attribute entries are joined by single newlines (no
 * blank line between them), matching the idiomatic AsciiDoc style
 * of stacking attributes together.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("attribute entry formatting", () => {
  // A canonical attribute entry with value must pass
  // through unchanged. This is the baseline — if this fails, the
  // printer is mangling attribute entries.
  test("attribute entry with value preserved as-is", async () => {
    const input = ":source-highlighter: rouge\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // No-value attribute entries (boolean flags) must not gain a
  // trailing space after the closing colon. A trailing space would
  // be invisible whitespace that linters flag.
  test("attribute entry with no value preserved as-is", async () => {
    const input = ":toc:\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Prefix unset form must pass through unchanged.
  test("prefix unset preserved", async () => {
    const input = ":!toc:\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Suffix unset form must pass through unchanged. Both unset forms
  // are valid AsciiDoc and the formatter should not convert between
  // them — that would change the author's style choice.
  test("suffix unset preserved", async () => {
    const input = ":toc!:\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Extra whitespace between the colon and value should be normalized
  // to a single space. This is a formatting opinion consistent with
  // how we normalize heading whitespace.
  test("extra spaces after colon normalized", async () => {
    const input = ":key:   spaced value\n";
    const expected = ":key: spaced value\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Consecutive attribute entries (common in document headers) should
  // be joined by single newlines, not separated by blank lines. This
  // matches idiomatic AsciiDoc style where attributes are stacked.
  test("consecutive attribute entries have no blank line between them", async () => {
    const input = ":author: Jane\n:revdate: 2024-01-01\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Attribute entries between paragraphs get the standard blank-line
  // treatment: one blank line on each side.
  test("attribute entry between paragraphs has normalized blank lines", async () => {
    const input = "Before.\n\n:key: value\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multiple blank lines around an attribute entry collapse to one,
  // matching paragraph behavior.
  test("multiple blank lines around attribute entry collapsed", async () => {
    const input = "Before.\n\n\n\n:key: value\n\n\n\nAfter.\n";
    const expected = "Before.\n\n:key: value\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Attribute entries inside sections must be separated from the
  // heading and from sibling blocks by blank lines.
  test("attribute entry inside a section", async () => {
    const input = "== Title\n\n:key: value\n\nText.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Mixed attribute entries and line comments should get blank-line
  // separation between the two different block types.
  test("attribute entry adjacent to line comment gets blank line", async () => {
    const input = ":key: value\n\n// comment\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Reverse direction: comment followed by attribute entry also
  // gets a blank-line separator, since they are different block types.
  test("line comment followed by attribute entry gets blank line", async () => {
    const input = "// comment\n\n:key: value\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});
