/**
 * Parser tests for YAML front matter (issue #21).
 *
 * A `---` line at the very top of a document, everything down to the
 * next `---` line, and that closing line, are one block the reader
 * takes off the stream before any other line is read - Asciidoctor's
 * `skip_front_matter!` (reader.rb l.1304-22). Before it did, `---`
 * and the YAML under it were paragraph lines that reflowed into
 * `--- layout: post ---`, which is neither valid front matter nor the
 * document the oracle renders.
 *
 * The fence is not a line SHAPE: the same three characters are
 * ordinary text anywhere else in a document, so every test below that
 * moves the block off the top expects a paragraph back.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { narrow } from "../../src/narrow.js";

describe("front matter parsing", () => {
  test("the block is one node, fences included", () => {
    const document = parse("---\nlayout: post\ntitle: Hello\n---\n\nBody.\n");
    const { children } = document;
    expect(children).toHaveLength(2);
    const [child0, child1] = children;
    narrow(child0, "frontMatter");
    expect(child0.content).toBe("---\nlayout: post\ntitle: Hello\n---");
    narrow(child1, "paragraph");
  });

  // The span runs from the opening fence to the end of the closing
  // one, so the block under it starts where the source says it does.
  test("the block's position covers both fences", () => {
    const document = parse("---\na: 1\n---\n\nBody.\n");
    const [child0, child1] = document.children;
    narrow(child0, "frontMatter");
    expect(child0.position.start.line).toBe(1);
    expect(child0.position.end.line).toBe(3);
    narrow(child1, "paragraph");
    expect(child1.position.start.line).toBe(5);
  });

  // `skip_front_matter!` shifts the opening fence and then reads
  // until the next one, so an empty block is two adjacent fences.
  test("an empty block is the two fences", () => {
    const document = parse("---\n---\n\nbody\n");
    const [child0] = document.children;
    narrow(child0, "frontMatter");
    expect(child0.content).toBe("---\n---");
  });

  // A blank line does NOT end the block: Ruby's loop tests only for
  // the closing fence, and a YAML document may hold a blank line.
  test("a blank line inside the block does not end it", () => {
    const document = parse("---\na: 1\n\nb: 2\n---\n\nbody\n");
    const [child0] = document.children;
    narrow(child0, "frontMatter");
    expect(child0.content).toBe("---\na: 1\n\nb: 2\n---");
  });

  // A document header under the block is the reading
  // `skip-front-matter` gives, and the one our tree models: the title
  // is a title and the line under it is still the author's.
  test("a document header may open under the block", () => {
    const document = parse("---\na: 1\n---\n= T\nDoc Writer\n\nbody\n");
    const [child0, child1] = document.children;
    narrow(child0, "frontMatter");
    narrow(child1, "documentHeader");
    expect(child1.title).toBe("T");
  });

  // ADVERSARIAL NEIGHBOURS: `---` is front matter only at the top of
  // a document and only with a partner fence below it.
  // `skip_front_matter!` unshifts every line it took when it reaches
  // the end of input first, so an unclosed block is not one - and a
  // `---` further down was never a candidate.
  test.each([
    ["no closing fence", "---\nlayout: post\n\nBody.\n"],
    ["the fences start on line two", "\n---\na: 1\n---\n"],
    ["a paragraph stands above them", "para\n\n---\na: 1\n---\n"],
    ["the fence carries a word", "--- a\nb: 1\n---\n"],
    ["four hyphens are a listing block", "----\na: 1\n----\n"],
  ])("%s is not front matter", (_name, input) => {
    const { children } = parse(input);
    for (const child of children) {
      expect(child.type).not.toBe("frontMatter");
    }
  });
});
