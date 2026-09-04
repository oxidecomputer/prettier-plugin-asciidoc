/**
 * The table layout GATE and the default normal form (issue #10).
 *
 * ONE total function from a table to a plan. The `"replay"` arm is the
 * printer's own body unchanged, which is the same shape
 * `canonicalAttrlist` (src/parse/attrlist.ts) takes when
 * `attrlistFields` declines an interior: the byte-replaying printer
 * does not become dead code and does not become a special case, it
 * becomes the arm the gate selects.
 *
 * Every decline reason names a fact the model ALREADY RECORDS, so the
 * gate is a fold over the node with no re-derivation and no second
 * parse. The reasons are evaluated in the union's declaration order
 * and the first one to fire is the answer, which is what makes the
 * ordered census a property of this code rather than of the test that
 * reads it.
 *
 * A {@link PlannedCell} holds STRINGS, extracted during the gate's own
 * walk. The narrowing the gate proves - psv cutting, no literal cell,
 * every opening a separator, no cell text that spans lines - is spent
 * once, here, so the emission needs no arm for a `lineStart` opening
 * and no branch for a literal cell's leading whitespace. That is what
 * makes the emission total without an unreachable branch.
 *
 * NO KNOB REACHES THE GATE. {@link planTable} takes the table and
 * nothing else, so which tables are laid out is the same set whatever
 * the style asks for, and the census (tests/format/table-census.test.ts)
 * is a property of the corpus rather than of any option value. The
 * style reaches the EMISSION alone, where it chooses between two
 * spellings of a table already accepted and decides whether that
 * table's cell text is padded out.
 *
 * PER TABLE, not per document. A document holding one declined table
 * still has its other tables laid out, so a reader can meet both
 * spellings in one file. The per-document answer would be one exported
 * `documentDeclines(root)` walking the tree with `getVisitorKeys`
 * (./visitor-keys.ts) plus one guard clause in ./table.ts; it is NOT
 * built, and its price is the population of mixed documents that
 * tests/format/table-census.test.ts measures and reports.
 */
import { util } from "prettier";
import type { TableCellNode, TableNode, TableRowNode } from "../ast.js";
import type { TableStyle } from "../options.js";
import { rstrip } from "../parse/line-shapes.js";

/**
 * Why a table is replayed instead of laid out. A closed union, because
 * this is the thing the project measures and ratchets: the census over
 * the corpus is pinned exact in both directions, so neither a reason
 * that starts firing more nor one that stops firing can land without
 * somebody saying why in the diff.
 *
 * DECLARATION ORDER IS EVALUATION ORDER ({@link planTable}). A table
 * holding two of these facts is counted under the first, so the order
 * is part of what a value here means.
 *
 * Named by tests/format/table-census.test.ts, which reads the gate's
 * own verdict rather than reimplementing it; no `src` consumer.
 * @internal
 */
export type TableDecline =
  // an attribute line stood above the table whose values the open
  // could not read, so every fact one governs is unknown: FIRST,
  // because it is the reason the others cannot be trusted.
  | "unread-attrlist"
  // csv, dsv, or a psv table whose separator the attribute line
  // replaced: the cell rules below are psv's.
  | "non-psv-format"
  // some cell's text spans source lines (#130).
  | "multi-line-cell"
  // an `l|` cell, or a cell whose column carries an `l` style: its
  // leading whitespace is content and the pad rule would move it.
  | "literal-cell"
  // a blank or comment line stands in front of the first cell.
  | "leading-runs"
  // a `//` line inside a cell's region, which the reader deletes.
  | "dropped-comment"
  // a table whose first line is missing its leading separator, where
  // the cell-spec queue runs one cell behind for the whole table.
  | "recovered-opening"
  // some row's effective column visits differ from the table's column
  // count: the oracle drops such a row and we keep its bytes.
  | "ragged-rows"
  // no closing delimiter line.
  | "unterminated"
  // the block's attribute-list INTERIOR holds an attribute reference.
  | "attribute-reference";

/** One cell, with everything the emission needs and nothing else. */
interface PlannedCell {
  /**
   * The spec's letters, stripped: `CellSpecStartRx` and `CellSpecEndRx`
   * take the surrounding whitespace with them (rx.rb:399-400), so the
   * recorded spec image carries a pad that this file re-derives.
   */
  readonly spec: string;
  /** The separator as consumed. */
  readonly separator: string;
  /** The cell's content runs, joined and stripped (see {@link cellStrip}). */
  readonly text: string;
}

/** One row: the cells one source line will carry. */
interface PlannedRow {
  /** The row's cells, in document order. */
  readonly cells: readonly PlannedCell[];
}

/** A table the gate accepted, and everything the emission may read. */
interface LaidOutPlan {
  /** Plan discriminant: the normal form applies. */
  readonly kind: "laidOut";
  /** The rows, in document order; empty for a table with no cells. */
  readonly rows: readonly PlannedRow[];
  /**
   * Whether the cells sit in a fixed column grid, which is what column
   * alignment pads against.
   *
   * DECIDED AT GATE TIME rather than at the padding, because a
   * {@link PlannedCell} deliberately carries no repeat: an emission
   * that read one would have to re-read the node it was planned from,
   * and the plan would stop being everything the emission may read.
   */
  readonly alignable: boolean;
}

/**
 * What the printer does with one table.
 *
 * The `"replay"` arm carries the REASON it declined. The census is
 * what this project measures, and a reason computed and thrown away
 * would have to be computed a second time by the test that counts it;
 * carrying it is what makes the census read the gate.
 */
export type TablePlan =
  | {
      /** Plan discriminant: the author's interior bytes go back. */
      readonly kind: "replay";
      /** Which fact declined the table. */
      readonly decline: TableDecline;
    }
  | LaidOutPlan;

/** The cutting a laid-out table has: `format` and `separator` both. */
const PSV_FORMAT = "psv";

/** The separator every top-level psv table cuts on (table.rb:466-474). */
const PSV_SEPARATOR = "|";

/** The run kind that is a cell's own text. */
const CONTENT_RUN = "content";

/** The run kind that is a `//` line the reader deletes. */
const DROPPED_COMMENT_RUN = "droppedComment";

/** The opening kind an accepted table's every cell has. */
const SEPARATOR_OPENING = "separator";

/** The style whose cells keep their own leading whitespace. */
const LITERAL_STYLE = "literal";

/** The repeat kind that carries a colspan and a rowspan both. */
const SPAN_REPEAT = "span";

/** The header verdict that emits no blank line after the first row. */
const NO_HEADER = "none";

/** The close that never wrote a closing delimiter line. */
const END_OF_STREAM = "endOfStream";

/** The one character the multi-line predicate reads. */
const LINE_FEED = "\n";

// `{name}` - `AttributeReferenceRx` (rx.rb:153). Narrower than Ruby's,
// which also takes `set:` and `counter2:` forms and an escaping
// backslash on either brace; a predicate that only ever DECLINES may
// be narrow in the escape's direction and is safe being broad in the
// other, so the simple spelling is the one to keep.
const ATTRIBUTE_REFERENCE = /\{[\w:.\-][\w:.\-]*\}/v;

/** The two pads a spec image may carry, and the only two. */
const SPEC_PAD_FRONT = /^[ \t]+/v;
const SPEC_PAD_BEHIND = /[ \t]+$/v;

/** The seven characters Ruby's `String#strip` takes (table.rb:282). */
const RUBY_WHITESPACE = new Set([" ", "\t", "\n", "\v", "\f", "\r", "\u0000"]);

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Plan one table: the first decline reason that fires, or the rows the
 * normal form will be emitted from.
 *
 * Written as a sequence rather than as a table of predicates so that
 * the source order a reader sees IS the order the census counts in.
 * It is split in three at exactly one seam, the `recovered-opening`
 * test, and that reason is why: it is the one reason that also
 * PRODUCES the plan, because a cell whose opening wrote no bytes of
 * its own has no spec and no separator to plan, and reading that
 * absence once is what leaves the emission with no arm for it. The two
 * halves keep the union's order between them.
 * @param node - the table to plan
 * @returns the plan, which is total over every table the reader builds
 */
export function planTable(node: TableNode): TablePlan {
  const known = declinesBeforePlanning(node);
  if (known !== undefined) {
    return { kind: "replay", decline: known };
  }
  const rows = plannedRows(node);
  if (rows === undefined) {
    return { kind: "replay", decline: "recovered-opening" };
  }
  const grouping = declinesAfterPlanning(node);
  if (grouping !== undefined) {
    return { kind: "replay", decline: grouping };
  }
  return { kind: "laidOut", rows, alignable: !hasSpan(node) };
}

/**
 * Whether some cell's spec spans columns or rows, which is what takes
 * the table out of a fixed column grid.
 *
 * ONE PREDICATE for both, because the `"span"` arm carries both halves
 * (`N+`, `.M+` and `N.M+` all parse to one colspan and one rowspan,
 * src/ast.ts): a colspan puts one cell where two columns' worth of
 * text sits, and a rowspan leaves the row below it short by the slots
 * `activate_rowspan` reserved (table.rb:713-716). Under either, the
 * cell at index `i` of one row and the cell at index `i` of the next
 * are not the same column, so there is no width to pad them to.
 *
 * A DUPLICATE (`3*|x`) is not one of these and does not decline
 * alignment. It is one recorded cell standing for several of Ruby's,
 * so the indexes on either side of it do drift - what the padding
 * lines up is then the recorded cells rather than the rendered
 * columns. That is a cosmetic difference and not a correctness one:
 * padding only ever adds whitespace in front of the next cell's spec,
 * which the parse discards (`parse_cellspec`, parser.rb:2511).
 * @param node - the table to read
 * @returns whether any cell spans columns or rows
 */
function hasSpan(node: TableNode): boolean {
  return node.children.some((row) =>
    row.children.some((cell) => cell.repeat.kind === SPAN_REPEAT),
  );
}

/**
 * The reasons that stand in FRONT of `recovered-opening` in the
 * union: everything that can be answered before a cell's bytes are
 * planned. In declaration order, first to fire wins.
 * @param node - the table to read
 * @returns the reason, or undefined when none of these six fires
 */
function declinesBeforePlanning(node: TableNode): TableDecline | undefined {
  if (hasUnreadAttrlist(node)) {
    return "unread-attrlist";
  }
  if (isNotPsv(node)) {
    return "non-psv-format";
  }
  if (node.children.some((row) => row.children.some(cellSpansLines))) {
    return "multi-line-cell";
  }
  if (hasLiteralCell(node)) {
    return "literal-cell";
  }
  if (node.leadingRuns.length > 0) {
    return "leading-runs";
  }
  if (node.children.some((row) => row.children.some(hasDroppedComment))) {
    return "dropped-comment";
  }
  return undefined;
}

/**
 * The reasons that stand BEHIND `recovered-opening` in the union. The
 * plan is already built when these run and none of them can unbuild
 * it; they sit here rather than in front only because that is where
 * the union declares them, and the union's order is what the census
 * counts in.
 * @param node - the table to read
 * @returns the reason, or undefined when none of these three fires
 */
function declinesAfterPlanning(node: TableNode): TableDecline | undefined {
  if (hasRaggedRows(node)) {
    return "ragged-rows";
  }
  if (node.close.kind === END_OF_STREAM) {
    return "unterminated";
  }
  if (hasAttributeReference(node)) {
    return "attribute-reference";
  }
  return undefined;
}

/**
 * Whether an attribute line above the table went unread, so that every
 * value one governs is unknown.
 *
 * FIRST of the ten, and the only one that is not a fact about the
 * table's own text. `cutting`, `columns` and `header` are all resolved
 * from the block's attribute list, and the reader records that list
 * only when it is the last line of the metadata run above the table
 * (`annotation`, src/parse/lines/held-metadata.ts). Asciidoctor reads
 * every metadata line above a block into one attribute hash whatever
 * the order (`parse_block_metadata_lines`, parser.rb:2014-2021), so a
 * `.Title` or an `[[anchor]]` between `[cols="1l,1"]` and `|===`
 * leaves this node saying psv, no columns, no annotation - and every
 * reason below would then read a fact the author did not write.
 * Declining is the only safe answer while the reader records less than
 * the author wrote: it is what the whole gate is for.
 *
 * CONSERVATIVE, and measurably so. An unread `caption=` governs
 * nothing this file reads, and a table behind one is declined all the
 * same, because the node says only THAT a line went unread and never
 * WHAT it said. Narrowing this to the values that matter means
 * recording the values, which is a reader change and a wider claim
 * than a printer may make on its own.
 * @param node - the table to read
 * @returns whether the table's resolved values are the whole truth
 */
function hasUnreadAttrlist(node: TableNode): boolean {
  return node.attrlistUnread !== undefined;
}

/**
 * Whether the table's cells were cut by anything but a top-level psv
 * table's own rules. The separator half is what catches `[separator=;]`
 * on a `|===` table, where the format is still psv and every cell
 * boundary is a character the rules below do not spell.
 * @param node - the table to read
 * @returns whether the cutting is outside this file's scope
 */
function isNotPsv(node: TableNode): boolean {
  const { format, separator } = node.cutting;
  return format !== PSV_FORMAT || separator !== PSV_SEPARATOR;
}

/**
 * Whether a cell's text spans source lines:
 *
 * > Join a cell's `content` runs in order, each LINE as the reader
 * > hands it over. Strip TRAILING LINE FEEDS from the result, and
 * > nothing else: not spaces and not tabs. The cell spans lines if
 * > what remains still holds a line feed.
 *
 * The trailing-line-feed strip is not a convenience. A psv cell's
 * buffer takes the line feed that ended the line it sat on
 * (`parser_ctx.buffer`, parser.rb:2391), so almost every cell in every
 * table would otherwise be read as spanning lines. Stripping trailing
 * WHITESPACE from the joined text instead is the drift to guard
 * against, and it is not a synonym: it would swallow the last line of
 * a two-line cell whose second line carries only spaces AND the
 * spaces that end a one-line cell, telling neither apart.
 *
 * READ AS THE READER'S OWN LINES, which is what the per-line
 * {@link rstrip} is: the oracle's reader rstrips every line before the
 * table is ever parsed (`prepare_source_string`), so a line carrying
 * only spaces is a BLANK line to the parse, exactly like the blank
 * lines the emission already deletes. The recorded run images keep
 * that whitespace because a replaying printer needs the bytes, and
 * reading it as content here would decline a table our own output then
 * accepts: Prettier trims every line at a hardline, so the replayed
 * spelling is not a fixed point and the second pass would move bytes
 * the first pass did not. Measured over the corpus: the two readings
 * name the same tables, so this costs nothing there and buys the fixed
 * point on the shape that does spell it.
 * @param cell - the cell to read
 * @returns whether the cell's own text holds a line break
 */
function cellSpansLines(cell: TableCellNode): boolean {
  const lines = contentText(cell).split(LINE_FEED).map(rstrip);
  return stripTrailingLineFeeds(lines.join(LINE_FEED)).includes(LINE_FEED);
}

/**
 * A cell's own text: its `content` runs joined, with the two run kinds
 * that are lines the reader consumed left out.
 * @param cell - the cell to read
 * @returns the joined content bytes, verbatim
 */
function contentText(cell: TableCellNode): string {
  return cell.runs
    .filter((run) => run.kind === CONTENT_RUN)
    .map((run) => run.image)
    .join("");
}

/**
 * Drop the line feeds at the end of `text`, and nothing else.
 * @param text - the text to strip
 * @returns the text without its trailing line feeds
 */
function stripTrailingLineFeeds(text: string): string {
  let stop = text.length;
  while (stop > 0 && text[stop - 1] === LINE_FEED) {
    stop -= 1;
  }
  return text.slice(0, stop);
}

/**
 * Whether any cell's EFFECTIVE style is literal: the style its own
 * spec named, or the style of a column it inherits from
 * (`cell_style = column.style`, table.rb:247).
 *
 * A DUPLICATE spec (`3*|x`) is one recorded cell standing for several
 * of Ruby's, so it inherits from every column in
 * `[columnIndex, columnIndex + count)`; a colspan is one cell however
 * many columns it visits, so it reads one column. `columnIndex` is
 * recorded where the grouping counted the same cells (src/ast.ts,
 * `TableCellNode.columnIndex`) and is never re-derived here.
 *
 * CONSERVATIVE on a header row, deliberately. `Table::Cell#initialize`
 * nulls the local `cell_style` a column's literal style would have set
 * on a header row (table.rb:241-247), so no header-row cell is really
 * literal; reading one as literal only ever DECLINES a table, which
 * moves no byte. Reading it the other way round would move a literal
 * cell's leading whitespace, which is content.
 *
 * Whole-TABLE, not whole-cell: a layout that relaid out some rows of a
 * table and replayed others would produce output nobody can read.
 * @param node - the table to read
 * @returns whether some cell would have its leading whitespace moved
 */
function hasLiteralCell(node: TableNode): boolean {
  const { columns } = node;
  return node.children.some((row) =>
    row.children.some((cell) => {
      const { opening } = cell;
      if (
        opening.kind === SEPARATOR_OPENING &&
        opening.parsed.style === LITERAL_STYLE
      ) {
        return true;
      }
      const span = cell.repeat.kind === "duplicate" ? cell.repeat.count : 1;
      for (let step = 0; step < span; step += 1) {
        const index = cell.columnIndex + step;
        if (
          columns !== undefined &&
          index < columns.length &&
          columns[index].style === LITERAL_STYLE
        ) {
          return true;
        }
      }
      return false;
    }),
  );
}

/**
 * Whether a cell's region holds a `//` line the reader deletes.
 *
 * `droppedComment` is the ONLY run kind that declines a table. A
 * `skippedBlank` run is not one: it is a blank line reached while no
 * cell was open (`skip_blank_lines`, parser.rb:2411-2413), and
 * DELETING it is the entire content of the blank-line rule the
 * emission applies. This is the one place the two non-content run
 * kinds have to be told apart, so it is the place that says so.
 * @param cell - the cell to read
 * @returns whether the cell's region holds a deleted comment line
 */
function hasDroppedComment(cell: TableCellNode): boolean {
  return cell.runs.some((run) => run.kind === DROPPED_COMMENT_RUN);
}

/**
 * Whether some row's effective column visits differ from the table's
 * column count.
 *
 * The same fold `groupRows` runs (src/parse/lines/table-reader.ts),
 * restated here because `print/` may not import `parse/` at that
 * address, and restated with BOTH its halves: `visitsOf` counts a
 * cell's colspan for a span, its count for a duplicate and one
 * otherwise, and `activate_rowspan` (table.rb:713-716) reserves a
 * rowspan's slots in the rows below. A row closes on
 * `effective_column_visits`, cells plus reservations, reaching the
 * count (`end_of_row?`, table.rb:721-729).
 *
 * So a ROWSPAN table is not ragged: the row under the rowspan is short
 * by exactly the slots the rowspan reserved, and the sum reaches the
 * count anyway. Ragged means the sum does not EQUAL the count.
 *
 * The count is `columns.length` where a readable `cols=` named the
 * columns, and the first row's own effective visits otherwise
 * (`close_row` sets `colcount` from `column_visits`, table.rb:701). With NO
 * rows there is no count to compute and the reason cannot fire, which
 * is what keeps this total on a zero-row table without a second
 * question and without an unreachable branch.
 *
 * More conservative than the render measurement demands: an
 * overrunning row relaid out renders the same, because the oracle
 * drops the same row before and after (`close_row true`,
 * table.rb:673-675). It stays a decline because the oracle LOGS an
 * error on those inputs and tests/parser/table-structure.test.ts
 * excludes oracle-logged cases, so our row grouping is unverified
 * exactly there.
 * @param node - the table to read
 * @returns whether some row's visits miss the column count
 */
function hasRaggedRows(node: TableNode): boolean {
  const reserved = [0];
  let count = node.columns?.length;
  for (const row of node.children) {
    const visits = rowVisits(row, reserved);
    const effective = visits + reserved[0];
    count ??= effective;
    if (effective !== count) {
      return true;
    }
    reserved.shift();
    if (reserved.length === 0) {
      reserved.push(0);
    }
  }
  return false;
}

/**
 * One row's own column visits, reserving any rowspan's slots in the
 * rows below as it goes.
 * @param row - the row to count
 * @param reserved - slots reserved per following row, index 0 being
 *   this row; mutated the way `activate_rowspan` mutates
 *   `@active_rowspans` (table.rb:713-716)
 * @returns the cells' own visits, reservations excluded
 */
function rowVisits(row: TableRowNode, reserved: number[]): number {
  let visits = 0;
  for (const cell of row.children) {
    const { repeat } = cell;
    if (repeat.kind === SPAN_REPEAT) {
      while (reserved.length < repeat.rowspan) {
        reserved.push(0);
      }
      for (let index = 1; index < repeat.rowspan; index += 1) {
        reserved[index] += repeat.colspan;
      }
      visits += repeat.colspan;
    } else if (repeat.kind === "duplicate") {
      visits += repeat.count;
    } else {
      visits += 1;
    }
  }
  return visits;
}

/**
 * Whether the block's attribute-list interior holds an attribute
 * reference anywhere in it.
 *
 * Defined over the INTERIOR, deliberately. The tempting spelling is
 * "`columns` came back undefined", and it is wrong: `[cols="1,{n}"]`
 * parses one readable record, so our count is one where the oracle
 * (which substitutes the reference before parsing the list) resolves
 * two, and nothing in the node says so.
 *
 * A referenced OPTIONS value is covered by the same predicate and is
 * declined too, even though it is harmless under these emission rules:
 * `[options="{o}"]` with `:o: header` gives the oracle a header row
 * and gives our reader `"none"`, and the blank line the verdict
 * decides does not matter because the header option is tested ahead of
 * it (`has_header_option`, parser.rb:2303-2310). That is directional
 * luck rather than design, and a later rule reading the verdict for
 * anything else would inherit a wrong answer with no warning.
 * @param node - the table to read
 * @returns whether the attribute line holds a reference
 */
function hasAttributeReference(node: TableNode): boolean {
  const { annotatedBy } = node;
  return annotatedBy !== undefined && ATTRIBUTE_REFERENCE.test(annotatedBy);
}

/**
 * The rows, planned, or `undefined` where some cell's opening wrote no
 * bytes of its own.
 *
 * That absence IS the `recovered-opening` fact, read once: a
 * `recovered` opening is Asciidoctor's repair for a table whose first
 * line is missing its leading separator (table.rb:621-627), and a
 * `lineStart` opening belongs to csv and dsv, already declined. Read
 * over the opening KIND rather than over `"recovered"` so that the
 * emission's narrowing to a separator opening is a consequence of the
 * gate rather than of a second argument.
 * @param node - the table to plan
 * @returns the planned rows, or undefined when some opening has no
 *   spec and no separator to plan
 */
function plannedRows(node: TableNode): readonly PlannedRow[] | undefined {
  const rows: PlannedRow[] = [];
  for (const row of node.children) {
    const cells: PlannedCell[] = [];
    for (const cell of row.children) {
      const { opening } = cell;
      if (opening.kind !== SEPARATOR_OPENING) {
        return undefined;
      }
      cells.push({
        spec: stripSpecPad(opening.spec),
        separator: opening.separator,
        text: cellStrip(contentText(cell)),
      });
    }
    rows.push({ cells });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// The normal form
// ---------------------------------------------------------------------------

/**
 * The pad between a separator and its cell's first content byte.
 *
 * FLUSH. Both spellings are safe for every non-literal style, measured
 * both ways, so nothing but idiom decides it: flush is how the
 * AsciiDoc documentation spells a table (`|Column 1 |Column 2`), where
 * the spaced form is Markdown's habit carried across. Changing this
 * one constant to `" "` is the whole of the other choice.
 */
const SEPARATOR_PAD = "";

/**
 * The pad in front of a mid-line cell spec, and NOT a taste question.
 * `CellSpecEndRx` (rx.rb:400) begins with `[ \t]+` and reads the text
 * in front of a separator as the next cell's spec, so removing the pad
 * can CREATE a spec out of a word (`|value z |next` loses `z`) and can
 * turn a separator into an escape (`|a\ |b` becomes one cell through
 * `skip_past_escaped_delimiter`, parser.rb:2372-2381). Adding it in
 * front of an existing spec is always safe.
 */
const SEPARATOR_PAD_BEFORE = " ";

/**
 * The one character column alignment pads with, and a third pad
 * distinct from the two above it: this one goes at the END of a cell
 * that is not its row's last, where the two above go between a spec
 * and its separator and between a separator and its cell's text.
 */
const ALIGNMENT_PAD = " ";

/** The emission that puts one recorded row on one source line. */
const ROW_LAYOUT = "row";

/** The emission that puts one cell per line after the first row. */
const CELL_LAYOUT = "cell";

/**
 * Emit an accepted table's interior in the emission
 * {@link chooseLayout} picked, with the blank lines the header verdict
 * asks for and no others.
 *
 * THE FIRST ROW KEEPS THE FIRST INTERIOR LINE, in both emissions,
 * which is what preserves the column count by construction: while no
 * readable `cols=` fixed it, only the end of a line can close the
 * first row, and `close_row` sets the table's `colcount` from the
 * `column_visits` that line held (table.rb:701). Every row after it
 * may be laid out any way at all.
 *
 * With an explicit `cols=` the first row's line placement is no longer
 * load-bearing and the first row COULD be split. Keeping it on one
 * line anyway is a UNIFORMITY choice and not a safety one: a table
 * whose shape depends on whether its author wrote a `cols=` reads as
 * two different styles in one document, and splitting the first row of
 * a table that declared no `cols=` would mean WRITING one into the
 * author's attribute list, which no rule here does. So the rule is
 * stated once, over every accepted table.
 *
 * SPLITTING THE LATER ROWS IS SAFE, and the reason is a decline rather
 * than an argument about line breaks: `hasRaggedRows` (above) refuses
 * every table some row's effective column visits do not carry to the
 * column count, rowspan reservations included, so in an accepted table
 * the reader regroups the flat cell stream back into these same rows
 * wherever the line breaks fall (`end_of_row?`, table.rb:721-729).
 * Take that decline away and the cell emission restructures a short
 * row's table.
 *
 * EMPTY for a table with no rows, and the caller writes no interior
 * line for it. Emitting one would write a blank line between the two
 * delimiters, which is both a byte change and a `leading-runs` decline
 * on the next read.
 * @param node - the table, read for its header verdict alone
 * @param plan - the accepted plan, whose rows are the emission
 * @param style - the style in force, which chooses between the two
 *   spellings and decides whether the cells are padded
 * @returns the interior bytes, delimiter lines excluded, with no
 *   trailing line feed of their own
 */
export function printLaidOut(
  node: TableNode,
  plan: LaidOutPlan,
  style: TableStyle,
): string {
  const layout = chooseLayout(plan.rows, style);
  const emission: Emission = {
    layout,
    headerBlank: blankAfterFirstRow(node),
    widths: columnWidths(plan, layout, style),
  };
  return plan.rows
    .flatMap((row, index) => rowLines(row, index, emission))
    .join(LINE_FEED);
}

/**
 * Everything one accepted table's emission decides ONCE, for the
 * table rather than for a row: which spelling its rows take, where the
 * header verdict puts a blank, and the widths its cells are padded out
 * to. Grouped so that a row's own emission reads facts already
 * settled and settles none of its own.
 */
interface Emission {
  /** One row per line, or one cell per line after the first row. */
  readonly layout: "row" | "cell";
  /** Whether one blank line follows the first row. */
  readonly headerBlank: boolean;
  /**
   * The width each cell but the last in its row is padded out to,
   * indexed by the cell's position in its row, or undefined where
   * nothing is padded at all. As long as the longest row when it is
   * present, so a cell that is padded always has a width to reach
   * ({@link columnWidths}).
   */
  readonly widths: readonly number[] | undefined;
}

/**
 * The width each column is padded out to, or undefined where no cell
 * is padded.
 *
 * OFF BY DEFAULT (`asciidocTableAlignColumns`, src/options.ts), and
 * the two arguments the default rests on are these. Alignment is
 * unavailable on every table the gate declines and on every table
 * holding a span, so defaulting it on would leave one table in a file
 * aligned and the next one not. And a one-character edit to a long
 * cell re-pads that cell's whole column, so a one-word change reaches
 * a diff as a change to every row of the table. And an aligned table
 * may EXCEED the `printWidth` its unaligned spelling fitted inside,
 * because the layout was chosen from the unpadded images and the
 * padding is added afterwards; that is accepted rather than guarded,
 * because a guard is the oscillation {@link chooseLayout} refuses -
 * padding that fed back into the choice would widen a row, flip the
 * layout, and turn itself off again. All three are COSMETIC costs
 * rather than correctness ones - the padding is render-neutral and a
 * fixed point either way - which is what makes this a question with
 * two safe answers instead of a rule.
 *
 * APPLIED AFTER the layout choice, and only under `"row"`. Under the
 * cell emission a row is not on one line and there is nothing to line
 * up; and measuring the width BEFORE the padding is what stops the two
 * from oscillating ({@link chooseLayout}).
 *
 * MEASURED IN COLUMNS, with the same `getStringWidth` the layout
 * choice measures by, so a full-width character costs two here too.
 * The same measure means the same blind spots, and the domain of the
 * claim is what that function scores: a tab counts zero columns, so a
 * cell holding one is padded by that count rather than to a rendered
 * tab stop.
 * @param plan - the accepted plan
 * @param layout - the emission the style and the width settled on
 * @param style - the style in force
 * @returns one width per column index, as long as the longest row, or
 *   undefined where nothing is padded
 */
function columnWidths(
  plan: LaidOutPlan,
  layout: "row" | "cell",
  style: TableStyle,
): readonly number[] | undefined {
  if (!style.alignColumns || !plan.alignable || layout !== ROW_LAYOUT) {
    return undefined;
  }
  const widths: number[] = [];
  for (const row of plan.rows) {
    for (const [index, cell] of row.cells.entries()) {
      const width = util.getStringWidth(cellImage(cell));
      if (index === widths.length) {
        widths.push(width);
      } else if (width > widths[index]) {
        widths[index] = width;
      }
    }
  }
  return widths;
}

/**
 * Which emission an accepted table takes: the style's own value, or,
 * under `"row"`, the width's answer.
 *
 * ALL-OR-NOTHING per table. A table whose rows do not ALL fit prints
 * in the cell style, which is the group semantics Prettier applies to
 * an object literal and what keeps one table internally uniform. To
 * take the other side of that question - `"row"` meaning row layout
 * whatever the width - return `style.layout` here.
 *
 * MEASURED IN COLUMNS, not in characters: `getStringWidth` is
 * Prettier's own measure, the one `wrap` (./reflow.ts) packs prose by,
 * so a full-width CJK character costs two and a combining mark costs
 * none. One tree, one answer to what a print width is.
 *
 * MEASURED ON THE UNALIGNED SPELLING, always, and column alignment
 * ({@link columnWidths}) is applied AFTER this choice rather than
 * before. The other order oscillates: alignment widens rows, a widened
 * row flips the layout to `"cell"`, and the cell emission turns
 * alignment off again. Measuring the unaligned image here is what
 * makes this order the only one there is.
 *
 * A table MAY exceed `printWidth`, TWO ways. Its first row alone can
 * be too wide, and the first row is never split
 * ({@link printLaidOut}); and column alignment ({@link columnWidths})
 * pads after this choice was taken on the unpadded images, so a table
 * whose every row fits can be pushed past the width by its own
 * padding. The width selects a LAYOUT; it never forces a break inside
 * a row, and it is not a promise about the emitted columns.
 * @param rows - the accepted plan's rows
 * @param style - the style in force
 * @returns which emission to write
 */
function chooseLayout(
  rows: readonly PlannedRow[],
  style: TableStyle,
): "row" | "cell" {
  if (style.layout === CELL_LAYOUT) {
    return CELL_LAYOUT;
  }
  return rows.every(
    (row) => util.getStringWidth(rowImage(row)) <= style.printWidth,
  )
    ? ROW_LAYOUT
    : CELL_LAYOUT;
}

/**
 * One row's lines, with the blank lines the header verdict puts around
 * it.
 *
 * A HEADERLESS table gets no blank line anywhere, so under the cell
 * emission its rows are not visually separated at all. Both spellings
 * that would separate them are unavailable: a blank after the first
 * row forges an implicit header (`implicit_header`,
 * parser.rb:2340-2345), and a leading blank is the gate's own
 * `leading-runs` decline, so a table printed with one stops being laid
 * out on the next read.
 * @param row - the planned row
 * @param index - its position in the table, the first row being 0
 * @param emission - what the table settled: the spelling, the header
 *   verdict's blank, and the widths the cells are padded out to
 * @returns the row's lines, in order, none with a line feed of its own
 */
function rowLines(
  row: PlannedRow,
  index: number,
  emission: Emission,
): string[] {
  const { layout, headerBlank, widths } = emission;
  if (index === 0) {
    const first = rowImage(row, widths);
    return headerBlank ? [first, ""] : [first];
  }
  if (layout === ROW_LAYOUT) {
    return [rowImage(row, widths)];
  }
  const cells = row.cells.map(cellImage);
  return index > 1 && headerBlank ? ["", ...cells] : cells;
}

/**
 * Whether one blank line follows the first row.
 *
 * Read off the HEADER VERDICT, never off row separation. A rule
 * phrased as "separate the header from the body" says nothing about a
 * table with one row and no body, and a one-row implicit-header table
 * loses its header when the blank goes (`implicit_header`,
 * parser.rb:2340-2345).
 *
 * For an EXPLICIT header the blank is optional rather than required,
 * and emitting it anyway is what makes one derivation cover all three
 * verdicts; it is a uniformity choice, not an obligation, and it
 * inserts a blank line into every `%header` table that lacks one.
 * Narrowing this to `node.header === "implicit"` is the whole of the
 * other choice.
 * @param node - the table to read
 * @returns whether to write the blank
 */
function blankAfterFirstRow(node: TableNode): boolean {
  return node.header !== NO_HEADER;
}

/**
 * One row as its source line: the cells, joined by the pad that keeps
 * every mid-line separator readable as one, each but the LAST padded
 * out to its column's width where `widths` asks for it.
 *
 * PADDED ON THE RIGHT, in front of the next cell's spec, which is
 * where the parse throws whitespace away: a spec position that matches
 * nothing but whitespace hands back the text in front of it rstripped
 * (`parse_cellspec`, parser.rb:2511), and a psv cell's own text is
 * stripped besides ({@link cellStrip}). Nothing is ever padded AFTER a
 * separator, so no cell's leading whitespace moves - which is the byte
 * a literal cell would lose, and the reason this rule is stated as a
 * direction rather than as a width.
 *
 * THE LAST CELL IS NEVER PADDED, and that is two facts rather than
 * one. The PADDING puts no trailing whitespace on any line, so nothing
 * here leans on Prettier's own trim at a hardline to take a pad back
 * off again. That claim is narrower than "no line ends in whitespace",
 * deliberately: a line ends with its last cell's text, and that text
 * came through an ASCII-only strip (`cell_text.strip`, table.rb:282),
 * so a cell ending in U+00A0 ends its line with one under either value
 * of the option. And no padded line can rstrip INTO the delimiter that
 * the length guard (src/print/table.ts) sizes against the interior it
 * is handed, so alignment adds no collision of its own.
 * @param row - the planned row
 * @param widths - the width each cell but the last is padded out to;
 *   omitted, and undefined, where nothing is padded
 * @returns the line, with no line feed of its own
 */
function rowImage(row: PlannedRow, widths?: readonly number[]): string {
  const last = row.cells.length - 1;
  return row.cells
    .map((cell, index) => {
      const image = cellImage(cell);
      return widths === undefined || index === last
        ? image
        : image +
            ALIGNMENT_PAD.repeat(widths[index] - util.getStringWidth(image));
    })
    .join(SEPARATOR_PAD_BEFORE);
}

/**
 * One cell as its bytes: its spec's letters flush against its own
 * separator, and the separator flush against the cell's first content
 * byte.
 * @param cell - the planned cell
 * @returns the cell's bytes
 */
function cellImage(cell: PlannedCell): string {
  return cell.spec + cell.separator + SEPARATOR_PAD + cell.text;
}

/**
 * The whitespace `CellSpecStartRx` and `CellSpecEndRx` (rx.rb:399-400)
 * take with a spec, which the recorded spec image keeps and this file
 * re-derives from the layout rule instead.
 * @param spec - the spec image as recorded
 * @returns the spec's letters alone
 */
function stripSpecPad(spec: string): string {
  return spec.replace(SPEC_PAD_FRONT, "").replace(SPEC_PAD_BEHIND, "");
}

/**
 * Ruby's `String#strip`, as `Table::Cell` applies it to a psv cell's
 * text (`cell_text.strip`, table.rb:282): the six ASCII whitespace
 * characters plus NUL, and nothing else.
 *
 * JavaScript's `trim()` is not a synonym and not a shortcut. It also
 * takes U+00A0 and the rest of Unicode's space separators, which
 * Asciidoctor keeps, so trimming would EDIT a cell's content in the
 * one place nothing inside a cell may move (issue #75's bug class,
 * named the same way at src/print/blocks.ts:107 and :317).
 *
 * The set is declared here rather than imported. The parse side has
 * its own copy (`rubyStrip`, src/parse/lines/table-reader.ts) and
 * `print/` reads `parse/` at exactly three addresses
 * (scripts/metrics/graph.ts), of which that file is not one.
 *
 * Where a cell's effective style is literal its leading whitespace is
 * content and the printer neither adds nor removes any (`l|` rstrips
 * only, table.rb:274-276). No branch here answers that: a literal cell
 * declines its whole table, so this strip is total over what reaches
 * it, and the branch becomes real only when the decline narrows to the
 * cell.
 * @param text - the cell's joined content runs
 * @returns the text Asciidoctor's own strip would leave
 */
function cellStrip(text: string): string {
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
