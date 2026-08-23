import { describe, test, expect } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";
import {
  interruptsByLineShape,
  interruptsParagraph,
  isDelimiterLine,
  isRawParagraphLine,
  type ParagraphContext,
} from "../../src/parse/line-shapes.js";
import {
  classifyLine,
  type LineKind,
  type ReaderContext,
} from "../../src/parse/lines/classify.js";

// The registry in src/parse/line-shapes.ts is our MODEL of Asciidoctor's
// paragraph-interruption rules. This test pins the model to the oracle:
// for every construct, in both contexts, the registry's verdict must equal
// what Asciidoctor actually does. Add a row whenever a new line-shaped
// construct is implemented — the reader's paragraph loop and the
// reflow guards both consume this registry, so a wrong row is a wrong
// formatter.

// [name, construct text (may be multi-line)]
const CONSTRUCTS: Array<[string, string]> = [
  ["unordered list marker", "* item"],
  ["ordered list marker", ". item"],
  ["callout list marker", "<1> item"],
  ["list continuation", "+"],
  ["block title", ".A title"],
  ["line comment", "// a comment"],
  ["attribute entry", ":name: value"],
  ["block attribute list", "[source]"],
  // BlockAttributeLineRx is narrow about the FIRST character inside
  // the brackets: `[+1]` and `[*bold*]` are ordinary text, which a
  // `[^\]]*` pattern gets wrong in the interrupting direction. The
  // two shapes that ARE attribute lines are pinned separately below
  // (blockCount cannot see them in a list item, where `fold_first`
  // merges the block they open straight back into the item text).
  ["bracketed text (leading +)", "[+1]"],
  ["bracketed text (leading *)", "[*bold*]"],
  ["block anchor", "[[anchor]]"],
  ["listing delimiter", "----\ncode\n----"],
  ["literal delimiter", "....\nlit\n...."],
  ["pass delimiter", "++++\np\n++++"],
  ["example delimiter", "====\nex\n===="],
  ["sidebar delimiter", "****\nsb\n****"],
  ["quote delimiter", "____\nq\n____"],
  ["comment block delimiter", "////\nc\n////"],
  ["open block delimiter", "--\nob\n--"],
  ["fenced code", "```\nc\n```"],
  ["table delimiter (psv)", "|===\n|a\n|==="],
  ["table delimiter (csv)", ",===\na,b\n,==="],
  ["table delimiter (dsv)", ":===\na:b\n:==="],
  ["table delimiter (nested)", "!===\n!a\n!==="],
  ["indented line", "  wrapped continuation"],
  ["admonition marker", "NOTE: note text"],
  ["conditional directive", "ifdef::flag[]\nx\nendif::[]"],
  ["include directive", "include::missing.adoc[]"],
  ["block macro", "image::a.png[]"],
  ["dlist term", "term:: definition"],
  // The other separator spellings are separate branches of
  // DLIST_SEPARATOR_WORD's alternation, so each is pinned to the
  // oracle in its own right rather than by analogy with `::`.
  ["dlist term (:::)", "term::: definition"],
  ["dlist term (::::)", "term:::: definition"],
  ["dlist term (;;)", "term;; definition"],
  // Ruby's term group spans the LINE, not the word, so the separator
  // may stand alone (`<dt>foo </dt>`) and the term may hold spaces.
  ["dlist term (bare ::)", "x :: definition"],
  ["dlist term (multi-word)", "a multi word term:: definition"],
  ["thematic break", "'''"],
  ["page break", "<<<"],
  ["section marker", "== Section"],
];

/**
 * Counts block-level elements the oracle emitted. An interrupting
 * line produces at least one more block (or list item) than the
 * baseline two-line paragraph / one-item list does, so comparing
 * counts is a construct-agnostic way to detect "did this interrupt".
 * @param html - normalized HTML from {@link renderedHtml}
 * @returns the number of block-level tags found in the markup
 */
function blockCount(html: string): number {
  // `dt`/`dd` are counted because a sibling description-list TERM is
  // the one interruption that adds no other block: `term1::` /
  // `term:: def` renders as two `<dt>` inside the same `<dl>`.
  return (html.match(/<(?:p|div|ul|ol|dl|dt|dd|pre|h\d|hr|li|table)\b/gv) ?? [])
    .length;
}

// The document shape each context is probed in. `listContinuation` is
// the paragraph a `+` attaches to a list item — a third rule set, not a
// blend of the other two (see ParagraphContext in line-shapes.ts).
// `dlistItem`'s prefix carries an inline description, so that an
// interruption shows up as a block-count growth the same way it does
// in the other contexts; after a BARE `term::` there is no open
// paragraph for the count to grow out of.
// `literalParagraph`'s prefix is an indented line, which is the only
// way to open one (`next_block`'s `indented && !style` branch).
const CONTEXT_PREFIX: Record<ParagraphContext, string> = {
  paragraph: "first line",
  listItem: "* item",
  listContinuation: "* item\n+\npara line",
  dlistItem: "term1:: desc",
  literalParagraph: "  indented first",
  // The prefix must already contain the style line AND one content
  // line: probing from the style line alone would test the
  // OPENING-line dispatch (step 7c's territory), where `----`, `====`,
  // `|===`, `== T` and `:a: b` open something else entirely.
  verbatimStyled: "[source]\nfirst content line",
};

// The enclosing list ancestry of each prefix, in the marker-style
// spelling listMarkerStyle() produces. Only a marker belonging to a
// list that is actually OPEN ends a continuation paragraph, so the
// registry has to be told which those are.
const CONTEXT_LIST_STYLES: Record<ParagraphContext, readonly string[]> = {
  paragraph: [],
  listItem: [],
  listContinuation: ["*"],
  dlistItem: [],
  literalParagraph: [],
  verbatimStyled: [],
};

// WHERE the construct sits inside the open block. Several shapes
// only mean anything on the first line after the block started —
// `next_block` reads that line to pick a block context, and from the
// second line on `read_paragraph_lines` no longer knows any of them.
// Probing one position would let a registry claim be half true, so
// every row is asserted in both. [name, filler lines, first-line?]
const POSITIONS: Array<[string, string, boolean]> = [
  ["directly after the block start", "", true],
  ["on a later line", "mid line\n", false],
];

/**
 * Asks the Asciidoctor oracle whether inserting `construct` between
 * two text lines (in the given context and position) started a new
 * block/item.
 * @param construct - the candidate line-shaped construct, as it
 *   would appear verbatim in source (may itself span multiple lines)
 * @param context - which document shape to probe in (plain paragraph,
 *   list-item text, or a `+`-attached continuation paragraph), which
 *   changes both the baseline document and the interrupting set
 * @param filler - lines inserted between the prefix and the
 *   construct, pushing it off the block's first line (see POSITIONS)
 * @returns true when the oracle's block count grew, i.e. Asciidoctor
 *   treated `construct` as ending the open paragraph/item text
 */
function oracleInterrupts(
  construct: string,
  context: ParagraphContext,
  filler: string,
): boolean {
  const { [context]: prefix } = CONTEXT_PREFIX;
  const baseline = renderedHtml(`${prefix}\n${filler}last line\n`);
  const withConstruct = renderedHtml(
    `${prefix}\n${filler}${construct}\nlast line\n`,
  );
  return blockCount(withConstruct) > blockCount(baseline);
}

// Every context a line can be classified in, in one place so the two
// suites below cannot drift into probing different sets.
const ALL_CONTEXTS: ParagraphContext[] = [
  "paragraph",
  "listItem",
  "listContinuation",
  "dlistItem",
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

describe("line-shape registry matches the Asciidoctor oracle", () => {
  describe.each(PROBES)("%s, %s", (context, _position, filler, firstLine) => {
    test.each(CONSTRUCTS)("%s", (_name, construct) => {
      const [line] = construct.split("\n");
      // vitest's expect() accepts an optional message as its second
      // argument (see vitest/valid-expect in eslint.config.js).
      expect(
        interruptsParagraph(line, context, {
          enclosingListStyles: CONTEXT_LIST_STYLES[context],
          firstLineAfterBlockStart: firstLine,
        }),
        `registry disagrees with oracle for ${JSON.stringify(line)}`,
      ).toBe(oracleInterrupts(construct, context, filler));
    });
  });
});

/**
 * Whether a line kind lets the open paragraph keep going. Text does,
 * and so does a raw line — the reader consumes comments, preprocessor
 * directives and the folded-away block anchor without ever ending a
 * block. Every other kind is something the reader has to act on, which
 * means the paragraph stopped.
 * @param kind - the classifier's verdict for one line
 * @returns true when the paragraph continues through the line
 */
function continuesParagraph(kind: LineKind): boolean {
  return kind.kind === "text" || kind.kind === "raw";
}

// The suite above pins `interruptsParagraph`, one predicate in the
// registry. This one pins the function the READER will call, which
// consults that registry but also orders every other line shape around
// it — so an ordering mistake in classifyLine shows up here even when
// the registry row it consults is right. Both line positions are
// probed for the same reason the registry suite probes both: several
// shapes only mean anything on a block's first line.
describe("classifyLine matches the Asciidoctor oracle", () => {
  describe.each(PROBES)("%s, %s", (context, _position, filler, firstLine) => {
    test.each(CONSTRUCTS)("%s", (_name, construct) => {
      const [line] = construct.split("\n");
      const reader: ReaderContext = {
        openParagraph: context,
        openListStyles: CONTEXT_LIST_STYLES[context],
        firstLineAfterStart: firstLine,
      };
      expect(
        continuesParagraph(classifyLine(line, reader)),
        `classifier disagrees with oracle for ${JSON.stringify(line)} in ${context}`,
      ).toBe(!oracleInterrupts(construct, context, filler));
    });
  });
});

// The description-list terms are the one rule interruptsByLineShape
// leaves out: they interrupt from any column of a list-item line and
// from none of a paragraph's, so reflow guards them by output line
// instead (see src/reflow.ts).
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
function oracleInterruptsSomewhere(construct: string): boolean {
  return PROBES.some(([context, , filler]) =>
    oracleInterrupts(construct, context, filler),
  );
}

describe("the line-shape union reflow consumes", () => {
  test.each(CONSTRUCTS)("%s", (name, construct) => {
    const [line] = construct.split("\n");
    expect(
      interruptsByLineShape(line),
      `union disagrees with oracle for ${JSON.stringify(line)}`,
    ).toBe(
      oracleInterruptsSomewhere(construct) && !WORD_BASED_CONSTRUCTS.has(name),
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
  ])("%s", (line, isAttributeLine) => {
    expect(interruptsParagraph(line, "paragraph")).toBe(isAttributeLine);
    // An attribute line splits the paragraph in two; text keeps it
    // as one. (Counting `<p>` rather than looking for the line's own
    // characters, which inline substitutions may rewrite.)
    const html = renderedHtml(`para\n${line}\nmore\n`);
    expect(paragraphCount(html), html).toBe(isAttributeLine ? 2 : 1);
  });
});

// Every rule in the registry matches an already-rstripped line, so
// which characters rstrip removes is part of the registry's contract.
// ORACLE SURPRISE: the oracle is Asciidoctor Ruby transpiled by Opal,
// and Opal implements String#rstrip as a JavaScript
// `self.replace(/[\s\u0000]*$/, '')`. That is NOT MRI's rstrip: it
// also strips every character JavaScript's `\s` covers (a no-break
// space among them), which MRI leaves in place. The oracle is the
// arbiter, so src/parse/line-shapes.ts#rstrip mirrors Opal, and these
// rows are the pin — a trailing NUL or no-break space must leave the
// delimiter a delimiter.
describe("rstrip runs before every line rule", () => {
  test.each([
    ["a space", "---- "],
    ["a tab", "----\t"],
    ["a carriage return (CRLF input)", "----\r"],
    ["a NUL", "----\u0000"],
    ["a no-break space (Opal, not MRI)", "----\u00A0"],
  ])("%s after a delimiter still delimits", (_name, delimiter) => {
    expect(isDelimiterLine(delimiter), JSON.stringify(delimiter)).toBe(true);
    expect(renderedHtml(`${delimiter}\ncode\n----\n`)).toBe(
      renderedHtml("----\ncode\n----\n"),
    );
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
    (line) => {
      const html = renderedHtml(`first line\n${line}\nlast line\n`);
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
  // directly after a list item's text it is metadata for a block
  // `fold_first` merges away, so the oracle emits no id and the
  // formatter must keep the line verbatim. One line further down the
  // anchor keeps its id, so it interrupts instead.
  test("a block anchor is raw only directly after a list item's text", () => {
    const first = { firstLineAfterBlockStart: true };
    expect(isRawParagraphLine("[[a]]", "listItem", first)).toBe(true);
    expect(isRawParagraphLine("[[a]]", "listItem")).toBe(false);
    expect(interruptsParagraph("[[a]]", "listItem", first)).toBe(false);
    expect(interruptsParagraph("[[a]]", "listItem")).toBe(true);
  });
});

// Rows the FORMATTER still gets wrong, each tied to the gap issue
// that tracks it. A row here is a promise, not an excuse: when the
// issue is fixed the entry must be deleted, and the test below fails
// loudly if a listed row starts passing.
const KNOWN_GAPS = new Map<string, string>([
  // Description lists are not parsed yet, so everything a `term::`
  // line owns is emitted at the top level (or reflowed into the
  // term's text).
  ["dlistItem/callout list marker", "#9 — description lists not parsed"],
  ["dlistItem/list continuation", "#9 — description lists not parsed"],
  ["dlistItem/block title", "#9 — description lists not parsed"],
  ["dlistItem/attribute entry", "#9 — description lists not parsed"],
  ["dlistItem/admonition marker", "#9 — description lists not parsed"],
  ["dlistItem/block macro", "#9 — description lists not parsed"],
  ["dlistItem/thematic break", "#9 — description lists not parsed"],
  ["dlistItem/page break", "#9 — description lists not parsed"],
]);

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
        renderedHtml(out) === renderedHtml(document) &&
        (await formatAdoc(out)) === out;
      expect(faithful, message).toBe(gap === undefined);
    });
  });
});
