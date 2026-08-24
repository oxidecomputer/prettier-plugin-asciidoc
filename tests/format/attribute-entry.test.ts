/**
 * Format tests for AsciiDoc attribute entries.
 *
 * The formatter preserves attribute entries with normalized spacing:
 * `:name: value` (single space after the closing colon). No-value
 * entries like `:toc:` are left as-is. The two unset spellings
 * (`:!name:` and `:name!:`) are one fact and print as `:!name:`, and
 * the NAME prints lowercase — Asciidoctor downcases it on the way in
 * (`sanitize_attribute_name`, parser.rb l.2770-71).
 *
 * Consecutive attribute entries are joined by single newlines (no
 * blank line between them), matching the idiomatic AsciiDoc style
 * of stacking attributes together.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

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

  // `:!name:` is the canonical spelling — the form the AsciiDoc
  // documentation leads with — and it round-trips.
  test("prefix unset preserved", async () => {
    const input = ":!toc:\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // The suffix form is the same fact under another spelling:
  // `store_attribute` (parser.rb l.2131-41) chops the `!` off
  // whichever end carries it and unsets the same attribute, so there
  // is nothing for the second spelling to mean and it is respelled.
  test("suffix unset is respelled to the prefix form", async () => {
    const input = ":toc!:\n";
    const out = await formatAdoc(input);
    expect(out).toBe(":!toc:\n");
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
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

// `sanitize_attribute_name` is
// `name.gsub(InvalidAttributeNameCharsRx, '').downcase` (parser.rb
// l.2770-71), so the case an author typed reaches neither the
// attribute table nor any reference to it. Each row asserts the
// bytes, that Asciidoctor renders the output as it renders the
// input, and that a second pass is a fixed point.
describe("attribute-entry names print lowercase", () => {
  test.each([
    ["a set entry", ":Foo: v\n", ":foo: v\n"],
    ["a no-value entry", ":Toc:\n", ":toc:\n"],
    ["an all-caps name", ":AUTHOR: Bob\n", ":author: Bob\n"],
    ["a prefix unset", ":!Foo:\n", ":!foo:\n"],
    ["a suffix unset", ":Foo!:\n", ":!foo:\n"],
    // The character-stripping half of sanitize is NOT copied: `Foo Bar`
    // and `foo bar` both sanitize to `foobar`, so lowering alone is
    // render-preserving and leaves the author's spacing alone.
    ["a name with a space", ":Foo Bar: v\n", ":foo bar: v\n"],
    // The VALUE is content and keeps its case.
    ["the value is untouched", ":Foo: Mixed Case\n", ":foo: Mixed Case\n"],
    // A reference is content too — the oracle downcases at lookup, so
    // `{Foo}` still resolves against the lowered entry.
    [
      "a reference in the body still resolves",
      ":Foo: v\n\n{Foo} {foo}\n",
      ":foo: v\n\n{Foo} {foo}\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// The unset spelling, both directions, with the render and
// fixed-point proofs the byte change needs.
describe("the unset spelling is one", () => {
  test.each([
    [
      "the canonical form round-trips",
      ":!foo:\n\n{foo}\n",
      ":!foo:\n\n{foo}\n",
    ],
    ["the suffix form is respelled", ":foo!:\n\n{foo}\n", ":!foo:\n\n{foo}\n"],
    [
      "an unset that really unsets",
      ":foo: v\n:foo!:\n\n{foo}\n",
      ":foo: v\n:!foo:\n\n{foo}\n",
    ],
    ["a suffix unset with a value", ":foo!: v\n", ":!foo: v\n"],
    [
      "a document-header unset",
      "= T\n:sectnums!:\n\n== S\n",
      "= T\n:!sectnums:\n\n== S\n",
    ],
  ])("%s", async (_name, input, expected) => {
    const out = await formatAdoc(input);
    expect(out).toBe(expected);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});
