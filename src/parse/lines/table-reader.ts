/**
 * The table SCAN (issue #10): a table extent's lines folded into the
 * cells they cut, and those cells folded into rows.
 *
 * Two total functions rather than one loop around a mutable context.
 * Asciidoctor carries a `Table::ParserContext` through the whole read
 * (table.rb:455-495 initializes fourteen instance variables and the
 * loop at parser.rb:2314-2415 mutates ten of them); its fields are
 * exactly the fold state of two passes, so they are written here as
 * two: {@link cutCells} decides where each cell's bytes begin and end,
 * and {@link groupRows} decides which cells share a row, reading only
 * per-cell facts the cut recorded plus the table's column count. A
 * grouping mistake therefore cannot move a byte: the printer replays
 * the cut, and the rows are a recorded derivation beside it.
 *
 * NOTHING IS DELETED. Asciidoctor's reader removes `//` lines
 * (`skip_comments`, reader.rb:424) and skips blank lines (`skip_blank_lines`,
 * reader.rb:279) before the table sees them, and those bytes are then
 * gone. A formatter cannot lose them, so they stay as runs inside the
 * cell whose region they fall in, tagged with why the reader dropped
 * them. Concatenating every run's image, each cell's opening in front
 * of it, reproduces the source.
 *
 * WHAT THE SCAN COVERS is the region from the first interior line's
 * first character to the last interior line's last character: the
 * terminator after the last line belongs to the closing delimiter, not
 * to any cell, and no other byte of the interior is left out.
 *
 * WHAT IT DOES NOT STORE is any derived reading of those bytes. The
 * text Asciidoctor buffers is the runs' text rstripped per line
 * (src/parse/lines/split.ts) and with each escaping backslash chopped
 * where a separator was escaped (table.rb:525-528, the chop the
 * cutAtSeparator comment and its test spell out), what `Table::Cell` shows is that text
 * stripped, unquoted and squeezed (table.rb:628-648), and what a style
 * letter makes of it is a whole further parse (`cell_style`,
 * table.rb:263-290). Each
 * is derived where it is needed instead of kept beside the bytes it
 * came from.
 */
import {
  parseCellSpecEnd,
  parseCellSpecStart,
  type TableCellRepeat,
  type TableCellSpec,
} from "./table-cell-spec.js";
import type { SourceLine } from "./split.js";

/**
 * The three cutting schemes a table can resolve to. `tsv` is not one:
 * it is an alias for csv with a tab separator, resolved where the
 * table opens, next to the fallback an illegal value takes with a log
 * against `cursor_at_prev_line` (table.rb:459-467), so neither ever
 * reaches the scan.
 *
 * Named by a table's open (lines/table-open.ts), which resolves it,
 * and by tests/parser/table-reader.test.ts.
 */
export type TableFormat = "psv" | "csv" | "dsv";

/**
 * How a table cuts cells: the format's rules, and the one string that
 * separates cells under them.
 *
 * Resolved by a table's open (lines/table-open.ts) and handed to the
 * two functions below; also read by tests/parser/table-reader.test.ts.
 */
export interface TableCutting {
  /** The cutting rules to apply. */
  readonly format: TableFormat;
  /**
   * The separator as written. Never empty from a document, since a
   * `nil_or_empty?` `separator=` falls back to the format's default
   * (table.rb:475-479); the searches below find an empty one nowhere,
   * because a separator that matched at every position would cut for
   * ever.
   */
  readonly separator: string;
}

/**
 * How a cell began. A psv cell opens at a separator, optionally behind
 * a spec. `recovered` is Asciidoctor's "table missing leading
 * separator" repair, where the text in front of the first separator of
 * the first line becomes a cell (`take_cellspec` finds nothing to
 * take, table.rb:621-626). `lineStart` is how a csv or dsv cell
 * begins, those formats calling `close_cell` at the end of a line
 * (parser.rb:2398-2401) and leaving `cell_text` no spec at all
 * (table.rb:628-631).
 *
 * Exported for tests/parser/table-reader.test.ts. No `src` consumer
 * spells the name: the builder reads the shape through src/ast.ts's
 * own restatement of it.
 * @internal
 */
export type TableCellOpening =
  | {
      /** Opening discriminant: a separator, with its spec in front. */
      readonly kind: "separator";
      /**
       * The spec text as written, INCLUDING the leading or trailing
       * whitespace `CellSpecStartRx` and `CellSpecEndRx` take with it
       * (rx.rb:399-400). `""` for a bare `|`, which is the ordinary
       * case rather than an absence, and always `""` for csv and dsv.
       */
      readonly spec: string;
      /** The spec's parse; every field absent for `spec === ""`. */
      readonly parsed: TableCellSpec;
      /**
       * The separator as CONSUMED, which is `cutting.separator`
       * everywhere but at a line start, where Asciidoctor cuts one
       * character off a line it matched the whole separator against
       * (parser.rb:2319-2320 against `starts_with_delimiter?`,
       * table.rb:502-504). Probed: with `separator=;;`, the first cell
       * of `;;a ;;b` reads `;a`.
       */
      readonly separator: string;
      /** Zero-based offset of the spec's first character. */
      readonly offset: number;
    }
  | {
      /** Opening discriminant: an opening that writes no bytes of its own. */
      readonly kind: "lineStart" | "recovered";
      /** Zero-based offset of the cell's first character. */
      readonly offset: number;
    };

/**
 * Why a run's bytes are in a cell's region: `content` is the cell's
 * own text, and the other two are lines the reader consumed before the
 * table could see them, kept so the printer can write them back.
 * `droppedComment` is a `//` line, but not a `///` one
 * (`skip_comments`, reader.rb:420-425); `skippedBlank` is a blank line no cell was open
 * to take (`skip_blank_lines`, reader.rb:279-291, reached from
 * parser.rb:2303 and parser.rb:2413). Both cover the line AND its
 * terminator, so the run list has no gaps - except on the extent's
 * LAST line, whose terminator belongs to the closing delimiter
 * ({@link regionEnd}), so a blank one there is a run of no bytes.
 *
 * Exported for tests/parser/table-reader.test.ts. No `src` consumer
 * spells the name: the builder reads the shape through src/ast.ts's
 * own restatement of it.
 * @internal
 */
export type TableRunKind = "content" | "droppedComment" | "skippedBlank";

/**
 * One run of a cell's raw region. One record rather than a
 * discriminated union: all three kinds carry the same two fields, so a
 * union would separate nothing a reader has to tell apart.
 *
 * Exported for tests/parser/table-reader.test.ts. No `src` consumer
 * spells the name: the builder reads the shape through src/ast.ts's
 * own restatement of it.
 * @internal
 */
export interface TableTextRun {
  /** Why these bytes are here. */
  readonly kind: TableRunKind;
  /** The bytes, verbatim, newlines included. */
  readonly image: string;
  /** Zero-based offset of the run's first character. */
  readonly offset: number;
}

/**
 * One cell as the scan cut it.
 *
 * Exported for tests/parser/table-reader.test.ts. No `src` consumer
 * spells the name: the builder reads the shape through src/ast.ts's
 * own restatement of it.
 * @internal
 */
export interface TableScanCell {
  /** How this cell was opened. */
  readonly opening: TableCellOpening;
  /**
   * The cell's raw region, partitioned. The region runs from the end
   * of this cell's opening to the start of the next cell's, so every
   * byte between two openings belongs to exactly one run.
   */
  readonly runs: readonly TableTextRun[];
  /**
   * The repeat Asciidoctor's cell-spec QUEUE hands this cell, which is
   * what the grouping counts. Usually the repeat of the cell's own
   * opening spec; in a table whose first line is missing its leading
   * separator the queue runs one behind for the whole table
   * (`take_cellspec` shifts, table.rb:554-556, what `push_cellspec`
   * put there one separator later, table.rb:562-565), so each cell
   * takes the NEXT opening's repeat and the last cell takes none.
   * Probed: `a 2+|b |c` reports the recovered cell with colspan 2.
   */
  readonly repeat: TableCellRepeat;
  /**
   * Whether the cell was closed at the end of a line rather than by a
   * separator in the middle of one (`close_cell`'s `eol`,
   * table.rb:617/672). It is what closes the first row of a table that
   * declared no `cols`.
   */
  readonly closedAtLineEnd: boolean;
}

/**
 * What one table's interior cut into.
 *
 * Exported for tests/parser/table-reader.test.ts. No `src` consumer
 * spells the name: the builder reads the shape through src/ast.ts's
 * own restatement of it.
 * @internal
 */
export interface TableCut {
  /**
   * Runs before the first cell begins: the blank lines
   * `skip_blank_lines` swallowed ahead of it (parser.rb:2303), and any
   * comment line among them. Empty for a table that opens with
   * content.
   */
  readonly leadingRuns: readonly TableTextRun[];
  /** The cells, in document order. */
  readonly cells: readonly TableScanCell[];
}

/**
 * What a table's first row is.
 *
 * Exported for tests/parser/table-reader.test.ts. No `src` consumer
 * spells the name: the builder reads the shape through src/ast.ts's
 * own restatement of it.
 * @internal
 */
export type TableHeaderDecision = "explicit" | "implicit" | "none";

/**
 * The header-related options the block's attribute list declared.
 *
 * Exported for tests/parser/table-reader.test.ts. No `src` consumer
 * spells the name: the builder reads the shape through src/ast.ts's
 * own restatement of it.
 * @internal
 */
export interface TableHeaderOptions {
  /** `%header` or `options="header"` (`has_header_option`, parser.rb:2304-2305). */
  readonly header: boolean;
  /** `%noheader`, read where `has_header_option` is not (parser.rb:2306). */
  readonly noheader: boolean;
}

/** A cell spec that named nothing: the reading for a bare separator. */
const EMPTY_SPEC: TableCellSpec = { repeat: { kind: "none" } };

/** The repeat a cell with no spec of its own carries. */
const NO_REPEAT: TableCellRepeat = { kind: "none" };

/** The quote character csv data protects its separators with. */
const QUOTE = '"';

/**
 * Two quotes: csv's spelling of one literal quote, as
 * `buffer_has_unclosed_quotes?` collapses them (table.rb:534-546).
 */
const DOUBLED_QUOTE = '""';

/** What a `//` comment line starts with (`skip_comments`, reader.rb:424). */
const COMMENT_HEAD = "//";

/** What a `///` line starts with, which `skip_comments` does NOT drop (reader.rb:424). */
const NOT_COMMENT_HEAD = "///";

/**
 * The characters Ruby's `String#strip` removes, which is the strip the
 * csv quote test runs (`buffer_has_unclosed_quotes?`,
 * table.rb:534-537). It is NOT this repo's `rstrip`: that one is the
 * reader's own per-line strip, measured against the oracle, and it
 * leaves a NUL where `String#strip` takes one.
 */
const RUBY_WHITESPACE = new Set([" ", "\t", "\n", "\v", "\f", "\r", "\u0000"]);

/** The cell being accumulated, before it is handed to the cut. */
interface OpenRegion {
  /** Its opening, or undefined for the region before the first cell. */
  readonly opening: TableCellOpening | undefined;
  /** Its runs so far. */
  readonly runs: TableTextRun[];
  /** How it was closed, or undefined while it is still open. */
  closedAtLineEnd: boolean | undefined;
}

/** One cell, before the cell-spec queue's repeat is paired with it. */
interface PositionalCell {
  /** How this cell was opened. */
  readonly opening: TableCellOpening;
  /** The cell's raw region. */
  readonly runs: readonly TableTextRun[];
  /** Whether the cell was closed at the end of a line. */
  readonly closedAtLineEnd: boolean;
}

/** Everything the cut carries from one line to the next. */
interface CutState {
  /** Cells already cut, in document order. */
  readonly cells: PositionalCell[];
  /** Runs read before the first cell began. */
  readonly leadingRuns: TableTextRun[];
  /** The cell being accumulated. */
  region: OpenRegion;
  /**
   * Asciidoctor's `@cell_open` (table.rb:572-591): whether a blank
   * line is the open cell's content or a line the reader skips, and
   * whether the end of the stream closes one last cell.
   */
  cellOpen: boolean;
  /**
   * Asciidoctor's `@buffer` (its `attr_accessor`, table.rb:446-447),
   * maintained only for csv, whose `buffer_has_unclosed_quotes?` is the
   * one rule that reads back the text accumulated so far
   * (table.rb:534-552). The other two formats never
   * consult it.
   */
  csvBuffer: string;
}

/** One line of the scan, and everything reading it needs. */
interface LineScan {
  /** The fold's state. */
  readonly state: CutState;
  /** The line being read. */
  readonly line: SourceLine;
  /** Absolute offset the line's region ends at, terminator included. */
  readonly end: number;
  /** The table's cutting. */
  readonly cutting: TableCutting;
}

/** Where the scan of one line carries on from. */
interface CutStep {
  /** Absolute offset of the first character not yet scanned. */
  readonly cursor: number;
  /** The line's text from that offset on. */
  readonly rest: string;
}

/**
 * Where a separator sits in `text`, or -1 for none. An empty separator
 * is found nowhere: see {@link TableCutting.separator}.
 * @param text - the text to search
 * @param separator - the table's separator
 * @returns the index of the first separator, or -1
 */
function findSeparator(text: string, separator: string): number {
  return separator === "" ? -1 : text.indexOf(separator);
}

/**
 * Whether the reader deletes this line before the table is parsed:
 * `//` but not `///`, spelled as `skip_comments`'s own two prefix
 * tests (reader.rb:424) rather than as a pattern, since that line is
 * where the rule lives.
 * @param text - the line's text, already rstripped
 * @returns whether the reader drops it
 */
function isDroppedComment(text: string): boolean {
  return text.startsWith(COMMENT_HEAD) && !text.startsWith(NOT_COMMENT_HEAD);
}

/**
 * Ruby's `String#strip`, as the csv quote test applies it.
 * @param text - the text to strip
 * @returns the text without leading or trailing Ruby whitespace
 */
function rubyStrip(text: string): string {
  let start = 0;
  let stop = text.length;
  while (start < stop && RUBY_WHITESPACE.has(text[start])) {
    start += 1;
  }
  while (stop > start && RUBY_WHITESPACE.has(text[stop - 1])) {
    stop -= 1;
  }
  return text.slice(start, stop);
}

/**
 * Whether csv data accumulated so far has a quote still open, so that
 * the next separator is inside quoted text rather than a cut
 * (`buffer_has_unclosed_quotes?`, table.rb:534-552).
 * @param buffer - the text accumulated for the current cell
 * @returns whether a quote is still open
 */
function hasUnclosedQuotes(buffer: string): boolean {
  const record = rubyStrip(buffer);
  if (record === QUOTE) {
    return true;
  }
  if (!record.startsWith(QUOTE)) {
    return false;
  }
  const trailingQuote = record.endsWith(QUOTE);
  if (
    (trailingQuote && record.endsWith(DOUBLED_QUOTE)) ||
    record.startsWith(DOUBLED_QUOTE)
  ) {
    const collapsed = record.replaceAll(DOUBLED_QUOTE, "");
    return collapsed.startsWith(QUOTE) && !collapsed.endsWith(QUOTE);
  }
  return !trailingQuote;
}

/**
 * Where line `index`'s region ends: the start of the next line, so the
 * terminator between them belongs to this line, or the last line's own
 * end, since the terminator after it belongs to the closing delimiter.
 * @param lines - the extent's interior lines
 * @param index - which line
 * @returns the absolute offset the line's region ends at
 */
function regionEnd(lines: readonly SourceLine[], index: number): number {
  const next = index + 1;
  return next < lines.length
    ? lines[next].offset
    : lines[index].offset + lines[index].raw.length;
}

/**
 * The bytes of one line between two absolute offsets, taken from the
 * RAW spelling so that trailing whitespace the reader's rstrip dropped
 * is still reproduced, and carrying the line's terminator when the
 * range reaches past its last character.
 * @param line - the line to slice
 * @param from - absolute offset of the first character
 * @param to - absolute offset just past the last
 * @returns the bytes
 */
function imageBetween(line: SourceLine, from: number, to: number): string {
  const rawEnd = line.offset + line.raw.length;
  const head = line.raw.slice(
    from - line.offset,
    Math.min(to, rawEnd) - line.offset,
  );
  return to > rawEnd ? `${head}\n` : head;
}

/**
 * Add a run to the region being accumulated. A run of no bytes is not
 * a run: an empty cell at the end of a line has a region with nothing
 * in it.
 * @param state - the fold's state
 * @param run - the run to add
 */
function appendRun(state: CutState, run: TableTextRun): void {
  if (run.image === "") {
    return;
  }
  state.region.runs.push(run);
}

/**
 * Add the bytes between two offsets of the line being read as the
 * current cell's text.
 * @param scan - the line being read
 * @param from - absolute offset of the first character
 * @param to - absolute offset just past the last
 */
function appendContent(scan: LineScan, from: number, to: number): void {
  appendRun(scan.state, {
    kind: "content",
    image: imageBetween(scan.line, from, to),
    offset: from,
  });
}

/**
 * Add a whole line to the region, as bytes no cell's text claims.
 *
 * Pushed WITHOUT {@link appendRun}'s empty-image test, which is the
 * one place a run of no bytes is still a run: the extent's LAST line
 * carries no terminator of its own ({@link regionEnd}), so a blank
 * line there writes nothing at all, and the run is then the only
 * record that the interior had a line. That record is what tells a
 * replaying printer `|===` directly over `|===` from `|===` over a
 * blank line over `|===` - two extents whose runs are otherwise
 * identical and whose bytes are not.
 * @param scan - the line being read
 * @param kind - why the reader consumed it
 */
function appendWholeLine(scan: LineScan, kind: TableRunKind): void {
  scan.state.region.runs.push({
    kind,
    image: imageBetween(scan.line, scan.line.offset, scan.end),
    offset: scan.line.offset,
  });
}

/**
 * Append to the csv quote buffer, which only csv reads.
 * @param scan - the line being read
 * @param text - the text Asciidoctor would have buffered
 */
function appendToBuffer(scan: LineScan, text: string): void {
  if (scan.cutting.format === "csv") {
    scan.state.csvBuffer += text;
  }
}

/**
 * Close the cell being accumulated (`close_cell`, table.rb:617-683).
 * Closing does not end the cell's REGION: what the reader skips
 * between one cell and the next still belongs to the closed cell's
 * span, which is what keeps the run list gapless.
 * @param state - the fold's state
 * @param atLineEnd - Asciidoctor's `eol`
 */
function closeCell(state: CutState, atLineEnd: boolean): void {
  state.region.closedAtLineEnd = atLineEnd;
  state.csvBuffer = "";
  state.cellOpen = false;
}

/**
 * Hand the region being accumulated to the cut: as a cell when
 * something opened it, and as the leading runs when nothing did.
 * @param state - the fold's state
 */
function flushRegion(state: CutState): void {
  const previous = state.region;
  if (previous.opening === undefined) {
    state.leadingRuns.push(...previous.runs);
    return;
  }
  state.cells.push({
    opening: previous.opening,
    runs: previous.runs,
    closedAtLineEnd: previous.closedAtLineEnd ?? false,
  });
}

/**
 * Begin a cell, handing the region before it to the cut.
 * @param state - the fold's state
 * @param opening - how the new cell begins
 */
function beginCell(state: CutState, opening: TableCellOpening): void {
  flushRegion(state);
  state.region = { opening, runs: [], closedAtLineEnd: undefined };
}

/**
 * The cell a psv line opens in front of its text, if it opens one
 * (parser.rb:2318-2334). A line that starts with the separator opens
 * one with no spec at all; otherwise the text in front of the line's
 * first separator has to parse as a spec (`parse_cellspec`).
 * @param line - the line being read
 * @param separator - the table's separator
 * @returns the opening and where the line's scan resumes, or
 *   undefined when the line opens nothing
 */
function psvOpening(
  line: SourceLine,
  separator: string,
):
  | { readonly opening: TableCellOpening; readonly restOffset: number }
  | undefined {
  const leading = separator !== "" && line.text.startsWith(separator);
  const at = leading ? 0 : findSeparator(line.text, separator);
  const started =
    at === -1 ? undefined : parseCellSpecStart(line.text.slice(0, at));
  if (started?.kind !== "opensCell") {
    return undefined;
  }
  return {
    opening: {
      kind: "separator",
      spec: line.raw.slice(0, at),
      parsed: started.spec,
      // `starts_with_delimiter?` matched the whole separator and the
      // branch it guards cuts one character: see
      // {@link TableCellOpening}.
      separator: leading ? line.raw.slice(0, 1) : separator,
      offset: line.offset,
    },
    restOffset: line.offset + (leading ? 1 : at + separator.length),
  };
}

/**
 * Open whatever cell a psv line opens before its text is scanned.
 * @param scan - the line being read
 * @returns the absolute offset the line's scan starts at
 */
function openPsvRegion(scan: LineScan): number {
  const { state, line } = scan;
  const opened = psvOpening(line, scan.cutting.separator);
  if (opened !== undefined) {
    if (state.cellOpen) {
      closeCell(state, true);
    }
    beginCell(state, opened.opening);
    return opened.restOffset;
  }
  // The cell continues from the previous line, unless there is no
  // previous cell at all: then the text in front of the first
  // separator is one Asciidoctor recovers, `take_cellspec` having
  // nothing to take (table.rb:621-626).
  if (state.region.opening === undefined) {
    beginCell(state, { kind: "recovered", offset: line.offset });
  }
  return line.offset;
}

/**
 * Open whatever cell a line opens before its text is scanned. csv and
 * dsv call `close_cell` at the end of every line (parser.rb:2398-2401), so
 * a line begins a cell whenever the last one was closed.
 * @param scan - the line being read
 * @returns the absolute offset the line's scan starts at
 */
function openRegion(scan: LineScan): number {
  if (scan.cutting.format === "psv") {
    return openPsvRegion(scan);
  }
  const { region } = scan.state;
  if (region.opening === undefined || region.closedAtLineEnd !== undefined) {
    beginCell(scan.state, { kind: "lineStart", offset: scan.line.offset });
  }
  return scan.line.offset;
}

/**
 * Take everything left of a line into the open cell and decide, by
 * format, whether the line's end closes it (`close_cell`,
 * parser.rb:2389-2405).
 * @param scan - the line being read
 * @param cursor - absolute offset of the first unscanned character
 * @param rest - the line's text from that offset on
 */
function endLine(scan: LineScan, cursor: number, rest: string): void {
  appendContent(scan, cursor, scan.end);
  appendToBuffer(scan, `${rest}\n`);
  if (scan.cutting.format === "csv") {
    if (hasUnclosedQuotes(scan.state.csvBuffer)) {
      scan.state.cellOpen = true;
    } else {
      closeCell(scan.state, true);
    }
    return;
  }
  if (scan.cutting.format === "dsv") {
    closeCell(scan.state, true);
    return;
  }
  scan.state.cellOpen = true;
}

/**
 * Take the text in front of a separator into the open cell, and say
 * where the next cell's spec begins. For psv that is wherever
 * `parse_cellspec` found one (parser.rb:2382-2384); the other two
 * formats carry no spec, so it is the separator itself.
 * @param scan - the line being read
 * @param cursor - absolute offset the text starts at
 * @param pre - the text in front of the separator
 * @param separatorStart - absolute offset of the separator
 * @returns the next cell's spec position and parse
 */
function takePreMatch(
  scan: LineScan,
  cursor: number,
  pre: string,
  separatorStart: number,
): { readonly specStart: number; readonly parsed: TableCellSpec } {
  if (scan.cutting.format !== "psv") {
    appendToBuffer(scan, pre);
    appendContent(scan, cursor, separatorStart);
    return { specStart: separatorStart, parsed: EMPTY_SPEC };
  }
  const { spec, rest } = parseCellSpecEnd(pre);
  appendToBuffer(scan, rest);
  const specStart = cursor + rest.length;
  appendContent(scan, cursor, specStart);
  return { specStart, parsed: spec };
}

/**
 * One separator on a line: cut a cell at it, or take it as literal
 * text and carry on (`match_delimiter`, parser.rb:2351-2388).
 * @param scan - the line being read
 * @param cursor - absolute offset of the first unscanned character
 * @param rest - the line's text from that offset on
 * @param at - index of the separator within `rest`
 * @returns where to carry on from, or undefined when the line is done
 */
function cutAtSeparator(
  scan: LineScan,
  cursor: number,
  rest: string,
  at: number,
): CutStep | undefined {
  const { separator, format } = scan.cutting;
  const pre = rest.slice(0, at);
  const post = rest.slice(at + separator.length);
  const separatorStart = cursor + at;
  const postStart = separatorStart + separator.length;
  const quoted =
    format === "csv" && hasUnclosedQuotes(scan.state.csvBuffer + pre);
  if (quoted || (format !== "csv" && pre.endsWith("\\"))) {
    // The separator is data: quoted (`skip_past_delimiter`,
    // table.rb:517-520) or escaped, in which case the backslash in
    // front of it is chopped from the text but not from the bytes
    // (`skip_past_escaped_delimiter`, table.rb:525-528).
    appendToBuffer(scan, `${quoted ? pre : pre.slice(0, -1)}${separator}`);
    appendContent(scan, cursor, postStart);
    if (post !== "") {
      return { cursor: postStart, rest: post };
    }
    // At the end of a line the escaped arm buffers the terminator and
    // holds the cell open, while the quoted arm breaks out and does
    // neither, which is the one place a `content` run carries a
    // newline the cell's own text does not (`skipPastDelimiter`,
    // parser.js:3310-3315, against `skipPastEscapedDelimiter`,
    // parser.js:3319-3325).
    appendToBuffer(scan, "\n");
    appendContent(scan, postStart, scan.end);
    scan.state.cellOpen = !quoted;
    return undefined;
  }
  const { specStart, parsed } = takePreMatch(scan, cursor, pre, separatorStart);
  closeCell(scan.state, false);
  beginCell(scan.state, {
    kind: "separator",
    spec: imageBetween(scan.line, specStart, separatorStart),
    parsed,
    separator,
    offset: specStart,
  });
  return { cursor: postStart, rest: post };
}

/**
 * Scan one line for the separators that cut it (`match_delimiter`,
 * parser.rb:2350-2407).
 * @param scan - the line being read
 * @param start - absolute offset the scan begins at
 */
function cutLine(scan: LineScan, start: number): void {
  let step: CutStep | undefined = {
    cursor: start,
    rest: scan.line.text.slice(start - scan.line.offset),
  };
  while (step !== undefined) {
    const at = findSeparator(step.rest, scan.cutting.separator);
    if (at === -1) {
      endLine(scan, step.cursor, step.rest);
      return;
    }
    step = cutAtSeparator(scan, step.cursor, step.rest, at);
  }
}

/**
 * Read one line into the fold.
 * @param state - the fold's state
 * @param lines - the extent's interior lines
 * @param index - which line
 * @param cutting - the table's cutting
 */
function readLine(
  state: CutState,
  lines: readonly SourceLine[],
  index: number,
  cutting: TableCutting,
): void {
  const line = lines[index];
  const scan: LineScan = { state, line, end: regionEnd(lines, index), cutting };
  if (isDroppedComment(line.text)) {
    appendWholeLine(scan, "droppedComment");
    return;
  }
  if (line.text === "") {
    // A blank line inside an open cell is bytes the cell keeps, and
    // nothing more: it neither closes the cell nor ends a row. The
    // oracle gives it an arm of its own, whose only call is
    // `keepCellOpen` (parser.js:3376-3383), and that is where its
    // reading and the Ruby's part company: the Ruby's `beyond_first`
    // arm (parser.rb:2315-2316) blanks the line and lets it fall
    // through to the arm a line with no separator takes, which would
    // END a dsv cell there. Probed: a dsv cell held open by an escaped
    // separator swallows the blank line after it, and the line after
    // that, as one cell. The oracle wins.
    if (state.cellOpen) {
      appendContent(scan, line.offset, scan.end);
      appendToBuffer(scan, "\n");
      return;
    }
    appendWholeLine(scan, "skippedBlank");
    return;
  }
  cutLine(scan, openRegion(scan));
}

/**
 * The repeat one cell's own opening spec carries, if it carries one.
 * @param cells - the cells cut, in document order
 * @param index - which cell's opening to read
 * @returns the repeat, or none when there is no such cell or no spec
 */
function openingRepeat(
  cells: readonly PositionalCell[],
  index: number,
): TableCellRepeat {
  if (index >= cells.length) {
    return NO_REPEAT;
  }
  const { opening } = cells[index];
  return opening.kind === "separator" ? opening.parsed.repeat : NO_REPEAT;
}

/**
 * Pair each cell with the repeat Asciidoctor's spec queue hands it.
 * See {@link TableScanCell.repeat}: a recovered first cell is one push
 * short, which shifts the queue for the rest of the table.
 * @param cells - the cells cut, in document order
 * @returns the same cells, each with its repeat
 */
function assignRepeats(cells: readonly PositionalCell[]): TableScanCell[] {
  const shifted = cells.length > 0 && cells[0].opening.kind === "recovered";
  return cells.map((cell, index) => ({
    ...cell,
    repeat: openingRepeat(cells, shifted ? index + 1 : index),
  }));
}

/**
 * Cut a table's interior into cells: where each one begins, and which
 * bytes are its own.
 *
 * Driven by a table's open (lines/table-open.ts) and by
 * tests/parser/table-reader.test.ts.
 * @param lines - the extent's interior lines, with their offsets in
 *   the whole document
 * @param cutting - the format and separator the table resolved to
 * @returns the cells, and whatever came before the first of them
 */
export function cutCells(
  lines: readonly SourceLine[],
  cutting: TableCutting,
): TableCut {
  const state: CutState = {
    cells: [],
    leadingRuns: [],
    region: { opening: undefined, runs: [], closedAtLineEnd: undefined },
    cellOpen: false,
    csvBuffer: "",
  };
  for (let index = 0; index < lines.length; index += 1) {
    readLine(state, lines, index, cutting);
  }
  if (state.cellOpen) {
    closeCell(state, true);
  }
  // A region left unclosed at the end of the stream is one Asciidoctor
  // never turns into a cell (parser.rb:2410-2413 reaches the end with
  // a buffer it drops, and `close_table` says so, table.rb:685-688).
  // Its bytes are kept here, because a formatter that dropped them
  // would delete text.
  flushRegion(state);
  return { leadingRuns: state.leadingRuns, cells: assignRepeats(state.cells) };
}

/**
 * How many column visits one cell counts for (`column_visits`,
 * table.rb:651-670): its colspan, or its duplication count, or one.
 * @param repeat - the repeat the spec queue handed the cell
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
 * Reserve a rowspan's slots in the rows below (`activate_rowspan`,
 * table.rb:713-716).
 * @param reserved - slots reserved per following row, index 0 being
 *   the row now being built
 * @param repeat - the repeat the spec queue handed the cell
 */
function activateRowspan(reserved: number[], repeat: TableCellRepeat): void {
  if (repeat.kind !== "span") {
    return;
  }
  while (reserved.length < repeat.rowspan) {
    reserved.push(0);
  }
  for (let index = 1; index < repeat.rowspan; index += 1) {
    reserved[index] += repeat.colspan;
  }
}

/**
 * Fold cells into rows.
 *
 * A row closes when its effective column visits, the cells' own plus
 * the slots rowspans above reserved, reach the table's column count
 * (`end_of_row?`, table.rb:721-728). With no `cols` there is no count
 * until the first row sets one, and until then only the end of a line
 * closes a row (table.rb:672's `eol` arm; its `@linenum > 0` arm
 * cannot be reached while the count is still unset, because the first
 * line to open a cell is also the first to close one at its end).
 *
 * Two places where Asciidoctor DROPS and this keeps, both so that no
 * byte goes missing: a row whose visits overrun the column count
 * (table.rb:673-675), and the cells of a last row that never closed
 * (`close_table`, table.rb:685-688). A duplicated cell is also one
 * cell here rather than N, three nodes being unable to share one span
 * honestly, so its visits are counted at once; Asciidoctor closes a
 * row between two repetitions of the same spelling when the count runs
 * out mid-way.
 *
 * Driven by a table's open (lines/table-open.ts) and by
 * tests/parser/table-reader.test.ts.
 * @param cells - the cells cut, in document order
 * @param columnCount - the count `cols=` fixed, or undefined when the
 *   first row is to fix it
 * @returns the rows, in document order
 */
export function groupRows(
  cells: readonly TableScanCell[],
  columnCount: number | undefined,
): ReadonlyArray<readonly TableScanCell[]> {
  const rows: TableScanCell[][] = [];
  const reserved = [0];
  let count = columnCount;
  let visits = 0;
  let row: TableScanCell[] = [];
  for (const cell of cells) {
    activateRowspan(reserved, cell.repeat);
    visits += visitsOf(cell.repeat);
    row.push(cell);
    const closes =
      count === undefined
        ? cell.closedAtLineEnd
        : visits + reserved[0] >= count;
    if (closes) {
      rows.push(row);
      count ??= visits;
      visits = 0;
      row = [];
      reserved.shift();
      if (reserved.length === 0) {
        reserved.push(0);
      }
    }
  }
  if (row.length > 0) {
    rows.push(row);
  }
  return rows;
}

/**
 * What a table's first row is.
 *
 * Asciidoctor assumes a header, tracks the size of the gap after the
 * first line in `implicit_header_boundary`, and clears the assumption
 * from three sites: `has_header_option` (parser.rb:2306-2309), the
 * boundary itself (:2331-2332, :2340-2345) and
 * `buffer_has_unclosed_quotes?` (:2394-2395). The same
 * observable rule, over facts the cut already recorded: the first row
 * is a header exactly when the block declared neither option, the
 * first line the TABLE sees is not blank, the line after it is, and
 * the first non-blank line after that gap begins a cell of its own
 * instead of continuing the one above it. That last clause is what
 * makes the csv case fall out rather than be special-cased: a first
 * line whose quotes never close leaves its cell running, so no cell
 * begins on the line after the gap.
 *
 * KNOWN CORNER: Asciidoctor tests those quotes only where it takes a
 * line's tail into the buffer (parser.rb:2394), not where it breaks
 * out of a line that ended on a quoted separator (parser.rb:2357), so
 * `a,"b,` followed by a gap keeps its header there and loses it here.
 *
 * Driven by a table's open (lines/table-open.ts) and by
 * tests/parser/table-reader.test.ts.
 * @param lines - the extent's interior lines
 * @param cells - the cells {@link cutCells} cut from them
 * @param cutting - the format and separator the table resolved to
 * @param options - the header options the attribute list declared
 * @returns what the first row is
 */
export function readHeaderDecision(
  lines: readonly SourceLine[],
  cells: readonly TableScanCell[],
  cutting: TableCutting,
  options: TableHeaderOptions,
): TableHeaderDecision {
  if (options.header) {
    return "explicit";
  }
  if (options.noheader) {
    return "none";
  }
  // The reader's deletions happen before any of this, so the lines the
  // rule counts are the lines the table sees (`skip_comments`,
  // reader.rb:420-425).
  const seen = lines.filter((line) => !isDroppedComment(line.text));
  if (seen.length < 2 || seen[0].text === "" || seen[1].text !== "") {
    return "none";
  }
  const resumed = seen.slice(2).find((line) => line.text !== "");
  // Nothing can cancel a dsv table's header: the loop clears the
  // assumption where `closeOpenCell` runs, which is the psv branch
  // alone (parser.js:3263-3282), and where `bufferHasUnclosedQuotes`
  // clears `implicitHeaderBoundary` on the first line, which is csv's
  // (parser.js:3356-3363).
  if (resumed === undefined || cutting.format === "dsv") {
    return "implicit";
  }
  return cells.some((cell) => cell.opening.offset === resumed.offset)
    ? "implicit"
    : "none";
}
