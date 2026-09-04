/**
 * Table printing (issue #10): one NORMAL FORM for a table whose facts
 * the model fully records, and REPLAY of the author's interior bytes
 * for every other table.
 *
 * Which of the two a table takes is one total function's answer
 * (./table-layout.ts). The replay arm is what this file did before
 * anything was normalized: every byte between the two delimiters goes
 * back exactly as the author wrote it, the printer adds nothing there
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
 * terminators) are told apart by that test and by nothing else. The
 * laid-out arm keeps the same test: a table it accepts with no rows
 * has no leading run either, because a leading run is its own
 * decline.
 *
 * ONE COMPOSITION of a table's recorded bytes, {@link cellBytes}, and
 * everything that needs those bytes goes through it: the delimiter
 * guard, which must read the interior ABOUT TO BE EMITTED and cannot
 * ask a Doc; the replay arm's Doc, cell by cell; and the laid-out
 * arm, which is a string throughout. What is left over the records is
 * an ITERATION - leading runs, then rows, then cells, in document
 * order - and the replay arm makes it twice, once as a string for the
 * guard and once as a Doc through Prettier's own recursion.
 *
 * That second iteration is the residue of a subtraction that does not
 * fit: dropping the Doc walk entirely and emitting `replay(interior)`
 * for both arms is byte-identical and deletes three functions, but
 * `AnyNode` (./blocks.ts) must still admit a row and a cell, so the
 * print switch must still carry an arm for each - and with nothing
 * recursing, that arm is reachable by no walk and by no test.
 *
 * WHAT IS NOT NORMALIZED in a REPLAYED table: the interior, entirely.
 * A cell's spacing, a row's line breaks and the column alignment
 * authors lay out by hand are all still the author's. Trailing
 * whitespace does go, on every line - not a decision here but
 * Prettier's own trim at a hardline, and render-neutral: the oracle's
 * reader rstrips every line before parsing
 * (`prepare_source_string`).
 *
 * The two DELIMITER lines are outside that split, and the only thing
 * that is: they take their shortest safe spelling ({@link
 * tableDelimiter}) whichever arm produced the interior, because that
 * rule reads the delimiter lines and the interior as text and moves
 * no byte between them.
 */
import { doc, type Doc } from "prettier";
import type { TableCellNode, TableNode, TableRowNode } from "../ast.js";
import { MIN_TABLE_DELIMITER_LENGTH } from "../constants.js";
import { rstrip } from "../parse/line-shapes.js";
import type { PrintFunction, PrintPath } from "./blocks.js";
import { planTable, printLaidOut, type TablePlan } from "./table-layout.js";

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
 * row's cells, adjacent.
 *
 * The ONE composition of a replayed table's bytes, which is what the
 * delimiter guard reads and what {@link printTable} emits. Rows write
 * no bytes of their own - the grouping is a recorded derivation over
 * cells that were already cut - so a row is exactly its cells and
 * there is no row separator to write.
 * @param node - the table node
 * @returns the interior bytes, delimiter lines excluded
 */
function replayedInterior(node: TableNode): string {
  return [
    ...node.leadingRuns.map((run) => run.image),
    ...node.children.map(rowBytes),
  ].join("");
}

/**
 * One row's recorded bytes: its cells, adjacent.
 *
 * A row with NO cells would write nothing and be invisible here. None
 * exists: `groupRows` (src/parse/lines/table-reader.ts) never pushes a
 * row before pushing a cell into it. That is a fact about the producer
 * rather than a guarantee of the type - `TableRowNode.children` is a
 * plain array and admits an empty one - which is why it is written
 * down at the consumer that would be the one to lose bytes if it
 * stopped holding.
 * @param row - the row node
 * @returns the row's recorded bytes
 */
function rowBytes(row: TableRowNode): string {
  return row.children.map(cellBytes).join("");
}

/**
 * One cell's recorded bytes: what its OPENING wrote of its own, then
 * its runs.
 *
 * A `separator` opening wrote its spec and the separator character
 * that followed it; the other two openings wrote nothing at all - a
 * csv or dsv cell begins where its line begins, and a recovered psv
 * cell begins at text that stands in front of the first separator
 * (src/ast.ts, {@link TableCellNode.opening}).
 * @param cell - the cell node
 * @returns the cell's recorded bytes
 */
function cellBytes(cell: TableCellNode): string {
  const { opening } = cell;
  const image =
    opening.kind === "separator" ? opening.spec + opening.separator : "";
  return image + cell.runs.map((run) => run.image).join("");
}

/**
 * One cell: its recorded bytes as the lines they are.
 *
 * Reached only through {@link printTable}'s REPLAY arm, whose Doc is
 * Prettier's own recursion over the same records the guard read as a
 * string; {@link cellBytes} is what keeps the two answering the same
 * bytes.
 * @param node - the cell node
 * @returns Doc IR for the cell's own bytes
 */
export function printTableCell(node: TableCellNode): Doc {
  return replay(cellBytes(node));
}

/**
 * One row: its cells, adjacent. A row writes no bytes of its own -
 * the grouping is a recorded derivation over cells that were already
 * cut, so there is no row separator to print and no line break the
 * cells do not already carry.
 * @param path - Prettier's AST path, at the row
 * @param print - Prettier's recursive print callback
 * @returns Doc IR for the row
 */
export function printTableRow(path: PrintPath, print: PrintFunction): Doc {
  return path.map(print, "children");
}

/**
 * A whole table: its delimiter lines, and between them either the
 * normal form or the author's own interior bytes.
 *
 * The guard reads the interior ABOUT TO BE EMITTED, which is what
 * makes the output re-read as this same table: a guard run over some
 * other interior would be answering for a document nobody writes. So
 * both arms build that interior as a STRING first, and only then does
 * each say it as a Doc - the laid-out arm through {@link replay},
 * because a Doc says line breaks with hardlines and never with `\n`
 * inside a string (Prettier's column tracking and its
 * trailing-whitespace trim at a hardline both key off the hardline),
 * and the replay arm through Prettier's own recursion over the very
 * records {@link replayedInterior} just read.
 *
 * The `endOfStream` close writes no closing line, so an unterminated
 * table's opening is respelled with nothing to keep it company.
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
  const plan: TablePlan = planTable(node);
  const interior =
    plan.kind === "replay" ? replayedInterior(node) : printLaidOut(node, plan);
  const delimiter = tableDelimiter(node.open.slice(0, 1), interior);
  const body: Doc =
    plan.kind === "replay"
      ? [
          ...node.leadingRuns.map((run) => replay(run.image)),
          ...path.map(print, "children"),
        ]
      : replay(interior);
  return [
    delimiter,
    ...(hasInteriorLine(node) ? [hardline, body] : []),
    ...(node.close.kind === "delimiter" ? [hardline, delimiter] : []),
  ];
}

/**
 * Whether the extent held an interior LINE at all, which is what tells
 * `|===` directly over `|===` from `|===` over one blank line.
 *
 * Read off the RECORDS rather than off the interior text, because the
 * two spellings differ by a terminator and not by a byte either arm
 * writes: a blank line is a run even where it wrote no bytes. Both
 * arms answer it here, and the laid-out arm needs no separate test - a
 * table it accepted with no rows has no leading run either, since a
 * leading run is its own decline.
 * @param node - the table node
 * @returns whether to write an interior at all
 */
function hasInteriorLine(node: TableNode): boolean {
  return node.leadingRuns.length > 0 || node.children.length > 0;
}
