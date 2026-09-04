/**
 * Table structure (issue #10): the SCAN driven directly over the
 * corpus's table cases, compared against the oracle's own parsed
 * model.
 *
 * The scan, build and flattening machinery lives in
 * table-structure-scan.ts (split out to stay under the repo's line
 * ceiling); this file loads the corpus, classifies every table each
 * case's scan and the oracle's `findBy` both find as excluded or
 * comparable, and asserts: the structural comparison, the byte
 * partition each built table's own records must satisfy regardless of
 * the oracle, and the exclusion accounting itself.
 *
 * The oracle side is `oracleTables` (tests/helpers.ts), which reads
 * `@asciidoctor/core`'s parsed model directly rather than rendered
 * HTML: `table.rows`, and each cell's `source()` (its text BEFORE
 * substitutions, the same question this suite's own text asks),
 * `colspan`, `rowspan` and `getAttributes()`.
 */
import { describe, expect, test } from "vitest";
import {
  flattenRow,
  hasPreprocessorLine,
  hasSplittingDuplicate,
  scanTables,
  type Exclusion,
  type FlatCell,
  type ScannedTable,
} from "./table-structure-scan.js";
import { allowsOverhang, replayTable } from "./table-nodes.js";
import { oracleTables, type OracleTable } from "../helpers.js";
import { parseJsonl, type CorpusCase } from "../conformance/loader.js";

// ---------------------------------------------------------------------------
// The corpus
// ---------------------------------------------------------------------------

/** One case, paired with the table(s) `parse()` finds in it. */
interface TableCase extends CorpusCase {
  /** Which corpus file this case came from. */
  readonly group: string;
}

const TABLES_CORPUS: TableCase[] = parseJsonl(
  "vendor/asciidoctor-corpus/tables_test.jsonl",
).map((entry) => ({ ...entry, group: "tables_test" }));

/**
 * Case ids `tableBearingCases` caught a throw for while deciding
 * table-bearing-ness, rather than a clean "no table" answer: a
 * regression-only bucket (see `SCAN_FILTER_ERRORS` empty test), since
 * a throw here silently drops the case from `ALL_CASES` before
 * `classify` ever gets a chance to give it a named exclusion - the
 * one way this suite's own accounting could hide a real case instead
 * of naming it.
 */
const SCAN_FILTER_ERRORS: string[] = [];

/**
 * Table-bearing cases from a corpus file that is not itself all
 * tables: filtered by the same rule {@link scanTables} answers with a
 * non-empty result, so "table-bearing" means exactly what this suite
 * can scan (a `|===` inside a `////` comment block or a listing is
 * not table-bearing, because `parse()` never descends into either to
 * find one). A throw counts as "not table-bearing" too, but is
 * recorded to `SCAN_FILTER_ERRORS` first rather than swallowed
 * silently.
 * @param path - the corpus file's repo-relative path
 * @param group - the group name to stamp on each case
 * @returns the cases that hold at least one table
 */
function tableBearingCases(path: string, group: string): TableCase[] {
  return parseJsonl(path)
    .filter((entry) => {
      try {
        return scanTables(entry.input).length > 0;
      } catch {
        SCAN_FILTER_ERRORS.push(entry.id);
        return false;
      }
    })
    .map((entry) => ({ ...entry, group }));
}

const DOCS_CORPUS = tableBearingCases(
  "vendor/asciidoctor-corpus/docs.jsonl",
  "docs",
);
const BLOCKS_CORPUS = tableBearingCases(
  "vendor/asciidoctor-corpus/blocks_test.jsonl",
  "blocks_test",
);

const ALL_CASES = [...TABLES_CORPUS, ...DOCS_CORPUS, ...BLOCKS_CORPUS];

// ---------------------------------------------------------------------------
// Labeling: a case with more than one table needs one id per table
// ---------------------------------------------------------------------------

/** One table `scanTables` found in a case, labeled for a test name. */
interface LabeledScan extends ScannedTable {
  /** The case id, `#N` suffixed when the case holds more than one table. */
  readonly id: string;
  /** Which corpus file this case came from. */
  readonly group: string;
}

/**
 * Scan `entry` and label each table it finds. A case with exactly one
 * table keeps the case's own id; a case with more than one gets `#0`,
 * `#1`, ... appended, in document order.
 * @param entry - the corpus case
 * @returns the case's tables, labeled
 */
function labeledScans(entry: TableCase): LabeledScan[] {
  const scanned = scanTables(entry.input);
  return scanned.map((one, index) => ({
    ...one,
    id: scanned.length > 1 ? `${entry.id}#${String(index)}` : entry.id,
    group: entry.group,
  }));
}

const ALL_SCANNED: LabeledScan[] = ALL_CASES.flatMap(labeledScans);

// ---------------------------------------------------------------------------
// Classification: excluded with a reason and a family, or comparable
// ---------------------------------------------------------------------------

/**
 * The named reason categories this suite excludes a table for.
 * `no-table-scanned`, `no-table-oracle` and `table-count-mismatch` are
 * SELF-REFERENTIAL: this suite's own corpus filter (`tableBearingCases`)
 * and `oracleTables` already agree on which cases hold a table, so
 * these three are reachable only through a regression in this suite
 * itself, never through a real corpus case, and the pinned-count test
 * below asserts each is empty rather than merely small.
 */
type ExclusionFamily =
  | "preprocessor"
  | "oracle-logged"
  | "duplicate-split"
  | "no-table-scanned"
  | "no-table-oracle"
  | "table-count-mismatch";

/** One case this suite declined to compare, and why. */
interface ExcludedCase extends Exclusion {
  /** Node discriminant. */
  readonly kind: "excluded";
  /** Which corpus file this case came from. */
  readonly group: string;
  /** The named category this exclusion belongs to. */
  readonly family: ExclusionFamily;
  /** The oracle's own logged severities, for the `oracle-logged` family. */
  readonly severities?: readonly string[];
}

/** One case, scanned, built and ready for straight-line assertions. */
interface ComparableCase {
  /** Node discriminant. */
  readonly kind: "comparable";
  /** The corpus case id, `#N` suffixed for a multi-table case. */
  readonly id: string;
  /** Which corpus file this case came from. */
  readonly group: string;
  /** This reader's rows, flattened to the oracle's own per-cell shape. */
  readonly ourRows: FlatCell[][];
  /** Whether this reader's header verdict is anything but `"none"`. */
  readonly ourHeader: boolean;
  /** This reader's footer verdict. */
  readonly ourFooter: boolean;
  /** This reader's column count, when a `cols` value was present. */
  readonly ourColcount: number | undefined;
  /** The oracle's own structural read of the same table. */
  readonly oracle: OracleTable;
}

/**
 * Classify every table one corpus case holds: excluded with a reason,
 * or scanned, built and paired with the oracle's own read, ready for
 * a test with no conditional of its own. Every branch below RETURNS
 * rather than falling through, so no later step ever runs after an
 * earlier one has already decided a table's fate.
 * @param entry - the corpus case
 * @returns one classification per table this reader and the oracle
 *   agree the case holds (or one whole-case exclusion, for the
 *   reasons that apply before any table is even paired up)
 */
async function classify(
  entry: TableCase,
): Promise<Array<ExcludedCase | ComparableCase>> {
  const { id, group, input } = entry;
  if (hasPreprocessorLine(input)) {
    return [
      {
        kind: "excluded",
        id,
        group,
        family: "preprocessor",
        reason: "preprocessor line anywhere in the case (issue #131)",
      },
    ];
  }
  const oracle = await oracleTables(input);
  const scanned = labeledScans(entry);
  if (scanned.length === 0) {
    return [
      {
        kind: "excluded",
        id,
        group,
        family: "no-table-scanned",
        reason: "this reader found no table to scan",
      },
    ];
  }
  if (oracle.length === 0) {
    return [
      {
        kind: "excluded",
        id,
        group,
        family: "no-table-oracle",
        reason: "oracle found no table context",
      },
    ];
  }
  if (scanned.length !== oracle.length) {
    return [
      {
        kind: "excluded",
        id,
        group,
        family: "table-count-mismatch",
        reason: `this reader found ${String(scanned.length)} table(s), the oracle found ${String(oracle.length)}`,
      },
    ];
  }
  return scanned.map((one, index) => {
    const oracleTable = oracle[index];
    if (oracleTable.severities.length > 0) {
      return {
        kind: "excluded",
        id: one.id,
        group,
        family: "oracle-logged",
        reason: `the oracle's own read logged a message (${oracleTable.severities.join(", ")})`,
        severities: oracleTable.severities,
      };
    }
    if (hasSplittingDuplicate(one.table)) {
      return {
        kind: "excluded",
        id: one.id,
        group,
        family: "duplicate-split",
        reason:
          "N* duplicate cell spec splits across oracle rows: groupRows counts a duplicate's visits all at once (its own documented divergence, src/parse/lines/table-reader.ts), so a row boundary inside this duplicate's own repetitions is not something this reader's one recorded cell can reproduce (issue #10)",
      };
    }
    return {
      kind: "comparable",
      id: one.id,
      group,
      ourRows: one.table.children.map((row) =>
        flattenRow(row, one.cutting, one.table.columns),
      ),
      ourHeader: one.table.header !== "none",
      ourFooter: one.table.footer,
      ourColcount: one.table.columns?.length,
      oracle: oracleTable,
    };
  });
}

const CLASSIFIED_BY_CASE = await Promise.all(ALL_CASES.map(classify));
const CLASSIFIED = CLASSIFIED_BY_CASE.flat();
const EXCLUDED = CLASSIFIED.filter(
  (one): one is ExcludedCase => one.kind === "excluded",
);
const COMPARABLE = CLASSIFIED.filter(
  (one): one is ComparableCase => one.kind === "comparable",
);

/**
 * How many tables {@link EXCLUDED} carries per family.
 * @returns the per-family counts
 */
function excludedCountsByFamily(): Record<ExclusionFamily, number> {
  const counts: Record<ExclusionFamily, number> = {
    preprocessor: 0,
    "oracle-logged": 0,
    "duplicate-split": 0,
    "no-table-scanned": 0,
    "no-table-oracle": 0,
    "table-count-mismatch": 0,
  };
  for (const one of EXCLUDED) {
    counts[one.family] += 1;
  }
  return counts;
}

/** Every cell across {@link COMPARABLE}'s own rows, flattened once. */
const ALL_COMPARED_CELLS: FlatCell[] = COMPARABLE.flatMap((one) =>
  one.ourRows.flat(),
);

describe("table structure vs the oracle", () => {
  test.each(COMPARABLE)("$group: $id", (comparable) => {
    const { id, ourRows, ourHeader, ourFooter, ourColcount, oracle } =
      comparable;

    // Row grouping: our row lengths equal the oracle's head+body+foot
    // row lengths, in order (design 5.1).
    expect(
      ourRows.map((row) => row.length),
      `${id}: row cell counts`,
    ).toEqual(oracle.rows.map((row) => row.length));

    // Header and footer verdicts.
    expect(ourHeader, `${id}: header verdict`).toBe(oracle.head === 1);
    expect(ourFooter, `${id}: footer verdict`).toBe(oracle.foot === 1);

    // Column count, only when a `cols` value was present: vacuous
    // (compares `oracle.colcount` to itself) when it was not, which
    // is how this stays one unconditional assertion.
    expect(ourColcount ?? oracle.colcount, `${id}: colcount`).toBe(
      oracle.colcount,
    );

    // Cell text and specs, row for row, cell for cell. A styled
    // cell's `text` is undefined (see `cellText`); comparing it to
    // the oracle's own value there is likewise vacuous.
    for (const [rowIndex, ourRow] of ourRows.entries()) {
      const oracleRow = oracle.rows[rowIndex];
      const oracleSpecRow = oracle.specs[rowIndex];
      for (const [cellIndex, cell] of ourRow.entries()) {
        const label = `${id}: row ${String(rowIndex)} cell ${String(cellIndex)}`;
        expect(cell.text ?? oracleRow[cellIndex], `${label} text`).toBe(
          oracleRow[cellIndex],
        );
        expect(cell.spec, `${label} spec`).toEqual(oracleSpecRow[cellIndex]);
      }
    }
  });

  // Independent of the oracle: every table this reader builds, from
  // every case (excluded ones included, since this is a fact about
  // this reader's own records, not about agreement with the oracle),
  // replays the bytes of the extent its position names, with only the
  // overhang its close kind allows (`allowsOverhang`,
  // tests/parser/table-nodes.ts). Every corpus table closes on its
  // terminator, so every row here is really asserting EQUALITY.
  test.each(ALL_SCANNED)("$group: $id replays its own bytes", (scanned) => {
    const replayed = replayTable(scanned.table);
    expect(scanned.content.startsWith(replayed)).toBe(true);
    expect(
      allowsOverhang(scanned.table, scanned.content.slice(replayed.length)),
    ).toBe(true);
  });

  test("exclusion counts are pinned per family", () => {
    const counts = excludedCountsByFamily();
    expect(counts, JSON.stringify(counts, undefined, 2)).toEqual({
      preprocessor: 2,
      "oracle-logged": 11,
      "duplicate-split": 1,
      "no-table-scanned": 0,
      "no-table-oracle": 0,
      "table-count-mismatch": 0,
    });
  });

  test("the exclusion list is non-vacuous and small", () => {
    const universe = EXCLUDED.length + COMPARABLE.length;
    expect(
      EXCLUDED.length,
      JSON.stringify(EXCLUDED, undefined, 2),
    ).toBeGreaterThan(0);
    expect(EXCLUDED.length).toBeLessThan(universe / 4);
  });

  test("oracle-logged exclusions are ERROR or WARN", () => {
    const logged = EXCLUDED.filter((one) => one.family === "oracle-logged");
    expect(logged.length).toBeGreaterThan(0);
    for (const one of logged) {
      for (const severity of one.severities ?? []) {
        expect(["ERROR", "WARN"]).toContain(severity);
      }
    }
  });

  // The header-row style-suppression gap `resolvedSpec` documents
  // widens this suite's cell-text skip: bounded here, exactly, rather
  // than left open-ended.
  test("skipped cell text is pinned", () => {
    const skipped = ALL_COMPARED_CELLS.filter(
      (cell) => cell.text === undefined,
    ).length;
    expect(skipped).toBe(62);
  });

  test("the corpus actually fed this suite something", () => {
    expect(TABLES_CORPUS.length).toBeGreaterThan(0);
    expect(ALL_CASES.length).toBeGreaterThanOrEqual(TABLES_CORPUS.length);
    expect(ALL_SCANNED.length).toBeGreaterThanOrEqual(ALL_CASES.length);
  });

  test("the table-bearing filter threw for nothing", () => {
    expect(SCAN_FILTER_ERRORS, JSON.stringify(SCAN_FILTER_ERRORS)).toEqual([]);
  });
});
