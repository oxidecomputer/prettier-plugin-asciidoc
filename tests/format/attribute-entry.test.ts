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
import { expectFormatted, formatAdoc, renderedHtml } from "../helpers.js";

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
    await expectFormatted(input, expected);
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
    await expectFormatted(input, expected);
  });
});

// A value the author carried onto the lines below with ` \` (or the
// legacy ` +`). Before the entry reached past its own line, the
// printer wrote a blank line under the first one and the rest of the
// value became body text - a literal paragraph, in the aligned
// spelling below - so the attribute lost everything after its first
// piece. Each row proves three things at once: the bytes come back,
// Asciidoctor renders the output the way it renders the input, and
// the output is a fixed point.
describe("a continued value keeps the author's split points", () => {
  test.each([
    [
      "the backslash marker",
      ":description: This is the first \\\n              Ruby implementation of \\\n              AsciiDoc.\n\n{description}\n",
      ":description: This is the first \\\n              Ruby implementation of \\\n              AsciiDoc.\n\n{description}\n",
    ],
    [
      "the legacy plus marker",
      ":description: This is the first +\n              Ruby implementation of +\n              AsciiDoc.\n\n{description}\n",
      ":description: This is the first +\n              Ruby implementation of +\n              AsciiDoc.\n\n{description}\n",
    ],
    [
      "a hard line break inside a continued value",
      ":description: first line + \\\nsecond line\n\n{description}\n",
      ":description: first line + \\\nsecond line\n\n{description}\n",
    ],
    // The run ends ON the line that does not repeat the suffix -
    // that line belongs to the value - and the block under it is a
    // block of its own, which is why the two rows below take the
    // ordinary blank-line separator between an entry and a paragraph.
    [
      "a run that stops at the first line without the marker",
      ":a: one \\\ntwo \\\nthree\nfour\n\n{a}\n",
      ":a: one \\\ntwo \\\nthree\n\nfour\n\n{a}\n",
    ],
    [
      "a backslash run does not chain into a plus line",
      ":a: one \\\ntwo +\nthree\n\n{a}\n",
      ":a: one \\\ntwo +\n\nthree\n\n{a}\n",
    ],
    [
      "the entry sits in a document header",
      "= T\n:description: one \\\n  two\nDoc Writer\n\n{description}\n",
      "= T\n:description: one \\\n  two\nDoc Writer\n\n{description}\n",
    ],
    [
      "an unset spelling is still respelled around it",
      ":a!: one \\\ntwo\n\n{a}\n",
      ":!a: one \\\ntwo\n\n{a}\n",
    ],
  ])("%s", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // ADVERSARIAL NEIGHBOURS: lines that look like the new syntax and
  // are not. `:a: one\` ends in a backslash with no space before it,
  // which `process_attribute_entry` does not accept (it tests the
  // two-character suffix ` \`), and `:a: \` has a value of `\` alone
  // because AttributeEntryRx eats the blanks after the colon. Both
  // leave the next line a block of its own, and the formatter must
  // not swallow it into the entry.
  test.each([
    ["a backslash with no space before it", ":a: one\\\ntwo\n\n{a}\n"],
    ["a value that is only the marker character", ":a: \\\ntwo\n\n{a}\n"],
    ["a marker with a blank line under it", ":a: one \\\n\ntwo\n\n{a}\n"],
    ["a marker at the end of input", ":a: one \\\n"],
    ["a plus that is a hard line break in prose", "one +\ntwo\n"],
  ])("%s", async (_name, input) => {
    const out = await formatAdoc(input);
    expect(await renderedHtml(out)).toBe(await renderedHtml(input));
    expect(await formatAdoc(out)).toBe(out);
  });
});

// The NAME CLASS (issue #246). Red before ATTRIBUTE_ENTRY stopped
// approximating Ruby's word class with `\w`
// (src/parse/line-shapes.ts): `:ünicode: v` was prose to the reader,
// the paragraph under it reflow-joined onto the same line, and the
// joined line then WAS an entry whose value swallowed the text, so
// the render lost it. Every row was measured through both programs
// before it was written, and both read every one of them the same
// way.
//
// The trailing rows are the class edges the two authorities agree on:
// a name is at least one character, so `:: v` stays prose and its
// paragraph joins; a space is outside the class but only the FIRST
// character is held to it, so `:a b: v` is an entry; and an ASCII name
// is untouched by the widening.
//
// A non-ASCII name keeps the author's CASE, which is what `:Ωmega:`
// and `:ΤΙΤΛΟΣ:` pin. An ASCII name still prints downcased
// (`sanitize_attribute_name`, parser.rb l.2770-71, reaches the same
// spelling), but outside ASCII the two programs lowercase differently
// and the respelling is not licensed - see printAttributeEntry in
// src/print/blocks.ts.
describe("attribute entry names outside ASCII", () => {
  test.each([
    [":ünicode: v\nmore text\n", ":ünicode: v\n\nmore text\n"],
    [":日本: v\nmore text\n", ":日本: v\n\nmore text\n"],
    [":Ωmega: v\nmore text\n", ":Ωmega: v\n\nmore text\n"],
    [":ключ: v\nmore text\n", ":ключ: v\n\nmore text\n"],
    [":ünicode!:\nmore text\n", ":!ünicode:\n\nmore text\n"],
    [":!ünicode:\nmore text\n", ":!ünicode:\n\nmore text\n"],
    [":café: v\nmore text\n", ":café: v\n\nmore text\n"],
    [":a-b: v\nmore text\n", ":a-b: v\n\nmore text\n"],
    [":1x: v\nmore text\n", ":1x: v\n\nmore text\n"],
    [":_x: v\nmore text\n", ":_x: v\n\nmore text\n"],
    [":a b: v\nmore text\n", ":a b: v\n\nmore text\n"],
    [":: v\nmore text\n", ":: v more text\n"],
  ])("%j formats to %j", async (input, expected) => {
    await expectFormatted(input, expected);
  });

  // The value has to survive as a value, not just as bytes on the
  // line: an entry the reader missed set nothing, so a reference to
  // it rendered as the literal `{name}`. The reference is what makes
  // the render assertion inside expectFormatted able to see that.
  //
  // The last row is the one that made the printer's downcase a
  // defect. Both programs resolve `{ΤΙΤΛΟΣ}` against `:ΤΙΤΛΟΣ:` as
  // the author wrote it; lowercasing the name here does not reach the
  // same string the reference implementation reaches, because JS
  // applies the Unicode Final_Sigma rule to a trailing capital sigma
  // and Ruby does not, so the respelled name is one no reference
  // resolves and the value leaves the render. Red before
  // printAttributeEntry gated the respelling on ASCII: the output was
  // `:τιτλος:` with a FINAL sigma.
  test.each([
    [":ünicode: v\n\n{ünicode}\n", ":ünicode: v\n\n{ünicode}\n"],
    [
      ":ΤΙΤΛΟΣ: Οδηγός\n\nΤο {ΤΙΤΛΟΣ} λέει.\n",
      ":ΤΙΤΛΟΣ: Οδηγός\n\nΤο {ΤΙΤΛΟΣ} λέει.\n",
    ],
    [":ключ: v\n\n{ключ}\n", ":ключ: v\n\n{ключ}\n"],
    [":Ünicode: v\n\n{Ünicode}\n", ":Ünicode: v\n\n{Ünicode}\n"],
  ])("%j sets an attribute a reference can read", async (input, expected) => {
    await expectFormatted(input, expected);
  });
});
