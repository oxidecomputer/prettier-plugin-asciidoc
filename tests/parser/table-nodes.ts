/**
 * Finding tables in a parse, and replaying one to the bytes its own
 * records account for.
 *
 * The walk is TYPED, over `BlockNode`'s own block-bearing members,
 * rather than the invariant suite's generic `preorder`: a table's
 * fields are read here (`open`, `leadingRuns`, each cell's opening and
 * runs), and reading them off an untyped record would be a cast
 * wearing a guard. The three suites that ask "which tables did this
 * document parse to" share one answer.
 */
import type {
  BlockNode,
  DocumentNode,
  TableCellNode,
  TableNode,
} from "../../src/ast.js";

/**
 * Every table in one block and everything under it, in document
 * order. The block kinds with block children are the only ones that
 * can hold a table: a verbatim block's interior is a slice, and a
 * header's lines are header lines.
 * @param node - the block to walk
 * @returns the tables it holds, in document order
 */
function tablesIn(node: BlockNode): TableNode[] {
  if (node.type === "table") {
    return [node];
  }
  if (node.type === "parentBlock" || node.type === "admonition") {
    return node.children.flatMap((child) => tablesIn(child));
  }
  if (node.type === "list") {
    return node.children.flatMap((item) =>
      item.blocks.flatMap((entry) => tablesIn(entry.block)),
    );
  }
  return [];
}

/**
 * Every table in a document, in document order.
 * @param document - the parsed document
 * @returns the tables it holds
 */
export function tableNodes(document: DocumentNode): TableNode[] {
  return document.children.flatMap((child) => tablesIn(child));
}

/**
 * The bytes one cell's opening wrote of its own: `spec + separator`
 * for a `separator` opening, empty for the two openings that write
 * none (src/ast.ts, `TableCellOpening`).
 * @param node - the cell node
 * @returns the bytes the opening itself contributes
 */
function openingImage(node: TableCellNode): string {
  const { opening } = node;
  return opening.kind === "separator" ? opening.spec + opening.separator : "";
}

/**
 * Replay a table's own records to the bytes they partition (AST
 * invariant (xv)): `open`, the runs before the first cell, every
 * row's cells in order (each one's opening bytes then its runs), and
 * the close, with a line terminator between the opening delimiter and
 * the interior and another between the interior and the close.
 *
 * The interior is written only where the extent HAD interior lines,
 * which is exactly where a run or a cell was recorded - a blank line
 * is a run even where its bytes are none. Without that test `|===`
 * directly over `|===` and `|===` over a blank line over `|===` would
 * replay alike, and one of the two would lose a line.
 *
 * A ROW contributes exactly its cells and no bytes of its own, so the
 * grouping cannot move a byte however it groups. That holds because
 * `groupRows` (src/parse/lines/table-reader.ts) never pushes a row
 * before pushing a cell into it, which `TableRowNode.children` is too
 * wide to say: an empty row would be representable and would replay
 * as nothing, and the count of rows would stop matching the count of
 * cut cells.
 *
 * This is the same partition src/print/table.ts writes back, spelled
 * independently: the suites compare it against the source, so the two
 * agreeing is a measurement rather than a shared derivation.
 * @param table - the table node
 * @returns the bytes the table's own records account for
 */
export function replayTable(table: TableNode): string {
  const interior = [
    ...table.leadingRuns.map((run) => run.image),
    ...table.children.flatMap((row) =>
      row.children.map(
        (cell) =>
          openingImage(cell) + cell.runs.map((run) => run.image).join(""),
      ),
    ),
  ];
  const body = interior.length === 0 ? "" : `\n${interior.join("")}`;
  const close =
    table.close.kind === "delimiter" ? `\n${table.close.image}` : "";
  return `${table.open}${body}${close}`;
}

/**
 * Whether the bytes a table's position names PAST its replay are the
 * overhang its close kind allows - the one home of that bound, shared
 * by the three suites that assert it.
 *
 * A TERMINATOR close leaves nothing over: the extent ends at the
 * closing line's own raw end, which is the last byte the replay
 * writes. Only a FORCED close can leave one byte, and always the same
 * one: the extent is stamped with the reader's boundary offset, one
 * past the last interior line's terminator, and that terminator
 * belongs to no cell (`regionEnd`, src/parse/lines/table-reader.ts).
 * @param table - the table node
 * @param over - the source its position names past the replayed bytes
 * @returns whether that overhang is the one its close kind allows
 */
export function allowsOverhang(table: TableNode, over: string): boolean {
  return table.close.kind === "delimiter"
    ? over === ""
    : over === "" || over === "\n";
}
