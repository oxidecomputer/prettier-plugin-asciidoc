import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("section formatting", () => {
  // A canonical heading should pass through unchanged.
  test("heading preserved as-is", async () => {
    const input = "== Title\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // The formatter normalizes heading whitespace: extra spaces between
  // the == marker and the title text, and any trailing whitespace, are
  // collapsed to a single space. This is a core formatting opinion.
  test("heading marker spacing normalized", async () => {
    const input = "==  Extra Spaces  \n";
    const expected = "== Extra Spaces\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Heading and its body content are separated by exactly one blank line.
  test("one blank line between heading and paragraph", async () => {
    const input = "== Title\n\nSome text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Adjacent sections are separated by exactly one blank line.
  test("one blank line between sections", async () => {
    const input = "== First\n\n== Second\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Full scenario: section with content followed by another section.
  // Validates that the blank-line join works across the section boundary.
  test("section with paragraph and next section", async () => {
    const input = "== First\n\nParagraph.\n\n== Second\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multiple blank lines between sections are collapsed, same as paragraphs.
  test("multiple blank lines before section collapsed", async () => {
    const input = "== First\n\n\n\n== Second\n";
    const expected = "== First\n\n== Second\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // The formatter must not change heading levels — that would alter document
  // semantics. We only normalize whitespace, not structure.
  test("heading levels are not changed", async () => {
    const input = "=== Level 2\n\n==== Level 3\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

// Issue #3: a block anchor (`[[id]]`) directly above a section
// heading labels that section — the printer must keep it glued
// to the heading, with the inter-section blank line ABOVE the
// anchor. The bug hit sections that follow the end of a
// preceding section at the same or deeper level: the anchor was
// nested as the last child of the PREVIOUS section, so the
// between-sections blank line landed between the anchor and its
// heading, detaching the anchor (xrefs stop resolving).
describe("block anchors on section headings", () => {
  test("issue #3 repro: anchors stay attached in all positions", async () => {
    const input =
      "= Doc Title\n" +
      "\n" +
      "A preamble paragraph.\n" +
      "\n" +
      "[[first]]\n" +
      "== First\n" +
      "\n" +
      "Body text one.\n" +
      "\n" +
      "[[second]]\n" +
      "== Second\n" +
      "\n" +
      "Body text two.\n" +
      "\n" +
      "[[third]]\n" +
      "=== Third\n" +
      "\n" +
      "Body text three.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Asciidoctor attaches a block anchor to the following section
  // even across a blank line, so the formatter normalizes the
  // detached form back to the attached one (healing documents
  // damaged by the original bug).
  test("blank line between anchor and heading is removed", async () => {
    const input =
      "== First\n\nBody one.\n\n[[second]]\n\n== Second\n\nBody two.\n";
    const expected =
      "== First\n\nBody one.\n\n[[second]]\n== Second\n\nBody two.\n";
    const first = await formatAdoc(input);
    expect(first).toBe(expected);
    expect(await formatAdoc(first)).toBe(first);
  });

  test("block attribute list stays attached to sibling section", async () => {
    const input =
      "== First\n\nBody one.\n\n[appendix]\n== Second\n\nBody two.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("anchor stays attached to deeper sibling section", async () => {
    const input = "== First\n\nBody one.\n\n[[sub]]\n=== Sub\n\nBody sub.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // An anchor not followed by a section stays where it is — it
  // is not section metadata.
  test("dangling anchor at section end is preserved", async () => {
    const input = "== First\n\nBody one.\n\n[[dangling]]\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

// Chains of metadata leading to a heading move as a unit — the
// scan in isSectionMetadata walks through consecutive metadata
// blocks, so every element of the chain must stay beside the
// section it labels.
describe("section metadata chains", () => {
  test("anchor + attribute list chain stays attached", async () => {
    const input =
      "== First\n\nBody one.\n\n[[second]]\n[appendix]\n== Second\n\nBody two.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  test("anchor + block title + attribute chain stays attached", async () => {
    const input =
      "== First\n\nBody one.\n\n[[second]]\n.A title\n[appendix]\n== Second\n\nBody two.\n";
    const first = await formatAdoc(input);
    expect(first).toBe(input);
    expect(await formatAdoc(first)).toBe(first);
  });

  // KNOWN LIMITATION, pinned so nobody re-investigates: a
  // comment inside a metadata run stops the isSectionMetadata
  // scan, so the anchor+comment pair stays in the previous
  // section and the inter-section blank line lands between the
  // comment and the heading — visually detaching them. Cosmetic
  // only: Asciidoctor skips comment lines when attaching
  // metadata, so <<c>> still resolves to the section in both
  // layouts.
  test("comment-interleaved metadata detaches visually (known gap)", async () => {
    const input =
      "== First\n\nBody one.\n\n[[c]]\n// note\n== Second\n\nBody two.\n";
    const first = await formatAdoc(input);
    expect(first).toBe(
      "== First\n\nBody one.\n\n[[c]]\n// note\n\n== Second\n\nBody two.\n",
    );
    expect(await formatAdoc(first)).toBe(first);
  });
});
