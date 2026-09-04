/**
 * GATE STABILITY (issue #10): the printer's own output must be re-read
 * as an ACCEPTED table, not merely as the same bytes.
 *
 * This is a second acceptance criterion beside byte idempotency, and
 * it is specific to a printer with a decline arm. A form that renders
 * correctly, is byte-stable, and DECLINES on re-read freezes a table
 * in whatever state the first pass left it, silently and permanently:
 * the bytes never move again, so no byte-level check ever sees it.
 * Nothing else in the harness set asks this question, and a change
 * that adds a decline reason without extending this file can freeze
 * tables with every other gate green.
 *
 * Counted PER TABLE, never per document. A document holding two
 * frozen tables is two flips, and counting it as one is how a rule
 * that freezes half the corpus can look survivable.
 *
 * The corpus half runs over every case holding at least one accepted
 * table. The two rows after it are shapes the corpus does not spell,
 * and they are the two a careless blank-line rule freezes first.
 */
import { describe, expect, test } from "vitest";
import { loadCorpus } from "../conformance/loader.js";
import { formatAdoc } from "../helpers.js";
import { scanTables } from "../parser/table-structure-scan.js";
import { planTable } from "../../src/print/table-layout.js";

/**
 * Which of a document's tables the gate accepts, in document order.
 * @param source - the document to read
 * @returns one verdict per table, `true` where it was laid out
 */
function acceptance(source: string): boolean[] {
  return scanTables(source).map(
    ({ table }) => planTable(table).kind === "laidOut",
  );
}

/**
 * The flips formatting `source` produces: one row per table that was
 * accepted on the way in and is not on the way out, plus one row when
 * the output does not even hold the same number of tables.
 *
 * TWO PASSES, because one is not enough to see the failure this file
 * is about. A form can survive its first re-read and lose the gate on
 * its second, and the second pass is the one whose output a repository
 * actually keeps.
 * @param source - the document to format twice and re-read after each
 * @returns one printable row per flip, empty when the gate held
 */
async function flipsOf(source: string): Promise<string[]> {
  const before = acceptance(source);
  const once = await formatAdoc(source);
  const twice = await formatAdoc(once);
  return [once, twice].flatMap((output, index) =>
    frozenIn(before, acceptance(output), index + 1),
  );
}

/**
 * The flips between one pass's verdicts and the input's.
 * @param before - the input's verdicts, in document order
 * @param after - the output's verdicts, in document order
 * @param pass - which pass produced `after`, for the message
 * @returns one printable row per flip, empty when the gate held
 */
function frozenIn(
  before: readonly boolean[],
  after: readonly boolean[],
  pass: number,
): string[] {
  if (before.length !== after.length) {
    return [
      `pass ${String(pass)}: tables ${String(before.length)} -> ${String(after.length)}`,
    ];
  }
  return before.flatMap((accepted, index) =>
    accepted && !after[index]
      ? [`pass ${String(pass)}: table ${String(index)} froze`]
      : [],
  );
}

describe("every accepted corpus table is accepted again after formatting", () => {
  const cases = loadCorpus()
    .flatMap((group) => group.cases)
    .filter((corpusCase) => acceptance(corpusCase.input).includes(true));

  // Non-vacuous by assertion, not by hope: an empty list here would
  // make every row below pass and prove nothing.
  test("the population is not empty", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  test.each(cases.map((corpusCase) => [corpusCase.id, corpusCase.input]))(
    "%s",
    async (_id, input) => {
      expect(await flipsOf(input)).toEqual([]);
    },
  );
});

describe("the shapes the corpus does not spell", () => {
  // A HEADERLESS table is the whole population a leading-blank rule
  // would be for: a leading blank line is a byte-only spelling of
  // `%noheader` and renders identically, and writing one would make
  // the table decline for `leading-runs` on the very next read. The
  // printer must never write one, and this row is what says so for
  // the shape that would freeze.
  test("a headerless two-row table", async () => {
    expect(await flipsOf("|===\n|a |b\n|c |d\n|===\n")).toEqual([]);
  });

  // A ONE-ROW IMPLICIT-HEADER table is the case a blank line derived
  // from ROW SEPARATION deletes: there is no second row to separate
  // it from, and deleting the blank loses the header outright.
  test("a one-row implicit-header table", async () => {
    expect(await flipsOf("|===\n|Column 1 |Column 2\n\n|===\n")).toEqual([]);
  });
});
