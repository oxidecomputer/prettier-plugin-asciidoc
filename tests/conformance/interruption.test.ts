import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";
import {
  interruptsByLineShape,
  interruptsParagraph,
  isDelimiterLine,
  isRawParagraphLine,
  type ParagraphContext,
  type ReaderContext,
} from "../../src/parse/line-shapes.js";
import { classifyLine } from "../../src/parse/lines/classify.js";
import {
  continuesParagraph,
  CONSTRUCTS,
  oracleInterrupts,
  POSITIONS,
} from "./interruption-probes.js";
import { parse } from "../../src/parser.js";

// The registry in src/parse/line-shapes.ts is our MODEL of Asciidoctor's
// paragraph-interruption rules. This test pins the model to the oracle:
// for every construct, in both contexts, the registry's verdict must equal
// what Asciidoctor actually does. Add a row whenever a new line-shaped
// construct is implemented — the reader's paragraph loop and the
// reflow guards both consume this registry, so a wrong row is a wrong
// formatter.

// The document shape each context is probed in. `listContinuation` is
// the paragraph a `+` attaches to a list item — a third rule set, not a
// blend of the other two (see ParagraphContext in line-shapes.ts).
// `dlistItem`'s prefix carries an inline description, so that an
// interruption shows up as a block-count growth the same way it does
// in the other contexts; after a BARE `term::` there is no open
// paragraph for the count to grow out of.
// `literalParagraph`'s prefix is an indented line, which is the only
// way to open one (`next_block`'s `indented && !style` branch).
// `listItemText` is the item's FIRST block, so its prefix is the
// marker line alone; `listItem` is a LATER block, so its prefix must
// spend the first one first. A block macro is what spends it: it
// gives `next_block` an image block, which `fold_first` refuses
// (parser.rb l.1384 folds a `:paragraph` alone), so `para line`
// below it opens a second block rather than continuing the first.
const CONTEXT_PREFIX: Record<ParagraphContext, string> = {
  paragraph: "first line",
  listItemText: "* item",
  listItem: "* item\nimage::a.png[]\npara line",
  listContinuation: "* item\n+\npara line",
  dlistItem: "term1:: desc",
  // The TEXTLESS term line, whose description Ruby reads with
  // `text_only` set. There is no inline description for the block
  // count to grow out of, and none is needed: the baseline
  // renders one `dd` holding `last line`, and an interruption
  // adds a block beside it.
  dlistItemTextOnly: "term1::",
  literalParagraph: "  indented first",
  // The prefix must already contain the style line AND one content
  // line: probing from the style line alone would test the
  // OPENING-line dispatch (step 7c's territory), where `----`, `====`,
  // `|===`, `== T` and `:a: b` open something else entirely.
  verbatimStyled: "[source]\nfirst content line",
};

// The open list's marker style for each prefix, in the spelling
// listMarkerStyle() produces. Only a marker belonging to a list that is
// actually OPEN ends a continuation paragraph, so the registry has to
// be told which one that is.
const CONTEXT_LIST_STYLE: Record<ParagraphContext, string | undefined> = {
  paragraph: undefined,
  listItemText: undefined,
  listItem: undefined,
  listContinuation: "*",
  dlistItem: undefined,
  dlistItemTextOnly: undefined,
  literalParagraph: undefined,
  verbatimStyled: undefined,
};

// Every context a line can be classified in, in one place so the two
// suites below cannot drift into probing different sets.
const ALL_CONTEXTS: ParagraphContext[] = [
  "paragraph",
  "listItemText",
  "listItem",
  "listContinuation",
  "dlistItem",
  "dlistItemTextOnly",
  "literalParagraph",
  "verbatimStyled",
];

// The contexts the FORMATTER is round-tripped in at the bottom of this
// file — every one the classifier knows, now that the BlockReader
// groups literal paragraphs itself.
const FORMATTED_CONTEXTS: ParagraphContext[] = ALL_CONTEXTS;

// Every context crossed with every position, flattened into one list
// so the suite below nests one describe deep instead of two.
// [context, position name, filler, first-line?]
const PROBES: Array<[ParagraphContext, string, string, boolean]> =
  ALL_CONTEXTS.flatMap((context) =>
    POSITIONS.map(
      ([position, filler, firstLine]): [
        ParagraphContext,
        string,
        string,
        boolean,
      ] => [context, position, filler, firstLine],
    ),
  );

// Every row below is expected to agree with the oracle exactly. There
// is no divergence escape hatch on purpose: the last one — a block
// macro on a list item's first text line, which core 2.0.20 folded
// into the item text and core 2.0.26 opens a block for — was closed by
// conforming the registry (issue #48), not by recording it. A new
// disagreement is a src/ change, not a row here.
describe("line-shape registry matches the Asciidoctor oracle", () => {
  describe.each(PROBES)("%s, %s", (context, _position, filler, firstLine) => {
    test.each(CONSTRUCTS)("%s", async (_name, construct) => {
      const [line] = construct.split("\n");
      const oracle = await oracleInterrupts(
        construct,
        CONTEXT_PREFIX[context],
        filler,
      );
      // vitest's expect() accepts an optional message as its second
      // argument (see vitest/valid-expect in eslint.config.js).
      expect(
        interruptsParagraph(line, context, {
          openParagraph: context,
          openListStyle: CONTEXT_LIST_STYLE[context],
          firstLineAfterStart: firstLine,
          nextLine: undefined,
        }),
        `registry disagrees with oracle for ${JSON.stringify(line)}`,
      ).toBe(oracle);
    });
  });
});

// The suite above pins `interruptsParagraph`, one predicate in the
// registry. This one pins the function the READER will call, which
// consults that registry but also orders every other line shape around
// it — so an ordering mistake in classifyLine shows up here even when
// the registry row it consults is right. Both line positions are
// probed for the same reason the registry suite probes both: several
// shapes only mean anything on a block's first line.
describe("classifyLine matches the Asciidoctor oracle", () => {
  describe.each(PROBES)("%s, %s", (context, _position, filler, firstLine) => {
    test.each(CONSTRUCTS)("%s", async (_name, construct) => {
      const [line] = construct.split("\n");
      const reader: ReaderContext = {
        openParagraph: context,
        openListStyle: CONTEXT_LIST_STYLE[context],
        firstLineAfterStart: firstLine,
        // Every probe here has a block OPEN above the construct, and
        // the setext arm belongs to a section's block start alone.
        nextLine: undefined,
      };
      const oracle = await oracleInterrupts(
        construct,
        CONTEXT_PREFIX[context],
        filler,
      );
      expect(
        continuesParagraph(classifyLine(line, reader)),
        `classifier disagrees with oracle for ${JSON.stringify(line)} in ${context}`,
      ).toBe(!oracle);
    });
  });
});

// The description-list terms are the one rule interruptsByLineShape
// leaves out: they interrupt from any column of a list-item line and
// from none of a paragraph's, so reflow guards them by output line
// instead (see src/print/reflow.ts).
const WORD_BASED_CONSTRUCTS = new Set([
  "dlist term",
  "dlist term (:::)",
  "dlist term (::::)",
  "dlist term (;;)",
  "dlist term (bare ::)",
  "dlist term (multi-word)",
]);

// interruptsByLineShape claims to be the union over every context —
// reflow relies on that claim, because it does not know which kind of
// paragraph it is printing. Pinned to the oracle rather than to the
// registry's internals: the union must be true exactly when SOME
// context's oracle interrupts.
/**
 * Whether the oracle treats `construct` as an interruption in ANY
 * context and position — the claim interruptsByLineShape makes.
 * @param construct - the candidate line-shaped construct
 * @returns true when some probe saw a new block
 */
async function oracleInterruptsSomewhere(construct: string): Promise<boolean> {
  // Every probe is rendered before any is inspected: `Array#some`
  // cannot short-circuit on promises, and the oracle is async.
  const interrupted = await Promise.all(
    PROBES.map(
      async ([context, , filler]) =>
        await oracleInterrupts(construct, CONTEXT_PREFIX[context], filler),
    ),
  );
  return interrupted.includes(true);
}

describe("the line-shape union reflow consumes", () => {
  test.each(CONSTRUCTS)("%s", async (name, construct) => {
    const [line] = construct.split("\n");
    expect(
      interruptsByLineShape(line),
      `union disagrees with oracle for ${JSON.stringify(line)}`,
    ).toBe(
      (await oracleInterruptsSomewhere(construct)) &&
        !WORD_BASED_CONSTRUCTS.has(name),
    );
  });
});

// `BlockAttributeLineRx` is `^\[(?:|[\w.#%{,"']CC_ANY*|\[…\])\]$`.
// Two halves of that are easy to lose: the FIRST character class,
// and `CC_ANY` matching `]`. The oracle shows both — an attribute
// line is consumed as metadata and its text vanishes, while ordinary
// bracketed text stays in the paragraph and keeps it whole.
/**
 * Counts the `<p>` elements the oracle emitted.
 * @param html - normalized HTML from {@link renderedHtml}
 * @returns the number of paragraphs
 */
function paragraphCount(html: string): number {
  return (html.match(/<p>/gv) ?? []).length;
}

describe("the block attribute line's exact shape", () => {
  test.each([
    ["[]", true],
    ["[a]b]", true],
    ["[#id]", true],
    ["[+1]", false],
    ["[*bold*]", false],
    ["[ ]", false],
  ])("%s", async (line, isAttributeLine) => {
    expect(interruptsParagraph(line, "paragraph")).toBe(isAttributeLine);
    // An attribute line splits the paragraph in two; text keeps it
    // as one. (Counting `<p>` rather than looking for the line's own
    // characters, which inline substitutions may rewrite.)
    const html = await renderedHtml(`para\n${line}\nmore\n`);
    expect(paragraphCount(html), html).toBe(isAttributeLine ? 2 : 1);
  });
});

// Every rule in the registry matches an already-rstripped line, so
// which characters rstrip removes is part of the registry's contract.
// The pinned oracle's set is the six ASCII whitespace characters and
// nothing else (`line.replace(/[ \t\r\n\f\v]+$/, '')`), which is
// MRI's set less the NUL: src/parse/line-shapes.ts#rstrip spells the
// same six. Both halves are oracle rows here — the characters that go
// and the characters that stay — because a set is only pinned when
// its complement is too.
describe("rstrip runs before every line rule", () => {
  test.each([
    ["a space", "---- "],
    ["a tab", "----\t"],
    ["a carriage return (CRLF input)", "----\r"],
    ["a form feed", "----\f"],
    ["a vertical tab", "----\v"],
  ])("%s after a delimiter still delimits", async (_name, delimiter) => {
    expect(isDelimiterLine(delimiter), JSON.stringify(delimiter)).toBe(true);
    expect(await renderedHtml(`${delimiter}\ncode\n----\n`)).toBe(
      await renderedHtml("----\ncode\n----\n"),
    );
  });

  // The complement, and the rows issue #49 closed: a NUL and a
  // no-break space used to be stripped here and are not stripped by
  // the pinned oracle, so both now READ AS TEXT on both sides. The
  // rest of the row set is every other space-like character the
  // oracle keeps, so a future widening of the set back towards
  // JavaScript's `\s` fails here rather than in the corpus.
  test.each([
    ["a NUL", "----\u{0}"],
    ["a no-break space", "----\u{A0}"],
    ["an ogham space mark", "----\u{1680}"],
    ["an en quad", "----\u{2000}"],
    ["a figure space", "----\u{2007}"],
    ["a thin space", "----\u{2009}"],
    ["a narrow no-break space", "----\u{202F}"],
    ["a medium mathematical space", "----\u{205F}"],
    ["a line separator", "----\u{2028}"],
    ["a paragraph separator", "----\u{2029}"],
    ["an ideographic space", "----\u{3000}"],
    ["a zero-width space", "----\u{200B}"],
    ["a byte-order mark", "----\u{FEFF}"],
  ])("%s after a delimiter delimits for neither", async (_name, line) => {
    expect(isDelimiterLine(line), JSON.stringify(line)).toBe(false);
    expect(await renderedHtml(`${line}\ncode\n----\n`)).not.toBe(
      await renderedHtml("----\ncode\n----\n"),
    );
  });

  // The same set read from the other side: inside a listing block,
  // where the only substitution is specialchars, a surviving
  // character comes back verbatim and a stripped one does not.
  test.each([
    ["a NUL survives", "\u{0}", true],
    ["a no-break space survives", "\u{A0}", true],
    ["a line separator survives", "\u{2028}", true],
    ["an ideographic space survives", "\u{3000}", true],
    ["a byte-order mark survives", "\u{FEFF}", true],
    ["a space is stripped", " ", false],
    ["a tab is stripped", "\t", false],
    ["a vertical tab is stripped", "\v", false],
    ["a form feed is stripped", "\f", false],
  ])(
    // The disposition rides in the row NAME: printf substitution
    // assigns each specifier to the next argument, so a trailing `%j`
    // would print the CHARACTER and every row would read "survives".
    "%s at the end of verbatim content",
    async (_name, char, survives) => {
      const html = await renderedHtml(`----\nX${char}\n----\n`);
      expect(html.includes(`X${char}`), html).toBe(survives);
    },
  );
});

// Asciidoctor's prepare_source drops ONE leading byte-order mark from
// the whole document before the reader sees a line, so a BOM ahead of
// `= Title` leaves a document title rather than demoting it to a
// paragraph (issue #60). The reader does the same in
// src/parse/lines/split.ts; these rows are the oracle's own answers
// for the edges — one mark, not two, at offset 0 only.
describe("prepare_source strips a leading byte-order mark", () => {
  const BOM = "\u{FEFF}";
  test("a BOM ahead of the title leaves the title standing", async () => {
    expect(await renderedHtml(`${BOM}= Title\n\nbody\n`)).toBe(
      await renderedHtml("= Title\n\nbody\n"),
    );
  });
  test("a document of nothing but a BOM renders nothing", async () => {
    expect(await renderedHtml(BOM)).toBe("");
  });
  test("the misdecoded three-character BOM goes too", async () => {
    expect(await renderedHtml("\u{EF}\u{BB}\u{BF}= Title\n\nbody\n")).toBe(
      await renderedHtml("= Title\n\nbody\n"),
    );
  });
  test("a SECOND BOM is ordinary text", async () => {
    expect(await renderedHtml(`${BOM}${BOM}= Title\n`)).toContain(
      `<p>${BOM}= Title</p>`,
    );
  });
  test("a BOM away from offset 0 is ordinary text", async () => {
    const html = await renderedHtml(`= Title\n\n${BOM}para\n`);
    expect(html).toContain(`${BOM}para`);
  });
  test("the BOM goes and the space behind it stays", async () => {
    expect(await renderedHtml(`${BOM} = Title\n`)).toBe(
      await renderedHtml(" = Title\n"),
    );
  });
  // The parser's own answer for the row that names the issue: the
  // first line is a document title, not a paragraph. Read through
  // parse() rather than through Prettier, which strips a BOM of its
  // own before any plugin is called.
  test("the reader reads a document title through the mark", () => {
    const [block] = parse(`${BOM}= Title\n`).children;
    expect(block.type).toBe("documentHeader");
  });
});

describe("raw (non-text, non-interrupting) paragraph lines", () => {
  // These lines vanish from rendered output — Asciidoctor drops comments
  // and consumes preprocessor directives while reading — so the formatter
  // must keep them verbatim on their own line rather than reflow them into
  // visible text.
  test.each([
    "// a comment",
    "ifdef::flag[]",
    "endif::[]",
    "include::missing.adoc[]",
  ])("%s is raw", (line) => {
    expect(isRawParagraphLine(line), line).toBe(true);
  });

  // Oracle corroboration: a raw line's text must NOT appear as
  // paragraph text. An unresolved include is left out — a real
  // oracle surprise, not a registry bug: Asciidoctor substitutes an
  // "Unresolved directive ... - include::missing.adoc[]" sentence
  // into the surrounding paragraph, so the directive's own text
  // legitimately leaks through for that one failure mode. See the
  // comment on the include pattern in PARAGRAPH_RAW_LINES
  // (src/parse/line-shapes.ts).
  test.each(["// a comment", "ifdef::flag[]", "endif::[]"])(
    "%s leaves no text behind",
    async (line) => {
      const html = await renderedHtml(`first line\n${line}\nlast line\n`);
      expect(html.includes(line), `${line} leaked into output`).toBe(false);
    },
  );

  test.each([":name: value", "NOTE: x", "image::a.png[]", "* item"])(
    "%s is text, not raw",
    (line) => {
      expect(isRawParagraphLine(line), line).toBe(false);
    },
  );

  // The block anchor is the one raw shape that depends on position:
  // in the block `fold_first` merges away it is that block's own
  // metadata, so the oracle emits no id and the formatter must keep
  // the line verbatim. One line further down the anchor keeps its id,
  // so it interrupts instead, and in every LATER block of the item
  // it interrupts wherever it stands, there being a first block
  // already.
  test("a block anchor is raw only inside the item's first block", () => {
    const first: ReaderContext = {
      openParagraph: "listItemText",
      openListStyle: undefined,
      firstLineAfterStart: true,
      nextLine: undefined,
    };
    expect(isRawParagraphLine("[[a]]", "listItemText", first)).toBe(true);
    expect(isRawParagraphLine("[[a]]", "listItemText")).toBe(false);
    expect(interruptsParagraph("[[a]]", "listItemText", first)).toBe(false);
    expect(interruptsParagraph("[[a]]", "listItemText")).toBe(true);
    expect(isRawParagraphLine("[[a]]", "listItem", first)).toBe(false);
    expect(interruptsParagraph("[[a]]", "listItem", first)).toBe(true);
  });
});

// Rows the FORMATTER still gets wrong, each tied to the gap issue
// that tracks it. A row here is a promise, not an excuse: when the
// issue is fixed the entry must be deleted, and the test below fails
// loudly if a listed row starts passing.
// EMPTY, and it stays a map rather than becoming a boolean: the
// `dlistItem` rows that were its last five entries are gone - each was
// a line a `term::` line owned being emitted at the top level or
// reflowed into the term's text, and a description is an ITEM now, so
// its recorded lines are written back where the author wrote them and
// each construct keeps the line and the column that decide what it is.
const KNOWN_GAPS = new Map<string, string>();

/**
 * Key for the KNOWN_GAPS map.
 * @param context - the probed context
 * @param name - the construct's row name
 * @returns a stable `context/name` key
 */
function gapKey(context: ParagraphContext, name: string): string {
  return `${context}/${name}`;
}

// The registry test above pins what the READER should decide. This
// one pins what the FORMATTER actually does with the same documents:
// a correct verdict that the printer then mangles is still a bug, and
// without this the registry could drift into being right on paper
// only.
describe("the formatter round-trips every construct in every context", () => {
  describe.each(FORMATTED_CONTEXTS)("%s", (context) => {
    // The title carries the gap text so a listed gap is visible in
    // the run, and is precomputed into its own column because a
    // `test.each` title is a format string, not an expression.
    // [title, document, gap reason or undefined]
    const rows = CONSTRUCTS.map(
      ([name, construct]): [string, string, string | undefined] => {
        const { [context]: prefix } = CONTEXT_PREFIX;
        const gap = KNOWN_GAPS.get(gapKey(context, name));
        return [
          gap === undefined ? name : `${name} (known gap: ${gap})`,
          `${prefix}\n${construct}\nlast line\n`,
          gap,
        ];
      },
    );
    test.each(rows)("%s", async (_title, document, gap) => {
      const message =
        gap === undefined
          ? `formatting changed the rendering of ${JSON.stringify(document)}`
          : `${gap} is listed as a known gap but this row now passes — delete the KNOWN_GAPS entry`;
      const out = await formatAdoc(document);
      const faithful =
        (await renderedHtml(out)) === (await renderedHtml(document)) &&
        (await formatAdoc(out)) === out;
      expect(faithful, message).toBe(gap === undefined);
    });
  });
});
