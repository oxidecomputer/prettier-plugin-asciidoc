/**
 * Format tests for block attribute lists, anchors, and titles.
 *
 * The formatter preserves block metadata lines as-is:
 * - `[source,ruby]` — block attribute list
 * - `[[anchor-id]]` — anchor (paragraph with inlineAnchor)
 * - `.Block Title` — block title
 *
 * Block metadata lines stack with the following block (no blank
 * line between them), matching idiomatic AsciiDoc style.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc } from "../helpers.js";

describe("block attribute list formatting", () => {
  // A canonical attribute list must pass through
  // unchanged.
  test("attribute list preserved as-is", async () => {
    const input = "[source,ruby]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Shorthand ID preserved.
  test("[#myid] preserved as-is", async () => {
    const input = "[#myid]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Shorthand role preserved.
  test("[.role] preserved as-is", async () => {
    const input = "[.role]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Attribute list stacks with following block (single newline,
  // no blank line between them).
  test("attribute list stacks with listing block", async () => {
    const input = "[source,ruby]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Multiple attribute lists stack together.
  test("multiple attribute lists stack together", async () => {
    const input = "[source,ruby]\n[#myid]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Attribute list with blank line before a block should have
  // the blank line removed (stacking behavior).
  test("blank line between attribute list and block is removed", async () => {
    const input = "[source,ruby]\n\n----\nputs 'hello'\n----\n";
    const expected = "[source,ruby]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Attribute list between paragraphs should get blank-line
  // treatment: one blank line between each.
  test("attribute list between paragraphs", async () => {
    const input =
      "Before.\n\n[source,ruby]\n----\nputs 'hello'\n----\n\nAfter.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("standalone anchor formatting", () => {
  // Anchor passes through unchanged.
  test("standalone anchor preserved as-is", async () => {
    const input = "[[anchor-id]]\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Anchor on its own line before text is a block-level anchor.
  // The `splitBlockAnchors` pass splits it, so the output has
  // a blank line between the anchor and the paragraph.
  test("anchor before text splits with blank line", async () => {
    const input = "[[my-anchor]]\nSome text.\n";
    expect(await formatAdoc(input)).toBe("[[my-anchor]]\n\nSome text.\n");
  });

  // Anchor followed by a blank line stays separate — the blank
  // line is preserved since anchors are regular paragraphs.
  test("anchor preserves blank line before next block", async () => {
    const input = "[[my-anchor]]\n\nSome text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Anchor with reftext: normalizes to a space after the comma.
  test("anchor with reftext preserved", async () => {
    const input = "[[my-id,My Reference Text]]\n";
    const expected = "[[my-id, My Reference Text]]\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Anchor with reftext that already has a space after the comma
  // round-trips unchanged.
  test("anchor with reftext round-trips with space", async () => {
    const input = "[[my-id, My Reference Text]]\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("block anchors with include", () => {
  test("two anchors then include", async () => {
    const input = "[[A]]\n\n[[a]]\ninclude::A[]\n";
    expect(await formatAdoc(input)).toBe("[[A]]\n\n[[a]]\ninclude::A[]\n");
  });

  // Stacked block anchors must stay on separate lines —
  // collapsing onto one line turns block anchors into inline
  // anchors, which Asciidoctor renders differently.
  test("stacked anchors stay on separate lines", async () => {
    const input = "[[A]]\n[[a]]\nsome text\n";
    expect(await formatAdoc(input)).toBe("[[A]]\n\n[[a]]\n\nsome text\n");
  });
});

describe("block title formatting", () => {
  // Title passes through unchanged.
  test("block title preserved as-is", async () => {
    const input = ".My Title\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Title stacks with following listing block.
  test("title stacks with listing block", async () => {
    const input = ".Example Code\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Title stacks with following paragraph.
  test("title stacks with paragraph", async () => {
    const input = ".Important Note\nThis is the note text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});

describe("combined block metadata formatting", () => {
  // Anchor paragraph is block metadata — it stacks with the
  // following title and attribute list. The entire metadata chain
  // stacks with the block.
  test("anchor + title + attribute list + block", async () => {
    const input =
      "[[my-id]]\n.My Title\n[source,ruby]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Title + attribute list before a paragraph.
  test("title + attribute list before paragraph stacks", async () => {
    const input = ".Important\n[#note]\nSome paragraph text.\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Attribute list before a section stacks.
  test("attribute list before section stacks", async () => {
    const input = "[appendix]\n== Appendix A\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // Metadata with blank lines between them should collapse.
  test("blank lines between metadata lines are removed", async () => {
    const input = ".My Title\n\n[source,ruby]\n\n----\nputs 'hello'\n----\n";
    const expected = ".My Title\n[source,ruby]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Block metadata after a paragraph gets blank-line separation.
  test("paragraph then metadata then block", async () => {
    const input = "Some text.\n\n[source,ruby]\n----\nputs 'hello'\n----\n";
    expect(await formatAdoc(input)).toBe(input);
  });
});
