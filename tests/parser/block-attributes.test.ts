/**
 * Parser tests for block attribute lists, anchors, and titles.
 *
 * Block attributes are lines that precede a block and modify it:
 * - `[source,ruby]` — block attribute list
 * - `[[anchor-id]]` — block anchor, its own node kind
 * - `.Block Title` — block title
 *
 * All three are standalone block-level nodes (like line comments
 * and attribute entries). The printer stacks them with the
 * following block (no blank line between).
 *
 * A `[[id]]` alone on a line is a BLOCK anchor: the reader holds
 * it back as metadata and it becomes a `blockAnchor` node. The
 * same spelling INSIDE a paragraph's text is an inline anchor
 * (`inlineAnchor`), tested in inline-links.test.ts.
 */
import { describe, test, expect } from "vitest";
import { parse } from "../../src/parser.js";
import { anchorLineShape } from "../../src/block-metadata.js";
import { narrow } from "../helpers.js";

describe("block attribute list parsing", () => {
  // The fundamental case: a positional attribute list like
  // [source,ruby] should become a blockAttributeList node,
  // not a paragraph.
  test("[source,ruby] parses as a block attribute list", () => {
    const document = parse("[source,ruby]\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAttributeList");
    expect(child0.value).toBe("source,ruby");
  });

  // Shorthand ID syntax: [#myid] sets the block's ID.
  test("[#myid] shorthand ID parses correctly", () => {
    const document = parse("[#myid]\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAttributeList");
    expect(child0.value).toBe("#myid");
  });

  // Shorthand role syntax: [.role] sets the block's role.
  test("[.role] shorthand role parses correctly", () => {
    const document = parse("[.role]\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAttributeList");
    expect(child0.value).toBe(".role");
  });

  // Combined shorthand: [#id.role%option] with ID, role, and
  // option (`%`) all in one attribute list. The `%option`
  // syntax sets a block option flag (e.g. `%autowidth`).
  test("[#id.role%option] combined shorthand", () => {
    const document = parse("[#id.role%option]\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAttributeList");
    expect(child0.value).toBe("#id.role%option");
  });

  // Named attributes: [start=7] on an ordered list.
  test("[start=7] named attribute", () => {
    const document = parse("[start=7]\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAttributeList");
    expect(child0.value).toBe("start=7");
  });

  // Style attributes like [abstract], [appendix] before sections.
  test("[abstract] style attribute", () => {
    const document = parse("[abstract]\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAttributeList");
    expect(child0.value).toBe("abstract");
  });

  // Block attribute list before a listing block should stack.
  test("attribute list before a listing block", () => {
    const document = parse("[source,ruby]\n----\nputs 'hello'\n----\n");
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("blockAttributeList");
    expect(document.children[1].type).toBe("delimitedBlock");
  });

  // Multiple attribute lines stacked before a block.
  test("multiple attribute lines stacked before a block", () => {
    const document = parse(
      "[source,ruby]\n[#myid]\n----\nputs 'hello'\n----\n",
    );
    expect(document.children).toHaveLength(3);
    expect(document.children[0].type).toBe("blockAttributeList");
    expect(document.children[1].type).toBe("blockAttributeList");
    expect(document.children[2].type).toBe("delimitedBlock");
  });

  // Position tracking: start and end offsets.
  test("block attribute list has correct position", () => {
    const document = parse("[source,ruby]\n");
    expect(document.children[0].position.start.offset).toBe(0);
    expect(document.children[0].position.start.line).toBe(1);
    expect(document.children[0].position.start.column).toBe(1);
    // "[source,ruby]" is 13 chars; end offset is exclusive
    const EXPECTED_END_OFFSET = 13;
    expect(document.children[0].position.end.offset).toBe(EXPECTED_END_OFFSET);
  });

  // Empty attribute list: [] should parse correctly.
  test("empty attribute list [] parses correctly", () => {
    const document = parse("[]\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAttributeList");
    expect(child0.value).toBe("");
  });
});

describe("anchor parsing", () => {
  // `[[anchor-id]]` on its own line is a block anchor: the reader
  // holds the line back as metadata and `buildBlockAnchor`
  // (build/metadata.ts) makes it a `blockAnchor` node of its own.
  test("[[anchor-id]] parses as a block anchor", () => {
    const document = parse("[[anchor-id]]\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAnchor");
    expect(child0.id).toBe("anchor-id");
    expect(child0.reftext).toBeUndefined();
  });

  // Anchor with reftext: [[id,reftext]] — split on the first
  // comma. Everything after the comma is the reftext; it is
  // preserved verbatim (whitespace included).
  test("[[id,reftext]] anchor with reftext", () => {
    const document = parse("[[my-id,My Reference Text]]\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAnchor");
    expect(child0.id).toBe("my-id");
    expect(child0.reftext).toBe("My Reference Text");
  });

  // Anchor on its own line before a paragraph is a block-level
  // anchor: the reader holds it back as metadata and
  // `buildBlockAnchor` (build/metadata.ts) makes it a separate
  // `blockAnchor` node so the printer can handle spacing correctly.
  test("anchor before text splits into two blocks", () => {
    const document = parse("[[my-anchor]]\nSome text.\n");
    expect(document.children).toHaveLength(2);
    const {
      children: [anchor, para],
    } = document;
    narrow(anchor, "blockAnchor");
    expect(anchor.id).toBe("my-anchor");
    narrow(para, "paragraph");
    expect(para.children[0].type).toBe("text");
  });

  // Anchor position tracking — the node spans the whole anchor
  // line, no padding of its own.
  test("standalone anchor has correct position", () => {
    const document = parse("[[my-id]]\n");
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAnchor");
    expect(child0.position.start.offset).toBe(0);
    expect(child0.position.start.line).toBe(1);
    expect(child0.position.start.column).toBe(1);
    // "[[my-id]]" is 9 chars; end offset is exclusive
    const EXPECTED_END_OFFSET = 9;
    expect(child0.position.end.offset).toBe(EXPECTED_END_OFFSET);
  });
});

describe("block title parsing", () => {
  // Block title: .Title text — a dot followed by non-whitespace.
  test(".Title parses as a block title", () => {
    const document = parse(".My Title\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockTitle");
    expect(child0.title).toBe("My Title");
  });

  // Block title before a listing block.
  test("block title before a listing block", () => {
    const document = parse(".Example Code\n----\nputs 'hello'\n----\n");
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("blockTitle");
    expect(document.children[1].type).toBe("delimitedBlock");
  });

  // Block title before a paragraph.
  test("block title before a paragraph", () => {
    const document = parse(".Important Note\nThis is the note text.\n");
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("blockTitle");
    expect(document.children[1].type).toBe("paragraph");
  });

  // Block title must not conflict with ordered list markers.
  // `. text` (dot space text) is an ordered list marker, not a title.
  test("'. text' is an ordered list, not a block title", () => {
    const document = parse(". Item one\n");
    expect(document.children).toHaveLength(1);
    expect(document.children[0].type).toBe("list");
  });

  // Block title must not conflict with literal block delimiters.
  // `....` is a literal block delimiter, not a title.
  test("'....' is a literal block delimiter, not a title", () => {
    const document = parse("....\ncontent\n....\n");
    expect(document.children).toHaveLength(1);
    expect(document.children[0].type).toBe("delimitedBlock");
  });

  // Title + attribute list stacked before a block.
  test("title and attribute list before a block", () => {
    const document = parse(
      ".Example Code\n[source,ruby]\n----\nputs 'hello'\n----\n",
    );
    expect(document.children).toHaveLength(3);
    expect(document.children[0].type).toBe("blockTitle");
    expect(document.children[1].type).toBe("blockAttributeList");
    expect(document.children[2].type).toBe("delimitedBlock");
  });

  // Block title position tracking.
  test("block title has correct position", () => {
    const document = parse(".My Title\n");
    expect(document.children[0].position.start.offset).toBe(0);
    expect(document.children[0].position.start.line).toBe(1);
    expect(document.children[0].position.start.column).toBe(1);
    // ".My Title" is 9 chars; end offset is exclusive
    const EXPECTED_END_OFFSET = 9;
    expect(document.children[0].position.end.offset).toBe(EXPECTED_END_OFFSET);
  });

  // Block title with special characters in the text.
  test("block title with special characters", () => {
    const document = parse(".Title: a `code` example\n");
    expect(document.children).toHaveLength(1);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockTitle");
    expect(child0.title).toBe("Title: a `code` example");
  });
});

describe("combined block metadata", () => {
  // All three types stacked before a block: anchor, title,
  // attribute list.
  test("anchor + title + attribute list before a block", () => {
    const document = parse(
      "[[my-id]]\n.My Title\n[source,ruby]\n----\nputs 'hello'\n----\n",
    );
    expect(document.children).toHaveLength(4);
    const {
      children: [child0],
    } = document;
    narrow(child0, "blockAnchor");
    expect(child0.id).toBe("my-id");
    expect(document.children[1].type).toBe("blockTitle");
    expect(document.children[2].type).toBe("blockAttributeList");
    expect(document.children[3].type).toBe("delimitedBlock");
  });

  // Style attributes before sections are preserved.
  test("[appendix] before a heading", () => {
    const document = parse("[appendix]\n== Appendix A\n");
    expect(document.children).toHaveLength(2);
    expect(document.children[0].type).toBe("blockAttributeList");
    expect(document.children[1].type).toBe("heading");
  });
});

describe("blockAnchor is its own node kind", () => {
  test("a standalone [[id]] line parses to a blockAnchor", () => {
    const [node] = parse("[[my-id]]\n").children;
    expect(node.type).toBe("blockAnchor");
    if (node.type !== "blockAnchor") {
      throw new Error("narrowed above");
    }
    expect(node.id).toBe("my-id");
    expect(node.reftext).toBeUndefined();
  });

  test("[[id,reftext]] carries the reftext", () => {
    const [node] = parse("[[my-id,Ref Text]]\n").children;
    if (node.type !== "blockAnchor") {
      throw new Error(`got ${node.type}`);
    }
    expect(node.reftext).toBe("Ref Text");
  });
});

describe("the reader's annotation record", () => {
  // The record is copied from the held NODE's `value`, and the two
  // spellings that once differed - that value and the RSTRIPPED
  // bracket interior the reader hands `parseAttrlist` - CONVERGED
  // when the builders started decomposing the rstripped line the
  // classifier matched (#69, #97). Pinned on the shape that used to
  // separate them, an attribute line with TRAILING WHITESPACE: the
  // held node's value was the raw image minus its first and last
  // character, so `[source,ruby]␠␠␠` stored `source,ruby]␠␠`, the
  // closing bracket included. Both halves are asserted because
  // invariant (xi) only compares the record against the sibling's
  // value, and neither the corpus nor the fuzz alphabets ever put a
  // trailing-whitespace attribute line above a block.
  test("annotatedBy and the attribute value are the rstripped interior", () => {
    const [attributes, block] = parse(
      "[source,ruby]   \n----\nfoo\n----\n",
    ).children;
    narrow(attributes, "blockAttributeList");
    narrow(block, "delimitedBlock");
    expect(attributes.value).toBe("source,ruby");
    expect(block.annotatedBy).toBe("source,ruby");
  });
});

describe("anchorLineShape: the printed-line record", () => {
  // One row per anchor spelling: what the PRINTED line re-reads as.
  // `[[id,]]` prints VERBATIM since #53's faithful replay (an empty
  // reftext fails the grammar's own spelling) and stays a text line;
  // `[[id, ]]` prints `[[id, ]]`, which the grammar accepts - an
  // anchor on re-read. `[[3-bad,Ref]]` prints byte-faithfully under
  // the serializer's verbatim arm and stays a text line.
  test.each([
    ["[[anc]]", "anchor"],
    ["[[anc,Ref]]", "anchor"],
    ["[[id,]]", "lookalike"],
    ["[[id, ]]", "anchor"],
    ["[[3-bad]]", "lookalike"],
    ["[[illegal$id]]", "lookalike"],
    ["[[9]]", "lookalike"],
    ["[[3-bad,Ref]]", "lookalike"],
    ["[[3-bad, Ref]]", "lookalike"],
  ] as const)("%s → %s", (line, expected) => {
    const [block] = parse(`${line}\n`).children;
    expect(anchorLineShape(block)).toBe(expected);
  });

  test("a block that is no [[…]] line answers undefined", () => {
    const [block] = parse("para\n").children;
    expect(anchorLineShape(block)).toBeUndefined();
  });

  // Issue #46 shape 2. A rejected-id line with TRAILING WHITESPACE
  // parses to two children - the anchor and the blanks the paragraph's
  // source slice keeps past the rstrip - and the record is about the
  // PRINTED line, which the blanks never reach. A child count alone
  // answered undefined here, and the printer then wrote a blank line
  // its own second pass removed.
  test.each([
    ["two spaces", "[[3-bad]]  "],
    ["a tab", "[[3-bad]]\t"],
    ["a rejected reftext and two spaces", "[[3-bad,Ref]]  "],
    ["an empty reftext and a space", "[[id,]] "],
  ] as const)("%s after the line still reads lookalike", (_n, line) => {
    const [block] = parse(`${line}\n`).children;
    expect(anchorLineShape(block)).toBe("lookalike");
  });

  // The complement: a trailing character the PRINTER keeps is content,
  // so the printed line is not a `[[...]]` line at all. A NUL is
  // outside both the reader's rstrip set and the packer's word split.
  //
  // Before issue #75, splitWords (src/print/reflow.ts) split on
  // JavaScript's wider `\s`, which also matches a no-break space, a
  // thin space, an ideographic space and a byte-order mark - so the
  // PACKER erased one of those as trailing whitespace while the
  // READER's ASCII-only rstrip kept it and read the line as a
  // paragraph. That was the one shape in the tree where a paragraph
  // answered "anchor": the tail was in the packer's word split but not
  // in the reader's rstrip set. splitWords is ASCII-only now (Ruby's
  // `\s`, matching the reader's rstrip set), so all four behave like
  // the NUL row above - outside both sets, kept by both, undefined
  // here the same way.
  test.each([
    ["a NUL", String.fromCodePoint(0)],
    ["a no-break space", "\u00A0"],
    ["a thin space", "\u2009"],
    ["an ideographic space", "\u3000"],
    ["a byte-order mark", "\uFEFF"],
  ] as const)("a trailing %s answers undefined", (_n, tail) => {
    const [block] = parse(`[[3-bad]]${tail}\n`).children;
    expect(anchorLineShape(block)).toBeUndefined();
  });

  // The VALID-id shape, which is the one issue #75 actually changed:
  // at main, `[[anc]]` (a perfectly valid id) plus a no-break space
  // was the one case in the whole tree where a paragraph answered
  // "anchor" - the packer erased the tail, so the printed line
  // re-read as a live block anchor. Pinned separately from the
  // `[[3-bad]]` rows above because THIS is the id the bug used to
  // reach, not an already-rejected one.
  test("a trailing no-break space after a VALID id also answers undefined", () => {
    const [block] = parse("[[anc]]\u00A0\n").children;
    expect(block.type).toBe("paragraph");
    expect(anchorLineShape(block)).toBeUndefined();
  });

  // The `blockAnchor` arm asks the grammar too, rather than taking a
  // node kind's word for the printed line - a defense that stays live
  // even now that issue #69's own repro no longer reaches the
  // "lookalike" branch: `buildBlockAnchor` (build/metadata.ts) rstrips
  // the line before splitting it, the same bytes the classifier
  // already matched, so `[[ok]]` plus two trailing spaces builds the
  // clean id `ok` and its printed spelling `[[ok]]` satisfies the
  // grammar - an anchor, not a lookalike.
  test("a blockAnchor's printed line satisfies the grammar even with trailing whitespace in the source", () => {
    const [block] = parse("[[ok]]  \n").children;
    expect(block.type).toBe("blockAnchor");
    expect(anchorLineShape(block)).toBe("anchor");
  });
});
