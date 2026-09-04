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
 *
 * TAKEN ONCE PER STYLE VALUE. The gate reads the table and never the
 * style, so which tables go in is one set; what comes OUT is a
 * different emission under each value, and freezing is a property of
 * what was written. The cell emission is where the question bites
 * hardest, because its rows are separated by blank lines wherever the
 * header verdict allows and a blank in the wrong place either forges a
 * header or is the `leading-runs` decline itself.
 */
import { describe, expect, test } from "vitest";
import { loadCorpus } from "../conformance/loader.js";
import { formatAdoc, type FormatOverrides } from "../helpers.js";
import { scanTables } from "../parser/table-structure-scan.js";
import { planTable } from "../../src/print/table-layout.js";

/**
 * The styles the whole sweep is taken under: the default, where the
 * width chooses, and one cell per line whatever the width.
 */
const VARIANTS: Array<[string, FormatOverrides | undefined]> = [
  ["the default row style", undefined],
  ["the cell style", { asciidocTableLayout: "cell" }],
];

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
 * @param overrides - the style to format under, both passes
 * @returns one printable row per flip, empty when the gate held
 */
async function flipsOf(
  source: string,
  overrides: FormatOverrides | undefined,
): Promise<string[]> {
  const before = acceptance(source);
  const once = await formatAdoc(source, overrides);
  const twice = await formatAdoc(once, overrides);
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

// The population, read ONCE: the gate takes no style, so which cases
// hold an accepted table is the same list under either variant.
const CASES = loadCorpus()
  .flatMap((group) => group.cases)
  .filter((corpusCase) => acceptance(corpusCase.input).includes(true));

describe.each(VARIANTS)("under %s", (_style, overrides) => {
  describe("every accepted corpus table is accepted again after formatting", () => {
    // Non-vacuous by assertion, not by hope: an empty list here would
    // make every row below pass and prove nothing.
    test("the population is not empty", () => {
      expect(CASES.length).toBeGreaterThan(0);
    });

    test.each(CASES.map((corpusCase) => [corpusCase.id, corpusCase.input]))(
      "%s",
      async (_id, input) => {
        expect(await flipsOf(input, overrides)).toEqual([]);
      },
    );
  });

  describe("the shapes the corpus does not spell", () => {
    // A HEADERLESS table is the whole population a leading-blank rule
    // would be for: a leading blank line is a byte-only spelling of
    // `%noheader` and renders identically, and writing one would make
    // the table decline for `leading-runs` on the very next read. The
    // printer must never write one, and this row is what says so for
    // the shape that would freeze. Under the cell style it is also the
    // shape that gets no row separation at all, which is the price of
    // the same fact.
    test("a headerless two-row table", async () => {
      expect(await flipsOf("|===\n|a |b\n|c |d\n|===\n", overrides)).toEqual(
        [],
      );
    });

    // A ONE-ROW IMPLICIT-HEADER table is the case a blank line derived
    // from ROW SEPARATION deletes: there is no second row to separate
    // it from, and deleting the blank loses the header outright.
    test("a one-row implicit-header table", async () => {
      expect(
        await flipsOf("|===\n|Column 1 |Column 2\n\n|===\n", overrides),
      ).toEqual([]);
    });
  });
});
