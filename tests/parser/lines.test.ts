import { describe, test, expect } from "vitest";
import { splitLines } from "../../src/parse/lines/split.js";
import {
  BLOCK_START_CONTEXT,
  parseDescriptionListLine,
  type ReaderContext,
} from "../../src/parse/line-shapes.js";
import {
  classifyLine,
  delimiterKind,
  isContinuationLine,
  parseAdmonitionLabel,
  parseAttributeEntry,
  parseBlockMacro,
  parseListMarker,
  parseSectionTitle,
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

describe("the kinds that carry their parse", () => {
  // The classifier reports the FIELDS, not just the verdict: the
  // builder reads them and re-derives nothing, so there is no second
  // pattern for any of these three shapes.
  test.each([
    [
      ":!name: value",
      {
        kind: "attributeEntry",
        name: "name",
        value: "value",
        unset: true,
      },
    ],
    ["== Section", { kind: "sectionTitle", level: 1, title: "Section" }],
    // classifyLine rstrips first, so the title capture carries no
    // trailing whitespace — the same text the deleted slice-and-trim
    // in build/heading.ts produced.
    [
      "== trailing spaces   ",
      { kind: "sectionTitle", level: 1, title: "trailing spaces" },
    ],
    [
      "image::a.png[Alt]",
      {
        kind: "blockMacro",
        name: "image",
        target: "a.png",
        attrlist: "Alt",
      },
    ],
  ])("%j carries its fields", (line, expected) => {
    expect(classifyLine(line, BLOCK_START_CONTEXT)).toEqual(expected);
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
      openListStyle: "*",
    };
    expect(classifyLine("* next", reader).kind).toBe("listMarker");
  });
  test("only the OPEN list's marker ends a +-attached paragraph", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      openParagraph: "listContinuation",
      openListStyle: "*",
    };
    expect(classifyLine(". next", reader).kind).toBe("text");
    expect(classifyLine("* next", reader).kind).toBe("listMarker");
  });
  test("a foreign marker in a +-attached paragraph is verbatim text", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      openParagraph: "listContinuation",
      openListStyle: "*",
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

describe("parseListMarker", () => {
  test.each([
    ["* a", { variant: "unordered", style: "*", indent: 0, markerEnd: 2 }],
    ["  **  a", { variant: "unordered", style: "**", indent: 2, markerEnd: 6 }],
    ["- a", { variant: "unordered", style: "-", indent: 0, markerEnd: 2 }],
    [".. a", { variant: "ordered", style: "..", indent: 0, markerEnd: 3 }],
    // The callout arm reports the marker's own number — the group its
    // match captured. `<.>` is auto-numbered, and 0 is the sentinel
    // for it (AUTO_CALLOUT_NUMBER).
    [
      "<.> a",
      {
        variant: "callout",
        style: "<>",
        indent: 0,
        markerEnd: 4,
        calloutNumber: 0,
      },
    ],
    [
      "<1> a",
      {
        variant: "callout",
        style: "<>",
        indent: 0,
        markerEnd: 4,
        calloutNumber: 1,
      },
    ],
    [
      "<12> a",
      {
        variant: "callout",
        style: "<>",
        indent: 0,
        markerEnd: 5,
        calloutNumber: 12,
      },
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
    openListStyle: "*",
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
  // The TITLE is the classifier's too: `SECTION_TITLE`'s `[ \t]+` eats
  // the whole gap and the line is already rstripped, so the capture is
  // exactly what the deleted slice-and-trim in build/heading.ts
  // produced.
  test.each([
    ["= Doc", 0, "Doc"],
    ["== Section", 1, "Section"],
    ["====== Deepest", 5, "Deepest"],
    ["==  padded", 1, "padded"],
    ["=   spaced doc", 0, "spaced doc"],
    ["== T ==", 1, "T =="],
    ["==\ttabbed", 1, "tabbed"],
  ])("%j → level %i, title %j", (line, level, title) => {
    expect(parseSectionTitle(line)).toEqual({ level, title });
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

describe("parseAttributeEntry", () => {
  // The ONE parse: the fields the AttributeEntryNode carries, read off
  // the registry's own groups. The value arrives trimmed, and an empty
  // one narrows to undefined so `:name:` and `:name: ` are one node.
  test.each([
    [":name: value", { name: "name", value: "value", unset: false }],
    [":name:", { name: "name", value: undefined, unset: false }],
    [":name:   ", { name: "name", value: undefined, unset: false }],
    [":name:\tv  ", { name: "name", value: "v", unset: false }],
    [":!a: v", { name: "a", value: "v", unset: true }],
    [":!a:", { name: "a", value: undefined, unset: true }],
    // The two `!` spellings are ONE fact: store_attribute (parser.rb
    // l.2131-41) chops it off whichever end carries it.
    [":a!:", { name: "a", value: undefined, unset: true }],
    [":a!: v", { name: "a", value: "v", unset: true }],
    [":a b: v", { name: "a b", value: "v", unset: false }],
  ])("%j", (line, expected) => {
    expect(parseAttributeEntry(line)).toEqual(expected);
  });
  test.each([":name", "name: v", ": v", ":!: v", "text"])(
    "%j is no attribute entry",
    (line) => {
      expect(parseAttributeEntry(line)).toBeUndefined();
    },
  );
});

describe("parseBlockMacro", () => {
  test.each([
    ["image::a.png[Alt]", { name: "image", target: "a.png", attrlist: "Alt" }],
    ["toc::[]", { name: "toc", target: "", attrlist: "" }],
    ["custom::t[a,b=c]", { name: "custom", target: "t", attrlist: "a,b=c" }],
  ])("%j", (line, expected) => {
    expect(parseBlockMacro(line)).toEqual(expected);
  });
  test.each(["image::a.png[Alt] x", "image:a.png[]", "1mage::a[]", "text"])(
    "%j is no block macro",
    (line) => {
      expect(parseBlockMacro(line)).toBeUndefined();
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

describe("parseDescriptionListLine carries Ruby's split", () => {
  test.each([
    ["term:: d", "::", "term", 7],
    ["term::", "::", "term", undefined],
    ["term::: d", ":::", "term", 8],
    ["term:::: d", "::::", "term", 9],
    ["a term;; d", ";;", "a term", 9],
    ["  in:: d", "::", "in", 7],
    // Ruby's (?!//[^/]) excludes comments, not every //-headed term.
    ["///x:: d", "::", "///x", 7],
    // The separator may end a word once something precedes it: the
    // term keeps its trailing space (oracle: <dt>foo </dt>).
    ["foo ::", "::", "foo ", undefined],
  ])("%j", (line, delimiter, term, descriptionStart) => {
    expect(parseDescriptionListLine(line)).toEqual({
      delimiter,
      term,
      descriptionStart,
    });
  });
  test.each([["// c:: d"], [";; d"], ["para"]])(
    "%j is no term line",
    (line) => {
      expect(parseDescriptionListLine(line)).toBeUndefined();
    },
  );
  test("the classifier's dlistTerm carries the parse", () => {
    const kind = classifyLine("  term:: d", BLOCK_START_CONTEXT);
    expect(kind).toEqual({
      kind: "dlistTerm",
      indent: 2,
      delimiter: "::",
      term: "term",
      descriptionStart: 9,
    });
  });
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
