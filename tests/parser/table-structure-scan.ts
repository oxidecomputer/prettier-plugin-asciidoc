/**
 * Table structure (issue #10): the scan, build and oracle-comparable
 * flattening tests/parser/table-structure.test.ts drives over the
 * corpus. Split out of that file to stay under the repo's line
 * ceiling, the way tests/parser/ast-walk.ts split out of
 * ast-invariants.ts for the identical reason.
 *
 * No reader hookup exists yet (a `|===` block still resolves to the
 * opaque `TableBlockNode` passthrough), so {@link scanTables} locates
 * each table's extent itself, from the passthrough node `parse()`
 * already builds correctly: its `content` is exactly the table's own
 * bytes (delimiters included, confinement already resolved), and its
 * `annotatedBy` is the held attribute line's interior. From there it
 * resolves the cutting scheme, column spec and header/footer options
 * the way a table's open eventually will, cuts and groups the cells
 * with `cutCells`/`groupRows`/`readHeaderDecision`
 * (src/parse/lines/table-reader.ts), and assembles a `TableNode` with
 * `buildTable` (src/parse/build/table.ts).
 */
import { parse } from "../../src/parser.js";
import type {
  TableCellNode,
  TableCellOpening,
  TableCellRepeat,
  TableCellSpec,
  TableCellStyle,
  TableHorizontalAlignment,
  TableNode,
  TableRowNode,
  TableRunKind,
  TableVerticalAlignment,
} from "../../src/ast.js";
import {
  cutCells,
  groupRows,
  readHeaderDecision,
  type TableCutting,
  type TableFormat,
  type TableHeaderOptions,
} from "../../src/parse/lines/table-reader.js";
import {
  parseColumnSpecs,
  type TableColumnSpec,
} from "../../src/parse/lines/table-cell-spec.js";
import { buildTable, type TableScan } from "../../src/parse/build/table.js";
import {
  blockExtentOf,
  delimitedExtent,
} from "../../src/parse/lines/delimited-reader.js";
import { splitLines } from "../../src/parse/lines/split.js";
import {
  delimiterKind,
  type DelimiterKind,
} from "../../src/parse/lines/classify.js";
import { attrlistFields } from "../../src/parse/attrlist.js";
import { rstrip } from "../../src/parse/line-shapes.js";
import { makeLocationIndex } from "../../src/parse/positions.js";
import { preorder, type AnyNode } from "./ast-walk.js";
import type { OracleCellSpec } from "../helpers.js";

// ---------------------------------------------------------------------------
// Locating a table's extent from the existing passthrough
// ---------------------------------------------------------------------------

/**
 * The default cutting scheme a table's own delimiter hint selects
 * before any `format=` attribute overrides it (`table.rb:459-467`):
 * `|` and `!` both open a psv table, `,` opens csv, `:` opens dsv.
 * @param kind - the delimiter kind that opened the table
 * @returns the default format
 */
function defaultFormat(kind: DelimiterKind): TableFormat {
  return kind === "tableComma" ? "csv" : kind === "tableColon" ? "dsv" : "psv";
}

/** The default cell separator for one cutting format. */
const DEFAULT_SEPARATOR: Record<TableFormat, string> = {
  psv: "|",
  csv: ",",
  dsv: ":",
};

/**
 * One block-attribute line's interior, split into its named
 * attributes and its `%shorthand` option names (`options="header"` and
 * `%header` are the same fact spelled two ways, parser.rb:2304-2306).
 * Built with {@link attrlistFields} rather than a hand-rolled split, so
 * a quoted `cols="1,1"` splits the same way the reader's own attrlist
 * parser splits it.
 */
interface TableAttributes {
  /** Named attribute values, keyed by name. */
  readonly named: ReadonlyMap<string, string>;
  /** Every `%name` shorthand and every `options=` list entry, together. */
  readonly options: ReadonlySet<string>;
}

/** An attrlist field with no attributes at all (a table with no held line). */
const NO_ATTRIBUTES: TableAttributes = { named: new Map(), options: new Set() };

/**
 * Strip one layer of matching quotes from an attrlist value, when the
 * whole value is quoted. Not Ruby's full unescape (this suite has no
 * need of `\"`), only enough to read `cols="1,1"` and `options="header,footer"`.
 * @param value - the field's value half
 * @returns the value with its surrounding quotes removed, if any
 */
function unquote(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const [quote] = value;
  return (quote === '"' || quote === "'") && value.endsWith(quote)
    ? value.slice(1, -1)
    : value;
}

/**
 * Parse a table's held attribute-line interior into named attributes
 * and option names.
 * @param annotatedBy - the interior the reader recorded, or undefined
 * @returns the parsed attributes
 */
function tableAttributes(annotatedBy: string | undefined): TableAttributes {
  if (annotatedBy === undefined) {
    return NO_ATTRIBUTES;
  }
  const fields = attrlistFields(annotatedBy) ?? annotatedBy.split(",");
  const named = new Map<string, string>();
  const options = new Set<string>();
  for (const field of fields) {
    const trimmed = field.trim();
    const shorthand = /^%(?<name>[\w\-]+)$/v.exec(trimmed);
    if (shorthand?.groups !== undefined) {
      options.add(shorthand.groups.name);
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const name = trimmed.slice(0, eq).trim();
    const value = unquote(trimmed.slice(eq + 1).trim());
    named.set(name, value);
    if (name === "options") {
      for (const option of value.split(",")) {
        if (option !== "") {
          options.add(option.trim());
        }
      }
    }
  }
  return { named, options };
}

/**
 * Resolve a table's cutting scheme: the delimiter's own default,
 * `format=` if it named one (with `tsv` aliased to csv, table.rb:461-463),
 * then `separator=` if it named one.
 * @param kind - the delimiter kind that opened the table
 * @param attributes - the table's parsed attribute line
 * @returns the cutting
 */
function resolveCutting(
  kind: DelimiterKind,
  attributes: TableAttributes,
): TableCutting {
  const named = attributes.named.get("format");
  const format: TableFormat =
    named === "psv" || named === "csv" || named === "dsv"
      ? named
      : named === "tsv"
        ? "csv"
        : defaultFormat(kind);
  const separator = attributes.named.get("separator");
  return {
    format,
    separator:
      separator === undefined || separator === ""
        ? format === "csv" && named === "tsv"
          ? "\t"
          : DEFAULT_SEPARATOR[format]
        : separator,
  };
}

/**
 * Resolve a table's `cols=` value into its column specs, absent (not
 * `[]`) when the attribute is missing or names no column at all
 * (`parseColumnSpecs`'s own contract for an empty value).
 * @param attributes - the table's parsed attribute line
 * @returns the columns, or undefined
 */
function resolveColumns(
  attributes: TableAttributes,
): TableColumnSpec[] | undefined {
  const cols = attributes.named.get("cols");
  if (cols === undefined) {
    return;
  }
  const parsed = parseColumnSpecs(cols);
  return parsed.length === 0 ? undefined : parsed;
}

/** One table's passthrough node, as `parse()` still builds it. */
interface TablePassthrough {
  /** The table's raw bytes, delimiters included. */
  readonly content: string;
  /** The held attribute line's interior, if any. */
  readonly annotatedBy: string | undefined;
}

/**
 * Whether a preorder-walked node is the existing table passthrough:
 * a `delimitedBlock` whose variant is `"table"`.
 * @param node - a node from {@link preorder}
 * @returns the node's `content`/`annotatedBy`, or undefined
 */
function asTablePassthrough(node: AnyNode): TablePassthrough | undefined {
  if (node.type !== "delimitedBlock" || node.variant !== "table") {
    return undefined;
  }
  const { content, annotatedBy } = node;
  if (typeof content !== "string") {
    return undefined;
  }
  return {
    content,
    annotatedBy: typeof annotatedBy === "string" ? annotatedBy : undefined,
  };
}

/** One table, scanned and built, ready to compare against the oracle. */
export interface ScannedTable {
  /** The assembled node. */
  readonly table: TableNode;
  /** The cutting the table resolved to (needed to reconstruct cell text). */
  readonly cutting: TableCutting;
  /**
   * The passthrough's own raw bytes this table was built from,
   * delimiters included: what {@link replayTable} is checked against.
   */
  readonly content: string;
}

/**
 * Scan and build every table `parse()` finds in `input`, in document
 * order. Each table's own passthrough `content` stands in for "the
 * whole document" here: {@link delimitedExtent} re-finds the same
 * close line (or the same unterminated run) the passthrough already
 * resolved, correctly for a nested or confined table too, since
 * `content` never runs past where the real reader stopped it.
 * @param input - AsciiDoc source text
 * @returns every table found, in document order
 */
export function scanTables(input: string): ScannedTable[] {
  const document = parse(input);
  const passthroughs = preorder(document)
    .map(asTablePassthrough)
    .filter((found) => found !== undefined);
  return passthroughs.map(({ content, annotatedBy }) => {
    const lines = splitLines(content);
    const kind = delimiterKind(lines[0].text);
    if (kind === undefined) {
      throw new Error("table-structure: passthrough content opens no table");
    }
    const extent = delimitedExtent(lines, 0, kind);
    const packaged = blockExtentOf(extent, content, content.length);
    const attributes = tableAttributes(annotatedBy);
    const cutting = resolveCutting(kind, attributes);
    const columns = resolveColumns(attributes);
    const cut = cutCells(extent.interior, cutting);
    const rows = groupRows(cut.cells, columns?.length);
    const headerOptions: TableHeaderOptions = {
      header: attributes.options.has("header"),
      noheader: attributes.options.has("noheader"),
    };
    const header = readHeaderDecision(
      extent.interior,
      cut.cells,
      cutting,
      headerOptions,
    );
    const scan: TableScan = {
      cutting,
      leadingRuns: cut.leadingRuns,
      rows,
      header,
      footer: attributes.options.has("footer"),
      ...(columns === undefined ? {} : { columns }),
    };
    const at = makeLocationIndex(content);
    const table = buildTable(packaged, scan, at, annotatedBy);
    return { table, cutting, content };
  });
}

/**
 * The bytes one cell's opening wrote of its own: `spec + separator`
 * for a `separator` opening, empty for the two openings that write
 * none (design section 3.4's `openingImage`).
 * @param opening - the cell's opening
 * @returns the bytes the opening itself contributes
 */
function openingImage(opening: TableCellOpening): string {
  return opening.kind === "separator" ? opening.spec + opening.separator : "";
}

/**
 * Replay a built table's own records to the bytes they partition
 * (design section 3.4, and AST invariant (xv) once this suite's
 * reader hooks up for real): `open`, a newline, every leading run in
 * order, every row's cells in order (each one's opening bytes then
 * its own runs' images), and the close. Checked against the
 * passthrough's own `content` at the call site, which is this suite's
 * proof that `open`, `leadingRuns`, each cell's `opening` (spec and
 * separator) and `runs`, and `close.image` together account for every
 * byte with none moved or dropped - `cutCells`/`groupRows`'s own cut
 * (src/parse/lines/table-reader.ts) carried through
 * src/parse/build/table.ts's assembly unchanged. It does NOT check
 * `cellEnd`/`TableRowNode.position` (a Location, not a byte, and
 * nothing here reads one) or `closeOf`'s `endOfStream` arm (no corpus
 * table is left unterminated, so that arm has no case to run this
 * check against at all).
 * @param table - the built table
 * @returns the bytes the table's own records account for
 */
export function replayTable(table: TableNode): string {
  const leading = table.leadingRuns.map((run) => run.image).join("");
  const rows = table.children
    .map((row) =>
      row.children
        .map(
          (cell) =>
            openingImage(cell.opening) +
            cell.runs.map((run) => run.image).join(""),
        )
        .join(""),
    )
    .join("");
  const close =
    table.close.kind === "delimiter" ? `\n${table.close.image}` : "";
  return `${table.open}\n${leading}${rows}${close}`;
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
