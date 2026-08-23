/**
 * Format tests for block attribute lists, anchors, and titles.
 *
 * The formatter preserves block metadata lines as-is:
 * - `[source,ruby]` — block attribute list
 * - `[[anchor-id]]` — block anchor (a `blockAnchor` node, spec D6)
 * - `.Block Title` — block title
 *
 * Block metadata lines stack with the following block (no blank
 * line between them), matching idiomatic AsciiDoc style.
 */
import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

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

  // Anchor on its own line before text is a block-level anchor: the
  // reader holds the line back as metadata and it becomes its own
  // `blockAnchor` node, so the paragraph after it is a separate
  // block. The printer then refuses to stack the two
  // (wouldMergeWithAnchor) — stacked, a re-parse would absorb the
  // anchor into the paragraph's text — so the output gains a blank
  // line.
  test("anchor before text splits with blank line", async () => {
    const input = "[[my-anchor]]\nSome text.\n";
    expect(await formatAdoc(input)).toBe("[[my-anchor]]\n\nSome text.\n");
  });

  // Anchor followed by a blank line stays separate — the blank line
  // is preserved because closing it would merge the two on re-parse
  // (wouldMergeWithAnchor).
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
  // A block anchor is block metadata — it stacks with the following
  // title and attribute list. The entire metadata chain stacks with
  // the block.
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

describe("block anchor spelling and idempotence (spec D6: byte-identical across the node change)", () => {
  test("a bare anchor keeps its spelling", async () => {
    const input = "[[my-id]]\n\npara\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await formatAdoc(output)).toBe(output);
    expect(renderedHtml(output)).toBe(renderedHtml(input));
  });

  test("an anchor with reftext keeps today's normalized spelling", async () => {
    const input = "[[my-id,Ref Text]]\n\npara\n";
    const output = await formatAdoc(input);
    expect(output).toBe("[[my-id, Ref Text]]\n\npara\n");
    expect(await formatAdoc(output)).toBe(output);
    expect(renderedHtml(output)).toBe(renderedHtml(input));
  });

  test("anchor over a block stacks; anchor over a paragraph keeps its blank line", async () => {
    const stacked = "[[a]]\n----\nx\n----\n";
    expect(await formatAdoc(stacked)).toBe(stacked);
    const merged = "[[a]]\n\npara\n";
    expect(await formatAdoc(merged)).toBe(merged);
  });
});

// A `[[…]]` line is a block ANCHOR only when it matches the
// block-anchor grammar (BLOCK_ANCHOR_SOURCE, parse/line-shapes.ts;
// behavior is Ruby's `BlockAnchorRx`). When the id fails it, or the
// reftext alternative does not, Asciidoctor reads the line as an
// ordinary PARAGRAPH — and so does the reader. It still prints as
// `[[…]]` alone on a line, so the printer keeps it stacked with the
// block below (`isPseudoAnchorLine`, src/block-metadata.ts — the
// shared predicate both printer-side rules consult since spec D6): the
// author's
// bytes survive and re-parsing our output gains no blank line.
//
// The class the suites missed before spec D6: every anchor alphabet in
// the repo (fuzz `/[A-Za-z_][\w-]{0,14}/`, the sweep's `[[anc]]`, the
// hand-written `[[my-id]]`) generates a VALID id, so only the corpus
// reached it — `blocks_test.rb#should not recognize block anchor that
// starts with digit#0` and `#should not recognize block anchor with
// illegal id characters#0`, which parity holds byte-identical.
describe("pseudo-anchor lines (spec D6: a `[[…]]` line that is not a block anchor)", () => {
  test("a digit-leading id stacks with the block below, unchanged", async () => {
    const input = "[[3-blind-mice]]\n----\nx\n----\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await formatAdoc(output)).toBe(output);
    expect(renderedHtml(output)).toBe(renderedHtml(input));
  });

  test("an illegal-character id stacks with the block below, unchanged", async () => {
    const input = "[[illegal$id]]\n----\nx\n----\n";
    const output = await formatAdoc(input);
    expect(output).toBe(input);
    expect(await formatAdoc(output)).toBe(output);
    expect(renderedHtml(output)).toBe(renderedHtml(input));
  });

  // The corpus row's own spelling. `, ` normalization inside the
  // brackets is pre-existing (anchorToSource) and the case is
  // quarantined for `fidelity`; what this row pins is the LINE
  // structure — the anchor stays on the delimiter's line.
  test("the reftext form keeps its stacking (bytes only — fidelity is quarantined)", async () => {
    const input = "[[illegal$id,Reference Text]]\n----\ncontent\n----\n";
    const output = await formatAdoc(input);
    expect(output).toBe(
      "[[illegal$id, Reference Text]]\n----\ncontent\n----\n",
    );
    expect(await formatAdoc(output)).toBe(output);
  });

  // `[[id,]]` is not a block-anchor line either: the grammar's reftext
  // alternative needs a character after the comma. It PRINTS as
  // `[[id]]`, which IS a block anchor on re-parse — so without the
  // pseudo-anchor clause pass 1 emitted a blank line that pass 2 took
  // back. Pass 1 must be the fixed point.
  //
  // No render check here, and the omission is not incidental: the
  // rendering DOES diverge (`[[id,]]` is literal text to Asciidoctor,
  // while `[[id]]` is a live anchor on the block below). That is the
  // pre-existing `anchorToSource` normalization, identical at
  // `ca35418c` — bytes and the fixed point are what this row owns.
  test("`[[id,]]` before a block: pass 1 is already the fixed point", async () => {
    const output = await formatAdoc("[[id,]]\n----\nx\n----\n");
    expect(output).toBe("[[id]]\n----\nx\n----\n");
    expect(await formatAdoc(output)).toBe(output);
  });
});
