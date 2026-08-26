/**
 * What a local-documents run MEANS: the classifier and the report.
 *
 * Pure by design. Everything here is a function from `CheckResult[]`
 * to numbers and strings, with no filesystem, no formatter and no
 * oracle in reach - which is what lets the failure paths be tested
 * against literal results rather than against a corpus that happens
 * to contain today's bugs. The I/O half is `local-documents-checks.ts`.
 *
 * The report is a discovery instrument, not a gate's evidence: a real
 * corpus is private, so what a run prints is read by the person who
 * ran it and goes no further. A finding leaves this harness as a
 * MINIMAL SYNTHETIC REPRO, hand-written from scratch. The detail sits
 * on the same line as the id for that reader's sake - it is the line
 * somebody READS while writing the repro, never a line to paste
 * anywhere, because the id is a real document's path. See
 * docs/harnesses.md.
 */
import type { CheckName, CheckResult } from "./local-documents-checks.js";

/** The order every roll-up reports the four checks in. */
const CHECK_ORDER: readonly CheckName[] = [
  "format",
  "reformat",
  "idempotence",
  "render",
];

/** Column width the family tables right-align their counts to. */
const COUNT_WIDTH = 5;

/** How many of the slowest and largest documents the report names. */
const EXTREMES_SHOWN = 5;

/** Milliseconds in the second the header prints. */
const MILLISECONDS_PER_SECOND = 1000;

/** What one run of the harness comes to. */
export interface LocalDocumentsSummary {
  /** How many documents were checked. */
  readonly documents: number;
  /** How many failed at least one check. */
  readonly failing: number;
  /** The failure families that have at least one document. */
  readonly failed: ReadonlyArray<{
    /** The check this roll is about. */
    readonly family: CheckName;
    /** The ids that landed in it, in the order the run produced them. */
    readonly documents: readonly string[];
  }>;
  /** The unassessed families that have at least one document. */
  readonly unassessed: ReadonlyArray<{
    /** The check this roll is about. */
    readonly family: CheckName;
    /** The ids that landed in it, in the order the run produced them. */
    readonly documents: readonly string[];
  }>;
  /** The results that failed something, in run order. */
  readonly failures: readonly CheckResult[];
  /** The slowest documents, longest first. */
  readonly slowest: ReadonlyArray<{
    /** The document's id. */
    readonly id: string;
    /** Wall time, milliseconds. */
    readonly elapsed: number;
  }>;
  /** The largest documents, biggest first. */
  readonly largest: ReadonlyArray<{
    /** The document's id. */
    readonly id: string;
    /** How many characters it holds. */
    readonly size: number;
  }>;
  /** Total wall time over every document, milliseconds. */
  readonly elapsed: number;
}

// Named by indexed access rather than declared as exported
// interfaces: a consumer can still spell them
// (`LocalDocumentsSummary["failed"][number]`), while an exported type
// nothing imports is what the scorecard's knip row counts.
type FamilyRoll = LocalDocumentsSummary["failed"][number];
type DocumentTime = LocalDocumentsSummary["slowest"][number];
type DocumentSize = LocalDocumentsSummary["largest"][number];

/**
 * Roll a run's results up into what the report prints and the exit
 * code is taken from.
 * @param results - one result per document, in run order
 * @returns the summary
 */
export function classify(
  results: readonly CheckResult[],
): LocalDocumentsSummary {
  const failures = results.filter((result) => result.failures.length > 0);
  return {
    documents: results.length,
    failing: failures.length,
    failed: rolls(results, (result) => result.failures),
    unassessed: rolls(results, (result) => result.unassessed),
    failures,
    slowest: results
      .map((result) => ({ id: result.id, elapsed: result.elapsed }))
      .toSorted((left, right) => right.elapsed - left.elapsed)
      .slice(0, EXTREMES_SHOWN),
    largest: results
      .map((result) => ({ id: result.id, size: result.size }))
      .toSorted((left, right) => right.size - left.size)
      .slice(0, EXTREMES_SHOWN),
    elapsed: results.reduce((total, result) => total + result.elapsed, 0),
  };
}

/**
 * Group results by check, dropping the checks nothing landed in.
 *
 * Empty families are dropped rather than printed as zeroes: this is a
 * discovery report over a corpus that changes under it, and four rows
 * of which two say nothing is three rows too many.
 * @param results - one result per document, in run order
 * @param pick - which of a result's two check lists to group by
 * @returns one roll per non-empty family, in check order
 */
function rolls(
  results: readonly CheckResult[],
  pick: (result: CheckResult) => readonly CheckName[],
): FamilyRoll[] {
  return CHECK_ORDER.map((family) => ({
    family,
    documents: results
      .filter((result) => pick(result).includes(family))
      .map((result) => result.id),
  })).filter((roll) => roll.documents.length > 0);
}

/**
 * The whole report, one line per element, ready to print.
 *
 * Takes the SUMMARY rather than the results, so a run classifies once
 * and the exit code is read off the same numbers the report printed.
 * @param summary - what {@link classify} made of the run
 * @param limit - how many failing documents to name individually
 * @returns the report's lines, without trailing newlines
 */
export function reportLines(
  summary: LocalDocumentsSummary,
  limit: number,
): string[] {
  const seconds = (summary.elapsed / MILLISECONDS_PER_SECOND).toFixed(1);
  const lines = [
    `local-docs: ${String(summary.documents)} documents, ${String(summary.failing)} failing (${seconds} s)`,
    ...familyTable("failures by check", summary.failed),
    ...familyTable("unassessed checks", summary.unassessed),
    ...failingDocuments(summary.failures, limit),
  ];
  if (summary.failing === 0) lines.push(cleanHeadline(summary));
  lines.push(...slowestLine(summary.slowest), ...largestLine(summary.largest));
  return lines;
}

/**
 * A family count table, or nothing when the family list is empty.
 * @param heading - what the table is about
 * @param family - the rolls to print
 * @returns the heading and one line per roll, or no lines at all
 */
function familyTable(heading: string, family: readonly FamilyRoll[]): string[] {
  if (family.length === 0) return [];
  return [
    `local-docs: ${heading}:`,
    ...family.map(
      (roll) =>
        `  ${String(roll.documents.length).padStart(COUNT_WIDTH)} ${roll.family}`,
    ),
  ];
}

/**
 * Name the failing documents, one line each, up to the limit.
 * @param failures - the results that failed something, in run order
 * @param limit - how many to name
 * @returns the heading and one line per named document
 */
function failingDocuments(
  failures: readonly CheckResult[],
  limit: number,
): string[] {
  if (failures.length === 0) return [];
  const shown = failures.slice(0, limit);
  const heading =
    shown.length === failures.length
      ? `local-docs: the ${String(failures.length)} failing documents:`
      : `local-docs: ${String(shown.length)} of ${String(failures.length)} failing documents:`;
  return [
    heading,
    ...shown.map(
      (result) =>
        `  ${result.id} [${result.failures.join(", ")}] ${result.detail}`,
    ),
  ];
}

/**
 * The headline a clean run gets.
 *
 * It may claim only what was MEASURED. A corpus whose renders were
 * all unassessed has had no render comparison at all, and a sentence
 * saying every document "rendered the same" over a check that never
 * ran is the quiet failure this repository's exit-code doctrine
 * exists against. Parsing and settling WERE measured, so such a run
 * is not the measured-nothing floor and its exit code stays 0; the
 * sentence is the part that has to be honest.
 * @param summary - the run's summary
 * @returns the line
 */
function cleanHeadline(summary: LocalDocumentsSummary): string {
  const unassessedRender = summary.unassessed.some(
    (roll) => roll.family === "render",
  );
  const claim = unassessedRender
    ? "every document parsed and settled"
    : "every document parsed, settled and rendered the same";
  return `local-docs: ${claim}${unassessedNote(summary)}`;
}

/**
 * The clause a clean run's headline carries when some check could not
 * be assessed.
 * @param summary - the run's summary
 * @returns the clause, or the empty string when everything was
 *   assessed
 */
function unassessedNote(summary: LocalDocumentsSummary): string {
  if (summary.unassessed.length === 0) return "";
  const spelled = summary.unassessed
    .map((roll) => `${String(roll.documents.length)} ${roll.family}`)
    .join(", ");
  return ` (unassessed: ${spelled})`;
}

/**
 * The slowest-documents line: a formatter that takes ten seconds over
 * one real document is a finding, and nothing else in the report
 * would show it.
 * @param slowest - the slowest documents, longest first
 * @returns the line, or nothing when the run measured no documents
 */
function slowestLine(slowest: readonly DocumentTime[]): string[] {
  if (slowest.length === 0) return [];
  const spelled = slowest
    .map((one) => `${one.id} ${String(one.elapsed)} ms`)
    .join(", ");
  return [`local-docs: slowest: ${spelled}`];
}

/**
 * The largest-documents line, beside the slowest one because the two
 * DISAGREEING is the interesting case: a small document that is slow
 * to format is a finding, and a big one that is fast says the corpus
 * is not being read the way its size suggests.
 * @param largest - the largest documents, biggest first
 * @returns the line, or nothing when the run measured no documents
 */
function largestLine(largest: readonly DocumentSize[]): string[] {
  if (largest.length === 0) return [];
  const spelled = largest
    .map((one) => `${one.id} ${String(one.size)} chars`)
    .join(", ");
  return [`local-docs: largest: ${spelled}`];
}
