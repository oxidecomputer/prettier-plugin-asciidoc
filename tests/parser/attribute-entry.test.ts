/**
 * Parser tests for AsciiDoc attribute entries.
 *
 * Attribute entries are metadata declarations of the form `:name: value`.
 * They appear in the document header or body and set, unset, or assign
 * values to document attributes. The official ASG discards them, but a
 * formatter must preserve them to avoid losing metadata.
 *
 * Syntax variants:
 * - `:name: value` — set attribute to a value
 * - `:name:` — set attribute with no value (boolean/flag)
 * - `:!name:` — unset attribute (prefix form)
 * - `:name!:` — unset attribute (suffix form)
 * - a value ending in ` \` or ` +` runs onto the line below
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../helpers.js";

describe("attribute entry parsing", () => {
  // The fundamental contract: `:name: value` must become an attribute
  // entry node, not a paragraph. Without this, attribute metadata would
  // be treated as prose and reflowed.
  test(":name: value parses as an attribute entry", () => {
    const document = parse(":source-highlighter: rouge\n");
    const { children } = document;
    expect(children).toHaveLength(1);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.name).toBe("source-highlighter");
    expect(child0.value).toBe("rouge");
    expect(child0.unset).toBe(false);
  });

  // Boolean/flag attributes have no value — just `:toc:`. The parser
  // must distinguish "no value" (undefined) from "empty string value"
  // to faithfully reconstruct the original syntax.
  test(":name: with no value parses correctly", () => {
    const document = parse(":toc:\n");
    const { children } = document;
    expect(children).toHaveLength(1);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.name).toBe("toc");
    expect(child0.value).toBeUndefined();
    expect(child0.unset).toBe(false);
  });

  // The prefix unset form `:!name:` negates the attribute. The `!`
  // is stripped from the name and stored as the unset form so the
  // printer writes the one canonical spelling back.
  test(":!name: (prefix unset) parses correctly", () => {
    const document = parse(":!toc:\n");
    const { children } = document;
    expect(children).toHaveLength(1);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.name).toBe("toc");
    expect(child0.value).toBeUndefined();
    expect(child0.unset).toBe(true);
  });

  // The suffix form `:name!:` is the same fact spelled differently —
  // `store_attribute` (parser.rb l.2131-41) chops the `!` off either
  // end — so the node records the FACT and not the end it sat on.
  test(":name!: (suffix unset) parses correctly", () => {
    const document = parse(":toc!:\n");
    const { children } = document;
    expect(children).toHaveLength(1);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.name).toBe("toc");
    expect(child0.value).toBeUndefined();
    expect(child0.unset).toBe(true);
  });

  // Prettier uses locStart/locEnd for cursor tracking and range
  // formatting. The attribute entry's position must cover the full
  // line from the opening `:` to the end of the value.
  test("attribute entry has correct position", () => {
    const document = parse(":author: Jane\n");
    expect(document.children[0].position.start.offset).toBe(0);
    expect(document.children[0].position.start.line).toBe(1);
    expect(document.children[0].position.start.column).toBe(1);
    // ":author: Jane" is 13 chars (offsets 0–12); end is exclusive,
    // so end.offset = 13 (one past the last character).
    const EXPECTED_END_OFFSET = 13;
    expect(document.children[0].position.end.offset).toBe(EXPECTED_END_OFFSET);
  });

  // Authors typically stack multiple attribute entries at the top of
  // a document. Each must be its own AST node so the printer can
  // emit them individually.
  test("consecutive attribute entries are separate nodes", () => {
    const document = parse(":author: Jane\n:revdate: 2024-01-01\n");
    const { children } = document;
    expect(children).toHaveLength(2);
    const [child0, child1] = children;
    narrow(child0, "attributeEntry");
    narrow(child1, "attributeEntry");
    expect(child0.name).toBe("author");
    expect(child0.value).toBe("Jane");
    expect(child1.name).toBe("revdate");
    expect(child1.value).toBe("2024-01-01");
  });

  // Attribute entries must survive as block-level nodes between
  // paragraphs, not be absorbed into adjacent paragraphs.
  test("attribute entry between paragraphs is preserved", () => {
    const document = parse("Before.\n\n:key: value\n\nAfter.\n");
    expect(document.children).toHaveLength(3);
    expect(document.children[0].type).toBe("paragraph");
    expect(document.children[1].type).toBe("attributeEntry");
    expect(document.children[2].type).toBe("paragraph");
  });

  // Flat model, sections not modeled: the entry and the paragraph are the
  // heading's siblings.
  test("attribute entry after a heading is a sibling", () => {
    const { children } = parse("== Title\n\n:key: value\n\nText.\n");
    expect(children.map((child) => child.type)).toEqual([
      "heading",
      "attributeEntry",
      "paragraph",
    ]);
  });

  // Attribute names can start with underscores and contain hyphens
  // and digits. Verify the parser accepts the full range of valid
  // name characters defined by AsciiDoc.
  test("attribute name with underscores and digits", () => {
    const document = parse(":_my-attr2: value\n");
    const { children } = document;
    expect(children).toHaveLength(1);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.name).toBe("_my-attr2");
    expect(child0.value).toBe("value");
  });

  // A value with extra spaces after the colon should preserve only
  // the content (the single space after `:` is syntactic separator,
  // not part of the value).
  test("value with leading whitespace is trimmed", () => {
    const document = parse(":key:   spaced value\n");
    const { children } = document;
    expect(children).toHaveLength(1);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.name).toBe("key");
    expect(child0.value).toBe("spaced value");
  });

  // Unset with a value (`:!name: value`) is unusual but syntactically
  // valid in AsciiDoc. This documents the expected behavior for this
  // edge case: both the unset flag and the value must be
  // preserved independently on the AST node.
  test("unset with value (:!name: value) preserves both", () => {
    const document = parse(":!experimental: value\n");
    const { children } = document;
    expect(children).toHaveLength(1);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.name).toBe("experimental");
    expect(child0.unset).toBe(true);
    expect(child0.value).toBe("value");
  });

  // `:key: ` (colon-space-newline) is subtly different from `:key:`
  // (colon-newline). In the regex, `\s?` consumes the space and
  // `(?<value>.+)?` has nothing left to match, so the `value`
  // group is `undefined` (not `""`). This matches the no-value
  // case — both produce `undefined`. The distinction matters
  // because an empty-string value would be printed as `:key: `
  // (with a trailing space), which Prettier would then strip.
  test(":key: with trailing space is treated as no value", () => {
    const document = parse(":key: \n");
    const { children } = document;
    expect(children).toHaveLength(1);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.name).toBe("key");
    expect(child0.value).toBeUndefined();
  });

  // A value that is only whitespace (`:key:   `) should be treated
  // as no value after trimming. The AST builder trims the raw value
  // and collapses empty-after-trim to `undefined`. This guards
  // against regressions where whitespace-only values leak through
  // as empty strings.
  test("whitespace-only value treated as no value", () => {
    const document = parse(":key:   \n");
    const { children } = document;
    expect(children).toHaveLength(1);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.name).toBe("key");
    expect(child0.value).toBeUndefined();
  });
});

// The value carried onto the lines below (issue #24). Before the
// entry reached past its own line, `:a: one \` was a one-line entry
// and every line under it was a block of its own - the value lost
// everything after its first piece. The node carries the SOURCE
// spelling, newlines and all, because the split points are the
// author's and Asciidoctor cannot see them
// (src/parse/lines/attribute-entry.ts).
describe("a continued attribute entry", () => {
  test.each([
    ["the backslash marker", ":a: one \\\ntwo\n", "one \\\ntwo"],
    ["the legacy plus marker", ":a: one +\ntwo\n", "one +\ntwo"],
    [
      "every line that repeats the suffix",
      ":a: one \\\ntwo \\\nthree\n",
      "one \\\ntwo \\\nthree",
    ],
    [
      "the indentation the author aligned with",
      ":a: one \\\n    two\n",
      "one \\\n    two",
    ],
    [
      "a run that stops at a line without the suffix",
      ":a: one \\\ntwo\nthree\n",
      "one \\\ntwo",
    ],
    [
      "a backslash run that does not chain into a plus line",
      ":a: one \\\ntwo +\nthree\n",
      "one \\\ntwo +",
    ],
  ])("%s", (_name, input, value) => {
    const { children } = parse(input);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.name).toBe("a");
    expect(child0.value).toBe(value);
  });

  // The entry's span reaches to the end of its last line, so the
  // block after it starts where the source says it does.
  test("the entry's position covers every line it read", () => {
    const document = parse(":a: one \\\ntwo\n\npara\n");
    const [child0, child1] = document.children;
    narrow(child0, "attributeEntry");
    expect(child0.position.start.line).toBe(1);
    expect(child0.position.end.line).toBe(2);
    narrow(child1, "paragraph");
    expect(child1.position.start.line).toBe(4);
  });

  // ADVERSARIAL NEIGHBOURS: a trailing backslash with no space before
  // it is not the ` \` suffix `process_attribute_entry` tests, and
  // `:a: \` has the single character `\` for a value because
  // AttributeEntryRx eats the blanks after the colon. Neither
  // continues, so the line below stays a block of its own.
  test.each([
    ["a backslash with no space before it", ":a: one\\\ntwo\n", "one\\"],
    ["a value that is only the marker character", ":a: \\\ntwo\n", "\\"],
    ["a marker with a blank line under it", ":a: one \\\n\ntwo\n", "one \\"],
  ])("%s leaves the next line its own block", (_name, input, value) => {
    const { children } = parse(input);
    const [child0, child1] = children;
    narrow(child0, "attributeEntry");
    expect(child0.value).toBe(value);
    narrow(child1, "paragraph");
  });

  // End of input is the loop's other exit: there is no line to
  // continue onto, so the entry is the ordinary one-line case.
  test("a marker at the end of input continues nothing", () => {
    const { children } = parse(":a: one \\\n");
    expect(children).toHaveLength(1);
    const [child0] = children;
    narrow(child0, "attributeEntry");
    expect(child0.value).toBe("one \\");
  });

  // A header entry is read by the header scan, not the block reader,
  // and it has its own reason to get this right: reading the
  // continuation as a line of its own used to spend the author slot
  // on it and demote the real author line to the revision.
  test("a continued entry inside a document header keeps the slots", () => {
    const document = parse("= T\n:a: one \\\n  two\nDoc Writer\n");
    const [header] = document.children;
    narrow(header, "documentHeader");
    const [entry, author] = header.lines;
    narrow(entry, "attributeEntry");
    expect(entry.value).toBe("one \\\n  two");
    narrow(author, "authorLine");
    expect(author.value).toBe("Doc Writer");
  });
});
