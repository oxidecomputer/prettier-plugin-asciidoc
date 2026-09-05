import { describe, test, expect } from "vitest";
import { splitLines } from "../../src/parse/lines/split.js";
import {
  BLOCK_START_CONTEXT,
  type ReaderContext,
} from "../../src/parse/line-shapes.js";
import { parseDescriptionListLine } from "../../src/parse/line-shapes-description.js";
import {
  attributeContinuation,
  classifyLine,
  delimiterKind,
  isContinuationLine,
  parseAdmonitionLabel,
  parseAttributeEntry,
  parseBlockMacro,
  parseSectionTitle,
} from "../../src/parse/lines/classify.js";

// `Helpers.prepare_source_string` names two behaviors that diverge
// (see the JSDoc on nextLineBreak, src/parse/positions.ts): MRI
// Ruby's does no line-ending normalization at all, and
// `@asciidoctor/core` 4.0.11's rewrites `\r\n` and then a lone `\r`
// to `\n` before splitting. This suite pins splitLines against the JS
// oracle's version, the one every other test in this repository runs
// against.
describe("splitLines mirrors the JS oracle's Helpers.prepare_source_string", () => {
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
  // The oracle's rstrip is `line.replace(/[ \t\r\n\f\v]+$/, '')` —
  // the six ASCII whitespace characters, which is MRI's set less the
  // NUL. The rows below are the ones that can reach a line end WITHOUT
  // ending the line first: a line never carries its own LF, and a
  // lone CR is now consumed as a line break of its own (issue #68)
  // rather than surviving into raw content, so it has no row here
  // (see "a lone carriage return ends the line" below instead). The
  // characters that SURVIVE have their own rows underneath, and
  // tests/conformance/interruption.test.ts pins both halves against
  // the oracle itself.
  test.each([
    ["a space", "a "],
    ["a tab", "a\t"],
    ["a form feed", "a\f"],
    ["a vertical tab", "a\v"],
    ["a mixed run", "a \t\f\v "],
  ])("rstrip removes %s", (_name, source) => {
    const [only] = splitLines(source);
    expect(only.text).toBe("a");
    expect(only.raw, "the author's bytes are kept alongside").toBe(source);
  });
  // A CR that IS part of CRLF is not lone, so it does not end the
  // line by itself: the `\n` does, one position later, and the `\r`
  // lands in raw exactly like any other trailing byte the rstrip set
  // covers.
  test("a CRLF keeps its CR in raw, same as any other trailing byte", () => {
    const [only] = splitLines("a\r\n");
    expect(only).toEqual({ text: "a", raw: "a\r", offset: 0, line: 1 });
  });
  // Was one line here and two under the JS oracle's own
  // `prepareSourceString` (issue #68; MRI's does no such rewrite, see
  // the JSDoc on nextLineBreak, src/parse/positions.ts): a bare CR
  // with no following `\n` is a LINE BREAK to it, consumed like a
  // `\n` rather than kept as trailing content, so it never reaches
  // rstrip and never survives into any line's `raw`.
  test("a lone carriage return ends the line, like a newline", () => {
    expect(splitLines("a\rb")).toEqual([
      { text: "a", raw: "a", offset: 0, line: 1 },
      { text: "b", raw: "b", offset: 2, line: 2 },
    ]);
  });
  // A trailing lone CR does not open a phantom last line either,
  // exactly like a trailing `\n` (see "a trailing newline does not
  // create a phantom last line" above).
  test("a trailing lone carriage return does not open a phantom last line", () => {
    expect(splitLines("a\r")).toEqual([
      { text: "a", raw: "a", offset: 0, line: 1 },
    ]);
  });
  // There is no formatAdoc-level render-equivalence pin for a lone CR
  // anywhere in this repository, and there cannot honestly be one:
  // Prettier's own entry point rewrites `\r\n?` to `\n` before any
  // plugin parser runs (prettier/index.mjs, normalizeEndOfLine), so a
  // lone CR never reaches splitLines through formatAdoc or the plugin
  // at all - only a direct parse call (the conformance harnesses that
  // feed raw documents) can ever see one. splitLines-vs-the-JS-oracle,
  // pinned by the rows above, is the reachable claim; a formatAdoc
  // round trip has no document left to observe this fix on.

  // Narrower than `trimEnd()` at both ends of the code space: the NUL
  // sits below the ASCII set and every non-ASCII space above it, and
  // the oracle keeps all of them. A run stops at the first survivor,
  // so `a<NUL><space>` loses the space and keeps the NUL. A SAMPLE:
  // the full survivor set is read from the oracle in
  // tests/conformance/interruption.test.ts.
  test.each([
    ["a NUL", "a\u{0}", "a\u{0}"],
    ["a no-break space", "a\u{A0}", "a\u{A0}"],
    ["an ogham space mark", "a\u{1680}", "a\u{1680}"],
    ["an en quad", "a\u{2000}", "a\u{2000}"],
    ["a figure space", "a\u{2007}", "a\u{2007}"],
    ["a narrow no-break space", "a\u{202F}", "a\u{202F}"],
    ["a line separator", "a\u{2028}", "a\u{2028}"],
    ["a paragraph separator", "a\u{2029}", "a\u{2029}"],
    ["an ideographic space", "a\u{3000}", "a\u{3000}"],
    ["a zero-width space", "a\u{200B}", "a\u{200B}"],
    ["a byte-order mark away from offset 0", "a\u{FEFF}", "a\u{FEFF}"],
    ["a NUL under a trailing space", "a\u{0} ", "a\u{0}"],
    // Only the TAIL is scanned, so this line's interior costs nothing
    // -- a padded ASCII-art line or a pasted fixed-width table row is
    // read as fast as any other. Sized so that retrying an unanchored
    // trailing-run match at every start position, which is what
    // matching `/[...]+$/` against it does, would take seconds; the
    // assertion is the answer, and the speed is the algorithm's.
    ["a long interior run", `a${" ".repeat(1e5)}b`, `a${" ".repeat(1e5)}b`],
  ])("rstrip keeps %s", (_name, source, text) => {
    const [only] = splitLines(source);
    expect(only.text).toBe(text);
    expect(only.raw, "the author's bytes are kept alongside").toBe(source);
  });
});

// Asciidoctor's prepare_source takes ONE byte-order mark off the head
// of the whole document before any line rule runs, which is why
// `<BOM>= Title` is a document title rather than a paragraph
// (issue #60). Offsets stay original-relative: the mark is skipped,
// not cut out, so the first line starts at offset 1 and every later
// line keeps the offset it always had.
describe("splitLines strips a leading byte-order mark", () => {
  test("the mark leaves the first line and costs it one offset", () => {
    expect(splitLines("\u{FEFF}= Title\n")).toEqual([
      { text: "= Title", raw: "= Title", offset: 1, line: 1 },
    ]);
  });
  test("the misdecoded three-character spelling goes too", () => {
    expect(splitLines("\u{EF}\u{BB}\u{BF}= Title\n")).toEqual([
      { text: "= Title", raw: "= Title", offset: 3, line: 1 },
    ]);
  });
  test("a document of nothing but the mark has no lines", () => {
    expect(splitLines("\u{FEFF}")).toEqual([]);
  });
  test("the mark before a blank line leaves the blank line", () => {
    expect(splitLines("\u{FEFF}\n= Title\n")).toEqual([
      { text: "", raw: "", offset: 1, line: 1 },
      { text: "= Title", raw: "= Title", offset: 2, line: 2 },
    ]);
  });
  test("ONE mark: a second is ordinary text", () => {
    expect(splitLines("\u{FEFF}\u{FEFF}= Title\n")).toEqual([
      {
        text: "\u{FEFF}= Title",
        raw: "\u{FEFF}= Title",
        offset: 1,
        line: 1,
      },
    ]);
  });
  test("a mark anywhere but offset 0 stays", () => {
    expect(splitLines("= Title\n\u{FEFF}para\n")).toEqual([
      { text: "= Title", raw: "= Title", offset: 0, line: 1 },
      { text: "\u{FEFF}para", raw: "\u{FEFF}para", offset: 8, line: 2 },
    ]);
  });
  test("the mark goes, the space after it stays", () => {
    const [only] = splitLines("\u{FEFF} = Title\n");
    expect(only.text).toBe(" = Title");
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
  ["---", "thematicBreak", "MARKDOWN_THEMATIC_BREAK_CHARS"],
  ["***", "thematicBreak", "MARKDOWN_THEMATIC_BREAK_CHARS"],
  ["___", "thematicBreak", "MARKDOWN_THEMATIC_BREAK_CHARS"],
  ["  ---", "thematicBreak", "MarkdownThematicBreakRx allows ^ {0,3}"],
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
    [
      "== Section",
      { kind: "sectionTitle", level: 1, title: "Section", extent: 1 },
    ],
    // classifyLine rstrips first, so the title capture carries no
    // trailing whitespace — the same text the deleted slice-and-trim
    // in build/heading.ts produced.
    [
      "== trailing spaces   ",
      { kind: "sectionTitle", level: 1, title: "trailing spaces", extent: 1 },
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
      openList: { kind: "marker", style: "*" },
    };
    expect(classifyLine("* next", reader).kind).toBe("listMarker");
  });
  test("only the OPEN list's marker ends a +-attached paragraph", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      openParagraph: "listContinuation",
      openList: { kind: "marker", style: "*" },
    };
    expect(classifyLine(". next", reader).kind).toBe("text");
    expect(classifyLine("* next", reader).kind).toBe("listMarker");
  });
  test("a foreign marker in a +-attached paragraph is verbatim text", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      openParagraph: "listContinuation",
      openList: { kind: "marker", style: "*" },
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
  test("with NO list open the foreign-marker rule stays out of the way", () => {
    // Top level, with the ordered marker `. next` as the foreign one:
    // `read_lines_for_list_item` never runs, so there is no
    // `within_nested_list` flag for the marker's column to ride on and
    // the line is ordinary reflowable text. Holding it
    // back here made `+` / `para` / `* item` / `more` reflow
    // differently on each pass, which is why the rule reads the open
    // style rather than the shape alone.
    expect(
      classifyLine(". next", {
        ...BLOCK_START_CONTEXT,
        openParagraph: "listContinuation",
      }),
    ).toEqual({ kind: "text" });
  });
  test("a block anchor in the item's first block stays raw", () => {
    const reader: ReaderContext = {
      ...BLOCK_START_CONTEXT,
      openParagraph: "listItemText",
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
    openList: { kind: "marker", style: "*" },
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
    ["==\ttabbed", 1, "tabbed"],
    // The CLOSED form: the trailing run repeats the opening markers
    // exactly, and Ruby's optional `\1` takes it off the title. A run
    // that is NOT the opening one stays in the title, which the
    // pattern decides by backtracking.
    ["== T ==", 1, "T"],
    ["== T ===", 1, "T ==="],
    ["== T =", 1, "T ="],
    // The MARKDOWN marker spelling, which `ExtAtxSectionTitleRx`
    // accepts beside the `=` one at the same levels. The two do not
    // mix: `\1` is the opening run, so an `=` closing run under `#`
    // markers is title text.
    ["# Doc", 0, "Doc"],
    ["## Section", 1, "Section"],
    ["###### Deepest", 5, "Deepest"],
    ["## S ##", 1, "S"],
    ["## S ==", 1, "S =="],
  ])("%j → level %i, title %j", (line, level, title) => {
    expect(parseSectionTitle(line)).toEqual({ level, title });
  });
  // `ExtAtxSectionTitleRx`'s marker group is `(=={0,5}|##{0,5})`, one
  // marker plus up to five more, and the gap is mandatory. The last
  // row is why the two alternatives are not one class.
  const notTitles = ["=Doc", "======= too deep", "= ", "===", "text"];
  test.each([...notTitles, "#Doc", "####### too deep", "=# mixed"])(
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
  // Asciidoctor only opens a block macro for a REGISTERED name: image,
  // video, audio, toc by default, and any other name only when an
  // extension registers it (parser.rb l.647-649), and this formatter,
  // like the pinned oracle's own test harness, registers none.
  // `custom::t[a]` was wrongly accepted here before #183;
  // `footnote::[n]` is the issue's own witness.
  test.each([
    ["image::a.png[Alt]", { name: "image", target: "a.png", attrlist: "Alt" }],
    ["video::a.mp4[]", { name: "video", target: "a.mp4", attrlist: "" }],
    ["toc::[]", { name: "toc", target: "", attrlist: "" }],
    ["image::a.png[Alt] x", undefined],
    ["image:a.png[]", undefined],
    ["1mage::a[]", undefined],
    ["text", undefined],
    ["custom::t[a,b=c]", undefined],
    ["footnote::[n]", undefined],
  ])("%j", (line, expected) => {
    expect(parseBlockMacro(line)).toEqual(expected);
  });
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

describe("attributeContinuation", () => {
  // Every value here ends in the character a raw template cannot end
  // in, so these rows carry the escape instead.
  /* eslint-disable unicorn/prefer-string-raw -- see above */
  // The suffix is the two characters `process_attribute_entry` tests
  // (` \` and the legacy ` +`), and it is answered over the entry's
  // VALUE: `:a: \` has the value `\` alone, so a caller asking about
  // the line instead would continue where Asciidoctor does not.
  test.each([
    ["one \\", " \\"],
    ["one +", " +"],
    ["one \\ \\", " \\"],
  ])("%j continues with %j", (value, suffix) => {
    expect(attributeContinuation(value)).toEqual({ value, suffix });
  });

  // The last row is the entry with no value at all (`:toc:`,
  // `:!toc:`), which is what makes the function total over everything
  // the classifier can hand it.
  test.each(["one\\", "one+", "\\", "+", "one \\x", "", " \\ ", undefined])(
    "%j continues nothing",
    (value) => {
      expect(attributeContinuation(value)).toBeUndefined();
    },
  );
  /* eslint-enable unicorn/prefer-string-raw */
});
