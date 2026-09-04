/**
 * The DECLINE CENSUS (issue #10): how many of the corpus's tables the
 * layout gate accepts, and how many decline under each reason.
 *
 * The gate is a closed union of reasons, and this file is the ratchet
 * on it. Every count is pinned EXACT IN BOTH DIRECTIONS, so a count
 * that falls fails here and a count that rises fails here, and either
 * way somebody has to say why in the diff. The reasons are a debt with
 * a measured size, and a debt nobody measures is a debt nobody pays.
 *
 * A ZERO in the ordered census is not by itself a "delete this reason"
 * signal, and two of them are zero. `unterminated` has exactly one
 * corpus table and that table also holds a multi-line cell, which is
 * an earlier reason, so the ordered count is an ORDERING fact and the
 * unordered count below is the reason's real population.
 * `attribute-reference` has no corpus population at all and is
 * expected not to: it is the only formulation the gate can evaluate
 * for a `cols` or `options` value the oracle substitutes before
 * parsing, and the rows in tests/format/table.test.ts are what fire
 * it.
 *
 * TWO CENSUSES, because they answer different questions. The ORDERED
 * one counts each declined table under the FIRST reason that fires, in
 * the union's declaration order, which is what a `TableDecline` value
 * IS; it is read off `planTable`'s own verdict rather than
 * reimplemented here. The UNORDERED one counts how many tables hold a
 * fact at all, which is what sizes a dependency: 66 tables holding a
 * multi-line cell is what issue #130 has to reach, and the smaller
 * ordered number is only what declines for it first.
 *
 * PER TABLE and PER DOCUMENT are different denominators and this file
 * never mixes them. A document with two tables contributes two tables
 * and one document, and a document counts as accepted only when EVERY
 * table in it is accepted.
 *
 * The corpus filter is `scanTables` (tests/parser/table-structure-scan.ts),
 * the same one the structure suite uses, so "a table" means the same
 * thing here as it does there.
 */
import { describe, expect, test } from "vitest";
import { loadCorpus } from "../conformance/loader.js";
import { scanTables } from "../parser/table-structure-scan.js";
import type { TableCellNode, TableNode } from "../../src/ast.js";
import { rstrip } from "../../src/parse/line-shapes.js";
import {
  planTable,
  type TableDecline,
  type TablePlan,
} from "../../src/print/table-layout.js";

/**
 * A census with every reason at zero, spelled out rather than built
 * from a list: an object literal of exactly the union's members is
 * what makes a reason added to `TableDecline` a compile error here
 * until this file counts it.
 * @returns one zero per reason, in the union's declaration order
 */
function emptyCensus(): Record<TableDecline, number> {
  return {
    "unread-attrlist": 0,
    "non-psv-format": 0,
    "multi-line-cell": 0,
    "literal-cell": 0,
    "leading-runs": 0,
    "dropped-comment": 0,
    "recovered-opening": 0,
    "ragged-rows": 0,
    unterminated: 0,
    "attribute-reference": 0,
  };
}

/**
 * Whether a cell's text spans source lines, restating the predicate
 * `src/print/table-layout.ts` applies:
 *
 * > Join a cell's `content` runs in order, each LINE as the reader
 * > hands it over. Strip TRAILING LINE FEEDS from the result, and
 * > nothing else: not spaces and not tabs. The cell spans lines if
 * > what remains still holds a line feed.
 *
 * The trailing-line-feed strip is there because a psv cell's buffer
 * carries the newline that ended the line it sat on
 * (`parser_ctx.buffer`, parser.rb:2391), so almost every cell would
 * otherwise be read as spanning lines. Stripping trailing WHITESPACE
 * from the joined text instead is the drift to guard against: it
 * cannot tell the last line of a two-line cell from the spaces that
 * end a one-line one.
 *
 * The per-line rstrip is the reader's own (`prepare_source_string`),
 * which is why a line carrying only spaces is not a second line here.
 * MEASURED: over this corpus a raw join and a reader-line join name
 * the same 66 tables, so the number below does not discriminate the
 * two and the row that does is the whitespace-only interior line in
 * tests/format/table.test.ts.
 *
 * RESTATED rather than imported. The gate exports its verdict, not its
 * parts, and the unordered population is a question about a fact
 * rather than about a verdict; the ordered census below is what holds
 * this spelling and the gate's own to the same answer, because a
 * drift in either moves a pinned number.
 * @param cell - the cell to read
 * @returns whether the cell's own text holds a line break
 */
function cellSpansLines(cell: TableCellNode): boolean {
  const text = cell.runs
    .filter((run) => run.kind === "content")
    .map((run) => run.image)
    .join("")
    .split("\n")
    .map(rstrip)
    .join("\n");
  return text.replace(/\n+$/v, "").includes("\n");
}

/**
 * Whether any of a table's cells spans source lines.
 * @param table - the table to read
 * @returns whether some cell's own text holds a line break
 */
function holdsMultiLineCell(table: TableNode): boolean {
  return table.children.some((row) => row.children.some(cellSpansLines));
}

/**
 * Whether the first row is already followed by a blank line in the
 * source.
 *
 * Read off the records: a blank line inside an open psv cell is a
 * `content` run of its own, so the last cell of the first row ends in
 * one line feed for the row's own line and one more for each blank
 * that follows it.
 *
 * A ONE-ROW table always answers false and is excluded by the caller,
 * because the blank line before a closing delimiter is the terminator
 * the printer owns rather than a byte any cell recorded.
 * @param table - the table to read
 * @returns whether a blank already follows the first row
 */
function blankFollowsFirstRow(table: TableNode): boolean {
  const last = table.children.at(0)?.children.at(-1);
  if (last === undefined) {
    return false;
  }
  const image = last.runs.map((run) => run.image).join("");
  return image.endsWith("\n\n");
}

/** One document's tables, each with the gate's verdict. */
interface Scanned {
  /** The table the reader built. */
  readonly table: TableNode;
  /** The reason it declined, or undefined when it was accepted. */
  readonly decline: TableDecline | undefined;
}

/**
 * One table, with the gate's own verdict on it.
 * @param table - the table the reader built
 * @returns the table and the reason it declined, if it did
 */
function verdictOf(table: TableNode): Scanned {
  const plan = planTable(table);
  return {
    table,
    decline: plan.kind === "replay" ? plan.decline : undefined,
  };
}

/**
 * Every table in the corpus, grouped by the document it came from.
 * @returns one entry per corpus document, tables in document order
 */
function scanCorpus(): Scanned[][] {
  const documents: Scanned[][] = [];
  for (const group of loadCorpus()) {
    for (const corpusCase of group.cases) {
      documents.push(
        scanTables(corpusCase.input).map((scanned) => verdictOf(scanned.table)),
      );
    }
  }
  return documents;
}

const DOCUMENTS = scanCorpus();
const TABLE_DOCUMENTS = DOCUMENTS.filter((tables) => tables.length > 0);
const TABLES = TABLE_DOCUMENTS.flat();

/**
 * How many tables declined under each reason.
 * @returns one count per reason, over every corpus table
 */
function orderedCensus(): Record<TableDecline, number> {
  const counts = emptyCensus();
  for (const { decline } of TABLES) {
    if (decline !== undefined) {
      counts[decline] += 1;
    }
  }
  return counts;
}

/**
 * How many documents hold at least one table declining under each
 * reason. A document with two tables declining for the same reason
 * counts once, which is what makes this a different number from the
 * per-table census and not a scaled copy of it.
 * @returns one count per reason, over every table-bearing document
 */
function orderedDocumentCensus(): Record<TableDecline, number> {
  const counts = emptyCensus();
  for (const tables of TABLE_DOCUMENTS) {
    const seen = new Set(
      tables.flatMap((scanned) =>
        scanned.decline === undefined ? [] : [scanned.decline],
      ),
    );
    for (const reason of seen) {
      counts[reason] += 1;
    }
  }
  return counts;
}

describe("the corpus the census is taken over", () => {
  // Three denominators, stated once. A per-document count and a
  // per-table count are different numbers, and every count below says
  // which one it is.
  test("documents, table-bearing documents, tables", () => {
    expect({
      documents: DOCUMENTS.length,
      tableDocuments: TABLE_DOCUMENTS.length,
      tables: TABLES.length,
    }).toEqual({ documents: 1614, tableDocuments: 154, tables: 173 });
  });
});

describe("the ordered decline census", () => {
  // EXACT IN BOTH DIRECTIONS, and that is the ratchet. A reason whose
  // count falls to zero fails here, so the union cannot quietly carry
  // a reason nothing fires; a reason whose count rises fails too, so a
  // gate that started declining more tables cannot land unexamined.
  test("every reason's population, first reason to fire", () => {
    expect(orderedCensus()).toEqual({
      "unread-attrlist": 3,
      "non-psv-format": 17,
      "multi-line-cell": 60,
      "literal-cell": 1,
      "leading-runs": 2,
      "dropped-comment": 2,
      "recovered-opening": 1,
      "ragged-rows": 5,
      unterminated: 0,
      "attribute-reference": 0,
    });
  });

  test("every reason's population, per document", () => {
    expect(orderedDocumentCensus()).toEqual({
      "unread-attrlist": 3,
      "non-psv-format": 17,
      "multi-line-cell": 53,
      "literal-cell": 1,
      "leading-runs": 2,
      "dropped-comment": 1,
      "recovered-opening": 1,
      "ragged-rows": 5,
      unterminated: 0,
      "attribute-reference": 0,
    });
  });
});

/**
 * Whether the gate accepted this table.
 * @param scanned - one table and its verdict
 * @returns whether it was laid out rather than replayed
 */
function isAccepted(scanned: Scanned): boolean {
  return scanned.decline === undefined;
}

/**
 * Whether this table holds a cell spanning source lines.
 * @param scanned - one table and its verdict
 * @returns whether the fact is present, whatever the verdict
 */
function spansLines(scanned: Scanned): boolean {
  return holdsMultiLineCell(scanned.table);
}

/**
 * `planTable` under the type that says what it reads: the TABLE, and
 * nothing else.
 *
 * THE ANNOTATION IS THE PIN, and it is a static one: a gate that took
 * the style as a second parameter is not assignable to this type, so
 * `bun run check` fails before any test runs. Nothing at runtime can
 * pin it, because there is no style to vary - the parameter the
 * annotation refuses is the parameter a runtime check would have to
 * pass. The row below is therefore a count taken THROUGH the
 * constrained signature: it pins the accepted population against the
 * same literal the census pins, so the static claim and a number stand
 * or fall together.
 */
const gateReadsTheTableAlone: (table: TableNode) => TablePlan = planTable;

describe("what the gate accepts", () => {
  // ONE census, not one per option value. The style reaches the
  // EMISSION alone (`chooseLayout`, src/print/table-layout.ts), where
  // it chooses between two spellings of a table already accepted, so
  // the accepted set is the same under both values of
  // `asciidocTableLayout` and every number in this file is a property
  // of the corpus rather than of one option value. A gate that read
  // the style would need this census taken twice, and it would mean a
  // document's tables stop being laid out when its author changes a
  // style preference. What runs the emission under both values is
  // tests/format/table-gate-stability.test.ts, which sweeps the whole
  // corpus twice.
  test("the gate accepts 82 tables reading nothing but the table", () => {
    expect(
      TABLES.filter(
        (scanned) => gateReadsTheTableAlone(scanned.table).kind === "laidOut",
      ).length,
    ).toBe(82);
  });

  test("accepted tables, and documents whose every table is accepted", () => {
    expect({
      tables: TABLES.filter(isAccepted).length,
      documents: TABLE_DOCUMENTS.filter((tables) => tables.every(isAccepted))
        .length,
    }).toEqual({ tables: 82, documents: 72 });
  });

  // MIXED documents: one file holding both an accepted table and a
  // declined one, so a reader meets two spellings side by side. This
  // is the population a per-document gate would change, and its size
  // is what that change would cost.
  test("documents holding both an accepted and a declined table", () => {
    const mixed = TABLE_DOCUMENTS.filter(
      (tables) => tables.some(isAccepted) && !tables.every(isAccepted),
    );
    expect(mixed.length).toBe(3);
  });
});

describe("the unordered populations", () => {
  // The `unterminated` reason's real population. Its ORDERED count is
  // zero because the one table it names also holds a multi-line cell,
  // which is tested first; that is an ordering fact and not an empty
  // reason, and this is the pin that says so.
  test("tables with no closing delimiter line", () => {
    expect(
      TABLES.filter((scanned) => scanned.table.close.kind === "endOfStream")
        .length,
    ).toBe(1);
  });

  // A DIFFERENT number from the ordered one, and the one that sizes
  // issue #130: the ordered count is how many tables decline for a
  // multi-line cell FIRST, and this is how many hold one at all.
  //
  // The gap between the two is where every other reason's ordered
  // count went: 60 tables decline for a multi-line cell before any
  // later reason is reached, and six more hold one behind an earlier
  // reason.
  test("tables and documents holding a multi-line cell", () => {
    expect({
      tables: TABLES.filter(spansLines).length,
      documents: TABLE_DOCUMENTS.filter((tables) => tables.some(spansLines))
        .length,
    }).toEqual({ tables: 66, documents: 59 });
  });

  // The population the header-verdict blank line moves. The printer
  // writes one blank after the first row for every header verdict,
  // including `"explicit"`, where the blank is optional rather than
  // required; narrowing that clause to `"implicit"` would stop writing
  // it for these tables, and this is how many there are.
  test("accepted tables with an explicit header, and those gaining a blank", () => {
    const explicit = TABLES.filter(
      (scanned) => isAccepted(scanned) && scanned.table.header === "explicit",
    ).map((scanned) => scanned.table);
    expect({
      explicit: explicit.length,
      gainingTheBlank: explicit.filter(
        (table) => table.children.length > 1 && !blankFollowsFirstRow(table),
      ).length,
    }).toEqual({ explicit: 5, gainingTheBlank: 5 });
  });
});
