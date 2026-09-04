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
 * Everything a table node is made of: what the open resolved, and
 * what the scan cut under it.
 *
 * ONE call for the reader, which holds the extent and nothing else
 * about tables. The order is Ruby's own - the columns are read before
 * the loop starts, because the count is what closes a row
 * (parser.rb:2296-2311) - and every step is a total function over
 * what the step before it returned.
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
    rows: groupRows(cut.cells, columns?.length),
    header: readHeaderDecision(lines, cut.cells, cutting, {
      header: values.options.has("header"),
      noheader: values.options.has("noheader"),
    }),
    footer: values.options.has("footer"),
    ...(columns === undefined ? {} : { columns }),
  };
}
