/**
 * An `a|` cell's own document (issue #130), held against the oracle's
 * own nested document, over the WHOLE conformance corpus rather than
 * the table-bearing slice: `a|` cells turn up in nine of the vendored
 * files, not only in `tables_test.jsonl`, and a suite that read three
 * of them would be measuring a third of the evidence.
 *
 * What is compared is the LINES. `tableCellDocument`
 * (src/parse/lines/table-cell-document.ts) recovers, from a cell's
 * recorded runs, the lines Asciidoctor hands the nested `Document` it
 * builds for that cell; `oracleCellDocuments` (tests/helpers.ts) reads
 * those same lines off `getInnerDocument().getSourceLines()`. Equal
 * line arrays mean a reader run over ours would be reading exactly
 * what the oracle's nested parse read.
 *
 * Two independent facts ride along, and neither needs the oracle: each
 * line's `raw` is the span of the case's own source at the offset the
 * line carries, and each line's number is the line that offset falls
 * on. Those are what make these lines usable for POSITIONS, not just
 * for text.
 *
 * WHICH cells are compared is the oracle's call, not this suite's:
 * `getInnerDocument()` answers non-null exactly for the cells it read
 * as documents, so the count comparison below is itself a test of the
 * style resolution `nestedDocumentCells` (tests/parser/table-structure-scan.ts)
 * performs.
 */
import { describe, expect, test } from "vitest";
import { parse } from "../../src/parser.js";
import {
  tableCellDocument,
  type TableCellDocument,
} from "../../src/parse/lines/table-cell-document.js";
import { makeLocationIndex } from "../../src/parse/positions.js";
import type { SourceLine } from "../../src/parse/lines/split.js";
import { nestedDocumentCells } from "./table-structure-scan.js";
import { tableNodes } from "./table-nodes.js";
import { oracleCellDocuments } from "../helpers.js";
import { loadCorpus } from "../conformance/loader.js";

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** One corpus case, with the group that holds it. */
interface CorpusEntry {
  /** The case id. */
  readonly id: string;
  /** Which corpus group the case came from. */
  readonly group: string;
  /** The case's source text. */
  readonly input: string;
}

const ALL_CASES: CorpusEntry[] = loadCorpus().flatMap((group) =>
  group.cases.map((one) => ({
    id: one.id,
    group: group.name,
    input: one.input,
  })),
);

// ---------------------------------------------------------------------------
// This reader's side
// ---------------------------------------------------------------------------

/**
 * Every `a|` cell's document in one case, in document order: the
 * tables `parse()` found, each one's asciidoc-styled cells, each
 * cell's runs read back into the lines its nested document holds.
 * @param input - the case's source text
 * @returns one entry per cell the reader reads as a document
 */
function ourCellDocuments(input: string): TableCellDocument[] {
  const at = makeLocationIndex(input);
  return tableNodes(parse(input)).flatMap((table) =>
    nestedDocumentCells(table).map((cell) =>
      tableCellDocument(cell.runs, table.cutting, at),
    ),
  );
}

// ---------------------------------------------------------------------------
// Classification: excluded with a reason, or comparable
// ---------------------------------------------------------------------------

/**
 * The named reasons a whole case is not compared. Both are
 * REGRESSION-ONLY buckets: the pinned counts below assert each is
 * empty, so a case that starts throwing is named rather than quietly
 * dropped.
 */
type ExclusionFamily = "reader-threw" | "oracle-threw";

/**
 * Why one cell's lines are not compared, cell by cell rather than case
 * by case: both reasons are facts about a single cell, and excluding
 * its whole case would drop the cells beside it for no reason.
 *
 * `preprocessor` is Asciidoctor running its preprocessor over the
 * FIRST line of a cell's content and no other
 * (`PreprocessorReader.new \@document, [unprocessed_line1]`,
 * table.rb:301-308): an `include::` there is resolved before the
 * nested document is built, so the oracle's lines hold text that is in
 * no source file this suite can read. This reader runs no
 * preprocessor at all (issue #131).
 *
 * `rewritten` is the reader's own verdict for a quoted csv cell,
 * whose text csv's unquote rewrote (`cell_text.squeeze q`,
 * table.rb:633-648).
 */
type CellSkip = "preprocessor" | "rewritten";

/** One cell's lines, or the reason they are not compared. */
type CellComparison =
  | {
      /** Discriminant: compare these lines against the oracle's. */
      readonly kind: "compare";
      /** The lines the reader recovered. */
      readonly lines: readonly SourceLine[];
    }
  | {
      /** Discriminant: this cell is counted, not compared. */
      readonly kind: "skipped";
      /** Why. */
      readonly why: CellSkip;
    };

/**
 * The line shapes a preprocessor pass can REWRITE. Narrower than
 * Ruby's own gate, which runs the pass whenever the first line merely
 * holds `::` anywhere (`unprocessed_line1.include? '::'`,
 * table.rb:302), and narrower on purpose: a line the pass returns
 * unchanged is not shifted into the document (table.rb:304-307), so a
 * cell whose first line carries a `::` that is not a directive is
 * genuinely comparable and excluding it would cost evidence for
 * nothing.
 */
const PREPROCESSOR_DIRECTIVE = /^(?:include|ifdef|ifndef|ifeval)::/v;

/**
 * One cell's document, classified: skipped with a reason, or ready to
 * compare.
 * @param document - what the reader recovered for the cell
 * @returns the classification
 */
function cellComparison(document: TableCellDocument): CellComparison {
  if (document.kind === "rewritten") {
    return { kind: "skipped", why: "rewritten" };
  }
  const first = document.lines.at(0);
  return first !== undefined && PREPROCESSOR_DIRECTIVE.test(first.text)
    ? { kind: "skipped", why: "preprocessor" }
    : { kind: "compare", lines: document.lines };
}

/** One case this suite declined to compare, and why. */
interface ExcludedCase {
  /** Node discriminant. */
  readonly kind: "excluded";
  /** The corpus case id. */
  readonly id: string;
  /** Which corpus group the case came from. */
  readonly group: string;
  /** The named category this exclusion belongs to. */
  readonly family: ExclusionFamily;
}

/** One case whose cell documents are ready to compare. */
interface ComparableCase {
  /** Node discriminant. */
  readonly kind: "comparable";
  /** The corpus case id. */
  readonly id: string;
  /** Which corpus group the case came from. */
  readonly group: string;
  /** The case's source text, for the offset and line-number checks. */
  readonly input: string;
  /** This reader's cell documents, classified, in document order. */
  readonly ours: readonly CellComparison[];
  /** The oracle's own nested-document source lines, in document order. */
  readonly theirs: readonly string[][];
}

/** Nothing to compare: neither side read a cell as a document. */
interface EmptyCase {
  /** Node discriminant. */
  readonly kind: "empty";
}

/** What one corpus case contributes. */
type Classified = ExcludedCase | ComparableCase | EmptyCase;

/**
 * Run `read`, answering undefined where it threw. A corpus case that
 * throws is a REGRESSION here, not a fact about cell documents, so it
 * is named in its own bucket rather than allowed to fail this suite
 * for the wrong reason.
 * @param read - the reading to attempt
 * @returns what it returned, or undefined if it threw
 */
function attempt<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/**
 * {@link attempt}, for a reading that is asynchronous.
 * @param read - the reading to attempt
 * @returns what it returned, or undefined if it threw
 */
async function attemptAsync<T>(read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch {
    return undefined;
  }
}

/**
 * Classify one case. Both sides are read first, so that a case where
 * only ONE of them finds a cell document still reaches the comparison
 * and fails there, instead of being filtered away by whichever side
 * this suite happened to ask first.
 * @param entry - the corpus case
 * @returns the case's classification
 */
async function classify(entry: CorpusEntry): Promise<Classified> {
  const { id, group, input } = entry;
  const ours = attempt(() => ourCellDocuments(input));
  if (ours === undefined) {
    return { kind: "excluded", id, group, family: "reader-threw" };
  }
  const theirs = await attemptAsync(
    async () => await oracleCellDocuments(input),
  );
  if (theirs === undefined) {
    return ours.length === 0
      ? { kind: "empty" }
      : { kind: "excluded", id, group, family: "oracle-threw" };
  }
  if (ours.length === 0 && theirs.length === 0) {
    return { kind: "empty" };
  }
  return {
    kind: "comparable",
    id,
    group,
    input,
    ours: ours.map((one) => cellComparison(one)),
    theirs,
  };
}

const CLASSIFIED = await Promise.all(ALL_CASES.map(classify));
const EXCLUDED = CLASSIFIED.filter(
  (one): one is ExcludedCase => one.kind === "excluded",
);
const COMPARABLE = CLASSIFIED.filter(
  (one): one is ComparableCase => one.kind === "comparable",
);

/**
 * How many cases {@link EXCLUDED} carries per family.
 * @returns the per-family counts
 */
function excludedCountsByFamily(): Record<ExclusionFamily, number> {
  const counts: Record<ExclusionFamily, number> = {
    "reader-threw": 0,
    "oracle-threw": 0,
  };
  for (const one of EXCLUDED) {
    counts[one.family] += 1;
  }
  return counts;
}

/** Every classified cell across {@link COMPARABLE}, flattened once. */
const ALL_CELLS: CellComparison[] = COMPARABLE.flatMap((one) => one.ours);

/**
 * How many cells {@link ALL_CELLS} skips, per reason.
 * @returns the per-reason counts
 */
function skippedCountsByReason(): Record<CellSkip, number> {
  const counts: Record<CellSkip, number> = { preprocessor: 0, rewritten: 0 };
  for (const one of ALL_CELLS) {
    if (one.kind === "skipped") {
      counts[one.why] += 1;
    }
  }
  return counts;
}

/**
 * The oracle's lines for a cell, with the ONE line an empty cell gets
 * for free removed: `cell_text.split LF, -1` (table.rb:301) turns the
 * empty string into a one-element array holding it, where the reader
 * yields no lines at all. Both spell a document with no blocks; the
 * divergence is recorded at the reader's own site.
 * @param lines - the oracle's source lines for one cell
 * @returns the lines, minus a lone empty one
 */
function withoutTheEmptyLine(lines: readonly string[]): readonly string[] {
  return lines.length === 1 && lines[0] === "" ? [] : lines;
}

/**
 * The 1-based line `offset` falls on, counted off the source text
 * rather than asked of `makeLocationIndex`: the recovered line's own
 * number came from that index, so re-deriving it there would compare
 * one total function's answer with itself.
 * @param input - the case's source text
 * @param offset - a zero-based offset into it
 * @returns the 1-based line number
 */
function lineNumberAt(input: string, offset: number): number {
  return input.slice(0, offset).split("\n").length;
}

describe("an a| cell's own document vs the oracle", () => {
  test.each(COMPARABLE)("$group: $id", (comparable) => {
    const { id, input, ours, theirs } = comparable;

    // The count is the style resolution's own test: the oracle builds
    // a nested document for exactly the cells it read as asciidoc.
    expect(ours.length, `${id}: cell document count`).toBe(theirs.length);

    for (const [index, mine] of ours.entries()) {
      const label = `${id}: cell ${String(index)}`;
      if (mine.kind === "skipped") {
        continue;
      }
      expect(
        mine.lines.map((line) => line.text),
        `${label} lines`,
      ).toEqual(withoutTheEmptyLine(theirs[index]));

      // Independent of the oracle: every line is really a span of
      // this case's own source, at the offset and on the line it
      // carries. The line number is counted here rather than asked of
      // `makeLocationIndex` again - asking the same total function the
      // same question is a self-comparison that cannot fail.
      for (const line of mine.lines) {
        expect(
          input.slice(line.offset, line.offset + line.raw.length),
          `${label} raw at ${String(line.offset)}`,
        ).toBe(line.raw);
        expect(lineNumberAt(input, line.offset), `${label} line number`).toBe(
          line.line,
        );
      }
    }
  });

  test("no case is excluded whole", () => {
    const counts = excludedCountsByFamily();
    expect(counts, JSON.stringify(counts, undefined, 2)).toEqual({
      "reader-threw": 0,
      "oracle-threw": 0,
    });
  });

  // The census the issue asks for, and the size of what it is not
  // asking about: 1,614 corpus cases hold 53 that carry a cell the
  // oracle reads as a document, 61 such cells between them, of which
  // 58 are compared line for line. The three that are not are named,
  // one reason each.
  test("the compared population is pinned", () => {
    expect(ALL_CASES.length).toBeGreaterThanOrEqual(1614);
    expect(COMPARABLE.length).toBe(53);
    expect(ALL_CELLS.length).toBe(61);
    const skipped = skippedCountsByReason();
    expect(skipped, JSON.stringify(skipped, undefined, 2)).toEqual({
      preprocessor: 2,
      rewritten: 1,
    });
    expect(ALL_CELLS.filter((one) => one.kind === "compare").length).toBe(58);
  });
});

// ---------------------------------------------------------------------------
// The trims, one shape at a time
// ---------------------------------------------------------------------------

/** A psv separator escaped so the cell reads through it. */
const ESCAPE = String.raw`\|`;

/** A cell whose one line carries an escaped separator. */
const ESCAPED_SEPARATOR_CELL = `|===\na|one ${ESCAPE} two\n|===\n`;

/**
 * U+00A0: whitespace to the trim the oracle applies to a cell
 * buffer's two ends, and not whitespace to the rstrip its reader
 * gives every line. Written as an escape so the fixtures stay
 * readable ASCII.
 */
const NO_BREAK_SPACE = "\u{00A0}";

/**
 * The shapes the corpus reaches only incidentally, each written to
 * exercise one branch of the two trims. Every row is checked against
 * the oracle as well as against the expected lines, so a row cannot
 * pin a wrong answer.
 */
const SHAPES: ReadonlyArray<{
  /** What the row exercises. */
  readonly name: string;
  /** The synthetic source. */
  readonly input: string;
  /** The lines the cell's document should hold. */
  readonly lines: readonly string[];
}> = [
  {
    name: "a buffer opening with a newline keeps the first line's indent",
    input: "|===\na|\n  indented\n|===\n",
    lines: ["  indented"],
  },
  {
    name: "a buffer opening with text is lstripped, and only its first line",
    input: "|===\na|  indented\n    more\n|===\n",
    lines: ["indented", "    more"],
  },
  {
    name: "a blank line inside an open cell stays a line of its document",
    input: "|===\na|one\n\ntwo\n|===\n",
    lines: ["one", "", "two"],
  },
  {
    name: "blank lines at the end of a cell are trimmed away",
    input: "|===\n|x\n\na|one\n\n\n|===\n",
    lines: ["one"],
  },
  {
    name: "a line's trailing whitespace is gone before the document sees it",
    input: "[cols=1a]\n|===\n|one   \n|===\n",
    lines: ["one"],
  },
  {
    name: "a dropped comment line is no line of the document",
    input: "|===\na|one\n// gone\ntwo\n|===\n",
    lines: ["one", "two"],
  },
  {
    name: "an escaped separator's backslash is chopped out of the text",
    input: ESCAPED_SEPARATOR_CELL,
    lines: ["one | two"],
  },
  {
    name: "a cell with nothing in it holds a document of no lines",
    input: "|===\na|\n|===\n",
    lines: [],
  },
  {
    name: "a header row's cell is a plain cell, whatever its column said",
    input: "[cols=1a]\n|===\n|head\n\n|body\n|===\n",
    lines: ["body"],
  },
  {
    name: "a nested table's own lines are handed over unread",
    input: "|===\na|\n!===\n!x !y\n!===\n|===\n",
    lines: ["!===", "!x !y", "!==="],
  },
  {
    name: "the buffer's trailing whitespace goes in the trim's own dialect",
    input: `|===\na|x${NO_BREAK_SPACE}\n|===\n`,
    lines: ["x"],
  },
  {
    name: "a trailing whitespace-only line is no line of the document",
    input: `|===\na|one\n${NO_BREAK_SPACE}\n|===\n`,
    lines: ["one"],
  },
  {
    name: "a closing delimiter padded with whitespace still closes its block",
    input: `|===\na|\n----\nx\n----${NO_BREAK_SPACE}\n|===\n`,
    lines: ["----", "x", "----"],
  },
  {
    name: "a leading whitespace-only line goes, and the newline behind it",
    input: `|===\na|${NO_BREAK_SPACE}\nsecond\n|===\n`,
    lines: ["second"],
  },
  {
    name: "a cell of nothing but whitespace holds a document of no lines",
    input: `|===\na|${NO_BREAK_SPACE}\n|===\n`,
    lines: [],
  },
  {
    name: "the leading-newline drop stops at a whitespace-only line",
    input: `|===\na|\n${NO_BREAK_SPACE}\nx\n|===\n`,
    lines: [NO_BREAK_SPACE, "x"],
  },
  {
    name: "whitespace in the MIDDLE of the buffer is left where it stands",
    input: `|===\na|x\n${NO_BREAK_SPACE}\ny\n|===\n`,
    lines: ["x", NO_BREAK_SPACE, "y"],
  },
  {
    name: "a csv cell's buffer is trimmed in the same dialect",
    input: `[cols=1a,format=csv]\n,===\nab${NO_BREAK_SPACE}\n,===\n`,
    lines: ["ab"],
  },
  {
    name: "a dsv cell's buffer is trimmed in the same dialect",
    input: `[cols=1a,format=dsv]\n:===\nab${NO_BREAK_SPACE}\n:===\n`,
    lines: ["ab"],
  },
  {
    name: "a lone quote inside a csv value moves no byte",
    input: '[cols=1a,format=csv]\n,===\nab"cd\n,===\n',
    lines: ['ab"cd'],
  },
];

/**
 * The one cell document `input` holds, as its lines. Throws rather
 * than answering a union: a row below that produces anything but one
 * READABLE cell document is a broken row, not a result to compare.
 * @param input - the synthetic source
 * @returns the cell document's lines
 * @throws {Error} when the input holds anything but one readable cell
 *   document
 */
function onlyCellDocument(input: string): readonly SourceLine[] {
  const documents = ourCellDocuments(input);
  const only = documents.at(0);
  if (documents.length !== 1 || only?.kind !== "lines") {
    throw new Error(
      `expected one readable cell document, got ${JSON.stringify(documents)}`,
    );
  }
  return only.lines;
}

describe("the trims between a cell's buffer and its document", () => {
  test.each(SHAPES)("$name", async ({ input, lines }) => {
    const mine = onlyCellDocument(input);
    expect(mine.map((line) => line.text)).toEqual(lines);

    const theirs = await oracleCellDocuments(input);
    expect(theirs.length).toBe(1);
    expect(mine.map((line) => line.text)).toEqual(
      withoutTheEmptyLine(theirs[0]),
    );
  });

  // `raw` is the source as written and `text` is what a rule matches;
  // the two come apart at exactly two places, and both are here.
  test("raw keeps the bytes text does not", () => {
    const padded = onlyCellDocument("[cols=1a]\n|===\n|one   \n|===\n");
    expect(padded.map((line) => line.raw)).toEqual(["one   "]);

    const chopped = onlyCellDocument(ESCAPED_SEPARATOR_CELL);
    expect(chopped.map((line) => line.raw)).toEqual([`one ${ESCAPE} two`]);
  });

  // A quoted csv value is the one cell whose document text no span of
  // the source spells, so it gets an answer of its own rather than a
  // line list that would be quietly wrong.
  test.each([
    [
      "a whole-value quote",
      '[cols="1a",format=csv]\n,===\n"\n  x\n  "\n,===\n',
    ],
    [
      "adjacent quotes inside the value",
      '[cols=1a,format=csv]\n,===\nab""cd\n,===\n',
    ],
    ["a value that is one quote", '[cols=1a,format=csv]\n,===\n"\n,===\n'],
  ])("a csv cell rewritten by %s says so", (_name, input) => {
    expect(ourCellDocuments(input).map((one) => one.kind)).toEqual([
      "rewritten",
    ]);
  });
});
