#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * What licenses the rewrites we actually make.
 *
 * Every rewrite the formatter performs on the corpus is isolated -
 * applied to the source ON ITS OWN, with every other rewrite backed
 * out - and then asked two questions:
 *
 * - the LOCAL question: does every line still classify the way it
 *   classified before, in context? That is the line-classification
 *   lemma, answered by the reader's own classifier through the trace
 *   in tests/lib/reading.ts.
 * - the GLOBAL question: does the whole document still re-read as the
 *   same document? That is tests/conformance/reparse.ts.
 *
 * The four cells the pair produces are the measurement:
 *
 * - local green, global green: LICENSED. The lemma allows it and the
 *   re-read agrees. NOT a statement that the rewrite is render-safe -
 *   see the caveat below.
 * - local green, global red: a LEMMA COUNTEREXAMPLE. Every line still
 *   classifies the same and the document changed anyway.
 * - local red, global green: unlicensed, and safe. The price of
 *   trusting the lemma alone.
 * - local red, global red: unlicensed, and unsafe.
 *
 * The second cell is the one that decides whether the lemma is sound;
 * the third is the coverage a conservative printer would give up, and
 * this script reports that in corpus lines left as the author wrote
 * them.
 *
 * WHAT "LICENSED" DOES NOT MEAN. It means the projection lens
 * licenses the rewrite, and that lens is bounded by our reader's
 * vocabulary: where the reader is blind to a construct it is blind on
 * BOTH sides, so a rewrite that changes the render can still count as
 * licensed. Measured, in this corpus: the quarantined four-backtick
 * document (`blocks_test.rb#should not recognize fenced code blocks
 * with more than three delimiters`) has a splice this table calls
 * licensed whose Asciidoctor render differs, because neither reader
 * models what the oracle makes of the line. That blindness is
 * declared where the lens is (tests/conformance/reparse.ts, the
 * "WHAT IT IS NOT" paragraph); the render bar is the fidelity
 * property in tests/conformance/properties.ts, and it is a different
 * gate. Do not read a share below as a safety figure.
 *
 * ONE REWRITE IS ONE TOP-LEVEL BLOCK, or the blank run in front of
 * one. That granularity is not a convenience: a line-level diff of a
 * reflowed document anchors on whatever lines happen to survive
 * verbatim, which mis-attributes a paragraph's rewrite to its
 * neighbour and then measures the mis-attribution. Splicing block i
 * of the output over block i of the source replaces that anchoring
 * with ONE assumption, stated here: that block i of the output is
 * block i of the source. It is an assumption and not a proof - a
 * printer that reordered blocks while keeping their count would be
 * mis-measured the same way, and nothing here would say so - but it
 * is checkable at a glance and it does not vary with the content.
 * Where the two documents do not agree on how many top-level blocks
 * they have, no splice is well defined; those documents are counted
 * on their own line and contribute NO rewrite to the table, so every
 * percentage below is over the documents that kept their block count.
 *
 * WHAT THE NUMBERS ARE ABOUT: the vendored corpus, and nothing else.
 * The registry grids are deliberately out, because a generated
 * coordinate is not evidence about how often a rewrite happens; this
 * measurement is about the rewrites real documents actually receive.
 * A conclusion drawn here says nothing about the adjacency shapes the
 * pair grid reaches, which is where tests/conformance/reparse.ts
 * finds most of its breaches.
 *
 * A REPORT, not a gate. Exit codes (scripts/lib/cli.ts): 0 it ran, 2
 * it could not - a corpus that did not load.
 */
import { format } from "prettier";
import { cannotRun, printUsage, wantsHelp } from "./lib/cli.js";
import { parse } from "../src/parser.js";
import { loadCorpus } from "../tests/conformance/loader.js";
import { projectionOf } from "../tests/conformance/reparse.js";
import { readingOf } from "../tests/lib/reading.js";

const USAGE = `usage: bun run rewrite-justification

  --help  this text

exit: 0 it ran, 2 it could not run`;

const ARGUMENT_START = 2;
if (wantsHelp(process.argv.slice(ARGUMENT_START))) {
  printUsage(USAGE);
  process.exit();
}

/** A corpus this short is a corpus that did not load. */
const MINIMUM_CASES = 1000;

/** What kind of rewrite one block's change is. */
type Category =
  | "reflow"
  | "whitespace"
  | "blank run"
  | "marker or continuation"
  | "delimiter"
  | "attrlist or anchor"
  | "other";

/** The order categories are reported in, widest first. */
const CATEGORIES: readonly Category[] = [
  "reflow",
  "whitespace",
  "blank run",
  "marker or continuation",
  "delimiter",
  "attrlist or anchor",
  "other",
];

/** The four cells, plus the lines a decline would cost. */
interface Tally {
  /** Local green, global green: the lemma licenses it and it is safe. */
  licensed: number;
  /** Local green, global red: the lemma licenses a rewrite that is NOT safe. */
  counterexample: number;
  /** Local red, global green: safe, and the lemma cannot say so. */
  unlicensedSafe: number;
  /** Local red, global red: unlicensed, and unsafe. */
  unsafe: number;
  /** Source lines inside rewrites the lemma cannot license. */
  declinedLines: number;
  /** Source lines inside rewrites of this category, licensed or not. */
  touchedLines: number;
}

/**
 * A fresh, empty tally.
 * @returns the zero row
 */
function emptyTally(): Tally {
  return {
    licensed: 0,
    counterexample: 0,
    unlicensedSafe: 0,
    unsafe: 0,
    declinedLines: 0,
    touchedLines: 0,
  };
}

/** A half-open range of zero-based lines. */
interface Span {
  /** First line. */
  readonly from: number;
  /** One past the last line. */
  readonly to: number;
}

/**
 * The line span of every top-level block, each preceded by the span
 * of the blank run in front of it.
 *
 * The gap is a span of its own because a dropped or inserted blank
 * line is a rewrite the printer makes on purpose (the separator
 * policy) and it belongs to no block's own lines.
 * @param text - the document
 * @returns the spans, alternating gap and block, covering every line
 */
function blockSpans(text: string): Span[] {
  const spans: Span[] = [];
  let at = 0;
  for (const child of parse(text).children) {
    const from = child.position.start.line - 1;
    const to = child.position.end.line;
    spans.push({ from: at, to: from }, { from, to });
    at = to;
  }
  spans.push({ from: at, to: text.split("\n").length });
  return spans;
}

/**
 * The document with one span replaced by the output's counterpart.
 * @param source - the source lines
 * @param output - the output lines
 * @param left - the source span to replace
 * @param right - the output span to put there
 * @returns the patched document
 */
function spliced(
  source: readonly string[],
  output: readonly string[],
  left: Span,
  right: Span,
): string {
  return [
    ...source.slice(0, left.from),
    ...output.slice(right.from, right.to),
    ...source.slice(left.to),
  ].join("\n");
}

/**
 * Everything a run of lines says, with every whitespace run spelled
 * the same way.
 * @param lines - the lines
 * @returns their words, blank-separated
 */
function words(lines: readonly string[]): string {
  return lines.join(" ").trim().replaceAll(/\s+/gv, " ");
}

/** A line that is a run of one delimiter character, four or more long. */
const DELIMITER_LINE = /^\s*(?<run>[\-=~^*_.+\/`,;:!])\k<run>{3,}\s*$/v;

/** A line that opens a list item, continues one, or names a term. */
const MARKER_LINE = /^\s*(?:[*.\-]+\s|\d+\.\s|<\d+>\s|\+\s*$|.*::+\s*$)/v;

/** A line carrying an attribute list, an anchor, or a macro's brackets. */
const BRACKET_LINE = /\[.*\]/v;

/**
 * What kind of rewrite this is.
 *
 * The order is the order of generality: a change that only moves
 * blanks is a blank run whatever else its lines look like, one whose
 * lines say the same words in the same layout is whitespace, and one
 * whose lines say the same words in a different layout is reflow.
 * Only what is left is classified by the SHAPE of the lines it
 * touches.
 * @param before - the source lines
 * @param after - the output lines that replace them
 * @returns the category
 */
function categoryOf(
  before: readonly string[],
  after: readonly string[],
): Category {
  const beforeContent = before.filter((line) => line.trim() !== "");
  const afterContent = after.filter((line) => line.trim() !== "");
  if (beforeContent.length === 0 && afterContent.length === 0) {
    return "blank run";
  }
  if (words(beforeContent) === words(afterContent)) {
    return beforeContent.length === afterContent.length
      ? "whitespace"
      : "reflow";
  }
  const touched = [...beforeContent, ...afterContent];
  if (touched.every((line) => DELIMITER_LINE.test(line))) {
    return "delimiter";
  }
  if (touched.every((line) => MARKER_LINE.test(line))) {
    return "marker or continuation";
  }
  if (touched.some((line) => BRACKET_LINE.test(line))) {
    return "attrlist or anchor";
  }
  return "other";
}

/** Column widths, so the table lines up whatever the counts are. */
const CATEGORY_WIDTH = 24;

/** Width of a bare count column. */
const COUNT_WIDTH = 8;

/** Width of a count-and-share column. */
const SHARE_WIDTH = 16;

/** How many unsafe rewrites the report names. */
const WITNESS_SAMPLE = 10;

/** A share is a percentage. */
const PER_CENT = 100;

/**
 * A count and its share of a whole, as `123 (4.5%)`.
 * @param part - the count
 * @param whole - the total it is a share of
 * @returns the spelling
 */
function share(part: number, whole: number): string {
  const percent = whole === 0 ? 0 : (PER_CENT * part) / whole;
  return `${String(part)} (${percent.toFixed(1)}%)`;
}

/**
 * One line of the table.
 * @param label - the category name, or ALL
 * @param tally - its counts
 * @returns the formatted row
 */
function reportRow(label: string, tally: Tally): string {
  const rows =
    tally.licensed + tally.counterexample + tally.unlicensedSafe + tally.unsafe;
  return [
    label.padEnd(CATEGORY_WIDTH),
    String(rows).padStart(COUNT_WIDTH),
    share(tally.licensed, rows).padStart(SHARE_WIDTH),
    share(tally.unlicensedSafe, rows).padStart(SHARE_WIDTH),
    String(tally.unsafe).padStart(COUNT_WIDTH),
    share(tally.counterexample, rows).padStart(SHARE_WIDTH),
  ].join(" ");
}

/**
 * Format one document, or nothing at all when the formatter threw.
 *
 * A crash is already the verdict of the crash property
 * (tests/conformance/properties.ts); without an output there is no
 * rewrite here to justify.
 * @param source - the document
 * @returns the formatted text, or undefined
 */
async function formatted(source: string): Promise<string | undefined> {
  try {
    return await format(source, {
      parser: "asciidoc",
      plugins: ["./src/index.ts"],
    });
  } catch {
    return undefined;
  }
}

const corpus = loadCorpus().flatMap((group) => group.cases);
if (corpus.length < MINIMUM_CASES) {
  cannotRun(
    `rewrite-justification: the corpus spelled ${String(corpus.length)} case(s) - nothing was measured`,
  );
  process.exit(process.exitCode);
}

const tallies = new Map<Category, Tally>(
  CATEGORIES.map((category) => [category, emptyTally()]),
);
const witnesses: string[] = [];
let corpusLines = 0;
let rewrites = 0;
let restructured = 0;
let unformattable = 0;

for (const one of corpus) {
  const source = one.input.split("\n");
  corpusLines += source.length;
  // eslint-disable-next-line no-await-in-loop -- one document at a time; the formatter is CPU-bound on this thread
  const once = await formatted(one.input);
  if (once === undefined) {
    unformattable += 1;
    continue;
  }
  if (once === one.input) {
    continue;
  }
  const output = once.split("\n");
  const left = blockSpans(one.input);
  const right = blockSpans(once);
  if (left.length !== right.length) {
    restructured += 1;
    continue;
  }
  const sourceReading = readingOf(one.input).join("\n");
  const sourceProjection = projectionOf(one.input).tokens.join("\n");
  for (const [index, span] of left.entries()) {
    const before = source.slice(span.from, span.to);
    const after = output.slice(right[index].from, right[index].to);
    if (before.join("\n") === after.join("\n")) {
      continue;
    }
    const text = spliced(source, output, span, right[index]);
    const localGreen = readingOf(text).join("\n") === sourceReading;
    const globalGreen =
      projectionOf(text).tokens.join("\n") === sourceProjection;
    const category = categoryOf(before, after);
    const tally = tallies.get(category);
    if (tally === undefined) {
      continue;
    }
    rewrites += 1;
    tally.touchedLines += before.length;
    if (localGreen && globalGreen) {
      tally.licensed += 1;
    } else if (localGreen) {
      tally.counterexample += 1;
    } else {
      tally.declinedLines += before.length;
      if (globalGreen) {
        tally.unlicensedSafe += 1;
      } else {
        tally.unsafe += 1;
      }
    }
    if (!globalGreen) {
      witnesses.push(
        `[${category}${localGreen ? ", LOCAL GREEN" : ""}] ${one.id} lines ${String(span.from + 1)}-${String(span.to)}: ${JSON.stringify(before.join("\n"))} -> ${JSON.stringify(after.join("\n"))}`,
      );
    }
  }
}

const total = emptyTally();
for (const tally of tallies.values()) {
  total.licensed += tally.licensed;
  total.counterexample += tally.counterexample;
  total.unlicensedSafe += tally.unlicensedSafe;
  total.unsafe += tally.unsafe;
  total.declinedLines += tally.declinedLines;
  total.touchedLines += tally.touchedLines;
}

console.log(
  `${String(corpus.length)} corpus documents, ${String(corpusLines)} lines, ${String(rewrites)} isolated rewrites.`,
);
console.log(
  `${String(restructured)} document(s) changed their top-level block count, contribute no rewrite to the table below, and are excluded from every share in it; ${String(unformattable)} threw.`,
);
console.log(
  "Population: the vendored corpus only. Generated grid coordinates are out.",
);
console.log(
  '"licensed" means the projection lens licenses it, not that the render is safe:',
);
console.log(
  "the lens is bounded by our reader's vocabulary and is blind on both sides where",
);
console.log(
  "the reader is. Render safety is the fidelity property, a different gate.\n",
);
console.log(
  [
    "category".padEnd(CATEGORY_WIDTH),
    "rewrites".padStart(COUNT_WIDTH),
    "licensed".padStart(SHARE_WIDTH),
    "unlicensed-safe".padStart(SHARE_WIDTH),
    "unsafe".padStart(COUNT_WIDTH),
    "counterexample".padStart(SHARE_WIDTH),
  ].join(" "),
);
for (const category of CATEGORIES) {
  console.log(reportRow(category, tallies.get(category) ?? emptyTally()));
}
console.log(reportRow("ALL", total));

console.log(
  `\nA printer that declined every rewrite the local check cannot license would leave ${share(total.declinedLines, total.touchedLines)} of the ${String(total.touchedLines)} rewritten corpus lines as the author wrote them, which is ${share(total.declinedLines, corpusLines)} of the corpus. Both shares are over the documents that kept their block count, on this corpus.`,
);

if (witnesses.length > 0) {
  console.log(
    `\nWitnesses (${String(witnesses.length)}), the rewrites the global re-read calls unsafe:`,
  );
  for (const witness of witnesses.slice(0, WITNESS_SAMPLE)) {
    console.log(`  ${witness}`);
  }
}
