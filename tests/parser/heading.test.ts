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

/**
 * The MARKDOWN marker spelling, issue #63. `atx_section_title?` runs
 * `ExtAtxSectionTitleRx` under `markdown_syntax` (parser.rb
 * l.1709-13), whose marker group takes `#` beside `=` at the same
 * levels, so `## S` is the section `== S` is. Red before the registry
 * carried it: the line was paragraph text, so prose under it joined
 * into the heading and the heading became the joined line.
 */
describe("markdown-marker section titles", () => {
  test.each([
    ["#", 0],
    ["##", 1],
    ["######", 5],
  ])("%s opens a level-%i heading", (markers, level) => {
    const { children } = parse(`para\n\n${markers} S\n\nbody\n`);
    const [, heading] = children;
    narrow(heading, "heading");
    expect(heading.level).toBe(level);
    expect(heading.title).toBe("S");
  });

  // The CLOSED form: Ruby's optional trailing `\1` takes the closing
  // run off the title, so the title the printer replays is the one
  // the oracle renders.
  test("a closing marker run leaves the title", () => {
    const [heading] = parse("## S ##\n").children;
    narrow(heading, "heading");
    expect(heading.title).toBe("S");
  });

  // Seven markers are past the group's five-repeat tail, and a
  // missing gap is no title at all.
  test.each(["####### S\n", "#S\n", "###\n"])("%j is no title", (source) => {
    expect(parse(source).children[0]?.type).not.toBe("heading");
  });

  // A `#`-spelled level-0 title opens the document header, as `= Doc`
  // does: `is_next_line_doctitle?` asks the same predicate.
  test("a markdown document title opens the header", () => {
    const [header] = parse("# Doc\nAuthor Name\n\nb\n").children;
    narrow(header, "documentHeader");
    expect(header.title).toBe("Doc");
  });
});

/**
 * The UNDERLINED (setext) spelling, issue #16. `is_next_line_section?`
 * (parser.rb l.1667) reads a title from TWO lines - a title line and
 * a uniform run of `=`, `-`, `~`, `^` or `+` under it, within one
 * character of its length - and it is asked before `next_block`, so
 * the underline wins over the delimiter it looks like.
 *
 * Red before the reader carried the shape: `Title` / `-----` parsed
 * as a paragraph plus a listing block that swallowed the rest of the
 * document, and `para` / `----` / `x` / `----` put prose inside a
 * verbatim block.
 */
describe("underlined section titles", () => {
  // One row per SETEXT_SECTION_LEVELS entry (asciidoctor.rb
  // l.262-268), because the mark IS the level and a table is only
  // pinned when every entry is. A paragraph stands above each pair so
  // that the `=` row is a heading rather than the document header,
  // which has rows of its own below.
  test.each([
    ["=", 0],
    ["-", 1],
    ["~", 2],
    ["^", 3],
    ["+", 4],
  ])("an underline of %j is level %i", (mark, level) => {
    const { children } = parse(`para\n\nTitle\n${mark.repeat(5)}\n\nbody\n`);
    const [, heading] = children;
    narrow(heading, "heading");
    expect(heading.level).toBe(level);
    expect(heading.title).toBe("Title");
  });

  // The node spans BOTH lines, so the paragraph under it starts where
  // the source does and nothing between them is left unaccounted for.
  test("the heading's position covers the underline", () => {
    const source = "Title\n-----\n\nbody\n";
    const [heading, body] = parse(source).children;
    expect(heading.position.start.offset).toBe(0);
    expect(heading.position.end.offset).toBe("Title\n-----".length);
    expect(body.position.start.offset).toBe(source.indexOf("body"));
  });

  // The length rule is `.abs < 2` (parser.rb l.1724): one character
  // either way and no more.
  test.each([
    ["four under a five-character title", "Title\n----\n", "heading"],
    ["five under five", "Title\n-----\n", "heading"],
    ["six under five", "Title\n------\n", "heading"],
    // Three is two short, so the pair is a paragraph and the run is
    // the Markdown rule that ends it.
    ["three under five", "Title\n---\n", "paragraph"],
    // Seven is two long, and four or more hyphens are a listing
    // delimiter to `is_delimited_block?`.
    ["seven under five", "Title\n-------\n", "paragraph"],
  ])("%s reads as a %s", (_name, source, type) => {
    expect(parse(source).children[0]?.type).toBe(type);
  });

  // `SetextSectionTitleRx` (rx.rb l.248) refuses a line that opens
  // with `.` or carries no alphanumeric, which is what keeps a block
  // title and a delimiter pair out.
  test.each([
    ["a line opening with a dot", ".Title\n------\n"],
    ["a line with no alphanumeric", "!!!!!\n-----\n"],
    // A blank line above the run leaves no title to underline.
    ["a run with a blank line above it", "\n-----\n"],
  ])("%s is no title", (_name, source) => {
    expect(parse(source).children[0]?.type).not.toBe("heading");
  });

  // The confinement rule: `is_next_line_section?` belongs to
  // `next_section`'s loop, and an item's buffer or a compound block's
  // interior is parsed by `parse_blocks` -> `next_block`, which never
  // asks. So the same two lines inside either are ordinary content.
  test.each([
    ["a list item", "* item\nTitle\n-----\n"],
    ["an example block", "====\nTitle\n-----\n====\n"],
  ])("inside %s the pair is not a title", (_name, source) => {
    const shapes = parse(source).children.map((child) => child.type);
    expect(shapes).not.toContain("heading");
  });

  // A level-0 underlined title opens the DOCUMENT HEADER, exactly as
  // `= Doc` does: `is_next_line_doctitle?` asks the same predicate,
  // and the author line under the underline fills the header's first
  // slot rather than becoming body text.
  test("an underlined level-0 title opens the document header", () => {
    const { children } = parse("Doc\n===\nAuthor Name\n\nbody\n");
    const [header] = children;
    narrow(header, "documentHeader");
    expect(header.title).toBe("Doc");
    expect(header.lines.map((line) => line.type)).toEqual(["authorLine"]);
  });
});
