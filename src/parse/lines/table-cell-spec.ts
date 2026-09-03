/**
 * The table cell-spec and column-spec GRAMMAR (issue #10): the two
 * regexes Ruby uses to read the `2+|`, `.2+^.^h|` prefix in front of
 * a psv cell's separator, and the record grammar inside a `cols=`
 * value, each as a total function returning a discriminated union
 * rather than Ruby's nil-or-hash pair (a `Hash` on a match, `nil` on
 * none).
 *
 * This module owns the GRAMMAR only. It does not scan a line for a
 * separator, does not know a table's cutting scheme, and does not
 * decide where one cell ends and the next begins: that scan belongs
 * to a sibling reader module this file does not yet have, over the
 * `SourceLine[]` an extent already holds. What lands here is exactly
 * the segment of `rx.rb` that matches a piece of a line rather than a
 * whole one, so it is not a `line-shapes.ts` export.
 *
 * `TableCellSpec`, `TableCellRepeat`, `TableColumnSpec` and the
 * alignment/style unions are transcribed verbatim from Asciidoctor's
 * own cell and column semantics; they are homed here until table
 * modeling gives the AST its own node kinds, when they move to
 * `src/ast.ts` and this module imports them back.
 *
 * Every regex here is anchored with `^`/`$` the way Ruby's own is,
 * and the two mean the same thing only because every caller passes a
 * SINGLE rstripped line's text with no embedded newline: JS's `^`/`$`
 * (no `m` flag) bind to the whole string's start and end, while
 * Ruby's bind to any line's start and end by default. The two rules
 * would diverge the moment a raw newline reached one of these
 * functions, which this module's inputs never carry.
 */

/**
 * `TableCellHorzAlignments` (parser.rb:53-59).
 *
 * Exported for tests/parser/table-cell-spec.test.ts; moves to
 * `src/ast.ts` once table modeling gives the AST its own node kinds,
 * which is when it gains a `src` consumer.
 * @internal
 */
export type TableHorizontalAlignment = "left" | "center" | "right";

/**
 * `TableCellVertAlignments` (parser.rb:61-67).
 *
 * Exported for tests/parser/table-cell-spec.test.ts; moves to
 * `src/ast.ts` once table modeling gives the AST its own node kinds,
 * which is when it gains a `src` consumer.
 * @internal
 */
export type TableVerticalAlignment = "top" | "middle" | "bottom";

/**
 * `TableCellStyles` (parser.rb:69-77).
 *
 * Exported for tests/parser/table-cell-spec.test.ts; moves to
 * `src/ast.ts` once table modeling gives the AST its own node kinds,
 * which is when it gains a `src` consumer.
 * @internal
 */
export type TableCellStyle =
  | "none"
  | "strong"
  | "emphasis"
  | "monospaced"
  | "header"
  | "literal"
  | "asciidoc";

/**
 * One `cols=` record, after `N*` expansion (parser.rb:2452-2481).
 *
 * Exported for tests/parser/table-cell-spec.test.ts; moves to
 * `src/ast.ts` once table modeling gives the AST its own node kinds,
 * which is when it gains a `src` consumer.
 * @internal
 */
export interface TableColumnSpec {
  /** `<`, `^`, `>` as `left`, `center`, `right`; absent when the record set none. */
  readonly halign?: TableHorizontalAlignment;
  /** `.<`, `.^`, `.>` as `top`, `middle`, `bottom`; absent when the record set none. */
  readonly valign?: TableVerticalAlignment;
  /** The one style letter's meaning, absent when the record named none or named an unmapped letter. */
  readonly style?: TableCellStyle;
}

/**
 * A cell spec's parse (parser.rb:2495-2545). `repeat` is a union
 * because Asciidoctor's `+` and `*` forms are exclusive: `+` sets
 * colspan and rowspan, `*` sets a duplication count and IGNORES the
 * row half of the same digits (parser.rb:2515-2520). Two nullable
 * number fields would let `{ colspan: 2, duplicate: 3 }` typecheck.
 *
 * Exported for tests/parser/table-cell-spec.test.ts; moves to
 * `src/ast.ts` once table modeling gives the AST its own node kinds,
 * which is when it gains a `src` consumer.
 * @internal
 */
export interface TableCellSpec {
  /** The `N+`, `N.M+` or `N*` prefix, or its absence. */
  readonly repeat: TableCellRepeat;
  /** The horizontal alignment the spec named, if any. */
  readonly halign?: TableHorizontalAlignment;
  /** The vertical alignment the spec named, if any. */
  readonly valign?: TableVerticalAlignment;
  /** The style the spec's letter named, absent for an unmapped letter. */
  readonly style?: TableCellStyle;
}

/**
 * The three exclusive forms of a cell spec's leading digits.
 *
 * Exported for tests/parser/table-cell-spec.test.ts; moves to
 * `src/ast.ts` once table modeling gives the AST its own node kinds,
 * which is when it gains a `src` consumer.
 * @internal
 */
export type TableCellRepeat =
  | {
      /** Repeat discriminant: no digits in front of the spec. */
      readonly kind: "none";
    }
  | {
      /** Repeat discriminant: `N+`, `.M+` or `N.M+`. */
      readonly kind: "span";
      /** Columns spanned; 1 when the spec wrote only a row half. */
      readonly colspan: number;
      /** Rows spanned; 1 when the spec wrote only a column half. */
      readonly rowspan: number;
    }
  | {
      /** Repeat discriminant: `N*`, which repeats the cell N times. */
      readonly kind: "duplicate";
      /** How many cells the one spelling produces. */
      readonly count: number;
    };

/**
 * `ColumnSpecRx` (rx.rb:390), applied to one comma/semicolon-split
 * record of a `cols=` value. Named groups: `repeat` (the `N*` count),
 * `align` (the horizontal/vertical pair), `width` (unread: a
 * rendering concern this repo never models, since it only feeds
 * `assign_column_widths`'s percentage arithmetic (table.rb:121-152)
 * and changes no source byte), `style` (the one letter).
 */
const COLUMN_SPEC_RX =
  /^(?:(?<repeat>\d+)\*)?(?<align>[<^>](?:\.[<^>]?)?|(?:[<^>]?\.)?[<^>])?(?<width>\d+%?|~)?(?<style>[a-z])?$/v;

/**
 * `CellSpecStartRx` (rx.rb:399): the text before the separator on a
 * line's first cell. Anchored at both ends, so a match always
 * consumes the whole string; no match means the text is not a spec at
 * all (Ruby's `nil`), which is what makes `close_cell` recover with
 * "table missing leading separator" (table.rb:621-627).
 */
const CELL_SPEC_START_RX =
  /^[ \t]*(?:(?<repeatDigits>\d+(?:\.\d*)?|(?:\d*\.)?\d+)(?<repeatOp>[*+]))?(?<align>[<^>](?:\.[<^>]?)?|(?:[<^>]?\.)?[<^>])?(?<style>[a-z])?$/v;

/**
 * `CellSpecEndRx` (rx.rb:400): the text before a LATER separator.
 * Anchored only at the end, so it finds the last run of `[ \t]+`
 * whose remainder is spec-shaped; unlike the start pattern it always
 * has a fallback reading (parser.rb:2508-2510: no match still opens a
 * cell with an empty spec, the whole text as content), so no digits
 * anywhere near the end still commits the whitespace it does find, if
 * any, to the spec's span, never to the cell's text.
 */
const CELL_SPEC_END_RX =
  /[ \t]+(?:(?<repeatDigits>\d+(?:\.\d*)?|(?:\d*\.)?\d+)(?<repeatOp>[*+]))?(?<align>[<^>](?:\.[<^>]?)?|(?:[<^>]?\.)?[<^>])?(?<style>[a-z])?$/v;

/** `TableCellHorzAlignments` (parser.rb:53-59). */
const HORIZONTAL_ALIGNMENTS: ReadonlyMap<string, TableHorizontalAlignment> =
  new Map([
    ["<", "left"],
    [">", "right"],
    ["^", "center"],
  ]);

/** `TableCellVertAlignments` (parser.rb:61-67). */
const VERTICAL_ALIGNMENTS: ReadonlyMap<string, TableVerticalAlignment> =
  new Map([
    ["<", "top"],
    [">", "bottom"],
    ["^", "middle"],
  ]);

/** `TableCellStyles` (parser.rb:69-77). */
const CELL_STYLES: ReadonlyMap<string, TableCellStyle> = new Map([
  ["d", "none"],
  ["s", "strong"],
  ["e", "emphasis"],
  ["m", "monospaced"],
  ["h", "header"],
  ["l", "literal"],
  ["a", "asciidoc"],
]);

/** Decimal radix for every `Number.parseInt` call in this module. */
const DECIMAL = 10;

/** A cell spec whose text named nothing at all: a bare `\|`. */
const EMPTY_CELL_SPEC: TableCellSpec = { repeat: { kind: "none" } };

/**
 * Split one alignment capture (`ColumnSpecRx`, `CellSpecStartRx` and
 * `CellSpecEndRx` all share the identical group) into its horizontal
 * and vertical halves, exactly as `m[N].split '.'` does in Ruby
 * (parser.rb:2449-2453, :2528-2534): the half before the optional dot
 * is horizontal, the half after is vertical, and a half that maps to
 * neither alignment table is dropped rather than reported, matching
 * Ruby's `key?` guard (`TableCellHorzAlignments.key?`,
 * `TableCellVertAlignments.key?`).
 * @param align - the matched align group, or undefined when the spec
 *   named no alignment at all
 * @returns the two alignments, each absent when unmapped or unwritten
 */
function splitAlignment(align: string | undefined): {
  halign?: TableHorizontalAlignment;
  valign?: TableVerticalAlignment;
} {
  if (align === undefined) {
    return {};
  }
  const dot = align.indexOf(".");
  const horizontalPart = dot === -1 ? align : align.slice(0, dot);
  const verticalPart = dot === -1 ? undefined : align.slice(dot + 1);
  return {
    halign: HORIZONTAL_ALIGNMENTS.get(horizontalPart),
    valign:
      verticalPart === undefined
        ? undefined
        : VERTICAL_ALIGNMENTS.get(verticalPart),
  };
}

/**
 * The style a spec's one letter names, dropped when the letter maps
 * to nothing (parser.rb:2541-2543, :69-77): `TableCellStyles.key?`.
 * @param letter - the matched style group, or undefined when absent
 * @returns the style, or undefined when absent or unmapped
 */
function styleFrom(letter: string | undefined): TableCellStyle | undefined {
  return letter === undefined ? undefined : CELL_STYLES.get(letter);
}

/**
 * Build a `TableCellRepeat` from `CellSpecStartRx`/`CellSpecEndRx`'s
 * `repeatDigits`/`repeatOp` pair (parser.rb:2513-2520). The digits
 * split on `.` the same way the alignment group does: the half before
 * is the column count, the half after is the row count, and either
 * half defaults to 1 when it is empty or absent, Ruby's
 * `nil_or_empty?` guard on both `colspec` and `rowspec`.
 * @param digits - the matched `repeatDigits` group
 * @param op - the matched `repeatOp` group, `"+"` or `"*"`
 * @returns the repeat the digits and operator name
 * @throws {Error} if `op` is defined but is neither `"+"` nor `"*"`,
 *   a can't-happen guard: the regex captures the two together, so
 *   `digits` is never defined without a recognized `op` beside it.
 */
function repeatFrom(
  digits: string | undefined,
  op: string | undefined,
): TableCellRepeat {
  if (digits === undefined) {
    return { kind: "none" };
  }
  const dot = digits.indexOf(".");
  const columnText = dot === -1 ? digits : digits.slice(0, dot);
  const rowText = dot === -1 ? undefined : digits.slice(dot + 1);
  const colspan = columnText === "" ? 1 : Number.parseInt(columnText, DECIMAL);
  const rowspan =
    rowText === undefined || rowText === ""
      ? 1
      : Number.parseInt(rowText, DECIMAL);
  if (op === "+") {
    return { kind: "span", colspan, rowspan };
  }
  if (op === "*") {
    // The row half is read the same way but never stored: parse_cellspec
    // sets `repeatcol` from `colspec` alone (parser.rb:2519-2520), and
    // `close_cell` applies the duplication in its own `1.upto(repeat)`
    // loop (table.rb:650-651).
    return { kind: "duplicate", count: colspan };
  }
  throw new Error(
    `table-cell-spec: repeat digits "${digits}" captured with no recognized operator`,
  );
}

/**
 * Build a `TableCellSpec` from one `CellSpecStartRx`/`CellSpecEndRx`
 * match's named groups.
 * @param groups - the match's named capture groups
 * @returns the spec's parse
 */
function cellSpecFrom(
  groups: Record<string, string | undefined>,
): TableCellSpec {
  const { halign, valign } = splitAlignment(groups.align);
  return {
    repeat: repeatFrom(groups.repeatDigits, groups.repeatOp),
    halign,
    valign,
    style: styleFrom(groups.style),
  };
}

/**
 * How a cell-opening spec's text ended: a real spec, or nothing.
 *
 * Exported for tests/parser/table-cell-spec.test.ts; the table reader
 * that scans a line for a separator (not part of this change) becomes
 * the real `src` consumer once it lands.
 * @internal
 */
export type CellSpecStartResult =
  | {
      /** Result discriminant: `text` was a valid spec, empty or not. */
      readonly kind: "opensCell";
      /**
       * The spec `text` parsed to. No `rest` field beside it: unlike
       * {@link CellSpecEndResult}, `CellSpecStartRx` is anchored at
       * both ends (rx.rb:399), so a successful match always consumes
       * `text` in full, and a field with exactly one possible value
       * is not information a caller can read.
       */
      readonly spec: TableCellSpec;
    }
  | {
      /**
       * Result discriminant: `text` is not a spec at all (Ruby's
       * `nil`, parser.rb:2328-2335), so whatever separator follows it
       * does not open a new cell; the line continues the one already
       * open.
       */
      readonly kind: "continues";
    };

/**
 * Parse the text before the separator on a line's first cell
 * (`CellSpecStartRx`, rx.rb:399; `parse_cellspec(line, :start, delimiter)`,
 * parser.rb:2495-2527).
 * @param text - the text before the line's first separator, leading
 *   whitespace included
 * @returns the spec `text` opens, or `"continues"` when it is not one
 *
 * Exported for tests/parser/table-cell-spec.test.ts; the table reader
 * that scans a line for a separator (not part of this change) becomes
 * the real `src` consumer once it lands.
 * @internal
 */
export function parseCellSpecStart(text: string): CellSpecStartResult {
  const match = CELL_SPEC_START_RX.exec(text);
  if (match?.groups === undefined) {
    return { kind: "continues" };
  }
  return { kind: "opensCell", spec: cellSpecFrom(match.groups) };
}

/**
 * What one `CellSpecEndRx` reading found.
 *
 * Exported for tests/parser/table-cell-spec.test.ts; the table reader
 * that scans a line for a separator (not part of this change) becomes
 * the real `src` consumer once it lands.
 * @internal
 */
export interface CellSpecEndResult {
  /**
   * The spec the trailing whitespace (and whatever spec text follows
   * it) parsed to: every field absent when `CellSpecEndRx` cannot
   * even find the whitespace to try (parser.rb:2508-2510).
   */
  readonly spec: TableCellSpec;
  /**
   * `text` with the matched whitespace-and-spec removed from its end:
   * the cell's actual content (Ruby's `m.pre_match`). Equal to `text`
   * itself when no match was found.
   */
  readonly rest: string;
}

/**
 * Parse the text before a later separator (`CellSpecEndRx`, rx.rb
 * :400; `parse_cellspec(line)`, parser.rb:2495-2527). Total: unlike
 * the start reading, Ruby never reports "not a spec" here, because a
 * psv separator anywhere in the buffered text cuts a cell regardless
 * (the `match_delimiter` loop, parser.rb:2351-2356).
 * @param text - the text before a later separator
 * @returns the parsed spec and the cell text left over
 *
 * Exported for tests/parser/table-cell-spec.test.ts; the table reader
 * that scans a line for a separator (not part of this change) becomes
 * the real `src` consumer once it lands.
 * @internal
 */
export function parseCellSpecEnd(text: string): CellSpecEndResult {
  const match = CELL_SPEC_END_RX.exec(text);
  if (match?.groups === undefined) {
    return { spec: EMPTY_CELL_SPEC, rest: text };
  }
  return { spec: cellSpecFrom(match.groups), rest: text.slice(0, match.index) };
}

/**
 * Whether `records` is exactly the decimal spelling Ruby's
 * `String#to_i` would read back from itself: the deprecated
 * `cols="N"` spread (parser.rb:2437-2440), N columns, none of them
 * naming an alignment or style. `to_i` reads an optional sign and
 * leading digits and stops at the first byte that is not one,
 * defaulting to 0 when there are none; a spelling with a leading
 * zero, a `+` sign or any trailing byte never round-trips through
 * `to_s`, so it falls through to the ordinary record grammar instead,
 * exactly as Ruby's own equality check does.
 * @param records - the `cols=` value with spaces already deleted
 * @returns the column count the deprecated form names, or undefined
 *   when `records` is not that spelling
 */
function bareIntegerSpread(records: string): number | undefined {
  const leading = /^[+\-]?\d+/v.exec(records)?.[0];
  const parsed = leading === undefined ? 0 : Number.parseInt(leading, DECIMAL);
  return String(parsed) === records ? parsed : undefined;
}

/**
 * How many times one `cols=` record repeats (`ColumnSpecRx`'s `N*`
 * prefix, parser.rb:2479-2481): the digits themselves, or 1 when the
 * record wrote no repeat count at all. A named function, not an
 * inline comparison, so the `undefined` case stays meaningful to the
 * type checker: `match.groups` indexing types every group as plain
 * `string`, never `string | undefined`, so an inline check against
 * one of its properties reads as dead code even though the group can
 * genuinely be absent at runtime.
 * @param digits - the matched `repeat` group
 * @returns the repeat count
 */
function columnRepeatCount(digits: string | undefined): number {
  return digits === undefined ? 1 : Number.parseInt(digits, DECIMAL);
}

/**
 * Parse a `cols=` value's records (`ColumnSpecRx`, rx.rb:390;
 * `parse_colspecs`, parser.rb:2425-2482). Column WIDTHS are not
 * modeled: `assign_column_widths`'s percentage arithmetic
 * (table.rb:121-152) changes no source byte, so the only thing a
 * caller reads out of the returned array's LENGTH is the table's
 * column count.
 * @param value - the `cols` attribute's raw value
 * @returns one entry per column, in declaration order after `N*`
 *   repeats are expanded
 *
 * Exported for tests/parser/table-cell-spec.test.ts; the table reader
 * that scans a line for a separator (not part of this change) becomes
 * the real `src` consumer once it lands.
 * @internal
 */
export function parseColumnSpecs(value: string): TableColumnSpec[] {
  const records = value.includes(" ") ? value.replaceAll(" ", "") : value;
  // An empty value is no columns at all, not one default column.
  // Ruby's String#split on an empty receiver returns [] no matter
  // what limit is passed (parser.rb:2446), so the loop below never
  // runs; a caller reading cols="" then treats the attribute as
  // wholly absent (parser.rb:2298's !empty? guard), which is outside
  // this function's own contract but is why an empty array, not one
  // entry, is the right total answer here.
  if (records === "") {
    return [];
  }
  const bareCount = bareIntegerSpread(records);
  if (bareCount !== undefined) {
    // Total fallback: a negative bare-integer spread (`cols="-1"`, a
    // pathological spelling `to_i` still round-trips) makes Ruby's
    // `Array.new` raise; this reads it as zero columns instead. Blast
    // radius: only this one malformed `cols` value, and only its own
    // column count, no byte moves.
    return Array.from({ length: Math.max(bareCount, 0) }, () => ({}));
  }
  // JS's plain split() already keeps every empty field, leading,
  // middle or trailing, the same behavior Ruby spells with an
  // explicit -1 limit (parser.rb:2446); no limit argument is needed
  // here or anywhere else in this module that splits on a literal.
  const fields = records.includes(",")
    ? records.split(",")
    : records.split(";");
  const specs: TableColumnSpec[] = [];
  for (const record of fields) {
    if (record === "") {
      specs.push({});
      continue;
    }
    const match = COLUMN_SPEC_RX.exec(record);
    // A record matching neither shape contributes no column at all
    // (parser.rb:2452 has no `else`): silently skipped, not an error.
    if (match?.groups === undefined) {
      continue;
    }
    const { halign, valign } = splitAlignment(match.groups.align);
    const spec: TableColumnSpec = {
      halign,
      valign,
      style: styleFrom(match.groups.style),
    };
    const repeatCount = columnRepeatCount(match.groups.repeat);
    for (let index = 0; index < repeatCount; index += 1) {
      // Immutable and shared rather than cloned per repetition: every
      // repetition of one record is the identical spec
      // (`parse_colspecs`'s own `spec.merge`, parser.rb:2479), and
      // nothing here ever writes through a `TableColumnSpec` once
      // built.
      specs.push(spec);
    }
  }
  return specs;
}
