/**
 * The document header, pinned against the oracle (issue #18).
 *
 * Our model of `parse_document_header` -> `parse_header_metadata`
 * (parser.rb) is a reading of Ruby, and the oracle is what decides
 * whether the reading is right. Two grids:
 *
 * - WHAT THE ORACLE READS. For each header shape, which lines reach
 *   `author` / `revdate` and which reach the BODY as blocks. These
 *   are the rows the design was built from: the author line gets no
 *   test at all, comments and `////` blocks are transparent, and a
 *   blank line is the only thing that ends the header.
 * - WHAT WE PRINT. Every shape formats to bytes that render
 *   identically and settle in one pass. The minimal repro of #18 is
 *   the first row.
 */
import { describe, test, expect } from "vitest";
import { LoggerManager, NullLogger, load } from "@asciidoctor/core";
import { formatAdoc, renderedHtml } from "../helpers.js";

const nullLogger = NullLogger.create();
LoggerManager.setLogger(nullLogger);

/** What the oracle made of a document's header and its blocks. */
interface OracleReading {
  /** The `author` attribute, or undefined when the header set none. */
  author: string | undefined;
  /** The `revdate` attribute, or undefined. */
  revdate: string | undefined;
  /** The `revnumber` attribute, or undefined. */
  revnumber: string | undefined;
  /** Each top-level block's context, in document order. */
  blocks: string[];
}

/**
 * Load a document through Asciidoctor and report what its header set
 * and what blocks are left in the body.
 * @param input - the document source
 * @returns the oracle's reading
 */
async function oracleReading(input: string): Promise<OracleReading> {
  const document = await load(input, { safe: "safe", logger: nullLogger });
  const attributes: unknown = document.getAttributes();
  return {
    author: attributeOf(attributes, "author"),
    revdate: attributeOf(attributes, "revdate"),
    revnumber: attributeOf(attributes, "revnumber"),
    blocks: document.getBlocks().map((block) => block.getContext()),
  };
}

/**
 * One document attribute, as a string. `getAttributes()` is typed as
 * an `any` map, so the read is guarded here rather than asserted.
 * @param attributes - what `getAttributes()` returned
 * @param name - the attribute name
 * @returns the value, or undefined when the header set none
 */
function attributeOf(attributes: unknown, name: string): string | undefined {
  if (typeof attributes !== "object" || attributes === null) return undefined;
  const value: unknown = Reflect.get(attributes, name);
  return typeof value === "string" ? value : undefined;
}

// The reachability grid as two tables of PREFIXES, expanded into
// rows below. A prefix decides whether `= T` under it opens a header
// or a level-0 section, and every one of these was measured against
// the oracle before it was written down.
//
// `[foo = bar]`, `[foo =bar]` and `[foo<TAB>=bar]` are here because
// `parse_attribute` scans the name, THEN skips blanks, THEN tests for
// `=` (attribute_list.rb:110-120), and the blanks it skips are
// `BlankRx`, `[ \t]+` (attribute_list.rb:46, and identically in the
// oracle at build/node/index.cjs:9932): the blanks are part of the
// named form, so none of those lines names a style. `[foo bar]` and
// `[foo bar = baz]` are the other side of that - a blank inside the
// NAME ends the scan, so both are positional and both are barriers.
//
// `[foo.bar = baz]` is a barrier because the NAME CLASS we follow is
// the pinned oracle's, `${CG_WORD}[${CC_WORD}\\-]*`
// (build/node/index.cjs:9929), which has no `.`. Ruby's `NameRx`
// does (attribute_list.rb:44) and would read the entry as named; this
// row is the pin that says which of the two we obey.
const HEADER_KEPT: ReadonlyArray<readonly [string, string]> = [
  ["empty", "[]"],
  ["id shorthand", "[#id]"],
  ["role shorthand", "[.role]"],
  ["option shorthand", "[%opt]"],
  ["role then id", "[.role#id]"],
  ["empty first entry", "[,bar]"],
  ["named id", "[id=x]"],
  ["named first entry, positional second", "[a=b,c]"],
  ["named separator", "[separator=::]"],
  ["blanks around the equals", "[foo = bar]"],
  ["blank before the equals", "[foo =bar]"],
  ["blank after the equals", "[foo= bar]"],
  ["a tab before the equals", "[foo\t=bar]"],
  ["a tab on both sides of the equals", "[foo \t = bar]"],
  ["an anchor", "[[x]]"],
  ["an anchor with reftext", "[[x,ref]]"],
];

// Losing the header does not always leave the same body: a plain
// style demotes `= T` to a level-0 SECTION that swallows what follows,
// where `[discrete]` makes it a floating title and leaves the author
// line and the body as two paragraphs beside it. Each row carries the
// block contexts the oracle actually reports, so the difference is
// pinned rather than averaged away.
const HEADER_LOST: ReadonlyArray<readonly [string, string, string[]]> = [
  ["a bare style", "[foo]", ["section"]],
  ["a style with a second positional", "[foo,bar]", ["section"]],
  ["an admonition style", "[NOTE]", ["section"]],
  ["a quote style with attribution", "[quote,Name]", ["section"]],
  ["a style with a blank in it", "[foo bar]", ["section"]],
  [
    "a blank-in-name entry that only looks named",
    "[foo bar = baz]",
    ["section"],
  ],
  [
    "a dotted name the oracle scans as positional",
    "[foo.bar = baz]",
    ["section"],
  ],
  ["a quoted style", '["foo"]', ["section"]],
  ["a style with shorthand after it", "[foo#id]", ["section"]],
  ["a block title", ".Cap", ["section"]],
  [
    "a discrete style, which floats the title instead",
    "[discrete]",
    ["floating_title", "paragraph", "paragraph"],
  ],
];

// Every row is `[name, source, what the oracle reads]`. The
// `blocks` entry is what the BODY keeps: a line consumed by the
// header is absent from it, which is the fact the whole issue turns
// on.
const READINGS: Array<[string, string, OracleReading]> = [
  [
    "the line under the title is the author",
    "= T\nAuthor Name <a@b.c>\n\nbody\n",
    {
      author: "Author Name",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "a blank line after the title ends the header",
    "= T\n\nAuthor Name <a@b.c>\n\nbody\n",
    {
      author: undefined,
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph", "paragraph"],
    },
  ],
  [
    "the second line is the revision",
    "= T\nA U Thor\nv1.0, 2026-08-26\n\nbody\n",
    {
      author: "A U Thor",
      revdate: "2026-08-26",
      revnumber: "1.0",
      blocks: ["paragraph"],
    },
  ],
  [
    "a bare date is a revision too",
    "= T\nA U Thor\n2026-08-26\n\nbody\n",
    {
      author: "A U Thor",
      revdate: "2026-08-26",
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "attribute entries between title and author are transparent",
    "= T\n:toc:\nAuthor Name <a@b.c>\n\nbody\n",
    {
      author: "Author Name",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "a comment between title and author is transparent",
    "= T\n// c\nAuthor Name <a@b.c>\n\nbody\n",
    {
      author: "Author Name",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "a block comment is transparent, blank lines inside it included",
    "= T\n////\n\nc\n////\nA U Thor\n\nbody\n",
    {
      author: "A U Thor",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "attribute entries after the author are still header material",
    "= T\nA U Thor\n:x: y\nv1.0\n\nbody\n",
    {
      author: "A U Thor",
      revdate: undefined,
      revnumber: "1.0",
      blocks: ["paragraph"],
    },
  ],
  // The author line is read with `reader.read_line` and no test:
  // these three are the proof, and they are why the scan's last arm
  // asks the classifier nothing.
  [
    "a list marker in the author slot is the author",
    "= T\n* item\n\nbody\n",
    {
      author: "* item",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "a section title in the author slot is the author",
    "= T\n== S\n\nbody\n",
    {
      author: "== S",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "an attribute-list line in the author slot is the author",
    "= T\n[foo]\nAuthor Name\n\nbody\n",
    {
      author: "[foo]",
      revdate: "Author Name",
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "there is no third slot: the fourth line is body",
    "= T\nA\nB\nC\n\nbody\n",
    {
      author: "A",
      revdate: "B",
      revnumber: undefined,
      blocks: ["paragraph", "paragraph"],
    },
  ],
  [
    "no title, no header",
    "Author Name <a@b.c>\n\nbody\n",
    {
      author: undefined,
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph", "paragraph"],
    },
  ],
  [
    "a level-0 title after body content is a section",
    "para\n\n= T\nAuthor Name\n\nbody\n",
    {
      author: undefined,
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph", "section"],
    },
  ],
  // The attribution spellings the design rests on, each pinned here
  // rather than only in the parser's own rows.
  [
    "semicolon-separated authors are one line",
    "= T\nA One <a@b.c>; B Two <d@e.f>\n\nbody\n",
    {
      author: "A One",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "an underscore in a name is not reversible, so the line stays verbatim",
    "= T\nFirst_Name Last\n\nbody\n",
    {
      author: "First Name Last",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "a bare version is a revision",
    "= T\nA U Thor\nv1.0\n\nbody\n",
    {
      author: "A U Thor",
      revdate: undefined,
      revnumber: "1.0",
      blocks: ["paragraph"],
    },
  ],
  [
    "a version, date and remark are one revision line",
    "= T\nA U Thor\nv1.0, 2026-08-26: first cut\n\nbody\n",
    {
      author: "A U Thor",
      revdate: "2026-08-26",
      revnumber: "1.0",
      blocks: ["paragraph"],
    },
  ],
  [
    "a comment between the two attribution lines is transparent",
    "= T\nA U Thor\n// c\nv1.0\n\nbody\n",
    {
      author: "A U Thor",
      revdate: undefined,
      revnumber: "1.0",
      blocks: ["paragraph"],
    },
  ],
  // What makes an attribute line a barrier is the STYLE, not the
  // brackets: shorthand alone and named attributes leave the header
  // standing, which is why the reader asks
  // `Attrlist.styleAttribute` rather than its first positional.
  //
  // The rule is the PINNED ORACLE's: Ruby 2.0.26 builds a header
  // under `[foo]` too (parser.rb:132 bails on a block title alone),
  // and it is @asciidoctor/core 4.0.11 that adds `|| blockAttrs.style`
  // (src/parser.js:180). These rows are what makes the divergence a
  // decision rather than an accident - and they are the net that
  // would have caught both reachability bugs the review found.
  ...HEADER_KEPT.map(([name, prefix]): [string, string, OracleReading] => [
    `${prefix} above the title leaves a header (${name})`,
    `${prefix}\n= T\nA U Thor\n\nbody\n`,
    {
      author: "A U Thor",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ]),
  ...HEADER_LOST.map(
    ([name, prefix, blocks]): [string, string, OracleReading] => [
      `${prefix} above the title loses the header (${name})`,
      `${prefix}\n= T\nA U Thor\n\nbody\n`,
      {
        author: undefined,
        revdate: undefined,
        revnumber: undefined,
        blocks,
      },
    ],
  ),
  // The two shapes where a non-barrier attribute line is followed by
  // something that EMITS A BLOCK before the title. The style question
  // is answered once, where the line is held; asking it again at the
  // push - where only the node kind is visible - retired the header
  // for `[#id]` and re-rendered the author line as body text.
  [
    "a non-barrier attribute list survives an attribute entry under it",
    "[#id]\n:x: y\n= T\nA U Thor\n\nbody\n",
    {
      author: "A U Thor",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "a non-barrier role survives an attribute entry under it",
    "[.role]\n:x: y\n= T\nA U Thor\n\nbody\n",
    {
      author: "A U Thor",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  [
    "a non-barrier attribute list survives a comment block under it",
    "[#id]\n////\nc\n////\n= T\nA U Thor\n\nbody\n",
    {
      author: "A U Thor",
      revdate: undefined,
      revnumber: undefined,
      blocks: ["paragraph"],
    },
  ],
  // A BARRIER stays a barrier across the same shapes: the bit it
  // cleared at hold time is not restored by anything below it.
  [
    "a style barrier is still a barrier with an attribute entry under it",
    "[foo]\n:x: y\n= T\nA U Thor\n\nbody\n",
    {
      author: undefined,
      revdate: undefined,
      revnumber: undefined,
      blocks: ["section"],
    },
  ],
  [
    "a block title is still a barrier with an attribute entry under it",
    ".Cap\n:x: y\n= T\nA U Thor\n\nbody\n",
    {
      author: undefined,
      revdate: undefined,
      revnumber: undefined,
      blocks: ["section"],
    },
  ],
];

describe("what the oracle reads as a header", () => {
  test.each(READINGS)("%s", async (_name, source, expected) => {
    expect(await oracleReading(source)).toEqual(expected);
  });
});

describe("what we print for a header", () => {
  test.each(READINGS)(
    "%s renders the same after formatting",
    async (_name, source) => {
      const formatted = await formatAdoc(source);
      expect(await renderedHtml(formatted)).toBe(await renderedHtml(source));
    },
  );

  test.each(READINGS)("%s settles in one pass", async (_name, source) => {
    const once = await formatAdoc(source);
    expect(await formatAdoc(once)).toBe(once);
  });

  // The minimal repro from the issue, spelled out: the blank line the
  // formatter used to insert between the title and the author line is
  // what demoted the author line to the first body paragraph.
  test("the repro round-trips byte for byte", async () => {
    const input = "= T\nAuthor Name <a@b.c>\n\nbody\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // A header line is never reflowed: it is line syntax, and a wrapped
  // author line would hand its second half to the revision slot.
  test("an over-wide author line is not wrapped", async () => {
    const long =
      "A Very Long Author Name Indeed That Runs Past Eighty Columns All By Itself <a@b.c>";
    const input = `= T\n${long}\n\nbody\n`;
    expect(await formatAdoc(input)).toBe(input);
  });

  // Inline marks in a header line stay bytes: the line is not
  // tokenized, so nothing re-serializes it.
  test("inline marks in an author line are not re-serialized", async () => {
    const input = "= T\nA *B* C <a@b.c>\n\nbody\n";
    expect(await formatAdoc(input)).toBe(input);
  });

  // A header attribute entry is normalized exactly like a body one -
  // the header owns the node, not the bytes.
  test("a header attribute entry is still normalized", async () => {
    expect(await formatAdoc("= T\nA U Thor\n:name!:\n\nbody\n")).toBe(
      "= T\nA U Thor\n:!name:\n\nbody\n",
    );
  });

  // When the header ends on a NON-blank line, the block below it
  // stays adjacent: a revision line `RevisionInfoLineRx` rejects is
  // unshifted straight back into the body, so the two lines may still
  // be one paragraph to Asciidoctor.
  test("a rejected revision line keeps its paragraph", async () => {
    const input = "= T\nA\n: rem\nmore\n\nbody\n";
    expect(await formatAdoc(input)).toBe(input);
    expect(await renderedHtml(await formatAdoc(input))).toBe(
      await renderedHtml(input),
    );
  });
});
