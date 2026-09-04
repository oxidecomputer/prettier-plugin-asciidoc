/**
 * Table structure (issue #10): the oracle-comparable flattening
 * tests/parser/table-structure.test.ts drives over the corpus. Split
 * out of that file to stay under the repo's line ceiling, the way
 * tests/parser/ast-walk.ts split out of ast-invariants.ts for the
 * identical reason.
 *
 * The tables themselves come from `parse()` (tests/parser/table-nodes.ts):
 * the reader resolves a table's open and drives the scan, so nothing
 * here re-decides a cutting scheme or re-cuts a cell. What this file
 * owns is the READING of a built cell that the comparison needs and
 * the node deliberately does not store - the buffer text Asciidoctor
 * would hold, and the spec a cell inherits from its column - plus the
 * exclusions the comparison is not entitled to make.
 */
import { parse } from "../../src/parser.js";
import type {
  TableCellNode,
  TableCellRepeat,
  TableCellSpec,
  TableCellStyle,
  TableCutting,
  TableHorizontalAlignment,
  TableNode,
  TableRowNode,
  TableRunKind,
  TableVerticalAlignment,
} from "../../src/ast.js";
import type { TableColumnSpec } from "../../src/parse/lines/table-cell-spec.js";
import { rstrip } from "../../src/parse/line-shapes.js";
import { tableNodes } from "./table-nodes.js";
import type { OracleCellSpec } from "../helpers.js";

// ---------------------------------------------------------------------------
// The tables one document parses to
// ---------------------------------------------------------------------------

/** One table, as the reader built it, ready to compare. */
export interface ScannedTable {
  /** The node `parse()` produced. */
  readonly table: TableNode;
  /** The cutting the table resolved to (needed to reconstruct cell text). */
  readonly cutting: TableCutting;
  /**
   * The table's own bytes, delimiters included: the source its
   * position names, which is what {@link replayTable} is checked
   * against. A forced close can name one byte more - the final
   * newline - so the check at the call site is a prefix with that
   * overhang, exactly as AST invariant (x) states it.
   */
  readonly content: string;
}

/**
 * Every table `parse()` finds in `input`, in document order.
 *
 * The reader resolves the open and drives the scan itself now, so
 * this is a walk and nothing else: whatever this suite measures, it
 * measures about the tables a document really parses to.
 * @param input - AsciiDoc source text
 * @returns every table found, in document order
 */
export function scanTables(input: string): ScannedTable[] {
  return tableNodes(parse(input)).map((table) => ({
    table,
    cutting: table.cutting,
    content: input.slice(
      table.position.start.offset,
      table.position.end.offset,
    ),
  }));
}

// ---------------------------------------------------------------------------
// Reading a cell's text the way the oracle's buffer would hold it
// ---------------------------------------------------------------------------

/**
 * A cell's own spec, when its opening carries one.
 * @param cell - the cell to read
 * @returns the spec, or undefined for an opening with none
 */
function specOf(cell: TableCellNode): TableCellSpec | undefined {
  return cell.opening.kind === "separator" ? cell.opening.parsed : undefined;
}

/** The run kind that is a cell's own text (see {@link bufferTextOf}). */
const CONTENT_RUN: TableRunKind = "content";

/**
 * The bytes Asciidoctor's `@buffer` would hold for this cell: its
 * `content` runs (never `droppedComment`/`skippedBlank`, which the
 * reader deletes before the table is parsed), each LINE rstripped
 * (this reader's own lines keep trailing whitespace for byte replay;
 * the oracle's reader rstripped them before the table ever saw them),
 * and each escaped separator's backslash chopped
 * (`skip_past_escaped_delimiter`, table.rb:525-528); csv never
 * escapes, its separator sits inside quotes instead.
 * @param cell - the cell to read
 * @param cutting - the table's resolved cutting
 * @returns the reconstructed buffer text
 */
function bufferTextOf(cell: TableCellNode, cutting: TableCutting): string {
  const raw = cell.runs
    .filter((run) => run.kind === CONTENT_RUN)
    .map((run) => run.image)
    .join("");
  const perLine = raw.split("\n").map(rstrip).join("\n");
  if (cutting.format === "csv") {
    return perLine;
  }
  const escaped = `\\${cutting.separator}`;
  return perLine.split(escaped).join(cutting.separator);
}

/**
 * `Table::Cell`'s csv unquote and quote-squeeze
 * (`close_cell`, table.rb:628-644): a whole-value quoted cell has its
 * quotes stripped and every run of quotes inside squeezed to one; an
 * unquoted value with a quote in it only gets the squeeze. The
 * unclosed-quote error path (`cell_text.slice` returning an empty
 * string) is not replayed here: an input that reaches it is one the
 * oracle logs an error for, which excludes the case outright.
 * @param text - the already-stripped cell text
 * @returns the text csv's own unquote step would leave
 */
function csvUnquote(text: string): string {
  if (text === "" || !text.includes('"')) {
    return text;
  }
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    const inner = text.slice(1, -1);
    return inner === "" ? "" : inner.trim().replaceAll(/"+/gv, '"');
  }
  return text.replaceAll(/"+/gv, '"');
}

/**
 * A cell's comparable text: the reconstructed buffer, `.trim()`med
 * the way `Table::Cell#initialize`'s default-style branch strips it
 * (`cell_text ? cell_text.strip : ''`, table.rb:282), with csv's
 * unquote layered on top. `undefined` for a `literal` or `asciidoc`
 * styled cell (the style resolved for it, own spec or inherited
 * column, per `resolvedSpec`): those two apply a further transform
 * (leading blank-line trimming, rstrip/lstrip instead of a plain
 * trim) this suite does not model.
 * @param cell - the cell to read
 * @param cutting - the table's resolved cutting
 * @param resolvedStyle - the style this cell resolves to, own spec or
 *   inherited column
 * @returns the comparable text, or undefined to skip this cell's text
 */
function cellText(
  cell: TableCellNode,
  cutting: TableCutting,
  resolvedStyle: string | undefined,
): string | undefined {
  if (resolvedStyle === "literal" || resolvedStyle === "asciidoc") {
    return undefined;
  }
  const stripped = bufferTextOf(cell, cutting).trim();
  return cutting.format === "csv" ? csvUnquote(stripped) : stripped;
}

// ---------------------------------------------------------------------------
// Flattening our rows to the oracle's own row shape
// ---------------------------------------------------------------------------

/** One cell's comparable facts, in the oracle's own per-cell shape. */
export interface FlatCell {
  /** The comparable text, or undefined where a style exclusion applies. */
  readonly text: string | undefined;
  /** The oracle's own spec fields for this cell. */
  readonly spec: OracleCellSpec;
}

/**
 * The first defined value among `values`, in order.
 * @param values - candidate values, most specific first
 * @returns the first one that is not undefined
 */
function firstDefined<T>(...values: Array<T | undefined>): T | undefined {
  return values.find((value) => value !== undefined);
}

/** The three fields a cell's own spec and its column both may name. */
interface AlignAndStyle {
  /** The horizontal alignment named, if any. */
  readonly halign?: TableHorizontalAlignment;
  /** The vertical alignment named, if any. */
  readonly valign?: TableVerticalAlignment;
  /** The style named, if any. */
  readonly style?: TableCellStyle;
}

/**
 * `getAttributes()` always answers a concrete `halign`/`valign`
 * (`"left"`/`"top"` when neither the cell's own spec nor its column
 * named one, `Table::Column`'s own default), where our `TableCellSpec`
 * leaves the field absent when the spec named nothing. `style` gets no
 * such default: an unstyled oracle cell answers no `style` attribute
 * at all.
 *
 * On an IMPLICIT header row, `Table::Cell#initialize` nulls the LOCAL
 * `cell_style` a column's `asciidoc`/`literal` style would have set,
 * so that header text is not treated as a nested document or literal
 * block (table.rb:242-245) - but it does this AFTER `update_attributes
 * column.attributes` already ran (table.rb:250), and never touches the
 * attributes hash a style suppression would need to edit to change
 * what `getAttributes()` answers (table.rb:259 reads the un-nulled
 * `cell_style` for the switch that only governs TEXT). So the spec
 * comparison this function feeds stays correct on a header row; what
 * changes is `cellText`, which reads this same resolved style to
 * decide whether to skip a cell's text, and on a header row that skip
 * is too wide (a suppression it does not know about would have kept
 * the plain strip). See the skipped-cell-count bound this widens,
 * next to the exclusion ceiling.
 * @param own - the cell's own spec halign/valign/style, if it has one
 * @param column - the resolved column at this cell's position, if any
 * @returns the resolved spec, in the oracle's own defaulted shape
 */
function resolvedSpec(
  own: AlignAndStyle | undefined,
  column: AlignAndStyle | undefined,
): {
  halign: TableHorizontalAlignment;
  valign: TableVerticalAlignment;
  style: TableCellStyle | undefined;
} {
  return {
    halign: firstDefined(own?.halign, column?.halign) ?? "left",
    valign: firstDefined(own?.valign, column?.valign) ?? "top",
    style: firstDefined(own?.style, column?.style),
  };
}

/**
 * One row, flattened. A `duplicate` spec (`3*|`) is ONE recorded cell
 * here (src/parse/lines/table-reader.ts's own reason: three nodes
 * cannot share one span honestly) but `repeat` DUPLICATE Table::Cell
 * instances on the oracle's side (`close_cell`'s `1.upto(repeat)`
 * loop, table.rb:651), each carrying the same text and the same spec
 * minus the repeat itself (`repeatcol` is deleted before the spec
 * reaches `Table::Cell.new`, table.rb:620). Expanding here, rather
 * than excluding every table that uses `*`, is what lets this suite
 * compare the two representations as the same STRUCTURE despite the
 * different node count.
 *
 * `column` reads `columns[physicalIndex]`, matching
 * `@table.columns[@current_row.size]` (table.rb:653): the column a
 * cell inherits from is its PHYSICAL position within the row (a
 * duplicated cell's own copies each advance that position by one),
 * not the column its colspan visually reaches.
 * @param row - the row to flatten
 * @param cutting - the table's resolved cutting
 * @param columns - the table's resolved `cols=` columns, if it named any
 * @returns one entry per oracle-visible cell
 */
export function flattenRow(
  row: TableRowNode,
  cutting: TableCutting,
  columns: TableNode["columns"],
): FlatCell[] {
  const flat: FlatCell[] = [];
  const columnAt = (index: number): TableColumnSpec | undefined =>
    columns?.[index];
  for (const cell of row.children) {
    const own = specOf(cell);
    if (cell.repeat.kind === "duplicate") {
      for (let index = 0; index < cell.repeat.count; index += 1) {
        const spec = resolvedSpec(own, columnAt(flat.length));
        flat.push({
          text: cellText(cell, cutting, spec.style),
          spec: { colspan: 1, rowspan: 1, ...spec },
        });
      }
      continue;
    }
    const spec = resolvedSpec(own, columnAt(flat.length));
    flat.push({
      text: cellText(cell, cutting, spec.style),
      spec: {
        colspan: cell.repeat.kind === "span" ? cell.repeat.colspan : 1,
        rowspan: cell.repeat.kind === "span" ? cell.repeat.rowspan : 1,
        ...spec,
      },
    });
  }
  return flat;
}

// ---------------------------------------------------------------------------
// Exclusions (design section 5.1): named at the site, asserted small
// and non-vacuous below
// ---------------------------------------------------------------------------

/** One excluded case, and why. */
export interface Exclusion {
  /** The corpus case id. */
  readonly id: string;
  /** Why this suite does not compare it. */
  readonly reason: string;
}

/**
 * Whether `input` holds an `include::`, `ifdef::`, `ifndef::` or
 * `ifeval::` line anywhere in the case (not scoped to inside the
 * table itself: a directive before or after it can still gate whether
 * the table is even read): the oracle's preprocessor rewrites these
 * before the table is ever parsed (reader.rb's own preprocessor
 * pass), and this scan has no preprocessor of its own, so it and the
 * oracle would not be reading the same lines.
 * @param input - the case's source text
 * @returns whether a preprocessor line is present
 */
export function hasPreprocessorLine(input: string): boolean {
  return /^(?:include|ifdef|ifndef|ifeval)::/mv.test(input);
}

/**
 * How many column visits one cell counts for, restating
 * `visitsOf` (src/parse/lines/table-reader.ts, not exported): colspan
 * for a `span` repeat, the count for a `duplicate` repeat, else one.
 * @param repeat - the repeat the cell carries
 * @returns the visits
 */
function visitsOf(repeat: TableCellRepeat): number {
  if (repeat.kind === "span") {
    return repeat.colspan;
  }
  if (repeat.kind === "duplicate") {
    return repeat.count;
  }
  return 1;
}

/**
 * The column count `groupRows` used to group `table`'s rows: `cols=`
 * when the table named one, else the first row's own total visits,
 * the count `groupRows` establishes dynamically once that row closes
 * (`count ??= visits`, src/parse/lines/table-reader.ts). Undefined
 * only for a table with no rows at all.
 * @param table - the table to read
 * @returns the established column count
 */
function establishedColumnCount(table: TableNode): number | undefined {
  if (table.columns !== undefined) {
    return table.columns.length;
  }
  if (table.children.length === 0) {
    return undefined;
  }
  const [first] = table.children;
  return first.children.reduce((sum, cell) => sum + visitsOf(cell.repeat), 0);
}

/**
 * Whether a duplicate (`N*`) cell in `row` would land in more than
 * one oracle row. `groupRows` counts a duplicate's visits all at once
 * (src/parse/lines/table-reader.ts's own reason: one recorded cell
 * cannot honestly split into several), so a duplication CONTAINED in
 * one row - the common case - compares clean once flattened
 * (`flattenRow`'s own expansion). The oracle instead adds duplicate
 * repetitions one at a time and checks `end_of_row?` after each
 * (`close_cell`'s `1.upto(repeat)` loop, table.rb:651-672), so a row
 * boundary can fall STRICTLY INSIDE a duplicate's own repetitions -
 * after the 1st through the (N-1)th, never after the Nth, which is
 * the ordinary close this reader already gets right. Rowspan
 * reservations carried into `row` from an earlier row are not
 * modeled here (`groupRows`'s own `reserved` term): the corpus has no
 * case combining `N*` with an active rowspan, so this is a documented
 * simplification, not a claim of full generality.
 * @param row - the row to check
 * @param columnCount - the table's established column count, or
 *   undefined when the table has no rows to establish one
 * @returns whether this row's duplicate cell(s) split under the oracle
 */
export function duplicateSplitsRow(
  row: TableRowNode,
  columnCount: number | undefined,
): boolean {
  if (columnCount === undefined) {
    return false;
  }
  let visits = 0;
  for (const cell of row.children) {
    if (cell.repeat.kind === "duplicate") {
      const before = visits % columnCount;
      for (
        let repetition = 1;
        repetition < cell.repeat.count;
        repetition += 1
      ) {
        if ((before + repetition) % columnCount === 0) {
          return true;
        }
      }
    }
    visits += visitsOf(cell.repeat);
  }
  return false;
}

/**
 * Whether any row of `table` carries a duplicate spec that splits
 * across oracle rows: see {@link duplicateSplitsRow}.
 * @param table - the table to check
 * @returns whether a splitting duplicate is present
 */
export function hasSplittingDuplicate(table: TableNode): boolean {
  const columnCount = establishedColumnCount(table);
  return table.children.some((row) => duplicateSplitsRow(row, columnCount));
}

// ---------------------------------------------------------------------------
// The cells Asciidoctor reads as a nested document
// ---------------------------------------------------------------------------

/**
 * Every cell of `table` whose content Asciidoctor reads as a document
 * of its own, in the oracle's own order.
 *
 * Two facts decide it. The resolved style is `asciidoc` - the cell's
 * own spec, else the column at the cell's PHYSICAL position, the same
 * resolution {@link flattenRow} makes. And the cell is not in a
 * header row: `Table::Cell#initialize` nulls the style it would have
 * taken while `header_row?` holds (`cell_style = nil`,
 * table.rb:241-245) and refuses the cell's own style there too
 * (`unless in_header_row`, table.rb:259), so a header row's cell is a
 * plain cell whatever the column says. `header_row?` is true only
 * while the body is still empty (table.rb:83-85), which is the FIRST
 * row and no other.
 *
 * An `N*` duplicate yields its own repetitions, as `flattenRow` does:
 * the oracle builds one `Table::Cell` per repetition, each with its
 * own nested document.
 * @param table - the table to read
 * @returns the cells, in document order
 */
export function nestedDocumentCells(table: TableNode): TableCellNode[] {
  const found: TableCellNode[] = [];
  for (const [rowIndex, row] of table.children.entries()) {
    const headerRow = rowIndex === 0 && table.header !== "none";
    let position = 0;
    for (const cell of row.children) {
      const own = specOf(cell);
      const repetitions =
        cell.repeat.kind === "duplicate" ? cell.repeat.count : 1;
      for (let index = 0; index < repetitions; index += 1) {
        const { style } = resolvedSpec(own, table.columns?.[position]);
        if (style === "asciidoc" && !headerRow) {
          found.push(cell);
        }
        position += 1;
      }
    }
  }
  return found;
}
