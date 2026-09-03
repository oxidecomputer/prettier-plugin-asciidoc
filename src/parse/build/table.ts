/**
 * Table structure (issue #10): assembling a `TableNode` from the
 * table SCAN's own answers, the way build/delimited.ts assembles a
 * `DelimitedBlockNode` from an extent and an already-decided role.
 *
 * No decision lives here. Where cells are cut and how they group into
 * rows was decided by `cutCells` and `groupRows`
 * (src/parse/lines/table-reader.ts) before this module ever runs -
 * the two total functions that module's own docstring names as "the
 * table SCAN". What a spec's letters mean was decided by
 * src/parse/lines/table-cell-spec.ts. This module only measures
 * positions from offsets already recorded and places already-decided
 * facts into node literals: the same division build/delimited.ts
 * draws between the reader layer and the builder layer.
 *
 * Builders sit BELOW the reader in the parse stack (`build-imports-lines`,
 * scripts/metrics/graph.ts), so this file may not import
 * src/parse/lines/table-reader.ts back up. {@link ScannedCell} restates
 * that module's `TableScanCell` shape field for field instead: a real
 * `TableScanCell` satisfies it with no conversion, by structural
 * typing alone, the same way src/ast.ts restates the table SCAN's
 * types rather than importing them (that file is a leaf every parser
 * module imports FROM).
 */
import type {
  TableCellNode,
  TableCellOpening,
  TableCellRepeat,
  TableClose,
  TableColumnSpec,
  TableCutting,
  TableNode,
  TableRowNode,
  TableTextRun,
} from "../../ast.js";
import { annotation, type BlockExtent } from "./delimited.js";
import type { LocationIndex } from "../positions.js";

/**
 * One cell as the table SCAN cut it (`cutCells`'s `TableScanCell`,
 * src/parse/lines/table-reader.ts), restated rather than imported
 * (see the module comment). `closedAtLineEnd` is not carried: it is
 * cut-time bookkeeping `groupRows` already spent deciding which cells
 * share a row, and once that grouping is done, no further question
 * this module or a printer asks needs it.
 *
 * NOT exported: {@link TableScan.rows} is built from `groupRows`'s
 * own return value, which satisfies this shape structurally with no
 * caller ever needing to name it.
 */
interface ScannedCell {
  /** How this cell was opened. */
  readonly opening: TableCellOpening;
  /** The cell's raw region, partitioned into runs. */
  readonly runs: readonly TableTextRun[];
  /** The repeat the cell-spec queue handed this cell. */
  readonly repeat: TableCellRepeat;
}

/**
 * Everything the table SCAN and a table's open decided, bundled for
 * {@link buildTable} as one parameter (the linter caps a builder at
 * four; `build/delimited.ts`'s `role`/`rename`/`masquerade` parameters
 * bundle for the identical reason). `leadingRuns` and `rows` are
 * `cutCells` and `groupRows`'s own answers; `cutting`, `header`,
 * `footer` and `columns` are what a table's open resolves, which
 * neither function touches - `readHeaderDecision` decides `header`,
 * and `cutting`, `footer` and `columns` come straight off the
 * delimiter's hint character and the block's attribute list
 * (table.rb:459-486, parser.rb:2425-2482).
 *
 * Exported for tests/parser/table-structure.test.ts, which drives
 * `cutCells`, `groupRows` and `readHeaderDecision` itself (no reader
 * hookup exists yet) and assembles this record from their answers.
 * @internal
 */
export interface TableScan {
  /** The format and separator the table resolved to. */
  readonly cutting: TableCutting;
  /** Runs before the first cell begins (`TableCut.leadingRuns`). */
  readonly leadingRuns: readonly TableTextRun[];
  /** The cut cells, grouped into rows (`groupRows`'s own return). */
  readonly rows: ReadonlyArray<readonly ScannedCell[]>;
  /** What the first row is (`readHeaderDecision`'s answer). */
  readonly header: TableNode["header"];
  /** Whether `options=footer` made the last row a footer. */
  readonly footer: boolean;
  /**
   * The `cols=` parse, in declaration order after `N*` repeats are
   * expanded; absent when the block carried no readable `cols` value.
   */
  readonly columns?: readonly TableColumnSpec[];
}

/**
 * Where one cell's own bytes end: past its last run, or - a cell with
 * no runs at all, which happens when two separators sit back to back
 * - past its own opening, the only bytes such a cell wrote.
 * @param cell - the cut cell
 * @returns the offset just past the cell's own region
 */
function cellEnd(cell: ScannedCell): number {
  const last = cell.runs.at(-1);
  if (last !== undefined) {
    return last.offset + last.image.length;
  }
  const { opening } = cell;
  return opening.kind === "separator"
    ? opening.offset + opening.spec.length + opening.separator.length
    : opening.offset;
}

/**
 * One cut cell, as a `TableCellNode`. `opening`, `runs` and `repeat`
 * carry straight across (see the module comment on structural
 * typing); only the position is computed here.
 * @param cell - the cut cell
 * @param at - the document's location index
 * @returns the cell node
 */
function buildCell(cell: ScannedCell, at: LocationIndex): TableCellNode {
  return {
    type: "tableCell",
    opening: cell.opening,
    runs: cell.runs,
    repeat: cell.repeat,
    position: {
      start: at.at(cell.opening.offset),
      end: at.at(cellEnd(cell)),
    },
  };
}

/**
 * One grouped row, as a `TableRowNode`.
 * @param cells - the row's cut cells, in document order
 * @param at - the document's location index
 * @returns the row node
 * @throws {Error} if `cells` is empty: a can't-happen guard, since
 *   `groupRows` (src/parse/lines/table-reader.ts) never pushes a row
 *   before pushing at least one cell into it
 */
function buildRow(
  cells: readonly ScannedCell[],
  at: LocationIndex,
): TableRowNode {
  const children = cells.map((cell) => buildCell(cell, at));
  const [first] = children;
  const last = children.at(-1);
  if (last === undefined) {
    throw new Error("table row builder: a grouped row cut no cells");
  }
  return {
    type: "tableRow",
    children,
    position: { start: first.position.start, end: last.position.end },
  };
}

/**
 * How the extent ended, in `TableClose`'s own shape.
 * @param extent - where the table opened and closed
 * @returns the close
 */
function closeOf(extent: BlockExtent): TableClose {
  return extent.close === undefined
    ? { kind: "endOfStream" }
    : { kind: "delimiter", image: extent.close.image };
}

/**
 * A table, assembled from the SCAN's own answers and the extent a
 * delimited read already collected.
 *
 * Exported for tests/parser/table-structure.test.ts; the reader
 * dispatch that resolves a table's open and hooks this builder into
 * the normal block read (not part of this change) becomes the real
 * `src` consumer once it lands.
 * @param extent - where the table opened and closed
 * @param scan - what `cutCells`, `groupRows` and `readHeaderDecision`,
 *   plus the block's own attribute list, decided about this table
 * @param at - the document's location index
 * @param annotatedBy - the annotation the reader recorded, if any
 * @returns the table node
 * @internal
 */
export function buildTable(
  extent: BlockExtent,
  scan: TableScan,
  at: LocationIndex,
  annotatedBy: string | undefined,
): TableNode {
  return {
    type: "table",
    open: extent.open.image,
    close: closeOf(extent),
    cutting: scan.cutting,
    ...(scan.columns === undefined ? {} : { columns: scan.columns }),
    header: scan.header,
    footer: scan.footer,
    leadingRuns: scan.leadingRuns,
    children: scan.rows.map((row) => buildRow(row, at)),
    position: { start: at.start(extent.open), end: at.at(extent.end) },
    ...annotation(annotatedBy),
  };
}
