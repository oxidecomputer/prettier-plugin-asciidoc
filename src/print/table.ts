/**
 * Table printing (issue #10): REPLAY of the interior, under respelled
 * delimiter lines. Every byte between the two delimiters goes back
 * exactly as the author wrote it, and the printer adds nothing there
 * and drops nothing.
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
 * WHAT IS NOT NORMALIZED, and why: the interior, entirely. A cell's
 * spacing, a row's line breaks and the column alignment authors lay
 * out by hand are all still the author's, because the node records
 * where each cell's bytes begin and end but not yet what a normalizer
 * would be allowed to move. Trailing whitespace does go, on every
 * line - not a decision here but Prettier's own trim at a hardline,
 * and render-neutral: the oracle's reader rstrips every line before
 * parsing (`prepare_source_string`).
 *
 * The two DELIMITER lines are the exception, and the only one: they
 * take their shortest safe spelling ({@link tableDelimiter}). That
 * rule reads the delimiter lines and the interior as text and moves
 * no byte between them, so it holds for every table whatever its
 * interior turned out to be.
 */
import { doc, type Doc } from "prettier";
import type { TableCellNode, TableNode } from "../ast.js";
import { MIN_TABLE_DELIMITER_LENGTH } from "../constants.js";
import { rstrip } from "../parse/line-shapes.js";
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
 * A table's delimiter line: the hint character followed by the
 * SHORTEST run of `=` that is at least {@link
 * MIN_TABLE_DELIMITER_LENGTH} long and equals no interior line.
 *
 * The closing line is the exact rstripped opening line, so the two
 * lines are one decision and this is it: `is_delimited_block?`
 * (`parser.rb:976-1010`) hands back the whole matched LINE as the
 * block's terminator, and `read_lines_until` (`reader.rb:396-438`)
 * closes the block on `line == terminator`, an equality and not a
 * prefix test.
 *
 * MINIMAL LENGTH, not grow-past-the-longest, which is where it
 * differs from `computeDelimiter` (./blocks.ts): that one measures
 * the LONGEST conflicting line and pads past it, so a rule of that
 * shape answers an interior `|=======` with a delimiter longer than
 * it, where this one answers `|===` and never grows at all unless the
 * shorter spellings are themselves taken. Both re-read as the same
 * table; only the shortest is what AsciiDoc documents are written
 * in.
 *
 * The unbounded `for` terminates, and not by assumption: the interior
 * is a finite set of lines, so some candidate length is absent from
 * it, and the loop returns at the first one.
 *
 * The comparison rstrips because the reader does
 * (`prepare_source_string`), so a trailing-space `|===` in the
 * interior is a collision even though its bytes differ.
 * @param hint - the delimiter's first character, never changed
 * @param interior - the bytes about to be emitted between the two
 *   delimiter lines
 * @returns the delimiter line both ends of the table take
 */
function tableDelimiter(hint: string, interior: string): string {
  const lines = new Set(interior.split("\n").map((line) => rstrip(line)));
  for (let length = MIN_TABLE_DELIMITER_LENGTH; ; length += 1) {
    const candidate = hint + "=".repeat(length);
    if (!lines.has(candidate)) {
      return candidate;
    }
  }
}

/**
 * The table's interior as one string: its leading runs, then every
 * cell of every row, each cell's opening bytes followed by its runs.
 *
 * A MIRROR of the walk {@link printTable} and {@link printTableCell}
 * make over the same records, not a shared one: this side builds a
 * string and that side builds Doc. What holds the two in step is
 * {@link openingImage}, the one expression of a cell's opening bytes,
 * plus {@link tableDelimiter}'s rstrip, which absorbs the only
 * difference the two can have today (Prettier trims each line at a
 * hardline; this helper reads the raw images). Reorder the runs on
 * one side without the other and the guard would be reading a
 * document nobody prints, and nothing here would say so.
 * @param node - the table node
 * @returns the interior bytes, delimiter lines excluded
 */
function replayedInterior(node: TableNode): string {
  return [
    ...node.leadingRuns.map((run) => run.image),
    ...node.children.flatMap((row) =>
      row.children.map(
        (cell) =>
          openingImage(cell) + cell.runs.map((run) => run.image).join(""),
      ),
    ),
  ].join("");
}

/**
 * The bytes a cell's OPENING wrote of its own.
 *
 * A `separator` opening wrote its spec and the separator character
 * that followed it; the other two openings wrote nothing at all - a
 * csv or dsv cell begins where its line begins, and a recovered psv
 * cell begins at text that stands in front of the first separator
 * (src/ast.ts, {@link TableCellNode.opening}).
 * @param node - the cell node
 * @returns the opening's own bytes, empty for the two that wrote none
 */
function openingImage(node: TableCellNode): string {
  const { opening } = node;
  return opening.kind === "separator" ? opening.spec + opening.separator : "";
}

/**
 * One cell: the bytes its OPENING wrote of its own, then its runs.
 * @param node - the cell node
 * @returns Doc IR for the cell's own bytes
 */
export function printTableCell(node: TableCellNode): Doc {
  return [openingImage(node), ...node.runs.map((run) => replay(run.image))];
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
 *
 * The interior the collision guard reads is the one ABOUT TO BE
 * EMITTED, which is what makes the output re-read as this same table:
 * a guard run over some other interior would be answering for a
 * document nobody writes. The `endOfStream` close writes no closing
 * line, so an unterminated table's opening is respelled with nothing
 * to keep it company.
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
  const delimiter = tableDelimiter(
    node.open.slice(0, 1),
    replayedInterior(node),
  );
  return [
    delimiter,
    ...(interior.length === 0 ? [] : [hardline, interior]),
    ...(node.close.kind === "delimiter" ? [hardline, delimiter] : []),
  ];
}
