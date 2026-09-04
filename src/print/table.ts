/**
 * Table printing (issue #10): REPLAY. Every byte the table's records
 * hold goes back exactly as the author wrote it, and the printer adds
 * nothing and drops nothing.
 *
 * The table node's records PARTITION its extent (src/ast.ts): the
 * opening line, then the runs before the first cell, then every cell
 * of every row - its opening's own bytes, then its runs - then the
 * closing line. Concatenating them in that order IS the source, with
 * exactly two bytes left to this file: the line terminator after the
 * opening delimiter and the one before the closing delimiter. Neither
 * belongs to any cell (the scan's `regionEnd`,
 * src/parse/lines/table-reader.ts), and both are written here as
 * hardlines.
 *
 * The interior is emitted only when the extent HAD interior lines,
 * which is exactly when it holds a run or a cell: a blank line is a
 * run even where it wrote no bytes, so `|===` directly over `|===`
 * (no interior, one terminator between the two delimiters) and
 * `|===` over a blank line over `|===` (one interior line, two
 * terminators) are told apart by that test and by nothing else.
 *
 * WHAT IS NOT NORMALIZED, and why: everything. A cell's spacing, a
 * row's line breaks and the column alignment authors lay out by hand
 * are all still the author's, because the node records where each
 * cell's bytes begin and end but not yet what a normalizer would be
 * allowed to move. Trailing whitespace does go, on every line - not a
 * decision here but Prettier's own trim at a hardline, and
 * render-neutral: the oracle's reader rstrips every line before
 * parsing (`prepare_source_string`).
 */
import { doc, type Doc } from "prettier";
import type { TableCellNode, TableNode } from "../ast.js";
import type { PrintFunction, PrintPath } from "./blocks.js";

const {
  builders: { hardline, join },
} = doc;

/**
 * One recorded image as the lines it is: a run may carry the
 * terminators of the lines it covers, and a Doc says line breaks with
 * hardlines rather than with `\n` inside a string.
 * @param image - the recorded bytes
 * @returns the bytes, broken at every newline
 */
function replay(image: string): Doc {
  return join(hardline, image.split("\n"));
}

/**
 * One cell: the bytes its OPENING wrote of its own, then its runs.
 *
 * A `separator` opening wrote its spec and the separator character
 * that followed it; the other two openings wrote nothing at all - a
 * csv or dsv cell begins where its line begins, and a recovered psv
 * cell begins at text that stands in front of the first separator
 * (src/ast.ts, {@link TableCellNode.opening}).
 * @param node - the cell node
 * @returns Doc IR for the cell's own bytes
 */
export function printTableCell(node: TableCellNode): Doc {
  const { opening } = node;
  const written =
    opening.kind === "separator" ? opening.spec + opening.separator : "";
  return [written, ...node.runs.map((run) => replay(run.image))];
}

/**
 * One row: its cells, adjacent. A row writes no bytes of its own -
 * the grouping is a recorded derivation over cells that were already
 * cut, so there is no row separator to print and no line break the
 * cells do not already carry.
 *
 * A row with NO cells would print nothing and be invisible here.
 * None exists: `groupRows` (src/parse/lines/table-reader.ts) never
 * pushes a row before pushing a cell into it. That is a fact about
 * the producer rather than a guarantee of the type -
 * `TableRowNode.children` is a plain array and admits an empty one -
 * which is why it is written down at the consumer that would be the
 * one to lose bytes if it stopped holding.
 * @param path - Prettier's AST path, at the row
 * @param print - Prettier's recursive print callback
 * @returns Doc IR for the row
 */
export function printTableRow(path: PrintPath, print: PrintFunction): Doc {
  return path.map(print, "children");
}

/**
 * A whole table.
 * @param node - the table node
 * @param path - Prettier's AST path, at the table
 * @param print - Prettier's recursive print callback
 * @returns Doc IR for the table
 */
export function printTable(
  node: TableNode,
  path: PrintPath,
  print: PrintFunction,
): Doc {
  const interior: Doc[] = [
    ...node.leadingRuns.map((run) => replay(run.image)),
    ...path.map(print, "children"),
  ];
  return [
    node.open,
    ...(interior.length === 0 ? [] : [hardline, interior]),
    ...(node.close.kind === "delimiter" ? [hardline, node.close.image] : []),
  ];
}
