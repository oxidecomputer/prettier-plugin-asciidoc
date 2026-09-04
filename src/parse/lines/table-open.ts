/**
 * What a table's OPEN decides (issue #10), and the one call that hands
 * a builder everything a table node is made of.
 *
 * The scan beside this file (table-reader.ts) answers where cells are
 * cut once it is told HOW; this module answers the how, from the two
 * things the opening line has: the delimiter's own hint character
 * (lines/open-style.ts resolved it) and the block-attribute line the
 * reader held above it. Both answers are Asciidoctor's
 * `Table::ParserContext#initialize` (table.rb:455-486) and
 * `parse_table`'s head (parser.rb:2295-2311), with its mutable context
 * written as a value.
 *
 * The attribute VALUES come from src/parse/attrlist.ts, never from a
 * split of this file's own: one interior, one set of field
 * boundaries, so `cols="1,1"` reads here exactly as the printer
 * spells it back.
 *
 * A MODULE and not two more arms of the ones beside it, for two
 * reasons that both bite. `resolveDelimitedOpen` (lines/open-style.ts)
 * is pure over (delimiter kind x held style) and cannot see the held
 * ANNOTATION at all, which is where `format`, `separator`, `cols` and
 * the options are written - so the open cannot finish there. And
 * lines/reader.ts, the one place that holds both the annotation and
 * the extent, sits against the repo's `max-lines` ceiling, so the
 * composition cannot live there either. What it leaves the reader is
 * one call.
 */
import type {
  TableCellOpening,
  TableCellRepeat,
  TableTextRun,
} from "../../ast.js";
import {
  attrlistValues,
  NO_ATTRLIST_VALUES,
  type AttrlistValues,
} from "../attrlist.js";
import type { TableScan } from "../build/table.js";
import { parseColumnSpecs, type TableColumnSpec } from "./table-cell-spec.js";
import {
  cutCells,
  groupRows,
  readHeaderDecision,
  type TableCutting,
  type TableFormat,
} from "./table-reader.js";
import type { SourceLine } from "./split.js";

/**
 * The format keys Asciidoctor's `FORMATS` set holds (table.rb).
 * `tsv` is one of them and is NOT a {@link TableFormat}: it is csv
 * with a tab separator, which is why the two are separate types here -
 * the scan is told csv, and the separator lookup below is told tsv.
 */
type FormatKey = TableFormat | "tsv";

/**
 * The separator each format key defaults to (`DELIMITERS`,
 * table.rb:425-431). The `!sv` row is deliberately absent: it is the
 * one a NESTED document takes for psv, and nothing nested reaches a
 * reader yet, so a top-level `!===` cuts on `|` exactly as Ruby's
 * non-nested branch does.
 */
const DEFAULT_SEPARATOR: Record<FormatKey, string> = {
  psv: "|",
  csv: ",",
  dsv: ":",
  tsv: "\t",
};

/**
 * The one escape a `separator=` value carries: the two characters
 * `\t`, which Ruby answers with the tab itself ("QUESTION should we
 * support any other escape codes or multiple tabs?", table.rb:479-481).
 */
const TAB_SPELLING = String.raw`\t`;

/**
 * The format key the block resolved to, and with it the format the
 * scan cuts by.
 *
 * `format=` wins over the delimiter's hint wherever it names a legal
 * value, because Ruby only fills the hint in where the attribute is
 * absent (`attributes['format'] ||=`, parser.rb:874-877). An ILLEGAL
 * value takes neither: Ruby logs and falls back to psv outright
 * (table.rb:467-470), so `[format=bogus]` on a `,===` table cuts on
 * `|`.
 * @param hint - the format the delimiter's hint character contributed
 * @param values - the block-attribute line's values
 * @returns the format key
 */
function formatKeyOf(hint: TableFormat, values: AttrlistValues): FormatKey {
  const declared = values.named.get("format");
  if (declared === undefined) {
    return hint;
  }
  return declared === "psv" ||
    declared === "csv" ||
    declared === "dsv" ||
    declared === "tsv"
    ? declared
    : "psv";
}

/**
 * How this table cuts cells.
 *
 * A `separator=` naming nothing at all falls back to the format's own
 * default, which is Ruby's `nil_or_empty?` arm (table.rb:477-478) and
 * the reason {@link TableCutting.separator} is never empty.
 * @param hint - the format the delimiter's hint character contributed
 * @param values - the block-attribute line's values
 * @returns the cutting
 */
function resolveCutting(
  hint: TableFormat,
  values: AttrlistValues,
): TableCutting {
  const key = formatKeyOf(hint, values);
  const format = key === "tsv" ? "csv" : key;
  const declared = values.named.get("separator");
  if (declared === undefined || declared === "") {
    return { format, separator: DEFAULT_SEPARATOR[key] };
  }
  return {
    format,
    separator: declared === TAB_SPELLING ? DEFAULT_SEPARATOR.tsv : declared,
  };
}

/**
 * The columns `cols=` declared, or undefined when it declared none.
 *
 * Undefined and not `[]`: a `cols` value that parses to no column at
 * all leaves the table with no column count, which is the same state
 * a table with no `cols` is in (`!colspecs.empty?`, parser.rb:2298).
 * @param values - the block-attribute line's values
 * @returns the columns, or undefined
 */
function resolveColumns(
  values: AttrlistValues,
): readonly TableColumnSpec[] | undefined {
  const declared = values.named.get("cols");
  if (declared === undefined) {
    return undefined;
  }
  const parsed = parseColumnSpecs(declared);
  return parsed.length === 0 ? undefined : parsed;
}

/**
 * The three fields of a cut cell this fold reads and passes on.
 *
 * Restates the scan's `TableScanCell` shape rather than importing it,
 * the same way src/parse/build/table.ts restates it: a real scanned
 * cell satisfies this by structural typing alone, `closedAtLineEnd`
 * is cut-time bookkeeping the grouping already spent, and the names
 * come from src/ast.ts so that what leaves here is spelled in the
 * same vocabulary the builder is declared to take.
 */
interface CutCell {
  /** How this cell was opened. */
  readonly opening: TableCellOpening;
  /** The cell's raw region, partitioned into runs. */
  readonly runs: readonly TableTextRun[];
  /** The repeat the cell-spec queue handed this cell. */
  readonly repeat: TableCellRepeat;
}

/**
 * One cut cell with the column it inherits its style from recorded.
 * What leaves here is exactly what {@link TableScan.rows} is declared
 * to hold, so the compiler proves the fold ran.
 */
interface IndexedCell extends CutCell {
  /** The column whose style this cell inherits. */
  readonly columnIndex: number;
}

/**
 * Number each row's cells by their PHYSICAL position after duplicate
 * expansion, which is the index Asciidoctor inherits a cell's style
 * from (`@table.columns[@current_row.size]`, table.rb:662).
 *
 * A duplicate spec is one recorded cell standing for `count` of
 * Ruby's, each pushed by its own turn of `close_cell`'s
 * `1.upto(repeat)` loop (table.rb:651, :671), so it advances the
 * position by its count. A colspan is ONE `Table::Cell`
 * (table.rb:665) however many columns it visits, so it advances the
 * position by one; what a colspan advances is `@column_visits`
 * (:670), which is what closes a row and is already the grouping's
 * business.
 *
 * The position restarts at every row, including a row a rowspan above
 * reserved slots in: a reservation moves `@active_rowspans`
 * (table.rb:713-716) and with it `effective_column_visits` (:727-729),
 * neither of which is `@current_row.size`.
 * @param rows - the grouped rows, in document order
 * @returns the same rows, every cell carrying its column index
 */
function withColumnIndexes(
  rows: ReadonlyArray<readonly CutCell[]>,
): ReadonlyArray<readonly IndexedCell[]> {
  return rows.map((row) => {
    const indexed: IndexedCell[] = [];
    let columnIndex = 0;
    for (const cell of row) {
      indexed.push({
        opening: cell.opening,
        runs: cell.runs,
        repeat: cell.repeat,
        columnIndex,
      });
      columnIndex += cell.repeat.kind === "duplicate" ? cell.repeat.count : 1;
    }
    return indexed;
  });
}

/**
 * Everything a table node is made of: what the open resolved, and
 * what the scan cut under it.
 *
 * ONE call for the reader, which holds the extent and nothing else
 * about tables. The order is Ruby's own - the columns are read before
 * the loop starts, because the count is what closes a row
 * (parser.rb:2296-2311) - and every step is a total function over
 * what the step before it returned.
 *
 * The cells' column indexes are numbered here and nowhere else. This
 * is the only place holding both the grouping's output and the
 * columns those indexes point into: the grouping is handed a column
 * COUNT and never sees the columns themselves.
 * @param lines - the extent's interior lines
 * @param hint - the format the delimiter's hint character contributed
 * @param annotatedBy - the held attribute line's interior, if any
 * @returns the scan a table's builder takes
 */
export function readTable(
  lines: readonly SourceLine[],
  hint: TableFormat,
  annotatedBy: string | undefined,
): TableScan {
  const values =
    annotatedBy === undefined
      ? NO_ATTRLIST_VALUES
      : attrlistValues(annotatedBy);
  const cutting = resolveCutting(hint, values);
  const columns = resolveColumns(values);
  const cut = cutCells(lines, cutting);
  return {
    cutting,
    leadingRuns: cut.leadingRuns,
    rows: withColumnIndexes(groupRows(cut.cells, columns?.length)),
    header: readHeaderDecision(lines, cut.cells, cutting, {
      header: values.options.has("header"),
      noheader: values.options.has("noheader"),
    }),
    footer: values.options.has("footer"),
    ...(columns === undefined ? {} : { columns }),
  };
}
