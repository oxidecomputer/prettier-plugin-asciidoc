/**
 * Heading parsing — one LEAF kind at every level: `=` is
 * level 0 (the document-title spelling; the header rows live in
 * document-header.test.ts), `==` through `======` are levels 1–5,
 * and no section container exists: blocks after a heading are its
 * SIBLINGS. Nesting is not modeled because nothing the printer emits
 * consumes it.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../helpers.js";
import { serializedKeys } from "./reader-helpers.js";

describe("heading parsing", () => {
  test("== Title parses as a level-1 heading leaf", () => {
    const document = parse("== Title\n");
    expect(document.children).toHaveLength(1);
    const [child0] = document.children;
    narrow(child0, "heading");
    expect(child0.level).toBe(1);
    expect(child0.title).toBe("Title");
  });

  // Serialized key order is a first-class contract:
  // `type, level, title, position` for BOTH heading kinds —
  // parity's flatten fold emits the same canonical order, so a drift
  // here is a parity break waiting to happen.
  test("a heading's serialized key order is the canonical one", () => {
    const [heading] = parse("== Title\n").children;
    expect(serializedKeys(heading)).toEqual([
      "type",
      "level",
      "title",
      "position",
    ]);
  });

  test("a discreteHeading's serialized key order carries the `heading`→`title` rename in place", () => {
    const [, discrete] = parse("[discrete]\n== D\n").children;
    expect(discrete.type).toBe("discreteHeading");
    expect(serializedKeys(discrete)).toEqual([
      "type",
      "level",
      "title",
      "position",
    ]);
  });

  test("=== Title parses as level 2", () => {
    const [child0] = parse("=== Subsection\n").children;
    narrow(child0, "heading");
    expect(child0.level).toBe(2);
    expect(child0.title).toBe("Subsection");
  });

  // From TWO markers up: a single `=` at the top of a document opens
  // the document HEADER instead of a heading leaf (issue #18), which
  // is a node kind, not a level - the level-0 leaf is what a `= T`
  // deeper in the document still makes, and the level-jump row below
  // is where that is asserted.
  test("marker counts 2 through 6 carry level = count - 1", () => {
    for (let equals = 2; equals <= 6; equals += 1) {
      const marker = "=".repeat(equals);
      const [child0] = parse(`${marker} Heading\n`).children;
      narrow(child0, "heading");
      expect(child0.level).toBe(equals - 1);
    }
  });

  test("seven equals signs parse as a paragraph, not a heading", () => {
    const document = parse("======= Not a heading\n");
    expect(document.children).toHaveLength(1);
    expect(document.children[0].type).toBe("paragraph");
  });

  test("heading text has extra whitespace trimmed", () => {
    const [child0] = parse("==    Extra Spaces   \n").children;
    narrow(child0, "heading");
    expect(child0.title).toBe("Extra Spaces");
  });

  test("a heading has correct position and no children array", () => {
    const [heading] = parse("== Title\n").children;
    narrow(heading, "heading");
    expect(heading.position.start).toEqual({ offset: 0, line: 1, column: 1 });
    expect(heading.position.end.offset).toBe(8);
    expect("children" in heading).toBe(false);
  });

  test("blocks after a heading are SIBLINGS (sections are not modeled)", () => {
    const { children } = parse("== Title\n\nSome text.\n");
    expect(children.map((child) => child.type)).toEqual([
      "heading",
      "paragraph",
    ]);
  });

  test("a level run stays flat: h1, p, h2, p, h1", () => {
    const { children } = parse("== A\n\np\n\n=== B\n\nq\n\n== C\n");
    expect(children.map((child) => child.type)).toEqual([
      "heading",
      "paragraph",
      "heading",
      "paragraph",
      "heading",
    ]);
    const levels = children.flatMap((child) =>
      child.type === "heading" ? [child.level] : [],
    );
    expect(levels).toEqual([1, 2, 1]);
  });

  // The level-0 leaf, reached where no header can open: below body
  // content the `= D` line is a section title like any other.
  test("a level JUMP is carried, not interpreted", () => {
    const { children } = parse("p\n\n= D\n\n=== C\n");
    const [, first, second] = children;
    narrow(first, "heading");
    narrow(second, "heading");
    expect(first.level).toBe(0);
    expect(second.level).toBe(2);
  });
});

// Issue #3's flat successor: block metadata directly above a heading
// is the heading's immediate preceding SIBLING — visible directly
// now, with no container to hide the order.
describe("heading metadata placement", () => {
  test("an anchor before a heading is its preceding sibling", () => {
    const { children } = parse(
      "== First\n\nBody one.\n\n[[second]]\n== Second\n\nBody two.\n",
    );
    expect(children.map((child) => child.type)).toEqual([
      "heading",
      "paragraph",
      "blockAnchor",
      "heading",
      "paragraph",
    ]);
  });

  test("an anchor before a DEEPER heading sits in the same flat run", () => {
    const { children } = parse(
      "== Outer\n\nBody.\n\n[[sub]]\n=== Sub\n\nSub body.\n",
    );
    expect(children.map((child) => child.type)).toEqual([
      "heading",
      "paragraph",
      "blockAnchor",
      "heading",
      "paragraph",
    ]);
  });
});
