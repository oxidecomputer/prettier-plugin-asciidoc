/**
 * Finding the whitespace positions of a DOCUMENT the battery did not
 * write, and saying what construct each one is likely to be about.
 *
 * The template roster measures whitespace in shapes chosen to hold
 * one construct each. That is the wrong instrument for a population
 * of real documents, where a run sits wherever an author put it, so
 * this module reads a document and reports every run that can be
 * perturbed without changing what the line IS: a run with a non-blank
 * character on both sides, on a line the crude classifier below calls
 * eligible.
 *
 * Both halves are deliberately crude, and each one is counted rather
 * than trusted. The line classifier is a single-level delimiter
 * toggle, not the reader in `src/parse`, because a census that shares
 * the reader's model of a document cannot find a position the reader
 * is wrong about. The construct guess groups the report and decides
 * nothing: a row's CLASS comes from rendering, and the guess only
 * says where to look.
 */

/** Why a line was skipped, or that it was not. */
export const LINE_KINDS = [
  "attribute-entry",
  "block-attribute",
  "delimiter",
  "eligible",
  "inside-delimited",
  "marker",
] as const;

/** One line's kind. */
export type LineKind = (typeof LINE_KINDS)[number];

// A delimiter line opens or closes a block whose interior is verbatim
// or has its own whitespace rules. Perturbing a run on one of these
// lines changes which block the document has, not how a run inside it
// reads.
const DELIMITER =
  /^(?:-{4,}|={4,}|_{4,}|\.{4,}|\+{4,}|\/{4,}|\*{4,}|--|\|={3,}|,={3,}|:={3,}|!={3,})\s*$/v;

// An attribute entry's run is part of the attribute's VALUE, and a
// block attribute line's run is inside an attrlist the reference
// normalizes; both are their own measurements, made by the roster.
const ATTRIBUTE_ENTRY = /^:!?\w[\w\-]*!?:(?:\s|$)/v;
const BLOCK_ATTRIBUTE = /^\[.*\]\s*$/v;

// A marker line's leading run is structural: moving it moves the item
// in or out of a list. The whole line is skipped rather than the
// marker alone, which is cruder than it needs to be and is counted.
const LIST_MARKER = /^\s*(?:[*\-.]{1,5}|\d+\.|[a-zA-Z]\.|[ixvIXV]+\))\s+\S/v;
const CALLOUT = /^\s*<(?:\d+|\.)>/v;

/**
 * Classifies every line of a document, tracking delimited blocks with
 * a single-level toggle keyed on the exact delimiter string.
 *
 * Single-level is a real limit: a block nested inside another of the
 * same kind is mis-tracked. It is left that way on purpose, because
 * the honest alternative is to import the reader, and then the census
 * measures what the reader already believes.
 * @param lines - the document's lines, in order
 * @returns one kind per line, in the same order
 */
function lineKinds(lines: readonly string[]): LineKind[] {
  let openDelimiter: string | undefined = undefined;
  return lines.map((line) => {
    if (openDelimiter !== undefined) {
      const kind: LineKind = "inside-delimited";
      if (line.trim() === openDelimiter) {
        openDelimiter = undefined;
      }
      return kind;
    }
    if (DELIMITER.test(line)) {
      openDelimiter = line.trim();
      return "delimiter";
    }
    if (ATTRIBUTE_ENTRY.test(line)) {
      return "attribute-entry";
    }
    if (BLOCK_ATTRIBUTE.test(line)) {
      return "block-attribute";
    }
    if (LIST_MARKER.test(line) || CALLOUT.test(line)) {
      return "marker";
    }
    return "eligible";
  });
}

/** One perturbable run in a document. */
export interface DocumentRun {
  /** Zero-based line index. */
  readonly line: number;
  /** Zero-based column of the run's first character. */
  readonly column: number;
  /** The run itself, as the author spelled it. */
  readonly run: string;
}

/** What a scan of one document found, including what it skipped. */
export interface DocumentScan {
  /** The runs worth perturbing. */
  readonly runs: readonly DocumentRun[];
  /** Lines skipped, by the kind that skipped them. */
  readonly skippedLines: Readonly<Record<LineKind, number>>;
  /** Runs found at a line edge, where the alphabet is not well formed. */
  readonly edgeRuns: number;
}

/** Every whitespace run on one line, with its column. */
const RUN = /[ \t]+/gv;

/**
 * Finds every run this census will perturb, and counts what it left
 * behind so the report can say what was not measured.
 *
 * A run at a line edge is skipped because the alphabet is not well
 * formed there: replacing a leading run with a newline makes a blank
 * line, which changes the document's block structure rather than the
 * run's spelling.
 * @param source - the whole document
 * @returns the runs to perturb and the counts of what was skipped
 */
export function scanDocument(source: string): DocumentScan {
  const lines = source.split("\n");
  const kinds = lineKinds(lines);
  const runs: DocumentRun[] = [];
  const skippedLines: Record<LineKind, number> = {
    "attribute-entry": 0,
    "block-attribute": 0,
    delimiter: 0,
    eligible: 0,
    "inside-delimited": 0,
    marker: 0,
  };
  let edgeRuns = 0;
  for (const [index, line] of lines.entries()) {
    const kind = kinds[index];
    if (kind !== "eligible") {
      skippedLines[kind] += 1;
      continue;
    }
    for (const match of line.matchAll(RUN)) {
      const start = match.index;
      const end = start + match[0].length;
      if (start === 0 || end >= line.length) {
        edgeRuns += 1;
        continue;
      }
      runs.push({ line: index, column: start, run: match[0] });
    }
  }
  return { runs, skippedLines, edgeRuns };
}

/**
 * Rewrites one document with one run spelled differently.
 * @param source - the whole document
 * @param run - the run to respell
 * @param filler - what to write in its place
 * @returns the document with that one run replaced
 */
export function respell(
  source: string,
  run: DocumentRun,
  filler: string,
): string {
  const lines = source.split("\n");
  const line = lines[run.line];
  lines[run.line] =
    line.slice(0, run.column) +
    filler +
    line.slice(run.column + run.run.length);
  return lines.join("\n");
}

/** How much of the line either side of a run the report shows. */
const WINDOW = 15;

/**
 * The text around a run, for a report a person reads.
 * @param source - the whole document
 * @param run - the run to show
 * @returns up to fifteen characters either side of the run
 */
export function windowAround(source: string, run: DocumentRun): string {
  const line = source.split("\n")[run.line];
  const end = run.column + run.run.length;
  return line.slice(Math.max(run.column - WINDOW, 0), end + WINDOW);
}

// A section title line, whose whitespace has two roles: the run after
// the marker decides whether the line is a title at all, and a run in
// the title TEXT reaches the generated id.
const TITLE_LINE = /^\s*(?<mark>={1,6}|#{1,6})[ \t]+\S/v;

/** The construct guesses, in the order they are tried. */
const GUESSES: ReadonlyArray<readonly [RegExp, string]> = [
  [/`/v, "code span shelter"],
  [/(?:----|\.\.\.\.)/v, "verbatim block shelter"],
  [
    /(?:image|icon|menu|kbd|btn|link|xref|footnote|indexterm|anchor|pass|stem):/v,
    "macro target or attrlist",
  ],
  [/(?:<<|>>|\[\[)/v, "reference or anchor"],
  [/::/v, "description-list separator"],
];

/**
 * The guess a section title line gets: whether the run stands
 * between the marker and the title text, or inside the text.
 * @param line - the whole line
 * @param column - the run's column
 * @param mark - the title marker the line opens with
 * @returns which of the two title roles the run has
 */
function titleGuess(line: string, column: number, mark: string): string {
  return line.indexOf(mark) + mark.length === column
    ? "section title marker"
    : "section title text";
}

/**
 * The guesses that read the characters immediately beside the run: a
 * pattern for the text before it, one for the text after it, and the
 * name that wins when either matches. Adjacency beats the window,
 * because a run touching `--` is about the em-dash row whatever else
 * the line holds.
 */
const ADJACENT: ReadonlyArray<readonly [RegExp, RegExp, string]> = [
  [/--$/v, /^--/v, "em-dash replacement row"],
  [/\+$/v, /^\+\s*$/v, "hard break"],
  [/\}$/v, /^\{/v, "attribute reference"],
];

/**
 * Names the construct a position is probably about, from the text
 * around it.
 *
 * The guess groups the report; nothing decides on it. It is written
 * as ordered pattern lists because the alternative, asking the
 * reader, would tie the census to the model it exists to test.
 * @param source - the whole document
 * @param run - the run in question
 * @returns a construct name, or `unclassified`
 */
export function guessConstruct(source: string, run: DocumentRun): string {
  const line = source.split("\n")[run.line];
  const before = line.slice(0, run.column);
  const after = line.slice(run.column + run.run.length);
  const title = TITLE_LINE.exec(line);
  if (title !== null) {
    return titleGuess(line, run.column, title.groups?.mark ?? "");
  }
  const adjacent = ADJACENT.find(
    ([left, right]) => left.test(before) || right.test(after),
  );
  if (adjacent !== undefined) {
    return adjacent[2];
  }
  const window = windowAround(source, run);
  const guess = GUESSES.find(([pattern]) => pattern.test(window));
  return guess === undefined ? "unclassified" : guess[1];
}
