/**
 * The shared machinery of every interruption probe: the constructs
 * asked about, the two positions each is asked in, the oracle
 * question itself, and how a classifier verdict is read back as
 * "the paragraph continued".
 *
 * Split out of tests/conformance/interruption.test.ts when a second
 * suite came to need it: that file crosses the constructs with one
 * document shape per paragraph context, and
 * reader-context-grid.test.ts crosses the same constructs with every
 * reachable reader state. Two copies of the construct list would be
 * two lists that drift, and the registry's coverage claim is only as
 * wide as the list a suite actually ran.
 *
 * A LIBRARY module: no test lives here, only what the suites share.
 */
import { renderedHtml } from "../helpers.js";
import type { LineKind } from "../../src/parse/lines/classify.js";

/**
 * The line-shaped constructs the registry is pinned over, each as
 * the source an author would write. A row may span several lines so
 * that a delimited block can be probed whole; every consumer
 * classifies the FIRST line and hands the oracle all of them.
 */
// [name, construct text (may be multi-line)]
export const CONSTRUCTS: Array<[string, string]> = [
  ["unordered list marker", "* item"],
  ["ordered list marker", ". item"],
  // The EXPLICIT ordered forms of `OrderedListRx`
  // (`\d+\.|[a-zA-Z]\.|[IVXivx]+\)`), one row per family plus the
  // arabic form an author writes by accident: a year at the head of a
  // sentence. Where `2020. item` interrupts and where it does not is
  // the oracle's answer rather than a reading of the Ruby, because
  // the printer's hazard net trades a break for it
  // (tests/format/explicit-ordered-list.test.ts).
  ["explicit arabic marker", "1. item"],
  ["explicit arabic marker (a year)", "2020. item"],
  ["explicit loweralpha marker", "a. item"],
  ["explicit upperalpha marker", "A. item"],
  ["explicit lowerroman marker", "i) item"],
  ["explicit upperroman marker", "I) item"],
  // The mixed-case roman forms, whose family `OrderedListMarkerRxMap`
  // (rx.rb l.303) decides from the letter before the `)`. Here they
  // are markers like any other; WHICH family they resolve to is
  // pinned in tests/parser/ordered-marker-style.test.ts.
  ["mixed-case roman marker (lower tail)", "Iv) item"],
  ["mixed-case roman marker (upper tail)", "iV) item"],
  // Negative controls: shapes one bracket or one letter away from the
  // forms above, which `OrderedListRx` does NOT accept. Each must be
  // ordinary text in every context, or the alternation is wider than
  // Ruby's.
  ["arabic with a paren, not a marker", "1) item"],
  ["loweralpha with a paren, not a marker", "a) item"],
  ["upperalpha with a paren, not a marker", "A) item"],
  ["multi-letter alpha, not a marker", "ab. item"],
  ["non-roman letter with a paren, not a marker", "l) item"],
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
  // The tilde spelling of the SAME open-block content model
  // (DELIMITED_BLOCKS['~~~~'], absent from the vendored Ruby, issue
  // #64): interrupts everywhere `--` does, since both are read by the
  // same interrupting-set machinery (SHARED_INTERRUPTERS,
  // src/parse/line-shapes.ts).
  ["open block delimiter (tilde)", "~~~~\nob\n~~~~"],
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
  // The Markdown rules, one row per mark: each is its own alternative
  // of `MARKDOWN_THEMATIC_BREAK_CHARS`, so a row per mark is a row per
  // branch. The SPACED spellings are deliberately absent - the
  // registry leaves them as text, and its own note says why
  // (THEMATIC_BREAK, src/parse/line-shapes.ts).
  ["markdown thematic break (hyphens)", "---"],
  ["markdown thematic break (asterisks)", "***"],
  ["markdown thematic break (underscores)", "___"],
  ["page break", "<<<"],
  ["section marker", "== Section"],
];

/**
 * The block-level tags the oracle emitted, in document order.
 *
 * `dt`/`dd` are among them because a sibling description-list TERM is
 * the one interruption that adds no other block: `term1::` /
 * `term:: def` renders as two `<dt>` inside the same `<dl>`.
 * @param html - normalized HTML from {@link renderedHtml}
 * @returns the tag names, in order
 */
function blockTags(html: string): string[] {
  return html.match(/<(?:p|div|ul|ol|dl|dt|dd|pre|h\d|hr|li|table)\b/gv) ?? [];
}

/**
 * Whether `outer` holds every tag of `inner` in the same order - the
 * question "did the baseline's own structure survive".
 * @param inner - the baseline's tags
 * @param outer - the tags of the document carrying the construct
 * @returns true when the baseline's tags appear in order in `outer`
 */
function isSubsequence(
  inner: readonly string[],
  outer: readonly string[],
): boolean {
  let at = 0;
  for (const tag of outer) {
    if (at < inner.length && inner[at] === tag) {
      at += 1;
    }
  }
  return at === inner.length;
}

/**
 * Asks the Asciidoctor oracle whether inserting `construct` after
 * `prefix` (at the position `filler` puts it in) started a new
 * block or item.
 *
 * The prefix rather than a context name, because the two suites reach
 * a context by different documents: one shape per context here, one
 * per reachable reader state in the grid. The question the oracle is
 * asked is the same either way - does this line grow the block count
 * of the document it stands in.
 * @param construct - the candidate line-shaped construct, as it
 *   would appear verbatim in source (may itself span multiple lines)
 * @param prefix - the document lines that open the block, without a
 *   trailing newline
 * @param filler - lines inserted between the prefix and the
 *   construct, pushing it off the block's first line (see POSITIONS)
 * @returns true when the oracle's block count grew, i.e. Asciidoctor
 *   treated `construct` as ending the open paragraph/item text
 */
export async function oracleInterrupts(
  construct: string,
  prefix: string,
  filler: string,
): Promise<boolean> {
  const baseline = blockTags(
    await renderedHtml(`${prefix}\n${filler}last line\n`),
  );
  const withConstruct = blockTags(
    await renderedHtml(`${prefix}\n${filler}${construct}\nlast line\n`),
  );
  // TWO signals, because one of them is blind in a shape the other
  // is not. GROWTH catches the ordinary case: a new block or item
  // appears beside the ones the baseline had. The SUBSEQUENCE test
  // catches the case where the interruption costs the baseline a tag
  // and pays for it with another - a `++++` or `////` block on the
  // first line under a bare `term1::` renders nothing of its own,
  // ends the list, and swaps the item's `<dd>` for the paragraph's
  // own `<div>`, so the count is unmoved while the structure is not.
  return (
    withConstruct.length > baseline.length ||
    !isSubsequence(baseline, withConstruct)
  );
}

// WHERE the construct sits inside the open block. Several shapes
// only mean anything on the first line after the block started:
// `next_block` reads that line to pick a block context, and from the
// second line on `read_paragraph_lines` no longer knows any of them.
// Probing one position would let a registry claim be half true, so
// every row is asserted in both. [name, filler lines, first-line?]
export const POSITIONS: Array<[string, string, boolean]> = [
  ["directly after the block start", "", true],
  ["on a later line", "mid line\n", false],
];

/**
 * Whether a line kind lets the open paragraph keep going. Text does,
 * and so does a raw line, the reader consuming comments, preprocessor
 * directives and the folded-away block anchor without ever ending a
 * block. Every other kind is something the reader has to act on, which
 * means the paragraph stopped.
 * @param kind - the classifier's verdict for one line
 * @returns true when the paragraph continues through the line
 */
export function continuesParagraph(kind: LineKind): boolean {
  return kind.kind === "text" || kind.kind === "raw";
}
