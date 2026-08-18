import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/unreachable.js";

describe("section parsing", () => {
  // In AsciiDoc, == is a level-1 section heading (analogous to HTML h2).
  // The level is (number of = signs) - 1, because = (single) is reserved
  // for the document title (a separate node type, not a section).
  test("== Title parses as section level 1", () => {
    const document = parse("== Title\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "section");
    expect(child0.level).toBe(1);
    expect(child0.heading).toBe("Title");
  });

  // === is level 2 (h3). Verify independent of the previous test to catch
  // off-by-one errors in the level calculation.
  test("=== Title parses as section level 2", () => {
    const document = parse("=== Subsection\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "section");
    expect(child0.level).toBe(2);
    expect(child0.heading).toBe("Subsection");
  });

  // AsciiDoc supports headings from == (level 1) through ====== (level 5).
  // This exhaustive check catches regex boundary issues with ={2,6}.
  test("all heading levels from 2 to 6 equals signs", () => {
    for (let equals = 2; equals <= 6; equals += 1) {
      const marker = "=".repeat(equals);
      const document = parse(`${marker} Heading\n`);
      expect(document.children).toHaveLength(1);
      const {
        children: [child0],
      } = document;
      narrow(child0, "section");
      expect(child0.level).toBe(equals - 1);
    }
  });

  // Paragraphs after a heading belong to that section. The AST builder
  // groups non-section blocks under the preceding section heading.
  // Without this grouping, the printer would lose the nesting
  // context needed for indentation.
  test("section contains child paragraphs", () => {
    const input = "== Title\n\nSome text.\n";
    const document = parse(input);
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "section");
    expect(child0.children).toHaveLength(1);
    expect(child0.children[0].type).toBe("paragraph");
  });

  // A new heading at the same level closes the previous section.
  // Both sections are direct children of the document (flat, not nested).
  test("section followed by same-level section", () => {
    const input = "== First\n\nPara.\n\n== Second\n\nPara.\n";
    const document = parse(input);
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("section");
    expect(document.children[1].type).toBe("section");
  });

  // Position tracking on section nodes. The section starts at the == marker,
  // not at the title text. This is important for Prettier's locStart/locEnd,
  // which drive range formatting and cursor tracking.
  test("section has correct position", () => {
    const document = parse("== Title\n");
    const {
      children: [section],
    } = document;
    expect(section.position.start.offset).toBe(0);
    expect(section.position.start.line).toBe(1);
    expect(section.position.start.column).toBe(1);
  });

  // The printer normalizes heading whitespace: extra spaces between the
  // marker and title, or trailing spaces, should be trimmed during parsing
  // so the printer can emit a canonical form.
  test("heading text has extra whitespace trimmed", () => {
    const document = parse("==  Extra Spaces  \n");
    const {
      children: [child0],
    } = document;
    narrow(child0, "section");
    expect(child0.heading).toBe("Extra Spaces");
  });

  // 7+ equals signs exceed the SectionMarker range ({2,6}). DocumentTitle
  // also won't match: its pattern requires exactly one `=` followed
  // immediately by a space, but here the second character is `=`, not a
  // space. The line falls through to InlineModeStart and becomes a
  // paragraph.
  test("seven equals signs parsed as paragraph, not heading", () => {
    const document = parse("======= Not a heading\n");
    expect(document.children).toHaveLength(1);
    expect(document.children[0].type).toBe("paragraph");
  });
});

describe("section nesting", () => {
  // A deeper section (===) after a shallower one (==) becomes a child
  // of the shallower section. This is the fundamental nesting rule.
  test("subsection is child of parent section", () => {
    const {
      children: [parent],
    } = parse("== Parent\n\n=== Child\n");
    narrow(parent, "section");
    expect(parent.heading).toBe("Parent");
    expect(parent.children).toHaveLength(1);
    const {
      children: [child],
    } = parent;
    narrow(child, "section");
    expect(child.heading).toBe("Child");
  });

  // A same-level section closes the previous one. Both are children
  // of the enclosing parent section (or document root).
  test("same-level section after subsection closes both", () => {
    const {
      children: [sectionA, sectionC],
    } = parse("== A\n\n=== B\n\n== C\n");
    narrow(sectionA, "section");
    narrow(sectionC, "section");
    expect(sectionA.heading).toBe("A");
    expect(sectionA.children).toHaveLength(1);
    const {
      children: [childB],
    } = sectionA;
    narrow(childB, "section");
    expect(childB.heading).toBe("B");
    expect(sectionC.heading).toBe("C");
  });

  // Multiple subsections at the same level are all children of the
  // parent section, not nested inside each other.
  test("consecutive subsections are siblings under parent", () => {
    const {
      children: [parent],
    } = parse("== A\n\n=== B\n\n=== C\n");
    narrow(parent, "section");
    expect(parent.children).toHaveLength(2);
    const {
      children: [childB, childC],
    } = parent;
    narrow(childB, "section");
    expect(childB.heading).toBe("B");
    narrow(childC, "section");
    expect(childC.heading).toBe("C");
  });

  // Three levels deep: ==== is child of ===, which is child of ==.
  test("deeply nested sections", () => {
    const {
      children: [sectionA],
    } = parse("== A\n\n=== B\n\n==== C\n");
    narrow(sectionA, "section");
    expect(sectionA.heading).toBe("A");
    expect(sectionA.children).toHaveLength(1);
    const {
      children: [sectionB],
    } = sectionA;
    narrow(sectionB, "section");
    expect(sectionB.heading).toBe("B");
    expect(sectionB.children).toHaveLength(1);
    const {
      children: [sectionC],
    } = sectionB;
    narrow(sectionC, "section");
    expect(sectionC.heading).toBe("C");
  });
});

// Issue #3: block metadata directly above a section heading
// (anchors like `[[id]]`, attribute lists) labels that section,
// so nesting must keep it the section node's immediate preceding
// sibling — not the last child of the previous section.
describe("section metadata placement", () => {
  test("anchor before sibling section stays beside the section", () => {
    const { children } = parse(
      "== First\n\nBody one.\n\n[[second]]\n== Second\n\nBody two.\n",
    );
    // Root order: section First, anchor paragraph, section Second.
    expect(children.map((c) => c.type)).toEqual([
      "section",
      "paragraph",
      "section",
    ]);
    // The anchor paragraph is NOT inside section First.
    const [first] = children;
    narrow(first, "section");
    expect(first.children.map((c) => c.type)).toEqual(["paragraph"]);
  });

  test("anchor before nested section stays beside it in the parent", () => {
    const { children } = parse(
      "== Outer\n\nBody.\n\n[[sub]]\n=== Sub\n\nSub body.\n",
    );
    const [outer] = children;
    narrow(outer, "section");
    expect(outer.children.map((c) => c.type)).toEqual([
      "paragraph",
      "paragraph",
      "section",
    ]);
  });
});
