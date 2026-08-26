/**
 * Unit tests for `scripts/citations.ts`: the citation grammar and the
 * two checks it feeds. The command line, the floor and the reporting
 * live in tests/scripts/citation-check.test.ts, split out to keep both
 * files under the project's `max-lines` ceiling.
 *
 * The grammar's table is driven by the spellings that are ACTUALLY in
 * this repository's comments, because the gate's whole value is that it
 * reads every citation somebody has already written. A spelling this
 * table does not carry is a spelling the gate has never seen.
 *
 * The cited-file side is driven by the literal line array below rather
 * than by the vendored sources: a test that read
 * `vendor/asciidoctor-ruby/parser.rb` would change meaning the day the
 * pin moves. One test does open the vendored directory, and it checks
 * exactly one thing: that the sources the gate needs are there.
 *
 * This file is one of the four the checker does not scan
 * (`NOT_SCANNED`), which is what lets its rows quote the spellings the
 * grammar refuses without the gate reading them as real citations.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  IDENTIFIER_WINDOW,
  RUBY_DIRECTORY,
  RUBY_FILES,
  checkCitation,
  findCitations,
  identifierCandidates,
  parseLineSpec,
  type Citation,
  type CitedRange,
} from "../../scripts/citations.js";

/** The repository root, from this test file's own location. */
const ROOT = path.resolve(import.meta.dirname, "../..");

describe("the line-spec grammar", () => {
  // Every spelling in the tree, with the ranges it means. The
  // abbreviated ends (`2770-71`, `1443-48`) are the rows worth
  // reading: the end drops the digits it shares with the start.
  test.each<[string, CitedRange[]]>([
    ["2192", [{ start: 2192, end: 2192 }]],
    ["976-1010", [{ start: 976, end: 1010 }]],
    ["2770-71", [{ start: 2770, end: 2771 }]],
    ["1443-48", [{ start: 1443, end: 1448 }]],
    ["1580-81", [{ start: 1580, end: 1581 }]],
    [
      "414/433-435",
      [
        { start: 414, end: 414 },
        { start: 433, end: 435 },
      ],
    ],
    [
      "754/764",
      [
        { start: 754, end: 754 },
        { start: 764, end: 764 },
      ],
    ],
    [
      "1576/l.1580-82",
      [
        { start: 1576, end: 1576 },
        { start: 1580, end: 1582 },
      ],
    ],
    [
      "1430 and l.1519",
      [
        { start: 1430, end: 1430 },
        { start: 1519, end: 1519 },
      ],
    ],
    // The comma continuation, which `list-reader.ts` writes twice.
    [
      "1412-14, 1439",
      [
        { start: 1412, end: 1414 },
        { start: 1439, end: 1439 },
      ],
    ],
  ])("reads %s", (spec, expected) => {
    expect(parseLineSpec(spec)).toEqual(expected);
  });

  // What the spec REFUSES, and why each refusal matters. The dashes
  // and the spaced hyphen are the wrapped and typographic spellings a
  // strict matcher would silently truncate to the first number.
  test.each([
    ["1404–1592", "an en dash"],
    ["1404—1592", "an em dash"],
    ["1404- 1592", "a hyphen the comment's line break split"],
    ["1404 -1592", "a hyphen with a space before it"],
    ["0", "line zero, which no file has"],
    ["19-9", "an abbreviated end that would land on the start"],
    ["10-9", "a one-digit end, far likelier a reversed range typo"],
    ["", "nothing at all"],
  ])("refuses %s (%s)", (spec) => {
    expect(parseLineSpec(spec)).toBeUndefined();
  });
});

describe("reading citations out of comments", () => {
  test.each<[string, string, string, CitedRange[]]>([
    [
      "a colon spelling",
      "// the marker (parser.rb:2192) is resolved once\nexport const a = 1;\n",
      "parser.rb",
      [{ start: 2192, end: 2192 }],
    ],
    [
      "an l. spelling",
      "/** attributes[1] (parser.rb l.2770-71). */\nexport const a = 1;\n",
      "parser.rb",
      [{ start: 2770, end: 2771 }],
    ],
    [
      "a backticked oracle path",
      "// CC_WORD (`@asciidoctor/core/build/node/index.cjs` l.54)\nexport const a = 1;\n",
      "index.cjs",
      [{ start: 54, end: 54 }],
    ],
    [
      "the oracle's own JavaScript source",
      "// the strict `thisLine === ''` (parser.js l.2168)\nexport const a = 1;\n",
      "parser.js",
      [{ start: 2168, end: 2168 }],
    ],
    [
      "a space before the colon",
      "// a metadata line does not end it (parser.rb :1499)\nexport const a = 1;\n",
      "parser.rb",
      [{ start: 1499, end: 1499 }],
    ],
    [
      "alternates joined by a slash",
      "// read_lines_until (reader.rb:414/433-435) warns\nexport const a = 1;\n",
      "reader.rb",
      [
        { start: 414, end: 414 },
        { start: 433, end: 435 },
      ],
    ],
    // The four spellings a reader would write without thinking, all of
    // which a stricter grammar dropped in silence.
    [
      "`line N` spelled out",
      "// see parser.rb line 1404 for the loop\nexport const a = 1;\n",
      "parser.rb",
      [{ start: 1404, end: 1404 }],
    ],
    [
      "a parenthesized lead",
      "// the item read (parser.rb (l.1404)) runs long\nexport const a = 1;\n",
      "parser.rb",
      [{ start: 1404, end: 1404 }],
    ],
    [
      "two spaces before the lead",
      "// the item read parser.rb  l.1404 runs long\nexport const a = 1;\n",
      "parser.rb",
      [{ start: 1404, end: 1404 }],
    ],
    [
      "a comma-continued second half",
      "// the arms (parser.rb l.1412-14, 1439) both fire\nexport const a = 1;\n",
      "parser.rb",
      [
        { start: 1412, end: 1414 },
        { start: 1439, end: 1439 },
      ],
    ],
  ])("reads %s", (_name, source, file, ranges) => {
    const { citations, unparsed, contextless } = findCitations("t.ts", source);
    expect(unparsed).toEqual([]);
    expect(contextless).toEqual([]);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.file).toBe(file);
    expect(citations[0]?.ranges).toEqual(ranges);
  });

  test("a citation wrapped across two comment lines is one citation", () => {
    const source = [
      "// the loop sees the marker (read_lines_for_list_item,",
      "// parser.rb l.1430 and l.1519) before the slurp",
      "export const a = 1;",
      "",
    ].join("\n");
    const { citations } = findCitations("t.ts", source);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.ranges).toEqual([
      { start: 1430, end: 1430 },
      { start: 1519, end: 1519 },
    ]);
    // The line reported is the one the file name sits on, which is
    // where a reader has to go to fix it.
    expect(citations[0]?.line).toBe(2);
  });

  test("a deeply indented continuation line does not split a citation", () => {
    // The marker strip takes one space after ` * `; the rest of a
    // wrapped JSDoc list item's indent has to go too, or the join puts
    // an arbitrary gap in the middle of the citation.
    const source = [
      "/**",
      " * - the loop (parser.rb",
      " *       l.1430) sees it",
      " */",
      "export const a = 1;",
      "",
    ].join("\n");
    const { citations, unparsed } = findCitations("t.ts", source);
    expect(unparsed).toEqual([]);
    expect(citations[0]?.ranges).toEqual([{ start: 1430, end: 1430 }]);
  });

  test.each([
    ["a bare mention", "// the same fact parser.rb reads, in reverse\n"],
    ["prose after a colon", "// mirrors parser.rb: the read loop walks it\n"],
    ["prose after `line`", "// parser.rb line breaks are not citations\n"],
  ])("%s claims nothing and is not a failure", (_name, body) => {
    // A file name with no line after it is a MENTION. Turning ordinary
    // prose punctuation into a gate failure would be a trap in exactly
    // the place the docs promise safety.
    expect(findCitations("t.ts", `${body}export const a = 1;\n`)).toEqual({
      citations: [],
      unparsed: [],
      contextless: [],
    });
  });

  test("a citation inside a string literal is not read", () => {
    // Comments are taken from the PARSER's trivia, so code that
    // happens to contain the text of a citation is not one.
    const source = 'export const id = "lists_test.rb parser.rb:99";\n';
    expect(findCitations("t.ts", source).citations).toEqual([]);
  });

  test.each([
    ["an en dash", "// the item's read (parser.rb l.1404–1592) runs through\n"],
    [
      "a split hyphen",
      "// the item's read (parser.rb l.1404-\n// 1592) runs\n",
    ],
  ])("reports %s as unreadable rather than truncating it", (_name, body) => {
    const { citations, unparsed } = findCitations(
      "t.ts",
      `${body}export const a = 1;\n`,
    );
    expect(citations).toEqual([]);
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]?.spelling).toContain("1404");
  });
});

describe("a bare line reference and the file its comment is about", () => {
  test("takes the one file the comment names", () => {
    // The house style: name the file once, then write bare references
    // for the rest of the comment. Two out of five references in this
    // repository are written that way.
    const source = [
      "// `read_lines_for_list_item` (parser.rb l.1404-1592) erases the",
      "// `+` into `ListContinuationPlaceholder` (l.1439) and pops the",
      "// marked tail at l.1580-81.",
      "export const a = 1;",
      "",
    ].join("\n");
    const { citations, contextless } = findCitations("t.ts", source);
    expect(contextless).toEqual([]);
    expect(citations.map((one) => [one.file, one.ranges[0]?.start])).toEqual([
      ["parser.rb", 1404],
      ["parser.rb", 1439],
      ["parser.rb", 1580],
    ]);
  });

  test("a comment naming NO file leaves its bare references unresolved", () => {
    const source =
      "// Ruby erases the `+` there (l.1439).\nexport const a = 1;\n";
    const { citations, contextless } = findCitations("t.ts", source);
    expect(citations).toEqual([]);
    expect(contextless).toHaveLength(1);
    expect(contextless[0]?.spelling).toBe("l.1439");
  });

  test("a comment naming TWO files leaves them unresolved too", () => {
    // Picking the nearer name is how a citation ends up checked
    // against the wrong file and PASSING: parser.js has a line 1125 as
    // surely as parser.rb does.
    const source = [
      "// the JS oracle's strict `===` (parser.js l.2168), and",
      "// `parse_list`'s `skip_blank_lines || break` at l.1125 in",
      "// parser.rb consumes it",
      "export const a = 1;",
      "",
    ].join("\n");
    const { citations, contextless } = findCitations("t.ts", source);
    expect(citations.map((one) => one.file)).toEqual(["parser.js"]);
    expect(contextless.map((one) => one.spelling)).toEqual(["l.1125"]);
  });

  test("a one-digit bare reference is not a line reference", () => {
    // `:1` in prose is punctuation far more often than it is a
    // citation, and no file this repository cites has anything worth
    // naming on line 1 through 9.
    const source =
      "// parser.rb maps {'a':1} onto the buffer\nexport const a = 1;\n";
    expect(findCitations("t.ts", source)).toEqual({
      citations: [],
      unparsed: [],
      contextless: [],
    });
  });
});

describe("the identifier candidates a comment offers", () => {
  test("takes Ruby method, constant and regexp names", () => {
    const candidates = identifierCandidates(
      "sub_quotes runs QUOTE_SUBS, whose rows ExtAtxSectionTitleRx does not",
      "parser.rb",
    );
    expect(candidates).toContain("sub_quotes");
    expect(candidates).toContain("QUOTE_SUBS");
    expect(candidates).toContain("ExtAtxSectionTitleRx");
  });

  test("takes the oracle build's underscored table names", () => {
    expect(
      identifierCandidates("transcribed as `_normalQuoteSubs`", "index.cjs"),
    ).toContain("_normalQuoteSubs");
  });

  test("does not take file names or paths", () => {
    const candidates = identifierCandidates(
      "attribute_list.rb l.30-34, transcribed in src/parse/attrlist.ts",
      "attribute_list.rb",
    );
    expect(candidates).not.toContain("attribute_list");
    expect(candidates).not.toContain("attrlist");
  });

  test("takes lowerCamelCase against JavaScript and not against Ruby", () => {
    // The cited file's LANGUAGE decides. `readParagraphLines` is a name
    // in the oracle; against the Ruby, bare lowerCamelCase is only ever
    // one of ours, and taking it turned eight citations red the day it
    // was tried.
    const comment = "the confined read (`readParagraphLines`) folds them";
    expect(identifierCandidates(comment, "parser.js")).toContain(
      "readParagraphLines",
    );
    expect(identifierCandidates(comment, "parser.rb")).not.toContain(
      "readParagraphLines",
    );
  });

  test("does not take a bare capitalized word", () => {
    expect(
      identifierCandidates("Ruby pops it there", "parser.rb"),
    ).not.toContain("Ruby");
  });
});

/**
 * Build a citation for a check test.
 * @param comment - the citing comment, flattened
 * @param ranges - the ranges it names
 * @returns the citation
 */
function cite(comment: string, ranges: CitedRange[]): Citation {
  return {
    file: "parser.rb",
    ranges,
    spelling: "parser.rb:1",
    source: "t.ts",
    line: 1,
    comment,
  };
}

// A stand-in for a cited Ruby file: a method with a body, a constant
// beside it, and a second class whose own constants sit far enough
// inside it to tell a SIBLING header from an ENCLOSING one. Written out
// here rather than read from the vendored sources, so these rows keep
// their meaning when the pin moves.
const RUBY: readonly string[] = [
  "module Asciidoctor", // 1
  "class Parser", // 2
  "  def self.read_lines_for_list_item reader, list_type", // 3
  "    buffer = []", // 4
  "    while reader.has_more_lines?", // 5
  "      this_line = reader.read_line", // 6
  "      if ListContinuationMarker === this_line", // 7
  "        continuation = :frozen", // 8
  "      end", // 9
  "      buffer << this_line", // 10
  "    end", // 11
  "    buffer", // 12
  "  end", // 13
  "", // 14
  "  ADMONITION_STYLES = ['NOTE', 'TIP'].to_set", // 15
  "end", // 16
  "", // 17
  "class AttributeList", // 18
  String.raw`  APOS = '\''`, // 19
  String.raw`  BACKSLASH = '\\'`, // 20
  `  QUOT = '"'`, // 21
  "", // 22
  "  # Public: Regular expressions for the boundary of a value", // 23
  "  BoundaryRx = {", // 24
  String.raw`    QUOT => /.*?[^\\](?=")/,`, // 25
  "  }", // 26
  "end", // 27
  "end", // 28
];

describe("checking one citation against the file it names", () => {
  test("a line past the end of the file is a failure", () => {
    const checked = checkCitation(
      cite("the loop (parser.rb:99)", [{ start: 99, end: 99 }]),
      RUBY,
      IDENTIFIER_WINDOW,
    );
    expect(checked.failures).toHaveLength(1);
    expect(checked.failures[0]).toContain("28 lines");
  });

  test("the last line of the file is not past the end", () => {
    expect(
      checkCitation(cite("", [{ start: 28, end: 28 }]), RUBY, IDENTIFIER_WINDOW)
        .failures,
    ).toEqual([]);
  });

  test("a name inside the window anchors the citation", () => {
    expect(
      checkCitation(
        cite("frozen by `ListContinuationMarker`", [{ start: 7, end: 7 }]),
        RUBY,
        IDENTIFIER_WINDOW,
      ),
    ).toEqual({ failures: [], anchored: true });
  });

  test("the enclosing method's name anchors a line in its body", () => {
    // The common case: a citation points at a line in the middle of a
    // long method and the comment names the METHOD. Five lines either
    // side would never reach the `def`.
    expect(
      checkCitation(
        cite("`read_lines_for_list_item` buffers it", [{ start: 10, end: 10 }]),
        RUBY,
        IDENTIFIER_WINDOW,
      ),
    ).toEqual({ failures: [], anchored: true });
  });

  test("the enclosing CLASS anchors a line whose nearest header is a sibling", () => {
    // `BoundaryRx` at line 24 has `QUOT` three lines above it, so the
    // body slice starts there and stops short of `class AttributeList`
    // at 18. The enclosing chain is what carries the class name in.
    expect(
      checkCitation(
        cite("the interior spacing `AttributeList` applies", [
          { start: 24, end: 26 },
        ]),
        RUBY,
        IDENTIFIER_WINDOW,
      ),
    ).toEqual({ failures: [], anchored: true });
  });

  test("a name that is nowhere near the cited line is a failure", () => {
    const checked = checkCitation(
      cite("the `ADMONITION_STYLES` set", [{ start: 4, end: 4 }]),
      RUBY,
      IDENTIFIER_WINDOW,
    );
    expect(checked.anchored).toBe(true);
    expect(checked.failures[0]).toContain("ADMONITION_STYLES");
  });

  test("a name in ANY of a multi-range citation's windows anchors it", () => {
    expect(
      checkCitation(
        cite("the `ADMONITION_STYLES` set", [
          { start: 4, end: 4 },
          { start: 15, end: 15 },
        ]),
        RUBY,
        IDENTIFIER_WINDOW,
      ).failures,
    ).toEqual([]);
  });

  test("a comment that names nothing is unanchored, not failed", () => {
    // Nothing to look for is not the same as looking and not finding.
    // The range check still ran; the identifier check could not.
    expect(
      checkCitation(
        cite("the loop reads it once more", [{ start: 4, end: 4 }]),
        RUBY,
        IDENTIFIER_WINDOW,
      ),
    ).toEqual({ failures: [], anchored: false });
  });

  test("the window is the caller's, not a constant of the check", () => {
    const citation = cite("`ADMONITION_STYLES` again", [{ start: 4, end: 4 }]);
    expect(checkCitation(citation, RUBY, 11).failures).toEqual([]);
  });
});

describe("the vendored Ruby the gate reads", () => {
  // Not a test of the gate but of its INPUT: without these files every
  // Ruby citation is unverifiable, and the failure mode of a botched
  // vendoring is a checker that quietly checks nothing.
  test.each(RUBY_FILES)("%s is vendored and looks like Ruby", (name) => {
    const where = path.join(ROOT, RUBY_DIRECTORY, name);
    expect(existsSync(where)).toBe(true);
    expect(readFileSync(where, "utf8")).toContain("module Asciidoctor");
  });

  test("the upstream licence travels with the sources", () => {
    const licence = path.join(ROOT, RUBY_DIRECTORY, "LICENSE");
    expect(readFileSync(licence, "utf8")).toContain("MIT License");
  });
});
