/**
 * Format tests for discrete headings.
 *
 * A `[discrete]` attribute list before a heading produces a
 * standalone heading that does not create a section. The formatter
 * preserves the `[discrete]` attribute list on its own line,
 * stacked with the heading (no blank line between them).
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { expectFormatted, formatAdoc, narrow } from "../helpers.js";

describe("discrete heading formatting", () => {
  // Canonical discrete heading passes through unchanged.
  test("discrete heading preserved as-is", async () => {
    const input = "[discrete]\n== Heading\n";
    await expectFormatted(input, input);
    // A `[discrete]` attribute list followed by a heading line
    // produces a DiscreteHeadingNode instead of an ordinary heading.
    // Discrete headings are standalone — they don't create sections.
    // Note: levels are zero-indexed, so `==` is level 1 (not 0 or 2),
    // matching the HeadingNode.level convention.
    const { children } = parse(input);
    // The attribute list is kept as a separate block (for stacking),
    // and the heading becomes a discreteHeading node.
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const [, child1] = children;
    narrow(child1, "discreteHeading");
    expect(child1.level).toBe(1);
    expect(child1.title).toBe("Heading");
  });

  // The heading marker spacing is normalized, just like sections.
  test("discrete heading marker spacing normalized", async () => {
    const input = "[discrete]\n==  Extra Spaces  \n";
    const expected = "[discrete]\n== Extra Spaces\n";
    expect(await formatAdoc(input)).toBe(expected);
  });

  // Discrete heading does not nest — paragraph after it gets a
  // blank line separator, not section-style nesting.
  test("paragraph after discrete heading gets blank line", async () => {
    const input = "[discrete]\n== Heading\n\nSome text.\n";
    await expectFormatted(input, input);
  });

  // Discrete headings at various levels.
  test("discrete heading at level 2", async () => {
    const input = "[discrete]\n=== Subtitle\n";
    await expectFormatted(input, input);
  });

  test("discrete heading at level 3", async () => {
    const input = "[discrete]\n==== Deep Heading\n";
    await expectFormatted(input, input);
  });

  // Level 0 is valid for a discrete heading: `=` is a depth here,
  // not a document title, because the heading is style rather than
  // structure. The whole marker range round-trips byte-stably.
  test("discrete heading at level 0", async () => {
    const input = "[discrete]\n= T\n";
    await expectFormatted(input, input);
    // Level 0 (`=`) is VALID for a discrete heading: the marker that
    // would be a document title on an ordinary heading is only a depth
    // here, because a discrete heading is style, not structure. One
    // derivation classifies and builds the marker, so the whole
    // `=`-through-`======` range reaches the node.
    const { children } = parse(input);
    expect(children).toHaveLength(2);
    const [, child1] = children;
    narrow(child1, "discreteHeading");
    expect(child1.level).toBe(0);
    expect(child1.title).toBe("T");
  });

  // Discrete heading inside a section.
  test("discrete heading inside a section", async () => {
    const input = "== Section\n\n[discrete]\n=== Standalone\n\nParagraph.\n";
    await expectFormatted(input, input);
  });

  // Multiple discrete headings in sequence.
  test("consecutive discrete headings", async () => {
    const input = "[discrete]\n== First\n\n[discrete]\n== Second\n";
    await expectFormatted(input, input);
  });

  // A block anchor stacks with following metadata ([discrete]
  // attribute list), which itself stacks with the heading.
  test("anchor + discrete + heading", async () => {
    const input = "[[my-id]]\n[discrete]\n== Heading\n";
    await expectFormatted(input, input);
  });

  // `[float]` is the SAME style under a second name (parser.rb l.709
  // reads the pair with one test), so it builds the same node.
  // Red before the reader read both names: `[float]` fell through to
  // the ordinary heading arm, and the level >= 1 heading that made
  // carries a section's stacking rules.
  test("[float] names the same style as [discrete]", async () => {
    const input = "[float]\n== Heading\n";
    await expectFormatted(input, input);
    const { children } = parse(input);
    const [, child1] = children;
    narrow(child1, "discreteHeading");
    expect(child1.level).toBe(1);
    expect(child1.title).toBe("Heading");
  });
});

// Sections do not nest in a block, so a PLAIN title inside a
// container is paragraph text to both programs. A floating title is
// not: `next_block` owns its branch (parser.rb l.709) and
// `next_block` is exactly what reads an item's buffer and a compound
// interior, so both programs read a heading there.
describe("a floating title inside a container", () => {
  // Red before the reader ordered the style test ahead of its
  // confinement arm (issue #315): every row here folded the title
  // onto the line below (`== T para`), one paragraph where both
  // programs render a heading and a paragraph.
  test.each([
    [
      "an example block",
      "====\n[discrete]\n== T\npara\n====\n",
      "====\n[discrete]\n== T\n\npara\n====\n",
    ],
    [
      "an example block, [float]",
      "====\n[float]\n== T\npara\n====\n",
      "====\n[float]\n== T\n\npara\n====\n",
    ],
    [
      "a sidebar",
      "****\n[discrete]\n== T\npara\n****\n",
      "****\n[discrete]\n== T\n\npara\n****\n",
    ],
    [
      "an attached block in a list item",
      "* item\n+\n[discrete]\n== T\npara\n",
      "* item\n+\n[discrete]\n== T\npara\n",
    ],
    [
      "an attached block in a list item, [float]",
      "* item\n+\n[float]\n== T\npara\n",
      "* item\n+\n[float]\n== T\npara\n",
    ],
  ])("%s keeps the heading", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // SHORTHAND spells the same style. `next_block`'s branch (parser.rb
  // l.709) reads the style `parse_style_attribute` stored (l.2060,
  // l.2600), so the role, id and option shorthands ride along on it
  // and `[discrete.myrole]` names `discrete`. Red while the gate read
  // the raw first positional: every row here folded, and
  // `[float.independent#first]` is a shape the vendored corpus
  // carries.
  test.each([
    [
      "a role",
      "====\n[discrete.myrole]\n== T\npara\n====\n",
      "====\n[discrete.myrole]\n== T\n\npara\n====\n",
    ],
    [
      "an id",
      "====\n[discrete#tid]\n== T\npara\n====\n",
      "====\n[discrete#tid]\n== T\n\npara\n====\n",
    ],
    [
      "an option, [float]",
      "====\n[float%opt]\n== T\npara\n====\n",
      "====\n[float%opt]\n== T\n\npara\n====\n",
    ],
    [
      "a role and an id together, [float]",
      "====\n[float.independent#first]\n== T\npara\n====\n",
      "====\n[float.independent#first]\n== T\n\npara\n====\n",
    ],
  ])("%s on the style still names it", async (_name, input, expected) => {
    await expectFormatted(input, expected);
  });

  // The CONTROLS. A plain title inside a container has no branch in
  // `next_block`, so it is paragraph text that runs on into the line
  // below and the packer folds it - the reading issue #293 settled,
  // which the reorder above must leave standing. A bracket line whose
  // first entry is shorthand ALONE names no style at all, to Ruby and
  // to us, so it folds for the same reason.
  test.each([
    ["a plain title", "====\n== T\npara\n====\n", "====\n== T para\n====\n"],
    [
      "a title under a role-only line",
      "====\n[.myrole]\n== T\npara\n====\n",
      "====\n[.myrole]\n== T para\n====\n",
    ],
  ])(
    "%s inside a container is still folded",
    async (_name, input, expected) => {
      await expectFormatted(input, expected);
    },
  );
});
