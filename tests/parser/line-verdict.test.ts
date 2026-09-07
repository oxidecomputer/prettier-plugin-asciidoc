/**
 * THE SHARED VERDICT: what our reader makes of one line at one
 * position in a block (src/line-verdict.ts).
 *
 * Two askers read the same function, so the rows here are written
 * from both ends. The reader's own scans use it to decide whether a
 * source line continues the block they have open; the printer's
 * packer uses it to decide whether a line it is ABOUT TO WRITE reads
 * back as the block it came from. A row that fixes one asker's answer
 * fixes the other's.
 *
 * WHAT THE ROWS ARE FOR. The whole-line vocabulary is the point: a
 * block start in each of its spellings, a marker line with and
 * without its checkbox, both section-title spellings, a thematic
 * break, the description separator, the lone `+`, and the block
 * anchor. Each was a separate print-side predicate over a WORD before
 * this function existed, and each of those unioned every context's
 * patterns together because a word carries no context. The rows below
 * are arranged so the difference is visible: the same line, refused at
 * one position and kept at another.
 */
import { describe, expect, test } from "vitest";
import {
  accepts,
  FIRST_CONTINUATION,
  keepsTheLine,
  LATER_CONTINUATION,
  lineVerdict,
  OPENING_LINE,
  type BlockOpening,
  type BlockPosition,
} from "../../src/line-verdict.js";
import {
  BLOCK_START_CONTEXT,
  type ParagraphContext,
} from "../../src/parse/line-shapes.js";

/**
 * A continuation position inside an open block.
 * @param context - which kind of paragraph is open
 * @param ordinal - the line directly under the block start, or a
 *   later one
 * @returns the position
 */
function inside(
  context: ParagraphContext,
  ordinal: 1 | 2 = LATER_CONTINUATION,
): BlockPosition {
  return {
    ordinal,
    reader: { ...BLOCK_START_CONTEXT, openParagraph: context },
  };
}

/**
 * The block's own opening line, at document level.
 * @param opens - what the reader read that line as
 * @returns the position
 */
function opening(opens: BlockOpening): BlockPosition {
  return { ordinal: OPENING_LINE, reader: BLOCK_START_CONTEXT, opens };
}

/** What a plain paragraph's first line was read as. */
const OPENS_AS_TEXT: BlockOpening = { reading: "text" };

/** The three spellings of a thematic break the reader knows. */
const THEMATIC_BREAKS = ["'''", "---", "- - -"] as const;

describe("what a plain paragraph's continuation refuses", () => {
  // The shapes `read_paragraph_lines` breaks on at document level:
  // `StartOfBlockProc` (a delimited-block line or a block attribute
  // line, parser.rb l.36), the block anchor, and the lone `+`
  // `read_lines_until` breaks on separately (reader.rb l.413-427).
  const refused = [
    ["a delimiter line", "----"],
    ["a table delimiter", "|==="],
    ["a block attribute line", "[source,ruby]"],
    ["a block anchor", "[[anchor]]"],
    ["a lone plus", "+"],
  ] as const;
  for (const [what, line] of refused) {
    test(`${what} is not a paragraph's own text`, () => {
      expect(accepts(line, undefined, inside("paragraph"))).toBe(false);
    });
  }
  // Kept by the reader (the preprocessor eats them before block
  // structure exists) and refused to the packer, which may not
  // COMPOSE one. The last describe block below is that difference.
  const raw = [
    ["a comment line", "// a comment"],
    ["an include directive", "include::other.adoc[]"],
  ] as const;
  for (const [what, line] of raw) {
    test(`${what} is not a line the packer may compose`, () => {
      expect(accepts(line, undefined, inside("paragraph"))).toBe(false);
    });
  }
});

describe("what a plain paragraph's continuation keeps", () => {
  // The mirror rows, and what stops the refusals above from being a
  // blanket "anything punctuation-shaped". EVERY line here is refused
  // by the word probe the printer asked before this function existed
  // (`startsBlockAtLineStart`, src/parse/line-shapes.ts, which unions
  // every context's patterns and is deliberately blind to a setext
  // underline's neighbour), and every one is a line a plain paragraph
  // swallows.
  //
  // ORACLE, each of them written under `para line` and rendered by
  // Asciidoctor 2.0.26: one `<div class="paragraph">` holding both
  // lines, for the marker, the thematic break in both bare spellings,
  // the page break, the block macro and the attribute entry alike.
  // The reason is one line of Ruby: at document level
  // `read_paragraph_lines` takes `StartOfBlockProc`, which holds no
  // marker, no break, no macro and no attribute entry (parser.rb
  // l.36, l.962-970).
  const kept = [
    ["a marker line", "* item"],
    ["a marker line with a checkbox", "* [ ] item"],
    ["an ordered marker line", ". item"],
    ["a callout marker line", "<1> item"],
    ["a page break", "<<<"],
    ["a block macro", "image::a.png[]"],
    ["an attribute entry", ":name: value"],
    ["a block title", ".Title"],
    ["a setext underline", "^^^^"],
    ["an atx section title", "== Heading"],
    ["a description separator", "term:: definition"],
    ["ordinary text", "more words"],
    ["a bracketed word", "[not] an attribute line"],
  ] as const;
  for (const [what, line] of kept) {
    test(`${what} is a paragraph's own text`, () => {
      expect(accepts(line, undefined, inside("paragraph"))).toBe(true);
    });
  }
  for (const line of THEMATIC_BREAKS) {
    test(`the thematic break ${line} is a paragraph's own text`, () => {
      expect(accepts(line, undefined, inside("paragraph"))).toBe(true);
    });
  }
});

describe("a list item's text refuses what its own set holds", () => {
  // The context is the whole difference from the block above: an
  // item's text breaks at `is_sibling_list_item?` and buffers an
  // `AnyListRx` match as a nested list (parser.rb l.1430, l.1530), so
  // the marker spellings that are prose mid-paragraph end this block.
  // `- - -` is here because it is BOTH a break and a marker line, and
  // the marker reading is the one an item's set acts on.
  const refused = [
    ["a marker line", "* item"],
    ["a marker line with a checkbox", "* [ ] item"],
    ["an ordered marker line", ". item"],
    ["a callout marker line", "<1> item"],
    ["a spaced markdown break, which is also a marker line", "- - -"],
    ["a description separator", "term:: definition"],
  ] as const;
  for (const [what, line] of refused) {
    test(`${what} ends a list item's text`, () => {
      expect(accepts(line, undefined, inside("listItemText"))).toBe(false);
    });
  }
});

describe("the position inside the block", () => {
  // The one reason the ordinal is part of the position: the
  // interrupting sets tell the line directly under the block start
  // apart from every later line. A block ANCHOR after a list item's
  // text is metadata for the item's FIRST block on the first line,
  // which `fold_first` merges into the item text, id and all, and it
  // opens a second block below that (parser.rb l.1384).
  test("an anchor under a list item's text is refused at both positions", () => {
    expect(
      accepts("[[a]]", undefined, inside("listItemText", FIRST_CONTINUATION)),
    ).toBe(false);
    expect(
      accepts("[[a]]", undefined, inside("listItemText", LATER_CONTINUATION)),
    ).toBe(false);
  });
  // Both refuse, for two different readings, which is why this row
  // reads the VERDICT rather than the predicate: the first position
  // calls the line raw (the reader keeps it verbatim, marker and id
  // and all) and the second calls it an anchor block.
  test("and the two positions give it two different readings", () => {
    expect(
      lineVerdict(
        "[[a]]",
        undefined,
        inside("listItemText", FIRST_CONTINUATION),
      ).kind,
    ).toBe("raw");
    expect(
      lineVerdict(
        "[[a]]",
        undefined,
        inside("listItemText", LATER_CONTINUATION),
      ).kind,
    ).toBe("anchor");
  });
  // A description item's FIRST line is the one position where block
  // metadata stays in the description: `parse_list_item` hands the
  // lines after the term to a full `next_block` and `fold_first`
  // merges the block back in, title and all. The reader keeps such a
  // line; the packer may not compose one.
  test("a block title on a description's first line is kept, not composed", () => {
    const position = inside("dlistItem", FIRST_CONTINUATION);
    expect(keepsTheLine(lineVerdict(".Title", undefined, position))).toBe(true);
    expect(accepts(".Title", undefined, position)).toBe(false);
  });
});

describe("the opening line is asked against the recorded reading", () => {
  test("a paragraph that still opens as text is accepted", () => {
    expect(accepts("just words", undefined, opening(OPENS_AS_TEXT))).toBe(true);
  });
  // The whole vocabulary, at the one position where all of it counts:
  // the reader picks the block's context off this line, so every
  // shape the ladder knows is live here and the paragraph the packer
  // meant to write is gone if the line spells one. The mirror of the
  // second describe block above, line for line.
  const refused = [
    ["a delimiter", "----"],
    ["a table delimiter", "|==="],
    ["a block attribute line", "[source,ruby]"],
    ["a block anchor", "[[anchor]]"],
    ["a comment line", "// a comment"],
    ["a marker line", "* item"],
    ["a marker line with a checkbox", "* [ ] item"],
    ["an ordered marker line", ". item"],
    ["a callout marker line", "<1> item"],
    ["a page break", "<<<"],
    ["a block macro", "image::a.png[]"],
    ["an attribute entry", ":name: value"],
    ["a block title", ".Title"],
    ["an atx section title", "== Heading"],
    ["a description separator", "term:: definition"],
    ["a lone plus", "+"],
  ] as const;
  for (const [what, line] of refused) {
    test(`${what} is not a paragraph's opening line`, () => {
      expect(accepts(line, undefined, opening(OPENS_AS_TEXT))).toBe(false);
    });
  }
  for (const line of THEMATIC_BREAKS) {
    test(`the thematic break ${line} is not a paragraph's opening line`, () => {
      expect(accepts(line, undefined, opening(OPENS_AS_TEXT))).toBe(false);
    });
  }
  test("a list item's opening line has to keep its marker style", () => {
    const item: BlockOpening = { reading: "listMarker", style: "*" };
    expect(accepts("* the item", undefined, opening(item))).toBe(true);
    expect(accepts("- the item", undefined, opening(item))).toBe(false);
  });
  // The neighbour, and the only construct that reads one: the
  // underlined section title's test is a joint function of both
  // lines' lengths (`setext_section_title?`, parser.rb l.1722-1727).
  // The three rows are the reason `accepts` takes `next` at all.
  test("a neighbour of the right length makes the opening line a title", () => {
    expect(accepts("Title", "=====", opening(OPENS_AS_TEXT))).toBe(false);
  });
  test("and one of the wrong length leaves it text", () => {
    expect(accepts("Title", "==", opening(OPENS_AS_TEXT))).toBe(true);
  });
  test("no neighbour at all leaves it text", () => {
    expect(accepts("Title", undefined, opening(OPENS_AS_TEXT))).toBe(true);
  });
});

describe("the two askers part on exactly two readings", () => {
  // The reader KEEPS a raw line and a verbatim text line; the printer
  // may not COMPOSE either. Nothing else separates the predicates,
  // which is the claim src/line-verdict.ts's `isBlockText` makes.
  test("a comment line is kept by the reader and refused to the packer", () => {
    const position = inside("paragraph");
    expect(keepsTheLine(lineVerdict("// note", undefined, position))).toBe(
      true,
    );
    expect(accepts("// note", undefined, position)).toBe(false);
  });
  test("a foreign marker line inside a plus-attached paragraph likewise", () => {
    const position: BlockPosition = {
      ordinal: LATER_CONTINUATION,
      reader: {
        ...BLOCK_START_CONTEXT,
        openParagraph: "listContinuation",
        openList: { kind: "marker", style: "*" },
      },
    };
    expect(keepsTheLine(lineVerdict("- other", undefined, position))).toBe(
      true,
    );
    expect(accepts("- other", undefined, position)).toBe(false);
  });
  test("and ordinary text is accepted by both", () => {
    const position = inside("paragraph");
    expect(keepsTheLine(lineVerdict("words", undefined, position))).toBe(true);
    expect(accepts("words", undefined, position)).toBe(true);
  });
});
