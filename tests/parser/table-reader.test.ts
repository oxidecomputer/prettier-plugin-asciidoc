import { describe, expect, test } from "vitest";
import { splitLines } from "../../src/parse/lines/split.js";
import {
  cutCells,
  groupRows,
  readHeaderDecision,
  type TableCellOpening,
  type TableCut,
  type TableCutting,
  type TableFormat,
  type TableRunKind,
  type TableScanCell,
  type TableTextRun,
} from "../../src/parse/lines/table-reader.js";

/**
 * One table's cutting. Written through the module's own format type
 * rather than as a bare object literal, so that a rename of any of
 * these names is a type error here rather than a stale fixture.
 * @param format - the cutting rules to apply
 * @param separator - the separator as written
 * @returns the cutting
 */
function cutting(format: TableFormat, separator: string): TableCutting {
  return { format, separator };
}

/** The default psv cutting: `|`, the delimiter every plain table uses. */
const PSV = cutting("psv", "|");

/** The csv cutting, which `format=csv` and `format=tsv` both resolve to. */
const CSV = cutting("csv", ",");

/** The dsv cutting, which the `:===` delimiter hint also selects. */
const DSV = cutting("dsv", ":");

/** The run kind that is a cell's own text. */
const CONTENT: TableRunKind = "content";

/**
 * The bytes an opening wrote: the spec and separator, or nothing at
 * all for the two openings that write none.
 * @param opening - the opening to read
 * @returns its image
 */
function openingImage(opening: TableCellOpening): string {
  return opening.kind === "separator" ? opening.spec + opening.separator : "";
}

/**
 * One cell's text: its `content` runs alone, concatenated.
 * @param cell - the cell to read
 * @returns the bytes of its text
 */
function cellText(cell: TableScanCell): string {
  return cell.runs
    .filter((run) => run.kind === CONTENT)
    .map((run) => run.image)
    .join("");
}

/**
 * One run, as a kind-tagged image.
 * @param run - the run to describe
 * @returns the description
 */
function describeRun(run: TableTextRun): string {
  return `${run.kind}:${JSON.stringify(run.image)}`;
}

/**
 * Cut one table INTERIOR, written as it appears between the two
 * delimiter lines. Never write a trailing newline in an interior: the
 * newline in front of the closing delimiter belongs to the close, not
 * to the last cell, so a trailing one would leave a byte outside the
 * partition {@link expectRunFaithful} checks.
 * @param interior - the table's interior, verbatim
 * @param cutting - the format and separator the table resolved to
 * @returns the cut
 */
function cut(interior: string, cutting: TableCutting): TableCut {
  return cutCells(splitLines(interior), cutting);
}

/**
 * Replay a cut the way the printer will: leading runs, then each
 * cell's opening image followed by its runs, checking as it goes that
 * every piece starts exactly where the previous one ended.
 * @param result - the cut to replay
 * @returns the bytes the cut accounts for
 */
function replayed(result: TableCut): string {
  let image = "";
  const place = (piece: string, at: number): void => {
    expect(at, `piece ${JSON.stringify(piece)} is misplaced`).toBe(
      image.length,
    );
    image += piece;
  };
  for (const run of result.leadingRuns) {
    place(run.image, run.offset);
  }
  for (const cell of result.cells) {
    place(openingImage(cell.opening), cell.opening.offset);
    for (const run of cell.runs) {
      place(run.image, run.offset);
    }
  }
  return image;
}

/**
 * Cut an interior and assert the partition: the openings and runs
 * together reproduce the interior byte for byte, in order, with no
 * gap and no overlap.
 * @param interior - the table's interior, verbatim
 * @param cutting - the format and separator the table resolved to
 * @returns the cut, for the caller to make its own assertions on
 */
function expectRunFaithful(interior: string, cutting: TableCutting): TableCut {
  const result = cut(interior, cutting);
  // splitLines drops the LAST line's terminator, and so does the cut:
  // the newline in front of a table's closing delimiter belongs to
  // the close. Everything before it is the cut's to account for.
  const covered = interior.endsWith("\n") ? interior.slice(0, -1) : interior;
  expect(replayed(result)).toBe(covered);
  return result;
}

/**
 * How each cell was opened, as the bytes the opening wrote: the spec
 * and separator for a separator opening, and the discriminant's own
 * name for the two openings that write nothing.
 * @param result - the cut to read
 * @returns one entry per cell, in document order
 */
function openings(result: TableCut): string[] {
  return result.cells.map((cell) =>
    cell.opening.kind === "separator"
      ? openingImage(cell.opening)
      : cell.opening.kind,
  );
}

/**
 * Each cell's text: the `content` runs alone, concatenated, which is
 * Asciidoctor's own cell buffer once each line's trailing whitespace
 * is put back.
 * @param result - the cut to read
 * @returns one entry per cell, in document order
 */
function texts(result: TableCut): string[] {
  return result.cells.map((cell) => cellText(cell));
}

/**
 * Every run of every cell, and of the leading region, as a
 * kind-tagged image, so a test can pin where the reader's deletions
 * and skips landed rather than only what survived them.
 * @param result - the cut to read
 * @returns one entry per run, in document order
 */
function runKinds(result: TableCut): string[] {
  const all = [
    ...result.leadingRuns,
    ...result.cells.flatMap((cell) => cell.runs),
  ];
  return all.map((run) => describeRun(run));
}

/**
 * Group a cut's cells and read the rows back as their cell texts, so
 * a grouping assertion names the source rather than an index.
 * @param result - the cut to group
 * @param columnCount - the column count `cols=` fixed; omitted when
 *   the first row is to fix it
 * @returns one entry per row, each the row's cells' texts
 */
function expectRow(result: TableCut, columnCount?: number): string[][] {
  return groupRows(result.cells, columnCount).map((row) =>
    row.map((cell) => cellText(cell)),
  );
}

describe("cutCells, psv (parser.rb:2318-2334, :2372-2388)", () => {
  test("a separator anywhere in a line cuts a cell", () => {
    const result = expectRunFaithful("|a |b", PSV);
    expect(openings(result)).toStrictEqual(["|", " |"]);
    expect(texts(result)).toStrictEqual(["a", "b"]);
  });

  test("a line starting with the separator opens an empty spec", () => {
    const result = expectRunFaithful("|a\n|b", PSV);
    expect(openings(result)).toStrictEqual(["|", "|"]);
    expect(texts(result)).toStrictEqual(["a\n", "b"]);
  });

  test("a line with no separator continues the open cell", () => {
    const result = expectRunFaithful("|a\nstill a\n|b", PSV);
    expect(texts(result)).toStrictEqual(["a\nstill a\n", "b"]);
  });

  test("an escaped separator does not cut", () => {
    const result = expectRunFaithful(String.raw`|a\|b |c`, PSV);
    expect(openings(result)).toStrictEqual(["|", " |"]);
    // The backslash stays in the run: chopping it
    // (`skip_past_escaped_delimiter`, table.rb:525-528) is a derived
    // reading of the bytes, not a cut point.
    expect(texts(result)).toStrictEqual([String.raw`a\|b`, "c"]);
  });

  test("an escaped separator at end of line continues the cell", () => {
    const result = expectRunFaithful("|a\\|\nb", PSV);
    expect(openings(result)).toStrictEqual(["|"]);
    expect(texts(result)).toStrictEqual(["a\\|\nb"]);
  });

  test("a blank line inside the table stays inside the open cell", () => {
    const result = expectRunFaithful("|a\n\nb\n|c", PSV);
    expect(texts(result)).toStrictEqual(["a\n\nb\n", "c"]);
  });

  test("an empty cell at end of line survives", () => {
    const result = expectRunFaithful("|a |", PSV);
    expect(openings(result)).toStrictEqual(["|", " |"]);
    expect(texts(result)).toStrictEqual(["a", ""]);
  });

  test("text before the first separator is recovered as a cell", () => {
    const result = expectRunFaithful("a 2+|b |c", PSV);
    expect(openings(result)).toStrictEqual(["recovered", " 2+|", " |"]);
    expect(texts(result)).toStrictEqual(["a", "b", "c"]);
  });

  test("a table with no separator at all is one recovered cell", () => {
    const result = expectRunFaithful("abc", PSV);
    expect(openings(result)).toStrictEqual(["recovered"]);
    expect(texts(result)).toStrictEqual(["abc"]);
  });

  test("a custom multi-character separator cuts literally", () => {
    const result = expectRunFaithful("a ;;b ;;c", cutting("psv", ";;"));
    expect(openings(result)).toStrictEqual(["recovered", " ;;", " ;;"]);
    expect(texts(result)).toStrictEqual(["a", "b", "c"]);
  });

  // Probed against the oracle: `[separator=;;]` with `;;a ;;b` reports
  // the first cell's text as `;a`, because the line-start branch
  // consumes ONE character where `starts_with_delimiter?` matched the
  // whole separator (parser.rb:2319-2320 against table.rb:502-504).
  test("a line-start separator consumes one character, not one separator", () => {
    const result = expectRunFaithful(";;a ;;b", cutting("psv", ";;"));
    expect(openings(result)).toStrictEqual([";", " ;;"]);
    expect(texts(result)).toStrictEqual([";a", "b"]);
  });

  test("an empty separator cuts nothing", () => {
    const result = expectRunFaithful("a|b", cutting("psv", ""));
    expect(openings(result)).toStrictEqual(["recovered"]);
    expect(texts(result)).toStrictEqual(["a|b"]);
  });
});

describe("cutCells, csv and dsv (parser.rb:2353-2371, :2392-2401)", () => {
  test("every csv line ends its cell", () => {
    const result = expectRunFaithful("a,b\nc,d", CSV);
    expect(openings(result)).toStrictEqual([
      "lineStart",
      ",",
      "lineStart",
      ",",
    ]);
    expect(texts(result)).toStrictEqual(["a", "b\n", "c", "d"]);
  });

  test("a csv quote protects the separator inside it", () => {
    const result = expectRunFaithful('"a,b",c', CSV);
    expect(openings(result)).toStrictEqual(["lineStart", ","]);
    expect(texts(result)).toStrictEqual(['"a,b"', "c"]);
  });

  // A buffer that is nothing but one quote is the arm
  // `buffer_has_unclosed_quotes?` answers before it looks at either
  // end (table.rb:534-537). Probed: the oracle reads `",a` as one
  // cell, so the separator behind the quote never cut.
  test("a lone quote leaves the cell open", () => {
    const result = expectRunFaithful('",a', CSV);
    expect(texts(result)).toStrictEqual(['",a']);
  });

  test("a doubled quote is an escaped quote, not a close", () => {
    const result = expectRunFaithful('"a"",b",c', CSV);
    expect(texts(result)).toStrictEqual(['"a"",b"', "c"]);
  });

  test("a csv cell with unclosed quotes runs on to the next line", () => {
    const result = expectRunFaithful('"a,b\nc",d', CSV);
    expect(openings(result)).toStrictEqual(["lineStart", ","]);
    expect(texts(result)).toStrictEqual(['"a,b\nc"', "d"]);
  });

  test("a blank line between csv rows is skipped, not buffered", () => {
    const result = expectRunFaithful("a,b\n\nc,d", CSV);
    expect(texts(result)).toStrictEqual(["a", "b\n", "c", "d"]);
    expect(runKinds(result)).toStrictEqual([
      'content:"a"',
      String.raw`content:"b\n"`,
      String.raw`skippedBlank:"\n"`,
      'content:"c"',
      'content:"d"',
    ]);
  });

  test("a tab-separated table is csv with a tab separator", () => {
    const result = expectRunFaithful("a\tb", cutting("csv", "\t"));
    expect(texts(result)).toStrictEqual(["a", "b"]);
  });

  test("every dsv line ends its cell", () => {
    const result = expectRunFaithful("a:b\nc:d", DSV);
    expect(texts(result)).toStrictEqual(["a", "b\n", "c", "d"]);
  });

  test("a dsv escaped separator at end of line continues the cell", () => {
    const result = expectRunFaithful("a\\:\nb", DSV);
    expect(openings(result)).toStrictEqual(["lineStart"]);
    expect(texts(result)).toStrictEqual(["a\\:\nb"]);
  });

  // Probed: a dsv cell held open by an escaped separator at end of
  // line swallows the blank line after it, and the line after that,
  // as ONE cell. The oracle's blank-line arm buffers nothing for dsv
  // and closes nothing, `keepCellOpen` being its only call
  // (parser.js:3376-3383).
  test("a blank line does not close a dsv cell held open", () => {
    const result = expectRunFaithful("a\\:\n\nb", DSV);
    expect(openings(result)).toStrictEqual(["lineStart"]);
    expect(texts(result)).toStrictEqual(["a\\:\n\nb"]);
  });

  test("whitespace in front of a csv quote does not hide it", () => {
    const result = expectRunFaithful(' "a,b",c', CSV);
    expect(texts(result)).toStrictEqual([' "a,b"', "c"]);
  });

  // A csv line that ends ON a separator inside an unclosed quote
  // leaves Asciidoctor holding text it never turns into a cell
  // (parser.js:3310-3315, where skipPastDelimiter breaks out
  // without closing, and close_table reports what is left,
  // table.rb:685-688). The bytes are kept here.
  test("csv text the oracle never closes is still a cell", () => {
    const result = expectRunFaithful('a,"b,', CSV);
    expect(openings(result)).toStrictEqual(["lineStart", ","]);
    expect(texts(result)).toStrictEqual(["a", '"b,']);
  });
});

describe("cutCells, the reader's own deletions (reader.rb:424, :279)", () => {
  test("a // line is dropped from the cell but kept as a run", () => {
    const result = expectRunFaithful("|a\n//gone\nmore\n|b", PSV);
    expect(texts(result)).toStrictEqual(["a\nmore\n", "b"]);
    expect(runKinds(result)).toStrictEqual([
      String.raw`content:"a\n"`,
      String.raw`droppedComment:"//gone\n"`,
      String.raw`content:"more\n"`,
      'content:"b"',
    ]);
  });

  test("a /// line is not a comment and stays in the cell", () => {
    const result = expectRunFaithful("|a\n///kept\n|b", PSV);
    expect(texts(result)).toStrictEqual(["a\n///kept\n", "b"]);
  });

  test("a leading blank line lands before the first cell", () => {
    const result = expectRunFaithful("\n|a", PSV);
    expect(runKinds(result)).toStrictEqual([
      String.raw`skippedBlank:"\n"`,
      'content:"a"',
    ]);
  });

  // The SECOND run has no bytes and is a run anyway: the extent's
  // last line owns no terminator, so the only record that the line
  // was there at all is the run itself. Before `appendWholeLine`
  // stopped filtering it out, this row read one run, and a table
  // whose whole interior is one blank line replayed as an empty one.
  test("an interior of nothing but blanks cuts no cell at all", () => {
    const result = expectRunFaithful("\n\n", PSV);
    expect(result.cells).toStrictEqual([]);
    expect(runKinds(result)).toStrictEqual([
      String.raw`skippedBlank:"\n"`,
      'skippedBlank:""',
    ]);
  });

  test("a lone blank interior line is a run of no bytes", () => {
    const result = expectRunFaithful("\n", PSV);
    expect(result.cells).toStrictEqual([]);
    expect(runKinds(result)).toStrictEqual(['skippedBlank:""']);
  });
});

describe("groupRows (table.rb:651-679, :697-728)", () => {
  test("cols fixes the column count", () => {
    const result = expectRunFaithful("|a |b |c |d", PSV);
    expect(expectRow(result, 2)).toStrictEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("with no cols the first row's end of line fixes it", () => {
    const result = expectRunFaithful("|a |b\n|c |d", PSV);
    expect(expectRow(result)).toStrictEqual([
      ["a", "b\n"],
      ["c", "d"],
    ]);
  });

  test("a rowspan reserves a slot in the rows it spans", () => {
    const result = expectRunFaithful(".2+|spans |b\n|c\n|d |e", PSV);
    expect(expectRow(result)).toStrictEqual([
      ["spans", "b\n"],
      ["c\n"],
      ["d", "e"],
    ]);
  });

  test("a duplicated cell counts its repetitions as column visits", () => {
    const result = expectRunFaithful("3*|d |x", PSV);
    expect(expectRow(result)).toStrictEqual([["d", "x"]]);
    expect(result.cells[0].repeat).toStrictEqual({
      kind: "duplicate",
      count: 3,
    });
  });

  test("a row that overruns its column count keeps every cell", () => {
    const result = expectRunFaithful("|x 2+|y", PSV);
    expect(expectRow(result, 2)).toStrictEqual([["x", "y"]]);
  });

  test("an incomplete last row keeps its cells", () => {
    const result = expectRunFaithful("|a |b |c", PSV);
    expect(expectRow(result, 2)).toStrictEqual([["a", "b"], ["c"]]);
  });

  // Probed against the oracle: `a 2*|b |c |d` with no cols reports
  // five cells, `a a b c d`, because a missing leading separator
  // leaves the cell-spec queue one behind for the whole table
  // (`take_cellspec` shifts, table.rb:554-556, what `push_cellspec`
  // put there, table.rb:562-565).
  test("a recovered first cell takes the following spec's repeat", () => {
    const result = expectRunFaithful("a 2*|b |c |d", PSV);
    expect(result.cells.map((cell) => cell.repeat)).toStrictEqual([
      { kind: "duplicate", count: 2 },
      { kind: "none" },
      { kind: "none" },
      { kind: "none" },
    ]);
    expect(expectRow(result)).toStrictEqual([["a", "b", "c", "d"]]);
  });
});

/**
 * Read the header decision for one interior with no options set.
 * @param interior - the table's interior, verbatim
 * @param cutting - the format and separator the table resolved to
 * @returns what the first row is
 */
function decide(interior: string, cutting: TableCutting): string {
  return readHeaderDecision(
    splitLines(interior),
    cut(interior, cutting).cells,
    cutting,
    { header: false, noheader: false },
  );
}

describe("readHeaderDecision (parser.rb:2303-2310, :2337-2347)", () => {
  test("a first line followed by a blank line is an implicit header", () => {
    expect(decide("|a |b\n\n|c |d", PSV)).toBe("implicit");
  });

  test("no blank line after the first cancels the assumption", () => {
    expect(decide("|a |b\n|c |d", PSV)).toBe("none");
  });

  test("a leading blank line cancels the assumption", () => {
    expect(decide("\n|a |b\n\n|c |d", PSV)).toBe("none");
  });

  test("a cell continuing across the gap cancels the assumption", () => {
    expect(decide("|a |b\n\ncontinued\n|d |e", PSV)).toBe("none");
  });

  test("a table that ends in the gap keeps the header", () => {
    expect(decide("|a |b\n\n", PSV)).toBe("implicit");
  });

  test("a wider gap still keeps the header", () => {
    expect(decide("|a |b\n\n\n|c |d", PSV)).toBe("implicit");
  });

  // The reader deletes `//` lines before the table is parsed
  // (`skip_comments`, reader.rb:424), so the blank line the rule asks for is the line
  // after the first one the TABLE sees, not the line after the first
  // one the author wrote.
  test("a comment line between the row and the gap is invisible", () => {
    expect(decide("|a |b\n//c\n\n|c |d", PSV)).toBe("implicit");
  });

  test("an interior with no lines has no header", () => {
    expect(decide("", PSV)).toBe("none");
  });

  test("csv keeps the header when the first line's quotes close", () => {
    expect(decide("a,b\n\nc,d", CSV)).toBe("implicit");
  });

  test("csv cancels the header when the first line's quotes do not", () => {
    expect(decide('"a,b\n\nc,d', CSV)).toBe("none");
  });

  test("dsv keeps the header across the gap", () => {
    expect(decide("a:b\n\nc:d", DSV)).toBe("implicit");
  });

  // Probed: dsv has no cancellation site at all, so a cell that runs
  // straight through the gap still leaves the first row a header.
  test("dsv keeps the header even when a cell crosses the gap", () => {
    expect(decide("a\\:\n\nb", DSV)).toBe("implicit");
  });

  test("the header option makes the decision explicit", () => {
    expect(
      readHeaderDecision(splitLines("|a |b"), cut("|a |b", PSV).cells, PSV, {
        header: true,
        noheader: false,
      }),
    ).toBe("explicit");
  });

  test("the noheader option refuses the assumption", () => {
    expect(
      readHeaderDecision(
        splitLines("|a |b\n\n|c |d"),
        cut("|a |b\n\n|c |d", PSV).cells,
        PSV,
        { header: false, noheader: true },
      ),
    ).toBe("none");
  });
});

describe("groupRows over a cut with no cells", () => {
  test("no cells is no rows", () => {
    const cells: readonly TableScanCell[] = [];
    expect(groupRows(cells, 2)).toStrictEqual([]);
  });
});
