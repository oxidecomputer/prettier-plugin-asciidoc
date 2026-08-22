import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/unreachable.js";

describe("front matter parsing", () => {
  // The shape from the issue: delimiters plus metadata lines at the
  // very start of the file.
  test("recognizes a front matter block at document start", () => {
    const { children } = parse("---\nlayout: post\n---\n");
    expect(children).toHaveLength(1);
    const [block] = children;
    narrow(block, "frontMatter");
    expect(block.content).toBe("layout: post");
  });

  // Multiple metadata lines are held as one raw string; nothing
  // inside the block is interpreted as AsciiDoc.
  test("keeps multi-line metadata verbatim in one node", () => {
    const { children } = parse(
      "---\nlayout: post\ntitle: Hello\ntags: [a, b]\n---\n\n= Doc\n",
    );
    const [block] = children;
    narrow(block, "frontMatter");
    expect(block.content).toBe("layout: post\ntitle: Hello\ntags: [a, b]");
  });

  // Lines that would otherwise read as AsciiDoc constructs must not
  // be parsed while inside the block. `= Title` and `* item` are
  // the two that would visibly restructure the document.
  test("does not interpret AsciiDoc constructs inside the block", () => {
    const { children } = parse("---\n= Not a title\n* not a list\n---\n");
    expect(children).toHaveLength(1);
    const [block] = children;
    narrow(block, "frontMatter");
    expect(block.content).toBe("= Not a title\n* not a list");
  });

  // The content is SLICED out of the source rather than rebuilt from
  // the reader's lines, and this is the case that tells the two
  // apart: a rebuild joins the lines it kept and loses the blank one
  // between them.
  test("keeps an interior blank line", () => {
    const { children } = parse("---\na: 1\n\nb: 2\n---\n");
    const [block] = children;
    narrow(block, "frontMatter");
    expect(block.content).toBe("a: 1\n\nb: 2");
  });

  // Also from the slice, and the reason it reads `raw` rather than
  // the reader's `text`: every source line is rstripped on the way in
  // (`split.ts`, mirroring `prepare_source_string`), so content taken
  // from the lines would silently drop trailing bytes the YAML owns.
  test("keeps trailing whitespace inside the block", () => {
    const { children } = parse("---\na: 1  \n---\n");
    const [block] = children;
    narrow(block, "frontMatter");
    expect(block.content).toBe("a: 1  ");
  });

  // An empty block is legal in Jekyll and means "this file is
  // processed, with no metadata".
  test("empty front matter yields empty content", () => {
    const { children } = parse("---\n---\n");
    expect(children).toHaveLength(1);
    const [block] = children;
    narrow(block, "frontMatter");
    expect(block.content).toBe("");
  });

  // The block is only front matter at offset 0. This is the guard
  // that keeps the change away from `--` open blocks and from
  // markdown-style thematic breaks (#23).
  test("is not recognized below the first line", () => {
    const { children } = parse("Text.\n\n---\nlayout: post\n---\n");
    expect(children.every((child) => child.type !== "frontMatter")).toBe(true);
  });

  // `skip_front_matter!` scans for the closing `---` and, on reaching
  // EOF without one, unshifts every line it took back onto the reader
  // and returns nil. So a lone `---` is not front matter at all and
  // the document parses as if the guard had never matched.
  test("unterminated front matter is not a front matter block", () => {
    const { children } = parse("---\nlayout: post\n");
    expect(children.every((child) => child.type !== "frontMatter")).toBe(true);
  });

  // The same rule, and the case that makes it matter rather than
  // merely match the Ruby. A reader that consumed to EOF instead of
  // putting the lines back would swallow the WHOLE document into one
  // verbatim node — which round-trips, because nothing verbatim is
  // ever reflowed, so the damage is invisible in the output and shows
  // up only as a formatter that quietly stopped working below a stray
  // `---`.
  test("a stray leading dash line does not swallow the document", () => {
    const { children } = parse("---\nstray\n\nBody text.\n\n* item\n");
    expect(children.every((child) => child.type !== "frontMatter")).toBe(true);
    expect(children.length).toBeGreaterThan(1);
  });

  // `----` at offset 0 is a listing block delimiter and must keep
  // winning over the front matter opener.
  test("a four-dash opener is still a listing block", () => {
    const { children } = parse("----\nlayout: post\n----\n");
    expect(children).toHaveLength(1);
    const [block] = children;
    narrow(block, "delimitedBlock");
    expect(block.content).toBe("layout: post");
  });

  // `--` at offset 0 is an open block and must keep winning too:
  // the front matter opener requires exactly three dashes.
  test("a two-dash opener is still an open block", () => {
    const { children } = parse("--\ncontent\n--\n");
    expect(children).toHaveLength(1);
    const [block] = children;
    narrow(block, "parentBlock");
  });

  // A `----` line inside the block is content, not a terminator —
  // only a bare `---` line closes it.
  test("a longer dash line inside the block is content", () => {
    const { children } = parse("---\na: 1\n----\nb: 2\n---\n");
    expect(children).toHaveLength(1);
    const [block] = children;
    narrow(block, "frontMatter");
    expect(block.content).toBe("a: 1\n----\nb: 2");
  });

  // Both fences are matched against the RSTRIPPED line, which is what
  // `skip_front_matter!` compares too: it runs after
  // `prepare_source_string` has already stripped every line's tail.
  // Pinned in both positions because a pattern applied to `raw` would
  // pass the opener case by accident and fail this one.
  test("trailing whitespace on either fence still delimits", () => {
    const { children } = parse("---  \na: 1\n---\t\n");
    expect(children).toHaveLength(1);
    const [block] = children;
    narrow(block, "frontMatter");
    expect(block.content).toBe("a: 1");
  });

  // Position must cover the whole block including both delimiters,
  // since Prettier uses it for cursor and range tracking.
  test("position spans both delimiters", () => {
    const source = "---\na: 1\n---\n";
    const { children } = parse(source);
    const [block] = children;
    narrow(block, "frontMatter");
    expect(block.position.start.offset).toBe(0);
    expect(block.position.end.offset).toBe(source.indexOf("\n---\n") + 4);
  });
});
