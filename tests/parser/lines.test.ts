import { describe, test, expect } from "vitest";
import { splitLines } from "../../src/parse/lines/split.js";
import {
  BLOCK_START_CONTEXT,
  classifyLine,
  delimiterKind,
  isContinuationLine,
  parseAdmonitionLabel,
  parseListMarker,
  parseSectionTitle,
  type ReaderContext,
} from "../../src/parse/lines/classify.js";

describe("splitLines mirrors Helpers.prepare_source_string", () => {
  test("rstrips text, keeps raw, tracks offsets and 1-based lines", () => {
    const lines = splitLines("a  \n\n  b\t\nc");
    expect(lines).toEqual([
      { text: "a", raw: "a  ", offset: 0, line: 1 },
      { text: "", raw: "", offset: 4, line: 2 },
      { text: "  b", raw: "  b\t", offset: 5, line: 3 },
      { text: "c", raw: "c", offset: 10, line: 4 },
    ]);
  });
  test("a trailing newline does not create a phantom last line", () => {
    expect(splitLines("a\n")).toHaveLength(1);
    expect(splitLines("")).toHaveLength(0);
  });
  // The oracle is Asciidoctor Ruby transpiled by Opal, whose
  // String#rstrip is `self.replace(/[\s\u0000]*$/, '')` — JavaScript's
  // `\s`, not MRI's whitespace set. So it strips a NUL (which
  // trimEnd() leaves) and a no-break space (which MRI leaves). The
  // oracle rows in tests/conformance/interruption.test.ts pin both.
  test.each([
    ["a NUL", "a\u0000"],
    ["a no-break space", "a\u00A0"],
    ["a carriage return", "a\r"],
    ["a form feed", "a\f"],
  ])("rstrip removes %s", (_name, source) => {
    const [only] = splitLines(source);
    expect(only.text).toBe("a");
    expect(only.raw, "the author's bytes are kept alongside").toBe(source);
  });
});

// Block-start classification follows next_section → parse_block_metadata_line
// → next_block in that order. Each row names the Ruby it mirrors.
const BLOCK_START_ROWS: Array<[string, string, string]> = [
  ["", "blank", "Reader#skip_blank_lines"],
  [
    "// note",
    "raw",
    "CommentLineRx via skip_line_comments / parse_block_metadata_line",
  ],
  [
    "ifdef::a[]",
    "raw",
    "PreprocessorReader#process_line + ConditionalDirectiveRx",
  ],
  ["include::x.adoc[]", "raw", "IncludeDirectiveRx"],
  [
    "[source,ruby]",
    "attributeLine",
    "BlockAttributeLineRx (attribute-list alternative)",
  ],
  ["[[id]]", "anchor", "BlockAnchorRx"],
  [".Title", "blockTitle", "BlockTitleRx"],
  [":name: value", "attributeEntry", "AttributeEntryRx"],
  ["== Section", "sectionTitle", "AtxSectionTitleRx"],
  ["= Doc", "sectionTitle", "AtxSectionTitleRx level 0"],
  ["----", "delimiterOpen", "is_delimited_block? / DELIMITED_BLOCKS"],
  ["```ruby", "delimiterOpen", "is_delimited_block? fenced special case"],
  ["--", "delimiterOpen", "DELIMITED_BLOCKS['--']"],
  ["////", "delimiterOpen", "DELIMITED_BLOCKS['////']"],
  ["+", "continuation", "LIST_CONTINUATION"],
  ["* item", "listMarker", "UnorderedListRx"],
  [
    "  ** item",
    "listMarker",
    String.raw`UnorderedListRx allows leading [ \t]*`,
  ],
  [". item", "listMarker", "OrderedListRx"],
  ["<1> item", "listMarker", "CalloutListRx"],
  ["term:: def", "dlistTerm", "DescriptionListRx"],
  ["NOTE: x", "admonitionLabel", "AdmonitionParagraphRx"],
  ["image::a.png[]", "blockMacro", "BlockMediaMacroRx"],
  ["'''", "thematicBreak", "LAYOUT_BREAK_CHARS + uniform?"],
  ["<<<", "pageBreak", "LAYOUT_BREAK_CHARS"],
  ["  literal", "indented", "LiteralParagraphRx"],
  ["plain text", "text", "next_block fallthrough"],
  ["  <1> x", "indented", "callout requires !indented in next_block"],
];

describe("classifyLine at a block start", () => {
  test.each(BLOCK_START_ROWS)("%j → %s (%s)", (line, kind) => {
    expect(classifyLine(line, BLOCK_START_CONTEXT).kind).toBe(kind);
  });
});

describe("classifyLine inside an open paragraph", () => {
  const inParagraph: ReaderContext = {
    ...BLOCK_START_CONTEXT,
    openParagraph: "paragraph",
  };
  test.each([
    ["* item", "text"],
    [".Title", "text"],
    ["== S", "text"],
    ["// c", "raw"],
    ["[source]", "attributeLine"],
    ["----", "delimiterOpen"],
    ["+", "continuation"],
  ])("%j → %s", (line, kind) => {
    expect(classifyLine(line, inParagraph).kind).toBe(kind);
  });
  test("a sibling marker is a listMarker in list-item text", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      openParagraph: "listItem",
      openListStyles: ["*"],
    };
    expect(classifyLine("* next", reader).kind).toBe("listMarker");
  });
  test("only the OPEN list's marker ends a +-attached paragraph", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      openParagraph: "listContinuation",
      openListStyles: ["*"],
    };
    expect(classifyLine(". next", reader).kind).toBe("text");
    expect(classifyLine("* next", reader).kind).toBe("listMarker");
  });
  test("a foreign marker in a +-attached paragraph is verbatim text", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      openParagraph: "listContinuation",
      openListStyles: ["*"],
    };
    // `. next` does not end the paragraph (only the OPEN list's marker
    // does), but its COLUMN is load-bearing: `read_lines_for_list_item`
    // flips `within_nested_list` on any line matching
    // NESTABLE_LIST_CONTEXTS, and that flag decides whether a later `+`
    // is a real continuation. Reflowing it onto its predecessor would
    // silently change the next `+`'s meaning, so the kind carries the
    // "keep this on its own line" flag.
    expect(classifyLine(". next", reader)).toEqual({
      kind: "text",
      verbatim: true,
    });
    expect(classifyLine("plain words", reader)).toEqual({ kind: "text" });
  });
  test("a block anchor right after a list item's text stays raw", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      openParagraph: "listItem",
      firstLineAfterStart: true,
    };
    expect(classifyLine("[[a]]", reader)).toEqual({
      kind: "raw",
      form: "anchor",
    });
    expect(
      classifyLine("[[a]]", { ...reader, firstLineAfterStart: false }).kind,
    ).toBe("anchor");
  });
});

describe("classifyLine inside delimited blocks", () => {
  test("the outermost matching terminator closes (build_block reads the parent extent first)", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      openTerminators: ["====", "--"],
      inVerbatim: { close: "----" },
    };
    expect(classifyLine("====", reader).kind).toBe("delimiterClose");
    expect(classifyLine("----", reader).kind).toBe("delimiterClose");
    expect(classifyLine("* not a list here", reader).kind).toBe("verbatim");
  });
  test("a fence closes on exactly ``` (terminator.slice 0, 3)", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      inVerbatim: { close: "```" },
    };
    expect(classifyLine("```", reader).kind).toBe("delimiterClose");
    expect(classifyLine("````", reader).kind).toBe("verbatim");
  });
});

describe("parseListMarker", () => {
  test.each([
    [
      "* a",
      { variant: "unordered", style: "*", depth: 1, indent: 0, markerEnd: 2 },
    ],
    [
      "  **  a",
      { variant: "unordered", style: "**", depth: 2, indent: 2, markerEnd: 6 },
    ],
    [
      "- a",
      { variant: "unordered", style: "-", depth: 1, indent: 0, markerEnd: 2 },
    ],
    [
      ".. a",
      { variant: "ordered", style: "..", depth: 2, indent: 0, markerEnd: 3 },
    ],
    [
      "<.> a",
      { variant: "callout", style: "<>", depth: 1, indent: 0, markerEnd: 4 },
    ],
  ])("%j", (line, expected) => {
    expect(parseListMarker(line)).toEqual(expected);
  });
  test("no trailing text means no marker (rstripped line)", () => {
    expect(parseListMarker("*")).toBeUndefined();
    expect(parseListMarker("****")).toBeUndefined();
  });
});

// The registry kept TWO marker shapes that disagreed on two axes.
// LIST_MARKER_LINE (the classifier's parser) has always been Ruby-true:
// `UnorderedListRx` is `/^[ \t]*(-|\*\**|•)[ \t]+(CC_ANY*)$/`, so it
// allows leading whitespace and a tab gap. LIST_MARKERS (the
// interrupting set) was anchored at column 0 and required a single
// space, because widening it would have moved indented markers out of
// list-item text before a reader existed that could nest them.
//
// Issue #29 is closed: the BlockReader nests them, and the oracle says
// both axes are markers inside an item — `* a` / `␠␠** b` / `* c`
// renders a nested list plus a sibling, and both `* a` / `␠␠* b` and
// `* a` / `*\tb` render two sibling items. LIST_MARKERS was widened to
// Ruby's shape and these rows now assert the Ruby-true verdict in BOTH
// positions. tests/parser/reader.test.ts pins the reader's structure
// for the same three documents against the oracle.
describe("indented and tab-gapped markers (issue #29, closed)", () => {
  const inItem: ReaderContext = {
    ...BLOCK_START_CONTEXT,
    openParagraph: "listItem",
    openListStyles: ["*"],
  };
  test.each([
    ["leading whitespace", "  ** item"],
    ["a tab gap", "*\tnext"],
  ])("%s: a marker at a block start", (_axis, line) => {
    expect(classifyLine(line, BLOCK_START_CONTEXT).kind).toBe("listMarker");
  });
  test.each([
    ["leading whitespace", "  ** item"],
    ["a tab gap", "*\tnext"],
  ])("%s: a marker inside an open item too", (_axis, line) => {
    expect(classifyLine(line, inItem).kind).toBe("listMarker");
  });
});

describe("parseSectionTitle", () => {
  test.each([
    ["= Doc", 0],
    ["== Section", 1],
    ["====== Deepest", 5],
    ["==  padded", 1],
  ])("%j → level %i", (line, level) => {
    expect(parseSectionTitle(line)).toEqual({ level });
  });
  // `AtxSectionTitleRx`'s marker group is `(=={0,5})` — one `=` plus up
  // to five more — and the gap is mandatory.
  test.each(["=Doc", "======= too deep", "= ", "===", "text"])(
    "%j is not a section title",
    (line) => {
      expect(parseSectionTitle(line)).toBeUndefined();
    },
  );
});

describe("parseAdmonitionLabel", () => {
  // labelEnd is where `lines[0] = $'` starts, so it must count the
  // colon and the whole `[ \t]+` gap, not assume one space.
  test.each([
    ["NOTE: x", { label: "NOTE", labelEnd: 6 }],
    ["WARNING:\tx", { label: "WARNING", labelEnd: 9 }],
    ["IMPORTANT:   x", { label: "IMPORTANT", labelEnd: 13 }],
    ["CAUTION: a: b", { label: "CAUTION", labelEnd: 9 }],
  ])("%j", (line, expected) => {
    expect(parseAdmonitionLabel(line)).toEqual(expected);
  });
  test.each(["NOTE:x", "note: x", "NOTES: x", "Note: x"])(
    "%j carries no label",
    (line) => {
      expect(parseAdmonitionLabel(line)).toBeUndefined();
    },
  );
});

describe("delimiterKind", () => {
  test.each([
    ["----", "listing"],
    ["-----", "listing"],
    ["....", "literal"],
    ["++++", "pass"],
    ["====", "example"],
    ["****", "sidebar"],
    ["____", "quote"],
    ["////", "commentBlock"],
    ["--", "openBlock"],
    ["```", "fencedCode"],
    ["```ruby", "fencedCode"],
  ])("%j → %s", (line, kind) => {
    expect(delimiterKind(line)).toBe(kind);
  });
  // `is_delimited_block?` wants the delimiter and NOTHING else, and
  // rejects a four-backtick fence outright.
  test.each(["---", "````", "-- x", "----:: x", "text"])(
    "%j opens nothing",
    (line) => {
      expect(delimiterKind(line)).toBeUndefined();
    },
  );
});

describe("isContinuationLine", () => {
  // Rstripped inside, the way `Reader` rstrips every line before
  // comparing it with LIST_CONTINUATION.
  test.each(["+", "+ ", "+\t"])("%j is a continuation", (line) => {
    expect(isContinuationLine(line)).toBe(true);
  });
  test.each(["++", " +", "+x", ""])("%j is not", (line) => {
    expect(isContinuationLine(line)).toBe(false);
  });
});
