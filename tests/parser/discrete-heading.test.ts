import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/narrow.js";

describe("discrete heading parsing", () => {
  // A `[discrete]` attribute list followed by a heading line
  // produces a DiscreteHeadingNode instead of an ordinary heading.
  // Discrete headings are standalone — they don't create sections.
  // Note: levels are zero-indexed, so `==` is level 1 (not 0 or 2),
  // matching the HeadingNode.level convention.
  test("[discrete] + == Heading produces a discrete heading", () => {
    const { children } = parse("[discrete]\n== Heading\n");
    // The attribute list is kept as a separate block (for stacking),
    // and the heading becomes a discreteHeading node.
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    const [, child1] = children;
    narrow(child1, "discreteHeading");
    expect(child1.level).toBe(1);
    expect(child1.title).toBe("Heading");
  });

  // Discrete headings do NOT nest subsequent blocks. A paragraph
  // after a discrete heading should be a sibling, not a child.
  test("discrete heading does not nest subsequent blocks", () => {
    const document = parse("[discrete]\n== Heading\n\nA paragraph.\n");
    expect(document.children).toHaveLength(3);
    expect(document.children[0].type).toBe("blockAttributeList");
    expect(document.children[1].type).toBe("discreteHeading");
    expect(document.children[2].type).toBe("paragraph");
  });

  // Discrete headings work at all section levels (== through ======).
  // Levels 2, 3, and 5 are tested (non-consecutive) to verify any
  // level converts, not just those adjacent to the base case.
  // Level 4 is intentionally omitted as redundant given 3 and 5.
  test("discrete heading at level 2 (===)", () => {
    const { children } = parse("[discrete]\n=== Level 2\n");
    expect(children).toHaveLength(2);
    const [, child1] = children;
    narrow(child1, "discreteHeading");
    expect(child1.level).toBe(2);
    expect(child1.title).toBe("Level 2");
  });

  // Level 3 (====): one step beyond level 2, still no section nesting.
  test("discrete heading at level 3 (====)", () => {
    const { children } = parse("[discrete]\n==== Level 3\n");
    expect(children).toHaveLength(2);
    const [, child1] = children;
    narrow(child1, "discreteHeading");
    expect(child1.level).toBe(3);
    expect(child1.title).toBe("Level 3");
  });

  // Level 5 (======): the deepest valid heading level.
  test("discrete heading at level 5 (======)", () => {
    const { children } = parse("[discrete]\n====== Level 5\n");
    expect(children).toHaveLength(2);
    const [, child1] = children;
    narrow(child1, "discreteHeading");
    expect(child1.level).toBe(5);
    expect(child1.title).toBe("Level 5");
  });

  // Level 0 (`=`) is VALID for a discrete heading: the marker that
  // would be a document title on an ordinary heading is only a depth
  // here, because a discrete heading is style, not structure. One
  // derivation classifies and builds the marker, so the whole
  // `=`-through-`======` range reaches the node.
  test("discrete heading at level 0 (=)", () => {
    const { children } = parse("[discrete]\n= T\n");
    expect(children).toHaveLength(2);
    const [, child1] = children;
    narrow(child1, "discreteHeading");
    expect(child1.level).toBe(0);
    expect(child1.title).toBe("T");
  });

  // [discrete] under a heading: attrs + discrete heading + body are
  // FLAT siblings after the heading leaf — sections are not modeled.
  test("discrete heading after a section heading stays a leaf run", () => {
    const { children } = parse(
      "== Section\n\n[discrete]\n=== Discrete\n\nParagraph.\n",
    );
    expect(children.map((child) => child.type)).toEqual([
      "heading",
      "blockAttributeList",
      "discreteHeading",
      "paragraph",
    ]);
  });

  // A heading without [discrete] is an ordinary heading leaf: the
  // discrete arm is a no-op when the `[discrete]` attribute is
  // absent.
  test("heading without [discrete] is an ordinary heading", () => {
    const document = parse("== Normal Section\n");
    expect(document.children).toHaveLength(1);
    expect(document.children[0].type).toBe("heading");
  });

  // When [discrete] is followed by a non-heading line (e.g. a plain
  // paragraph), the attribute list is not consumed by the discrete
  // heading conversion. Both the attribute list and the paragraph
  // remain as separate sibling nodes.
  test("[discrete] not followed by heading is a no-op", () => {
    const { children } = parse("[discrete]\nJust a paragraph.\n");
    expect(children).toHaveLength(2);
    expect(children[0].type).toBe("blockAttributeList");
    expect(children[1].type).toBe("paragraph");
  });

  // An attribute list whose positional attribute is not "discrete"
  // must not trigger the conversion. `[appendix]` was chosen as a
  // realistic AsciiDoc style (not an invented `[foo]`) to confirm
  // the check is strictly value-equality against "discrete".
  test("[appendix] + heading is still an ordinary heading", () => {
    const document = parse("[appendix]\n== Appendix\n");
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("blockAttributeList");
    expect(document.children[1].type).toBe("heading");
  });
});
