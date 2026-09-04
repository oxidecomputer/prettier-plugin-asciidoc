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
 * src/parse/lines/table-reader.ts back up. It does not need to:
 * {@link TableCellFacts} is derived from the node it builds, and
 * src/ast.ts is the leaf every parser module imports FROM, so the one
 * declaration of a cell's fields serves the reader above and the
 * builder below alike.
 */
import type {
  TableCellNode,
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
 * One cell's facts as everything above this module hands them over:
 * the cell node less the two fields THIS module writes, its
 * discriminant and its position.
 *
 * Derived from the node rather than restated beside it, so a field
 * added to a cell is added once. Neither omitted field is a fact the
 * cut recorded: the discriminant is what a builder stamps on, and the
 * position is what {@link buildCell} measures from the offsets the
 * runs already carry.
 *
 * The derivation couples the two in ONE direction, and the direction
 * matters to whoever grows the node: a field added to `TableCellNode`
 * for a PRINTER's benefit becomes a required field of the scan's
 * answer, so the cut has to have a value for it. A fact only the
 * printer needs and the cut cannot know does not belong on the cell
 * node; it belongs where the printer can derive it.
 *
 * `closedAtLineEnd` is absent for a different reason - it is not a
 * cell fact at all, but cut-time bookkeeping `groupRows`
 * (src/parse/lines/table-reader.ts) already spent deciding which cells
 * share a row, and no question this module or a printer asks needs it
 * afterwards.
 */
export type TableCellFacts = Readonly<Omit<TableCellNode, "type" | "position">>;

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
 * Filled by a table's open (src/parse/lines/table-open.ts), which
 * drives `cutCells`, `groupRows` and `readHeaderDecision` and gathers
 * their answers into it.
 */
export interface TableScan {
  /** The format and separator the table resolved to. */
  readonly cutting: TableCutting;
  /** Runs before the first cell begins (`TableCut.leadingRuns`). */
  readonly leadingRuns: readonly TableTextRun[];
  /** The cut cells, grouped into rows and numbered by column. */
  readonly rows: ReadonlyArray<readonly TableCellFacts[]>;
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
function cellEnd(cell: TableCellFacts): number {
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
 * One cut cell, as a `TableCellNode`. `opening`, `runs`, `repeat` and
 * `columnIndex` carry straight across (see the module comment on
 * structural typing); only the position is computed here.
 * @param cell - the cut cell
 * @param at - the document's location index
 * @returns the cell node
 */
function buildCell(cell: TableCellFacts, at: LocationIndex): TableCellNode {
  return {
    type: "tableCell",
    opening: cell.opening,
    runs: cell.runs,
    repeat: cell.repeat,
    columnIndex: cell.columnIndex,
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
  cells: readonly TableCellFacts[],
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
 * What the metadata run above a table left the builder, bundled into
 * one parameter because the linter caps a builder at four (the same
 * reason {@link TableScan} bundles the open's own answers).
 *
 * NOT exported: the reader fills it structurally, so no caller has to
 * name it, and an export nothing imports is a knip failure.
 */
interface HeldAboveTable {
  /** The attribute line's interior, when the reader recorded one. */
  readonly annotatedBy: string | undefined;
  /**
   * Whether an attribute line stood above the table whose values the
   * open did NOT read (`TableNode.attrlistUnread`, src/ast.ts).
   */
  readonly attrlistUnread: boolean;
}

/**
 * A table, assembled from the SCAN's own answers and the extent a
 * delimited read already collected.
 *
 * Called by the reader at a table's delimited open
 * (src/parse/lines/reader.ts), the way every other builder is.
 * @param extent - where the table opened and closed
 * @param scan - what `cutCells`, `groupRows` and `readHeaderDecision`,
 *   plus the block's own attribute list, decided about this table
 * @param at - the document's location index
 * @param held - what the reader held above the table
 * @returns the table node
 */
export function buildTable(
  extent: BlockExtent,
  scan: TableScan,
  at: LocationIndex,
  held: HeldAboveTable,
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
    ...annotation(held.annotatedBy),
    ...(held.attrlistUnread ? { attrlistUnread: true as const } : {}),
  };
}
