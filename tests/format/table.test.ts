import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml, type FormatOverrides } from "../helpers.js";

/**
 * The table contract: the exact bytes, render-equal against the INPUT
 * (the oracle's reader rstrips every line before parsing -
 * prepare_source_string), and a fixed point.
 *
 * A row asserting `input === output` is a claim of one of two very
 * different things, and which one it is matters the day it goes red:
 * either the table is DECLINED and its interior came back byte for
 * byte, or it is ACCEPTED and the author already wrote the normal
 * form. Each row below says which.
 * @param input - the document
 * @param expected - the exact formatted bytes
 * @param overrides - optional Prettier overrides, passed to every
 *   `formatAdoc` call this helper makes
 */
async function expectTableFormat(
  input: string,
  expected: string,
  overrides?: FormatOverrides,
): Promise<void> {
  const output = await formatAdoc(input, overrides);
  expect(output).toBe(expected);
  expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  expect(await formatAdoc(output, overrides)).toBe(output);
}

describe("the shapes issue #10 was filed for", () => {
  // ACCEPTED, and the author already wrote the normal form: one row
  // per line, one space in front of the mid-line separator, and the
  // one blank the implicit header verdict asks for.
  test("the #10 corruption shape survives", async () => {
    const input = "|===\n|a |b\n\n|c |d\n|===\n";
    await expectTableFormat(input, input);
  });

  // DECLINED, and the interior is the author's: csv and dsv are
  // `non-psv-format`, and the top-level `!===` table cuts on `|`
  // (table.rb:466-474), so its `!a` line has no leading separator and
  // opens a `recovered-opening` cell.
  test.each([
    [",===\na,b\n,===\n"],
    [":===\na:b\n:===\n"],
    ["!===\n!a\n!===\n"],
  ])("%j is declined and replayed", async (input) => {
    await expectTableFormat(input, input);
  });

  // ACCEPTED, so the blank RUN after the first row collapses to the
  // one blank the header verdict asks for. Before the layout landed
  // this row asserted the three-line run back byte for byte; the run
  // is render-neutral either way (a blank line reached while no cell
  // is open is consumed by `skip_blank_lines`, parser.rb:2411-2413),
  // and the one blank that is NOT free is the one after the first
  // line, which decides the implicit header.
  test("a blank run inside a table collapses to one blank", async () => {
    await expectTableFormat(
      "|===\n|a\n\n\n|b\n|===\n",
      "|===\n|a\n\n|b\n|===\n",
    );
  });

  // DECLINED for a multi-line cell: `|====` opens a cell whose text
  // runs to the end of the stream, three lines of it.
  test("|==== inside an open |=== table is content, to EOF", async () => {
    const input = "|===\n|a\n|====\n\nafter\n";
    await expectTableFormat(input, input);
  });

  // DECLINED, `unterminated`. The only corpus table that fires this
  // reason holds a multi-line cell too, so this row is where the
  // reason is exercised on its own.
  test("an unterminated table runs to EOF", async () => {
    const input = "|===\n|a |b\n";
    await expectTableFormat(input, input);
  });

  // ACCEPTED, already in the normal form: one cell, one row, and a
  // header verdict of `"none"` (no blank line follows the first).
  test("a table attached inside a list item via + survives", async () => {
    const input = "* item\n+\n|===\n|a\n|===\n";
    await expectTableFormat(input, input);
  });

  test("a paragraph before a table stays a paragraph", async () => {
    // The blank line is the printer's STANDING block separation, not
    // anything table-specific: `para\n----\ncode\n----` and
    // `para\n====\nex\n====` normalize the same way at baseline. What
    // this row pins is that the paragraph does not swallow the table
    // (the #10 corruption) — the delimiter interrupts it.
    await expectTableFormat(
      "para\n|===\n|a\n|===\n",
      "para\n\n|===\n|a\n|===\n",
    );
  });

  // ACCEPTED. The cell's trailing space is stripped by the layout now
  // (`cell_text.strip`, table.rb:282) rather than by Prettier's trim
  // at a hardline; the bytes are the same either way.
  test("trailing whitespace on an interior line and on the closing line formats to the rstripped spelling", async () => {
    await expectTableFormat(
      "|===\n|a \n|=== \nafter\n",
      "|===\n|a\n|===\n\nafter\n",
    );
  });

  // DECLINED, `unread-attrlist`, and NOT for the reason the shape
  // suggests. The title stands between the attribute line and the
  // delimiter, so the reader records no annotation for the table at
  // all (`annotation`, src/parse/lines/held-metadata.ts) and the
  // `cols="1,1"` never reaches the model: without this decline the
  // gate would see a one-column table with one full row and lay it
  // out, and every other reason that reads a `cols=` value would be
  // reading a table the author did not write. Delete the `.Title`
  // line and the same input declines `ragged-rows` instead, which is
  // what the annotation on this row used to claim.
  test("held metadata stacks above the table", async () => {
    const input = '[cols="1,1"]\n.Title\n|===\n|a\n|===\n';
    await expectTableFormat(input, input);
  });

  test("reflow never forms a table delimiter at line start", async () => {
    // A wrappable word shaped like a table delimiter must not land at
    // column 0 (the registry union guard, src/print/reflow.ts).
    const input = `${"word ".repeat(15)}|=== tail\n`;
    const output = await formatAdoc(input);
    expect(await renderedHtml(output)).toBe(await renderedHtml(input));
    expect(await formatAdoc(output)).toBe(output);
    expect(
      // `\|` is not a useless escape: under `v` a bare `|` inside a
      // character class is reserved syntax (a SyntaxError).
      output.split("\n").some((line) => /^[\|,:!]={3,}[ \t]*$/v.test(line)),
    ).toBe(false);
  });
});

/**
 * The BYTE FIXED POINT for the cell surfaces (issue #10).
 *
 * Every row below is one syntax the reader has to understand - a cell
 * spec, a cutting scheme, a comment, a boundary - and every one of
 * them formats to itself. WHY it does is no longer one answer, and the
 * difference is what a reader needs the day a row goes red:
 *
 * - a DECLINED row formats to itself because its interior is replayed
 *   byte for byte, and it stays green under a mis-read cell, exactly
 *   as every row here used to. Each says which reason declines it.
 * - an ACCEPTED row formats to itself because the author already wrote
 *   the normal form, and it DOES depend on the read: a mis-cut cell, a
 *   mis-read spec or a mis-grouped row moves its bytes.
 *
 * So the second half is now a live pin rather than a byte identity,
 * and tests/format/table-census.test.ts is what holds the split
 * itself: a row re-pinned here to the author's own bytes is a claim
 * that the table is declined, and that claim is counted there.
 *
 * Which of the three holds a given surface matters the day a row here
 * goes red. tests/parser/table-reader.test.ts pins the cut and the row
 * grouping unit by unit; tests/parser/table.test.ts pins the cutting
 * each delimiter and each attribute line resolves to, and the node
 * shape a table opens; tests/parser/table-structure.test.ts compares
 * every cut cell in the table corpus against Asciidoctor's own
 * `Table::Cell`.
 *
 * TWO of the surfaces below have no corpus structural coverage at all
 * and rest on the two unit files alone. The top-level `!===` table:
 * the corpus spells `!===` three times and all three sit inside an
 * `a|` cell, where the document IS nested and the separator really is
 * `!`. The missing leading separator: the oracle logs an error for it,
 * which is one of the structure suite's named exclusions.
 *
 * Each input's structure was read from the oracle's parsed model
 * (`oracleTables`, tests/helpers.ts) before its expectation was
 * written, and the rows whose oracle answer is counter-intuitive say
 * what that answer was.
 */
describe("the cell surfaces format to themselves", () => {
  test.each([
    // Cell specs: a colspan, the full four-part spelling (rowspan,
    // horizontal and vertical alignment, style), and the duplicating
    // form that stands for three cells. All three ACCEPTED, and all
    // three already in the normal form.
    ["a colspan cell spec", "|===\n2+|spanning\n|a |b\n|===\n"],
    [
      "a cell spec naming a rowspan, both alignments and a style",
      "|===\n.2+^.^h|a |b\n|c\n|===\n",
    ],
    ["a duplicating cell spec", "|===\n3*|x\n|===\n"],
    // An `a|` cell's interior is left exactly as found, nested table
    // included. Reading INTO it is the deferred half of this feature,
    // and the cell spans four lines, so the table is DECLINED for a
    // multi-line cell and replayed.
    [
      "an a| cell holding a nested !=== table",
      "|===\na|\n!===\n!n\n!===\n|===\n",
    ],
    // Escaping. Mid-line the backslash only hides the separator, and
    // that row is ACCEPTED in the normal form; at end of line it also
    // holds the cell open across the line break, which is the one
    // place the cut spans two source lines and is therefore a
    // multi-line DECLINE.
    ["an escaped separator inside a cell", "|===\n|a \\| b |c\n|===\n"],
    ["an escaped separator at end of line", "|===\n|a\\|\nb |c\n|===\n"],
    ["a dsv escaped delimiter at end of line", ":===\na\\:\nb:c\n:===\n"],
    // csv escapes nothing: a separator inside a cell has to be quoted,
    // and an unclosed quote is what holds the cell open. DECLINED,
    // `non-psv-format`, as every csv and dsv row here is.
    ["csv quoting around an embedded separator", ',===\n"a,b",c\n,===\n'],
    // Cutting resolved from the attribute line rather than from the
    // delimiter: `tsv` is csv with a tab, and `separator=` replaces
    // the format's own character. Both DECLINED, `non-psv-format` -
    // the separator half of that reason is what catches the second,
    // whose format is still psv.
    ["a tsv table", "[format=tsv]\n|===\na\tb\n|===\n"],
    ["a declared separator", "[separator=;]\n|===\n;a ;b\n|===\n"],
    // Boundaries: a `//` line inside a cell is dropped from the cell's
    // text and kept in the bytes (DECLINED, `dropped-comment`), and a
    // blank line before the first row belongs to no cell at all
    // (DECLINED, `leading-runs`).
    ["a // line inside a cell", "|===\n|a\n// c\n|b\n|===\n"],
    ["a leading blank line", "|===\n\n|a\n|===\n"],
    // Column records: a plain count, a semicolon-separated pair, and a
    // record with nothing in it. All three ACCEPTED, and all three
    // already in the normal form; each row's cell count matches the
    // columns its record named, which is what keeps them off
    // `ragged-rows`.
    ["a cols count", '[cols="3"]\n|===\n|a |b |c\n|===\n'],
    ["a semicolon-separated cols list", '[cols="1;2"]\n|===\n|a |b\n|===\n'],
    ["an empty cols record", '[cols=",1"]\n|===\n|a |b\n|===\n'],
  ])("%s", async (_name, input) => {
    await expectTableFormat(input, input);
  });

  // `///` is NOT a comment block opener inside a table: the oracle
  // drops a `//` line and keeps this one, so its cell reads `a\n///`.
  // That two-line reading is exactly why the table is DECLINED for a
  // multi-line cell, and the bytes are the author's either way.
  test("a /// line inside a cell", async () => {
    await expectTableFormat(
      "|===\n|a\n///\n|b\n|===\n",
      "|===\n|a\n///\n|b\n|===\n",
    );
  });

  // The oracle LOGS an error here (its first line does not start with
  // the separator) and then reads `a` and `b` as two cells anyway. A
  // formatter has nothing to recover: the bytes are already what the
  // author wrote, and the row exists so a future recovery cannot
  // start rewriting them silently. DECLINED, `recovered-opening`,
  // which is the reason that reads exactly this repair.
  test("a missing leading separator", async () => {
    await expectTableFormat("|===\na |b\n|===\n", "|===\na |b\n|===\n");
  });

  // A top-level `!===` table cuts on `|`, not on `!`. The `!sv`
  // scheme, where `!` is the separator, belongs to a table inside a
  // NESTED document; at the top level the format resolves to plain
  // psv, and the `xsv` key that choice sets is exactly what indexes
  // `DELIMITERS` into `@delimiter` and `delimiter_rx`
  // (table.rb:466-474). So `|` cuts here and the oracle reads one row
  // of two cells, `a` and `b`. Counter-intuitive enough that someone
  // will one day "fix" it.
  //
  // The table is ACCEPTED, so this row DOES fail if the reader picks
  // `!`: cutting on `!` would leave the `|a |b` line without a
  // leading separator, which is a `recovered-opening` decline, and
  // the row would still be byte-identical but for the wrong reason.
  // The load-bearing pin is still the `nested-psv` row at
  // tests/parser/table.test.ts:43, which asserts the resolved cutting
  // is `{ format: "psv", separator: "|" }`; this row is the byte half
  // of it, written out because the surface has no corpus coverage.
  test("a top-level !=== table cuts on |", async () => {
    await expectTableFormat("!===\n|a |b\n!===\n", "!===\n|a |b\n!===\n");
  });
});

/**
 * The delimiter rule reaches EVERY table, laid out or replayed: it
 * reads the two delimiter lines and the interior as text and moves no
 * byte between them. The interior it reads is the one ABOUT TO BE
 * EMITTED, so on an accepted table it reads the normal form and not
 * the author's spelling - which is what the last row of the block
 * above turns on.
 */
describe("the delimiter is respelled to its shortest safe length", () => {
  // A long delimiter shortens to the canonical three, and the
  // terminator moves with it: the closing line is the exact rstripped
  // opening line (parser.rb:976-1010, reader.rb:396-438), so the two
  // are one decision. Before the respelling both lines came back as
  // `|=======`.
  test("a long delimiter shortens to three", async () => {
    await expectTableFormat(
      "|=======\n|a |b\n\n|c |d\n|=======\n",
      "|===\n|a |b\n\n|c |d\n|===\n",
    );
  });

  // MINIMAL LENGTH, not grow-past-the-longest. `computeDelimiter`
  // (src/print/blocks.ts) pads past the longest conflicting line, so
  // a rule of that shape would answer this interior with something
  // LONGER than `|=======`. Both re-read as the same table; only the
  // shortest is canonical.
  test("an interior line longer than the delimiter does not lengthen it", async () => {
    await expectTableFormat(
      "|=====\n|a\n|=======\n|b\n|=====\n",
      "|===\n|a\n|=======\n|b\n|===\n",
    );
  });

  // The guard is a search, not a shortening: line 3 IS what the
  // shortened delimiter would be, so shortening would make it the
  // terminator and orphan `|b`.
  test("an interior line equal to the shorter delimiter blocks the shortening", async () => {
    await expectTableFormat(
      "|====\n|a\n|===\n|b\n|====\n",
      "|====\n|a\n|===\n|b\n|====\n",
    );
  });

  // The rule reaches a table the layout opinion will never touch:
  // csv's own collision case, which is why the guard is not a psv
  // detail that csv inherits by luck.
  test("a csv table's delimiter is respelled under the same guard", async () => {
    await expectTableFormat(
      ",=====\na,b\n,===\nc,d\n,=====\n",
      ",====\na,b\n,===\nc,d\n,====\n",
    );
  });

  // An unterminated table has no closing line to move, and its opening
  // is still respelled under the same guard.
  test("an unterminated table's opening is respelled", async () => {
    await expectTableFormat("|=====\n|a |b\n", "|===\n|a |b\n");
  });

  // The hint character is never changed. For `,` and `:` it selects
  // the format (parser.rb:874-877); for `!` at top level it selects
  // nothing, and rewriting it would erase the author's nesting intent.
  test.each([
    [",=====\na,b\n,=====\n", ",===\na,b\n,===\n"],
    [":=====\na:b\n:=====\n", ":===\na:b\n:===\n"],
    ["!=====\n!a\n!=====\n", "!===\n!a\n!===\n"],
  ])("%j keeps its hint character", async (input, expected) => {
    await expectTableFormat(input, expected);
  });
});

/**
 * The NORMAL FORM (issue #10): what an accepted table is rewritten to.
 *
 * Two facts are structure-bearing and both are obligations rather than
 * preferences. The first row must stay on the first interior line,
 * because that line is what fixes the column count while no readable
 * `cols=` has (`close_row`, table.rb:701); and one blank line follows
 * the first row exactly when the first row is a header row, because
 * the blank is what an implicit header is made of
 * (`implicit_header`, parser.rb:2340-2345). Everything else in these
 * rows is a layout choice measured render-equal.
 *
 * Each row's structure was read from the oracle's own parsed model
 * (`oracleTables`, tests/helpers.ts) before its expectation was
 * written.
 */
describe("an accepted table takes the normal form", () => {
  // One recorded row per source line. The first row stays where it
  // was, which is what preserves the column count by construction;
  // every row after it may be laid out any way at all, because the
  // guard at table.rb:672 is satisfied by the fixed count alone.
  test("a row split across lines is rejoined", async () => {
    await expectTableFormat(
      "|===\n|a |b\n\n|c\n|d\n|===\n",
      "|===\n|a |b\n\n|c |d\n|===\n",
    );
  });

  // Exactly one space in front of every mid-line separator, and the
  // separator flush against the cell's first content byte.
  test("separators take one space in front and none behind", async () => {
    await expectTableFormat(
      "|===\n|  a    |   b\n|===\n",
      "|===\n|a |b\n|===\n",
    );
  });

  // A spec's letters sit flush against their own separator, and the
  // one space goes in front of the SPEC, because `CellSpecEndRx`
  // (rx.rb:400) reads the text in front of a separator as the next
  // cell's spec and the whitespace is what pins the boundary.
  test("a cell spec keeps its space in front and none behind", async () => {
    await expectTableFormat("|===\n|a   2+|b\n|===\n", "|===\n|a 2+|b\n|===\n");
  });

  // The strip is Ruby's `String#strip` (`cell_text`, table.rb:282),
  // which is the six ASCII whitespace characters plus NUL.
  // JavaScript's `trim()` would also eat the no-break spaces, which
  // Asciidoctor keeps: a content edit, in the one place nothing inside
  // a cell may move. Written with an escape so the row cannot be
  // normalized away by an editor.
  test("a no-break space at a cell's edge is content, not padding", async () => {
    const nbsp = "\u00A0";
    await expectTableFormat(
      `|===\n|  ${nbsp}a${nbsp}   |b\n|===\n`,
      `|===\n|${nbsp}a${nbsp} |b\n|===\n`,
    );
  });

  // The blank comes from the HEADER VERDICT, not from row separation,
  // so a one-row implicit-header table keeps its blank. Deleting it
  // here is a render difference and the only corpus case where a
  // row-separation rule shows itself.
  test("a one-row implicit-header table keeps its blank line", async () => {
    const input = "|===\n|Column 1 |Column 2\n\n|===\n";
    await expectTableFormat(input, input);
  });

  // An explicit header gains the blank it lacked. Optional rather than
  // required for this verdict (`has_header_option` wins outright,
  // parser.rb:2303-2310), and emitted anyway so one derivation covers
  // all three verdicts.
  test("an explicit header row gains the blank line", async () => {
    await expectTableFormat(
      "[%header]\n|===\n|H1 |H2\n|a |b\n|===\n",
      "[%header]\n|===\n|H1 |H2\n\n|a |b\n|===\n",
    );
  });

  // A headerless table gets no blank anywhere, and the blanks a later
  // row carried are removed. A LEADING blank is never written: it is
  // the gate's own `leading-runs` decline, so a table printed with one
  // would stop being formatted on the next pass.
  test("a headerless table loses its inter-row blanks", async () => {
    await expectTableFormat(
      "[%noheader]\n|===\n|a |b\n\n|c |d\n\n|e |f\n|===\n",
      "[%noheader]\n|===\n|a |b\n|c |d\n|e |f\n|===\n",
    );
  });

  // A blank RUN after the first row collapses to one.
  test("a blank run after the first row collapses to one blank", async () => {
    await expectTableFormat(
      "|===\n|a |b\n\n\n\n|c |d\n|===\n",
      "|===\n|a |b\n\n|c |d\n|===\n",
    );
  });

  // A line carrying only spaces is a BLANK line to the reader, which
  // rstrips every line before the table is parsed
  // (`prepare_source_string`), so the cell above it does not span
  // lines and the table is accepted. Reading that whitespace as
  // content would decline the table and then accept it on the next
  // pass, once Prettier's own trim at a hardline had removed it: the
  // author's `|  a` would move on pass two and not on pass one.
  test("a whitespace-only interior line is a blank line", async () => {
    await expectTableFormat(
      "|===\n|  a |b\n   \n|c |d\n|===\n",
      "|===\n|a |b\n\n|c |d\n|===\n",
    );
  });

  // The escape hazard from the other side: the space in front is what
  // keeps `\` from swallowing the separator
  // (`skip_past_escaped_delimiter`, parser.rb:2372-2381). Two cells
  // in, two cells out.
  test("a lone backslash before a separator keeps its space", async () => {
    const input = "|===\n|a\\ |b\n|===\n";
    await expectTableFormat(input, input);
  });

  // A rowspan is NOT a decline: once the column count is fixed, the
  // visit arithmetic (`activate_rowspan`, table.rb:713-716, and
  // `end_of_row?`, table.rb:721-729) does not read line breaks, and
  // the row under the rowspan is short by exactly the slots the
  // rowspan reserved.
  test("a rowspan table is laid out, not declined", async () => {
    const input = '[cols="2*"]\n|===\n.2+|s |b\n\n|c\n|===\n';
    await expectTableFormat(input, input);
  });

  // A zero-row table has no interior line at all, and the difference
  // between it and a table whose interior is one blank line is exactly
  // what the record of a zero-byte line exists for
  // (tests/parser/table.test.ts). The blank-line one is a
  // `leading-runs` decline and replays; the empty one is accepted with
  // no rows and must still emit no interior.
  test.each([
    ["an empty table", "|===\n|===\n"],
    ["a table whose interior is one blank line", "|===\n\n|===\n"],
  ])("%s keeps its exact interior", async (_name, input) => {
    await expectTableFormat(input, input);
  });

  // Under the flush rule `| ===` emits as `|===`, which is a
  // terminator. The delimiter's minimal-length collision guard reads
  // the interior about to be EMITTED, so the delimiter grows and the
  // cell survives. Nothing else prevents this. Both spellings read as
  // one cell holding `===` in the oracle's own model.
  test("a cell whose text would spell the terminator grows the delimiter", async () => {
    await expectTableFormat("|===\n| ===\n|===\n", "|====\n|===\n|====\n");
  });
});

/** One cell per source line after the first row, asked for by name. */
const CELL = { asciidocTableLayout: "cell" } as const;

/**
 * The second emission an accepted table has, and the width that
 * chooses it under the first.
 *
 * THE FIRST ROW IS NEVER SPLIT, under either value. A block that
 * declared no readable `cols=` starts with no column count at all, and
 * until one exists only the end of a line can close the first row:
 * `close_row` then takes the count from the column visits that line
 * held (table.rb:701). So `|a |b` / `|c |d` relaid out as one cell per
 * line is a ONE-column table with four rows, and `%noheader` does not
 * change it.
 *
 * Every row's blank lines come from the HEADER VERDICT, never from row
 * separation, which is why a headerless table gets none at all: a
 * blank after the first row forges an `implicit_header`
 * (parser.rb:2340-2345), and a leading blank is the gate's own
 * `leading-runs` decline.
 */
describe("the cell layout, and the width that chooses it", () => {
  // The first row whole, then the blank the header verdict asks for,
  // then each later row's cells one per line, with a blank in front of
  // each row from the THIRD onward.
  test("the cell layout puts one cell per line after the first row", async () => {
    await expectTableFormat(
      "|===\n|a |b\n\n|c |d\n|e |f\n|===\n",
      "|===\n|a |b\n\n|c\n|d\n\n|e\n|f\n|===\n",
      CELL,
    );
  });

  // A HEADERLESS table gets no blank line anywhere, and no leading
  // blank either. Both spellings that would separate its rows are
  // unavailable, so its rows run together: that is the cost of the
  // style, and it is a structural difference from a table with a
  // header rather than an accident.
  test("a headerless cell-layout table gets no row separation", async () => {
    await expectTableFormat(
      "[%noheader]\n|===\n|a |b\n|c |d\n|===\n",
      "[%noheader]\n|===\n|a |b\n|c\n|d\n|===\n",
      CELL,
    );
  });

  // The blank comes from the header verdict, so a one-row table with
  // no body to separate still gets it. Vacuous as a layout row - one
  // row offers nothing to split - and that is what makes it the pin: a
  // cell layout deriving its blanks from row separation deletes this
  // table's header.
  test("a one-row implicit-header table keeps its blank under cell", async () => {
    const input = "|===\n|Column 1 |Column 2\n\n|===\n";
    await expectTableFormat(input, input, CELL);
  });

  // The width chooses inside the default `"row"` value, all-or-nothing
  // per table: the rows do not all fit, so the whole table prints in
  // the cell style. The wide row is a LATER row, so the flip is
  // visible without asking the first row to split.
  const WIDE = "x".repeat(40);
  const TALL = "y".repeat(40);
  test("a later row that does not fit flips the whole table to the cell style", async () => {
    await expectTableFormat(
      `|===\n|a |b\n\n|${WIDE} |${TALL}\n|===\n`,
      `|===\n|a |b\n\n|${WIDE}\n|${TALL}\n|===\n`,
      { printWidth: 40 },
    );
  });

  // The print-width ruling: a table MAY exceed `printWidth`, and does
  // whenever its FIRST row alone is too wide, because the first row
  // cannot be split. The width selects a LAYOUT; it never forces a
  // break inside a row.
  test("a first row wider than the width is not split", async () => {
    await expectTableFormat(
      `|===\n|${WIDE} |${TALL}\n\n|a |b\n|===\n`,
      `|===\n|${WIDE} |${TALL}\n\n|a\n|b\n|===\n`,
      { printWidth: 40 },
    );
  });

  // ONE EMISSION, reached two ways. A width-flipped table under the
  // default value and the same table under `"cell"` are the same
  // bytes, because `chooseLayout` (src/print/table-layout.ts) answers
  // `"cell"` in both cases and the emission reads only that answer.
  // The parity families lean on this: an id whose tables were flipped
  // by the width takes `table-width-layout`, and it may do so only
  // because the flip writes what the option value writes.
  test("the width flip and the cell value are the same emission", async () => {
    const input = `|===\n|a |b\n\n|${WIDE} |${TALL}\n|c |d\n|===\n`;
    const flipped = await formatAdoc(input, { printWidth: 40 });
    expect(flipped).toBe(await formatAdoc(input, { printWidth: 40, ...CELL }));
    // Non-vacuous: at a width every row fits in, the default value
    // writes the ROW emission instead, so the equality above is two
    // spellings meeting and not one spelling asserted twice.
    expect(flipped).not.toBe(await formatAdoc(input, { printWidth: 200 }));
  });

  // The delimiter collision is reachable under this layout too, and a
  // mid-table cell reaches it: `===` lands alone on a line and spells
  // the terminator. The minimal-length guard reads the interior about
  // to be emitted and grows the delimiter. Both spellings read as one
  // two-column table whose last cell is `===` in the oracle's own
  // model.
  test("a cell-layout line that would spell the terminator grows the delimiter", async () => {
    await expectTableFormat(
      "|===\n|a |b\n\n|c | ===\n|===\n",
      "|====\n|a |b\n\n|c\n|===\n|====\n",
      CELL,
    );
  });
});

/**
 * One row per decline reason, each asserting that the table's interior
 * is the author's. These are the census's claims stated as bytes:
 * every row here is a table the gate must NOT lay out.
 */
describe("each decline reason keeps the author's interior", () => {
  test.each([
    ["a csv table is declined", ",===\na,b\n,===\n"],
    ["a multi-line cell is declined", "|===\n|a\nstill a |b\n|===\n"],
    ["a literal cell is declined", "|===\nl|  code |b\n|===\n"],
    [
      "a column-literal cell is declined",
      '[cols="1l,1"]\n|===\n|  code |b\n|===\n',
    ],
    ["a leading blank is declined", "|===\n\n|a |b\n|===\n"],
    ["a dropped comment is declined", "|===\n|a\n// c\n|b\n|===\n"],
    ["a missing leading separator is declined", "|===\na |b\n|===\n"],
    ["an unterminated table is declined", "|===\n|a |b\n"],
  ])("%s", async (_name, input) => {
    await expectTableFormat(input, input);
  });

  // A referenced `cols` or `options` value is declined over the
  // attribute line's INTERIOR, never over "`columns` came back
  // undefined": `[cols="1,{n}"]` parses one readable record where the
  // oracle resolves two, and nothing in the node says so. The blank
  // line each expectation gains is the printer's standing block
  // separation after an attribute entry, not a table decision.
  test.each([
    [
      "a referenced cols value",
      ':n: 2\n[cols="{n}*"]\n|===\n|a |b\n|===\n',
      ':n: 2\n\n[cols="{n}*"]\n|===\n|a |b\n|===\n',
    ],
    [
      "a referenced options value",
      ':o: header\n[options="{o}"]\n|===\n|a |b\n|===\n',
      ':o: header\n\n[options="{o}"]\n|===\n|a |b\n|===\n',
    ],
  ])("%s is declined", async (_name, input, expected) => {
    await expectTableFormat(input, expected);
  });

  // An ATTRIBUTE ENTRY and a COMMENT BLOCK are the two metadata lines
  // this reader pushes as blocks of their own rather than holding
  // them (`HELD_BUILDERS`, src/parse/lines/held-metadata.ts), so each
  // empties the held run without ending it. Ruby's own loop reads
  // through both and keeps collecting: a comment block is consumed by
  // `read_lines_until` (parser.rb:2074-2078) and an attribute entry
  // by `process_attribute_entry` (parser.rb:2083-2085), and both
  // answer `true` so the loop goes round again. That is why the RUN
  // has to be counted and not the run's remains: counting the remains
  // accepted every row here and deleted the leading spaces of the
  // literal cells.
  //
  // The blank line each expectation gains sits between the entry (or
  // the comment block) and the delimiter, and it is the printer's
  // standing block separation rather than a table decision: an
  // attribute entry is a block, and the table below it is the next
  // one. Render-neutral, and the interior is the author's byte for
  // byte, which is what these rows own.
  test.each([
    [
      "a literal column behind an attribute entry",
      '[cols="1l,1"]\n:attr: v\n|===\n|  code |b\n|===\n',
      '[cols="1l,1"]\n:attr: v\n\n|===\n|  code |b\n|===\n',
    ],
    [
      "a csv table behind an attribute entry",
      "[format=csv]\n:attr: v\n|===\n| code |b\n|===\n",
      "[format=csv]\n:attr: v\n\n|===\n| code |b\n|===\n",
    ],
    [
      "a declared separator behind an attribute entry",
      "[separator=;]\n:attr: v\n|===\n;a ;b\n|===\n",
      "[separator=;]\n:attr: v\n\n|===\n;a ;b\n|===\n",
    ],
    [
      "a literal column behind a comment block",
      '[cols="1l,1"]\n////\nx\n////\n|===\n|  code |b\n|===\n',
      '[cols="1l,1"]\n////\nx\n////\n\n|===\n|  code |b\n|===\n',
    ],
    [
      "a literal column behind a title and an entry",
      '[cols="1l,1"]\n.T\n:attr: v\n|===\n|  code |b\n|===\n',
      '[cols="1l,1"]\n.T\n:attr: v\n\n|===\n|  code |b\n|===\n',
    ],
    [
      "a literal column behind two entries",
      '[cols="1l,1"]\n:a: 1\n:b: 2\n|===\n|  code |b\n|===\n',
      '[cols="1l,1"]\n:a: 1\n:b: 2\n\n|===\n|  code |b\n|===\n',
    ],
  ])("%s is declined", async (_name, input, expected) => {
    await expectTableFormat(input, expected);
  });

  // `ragged-rows` gets its own row, because its input is the one that
  // needs the comment. The oracle LOGS an error on it (it drops the
  // overrunning row, `close_row true`, table.rb:673-675),
  // tests/parser/table-structure.test.ts excludes oracle-logged cases,
  // and our row grouping is therefore UNVERIFIED exactly here. That is
  // why the reason is in the union even though a relaid-out
  // overrunning row measures render-equal. The double space is what
  // makes this row discriminate: laid out, it would close up.
  test("an overrunning row is declined", async () => {
    const input = '[cols="2*"]\n|===\n|a  2+|wide\n|===\n';
    await expectTableFormat(input, input);
  });
});

/**
 * The attribute line the reader could not record, and the tables that
 * must not be laid out behind one.
 *
 * `annotation` (src/parse/lines/held-metadata.ts) records a block's
 * attribute line only when it is the LAST line of the metadata run
 * above the block, so a title or an anchor between `[...]` and `|===`
 * hides it, and a second attribute line hides the first. Asciidoctor
 * has no such gap: `parse_block_metadata_lines` (parser.rb:2014-2021)
 * accumulates every metadata line above a block into ONE attribute
 * hash whatever the order.
 *
 * So the values `cutting`, `columns` and `header` were resolved from
 * are then less than the author wrote, and four of the reasons read
 * exactly those fields. Every row below is a table the gate has to
 * decline for that alone, and each names what the layout would have
 * done to it: the first is the design's own literal-cell disproof
 * happening for real.
 */
describe("an unread attribute line declines its table", () => {
  test.each([
    // A literal column the gate cannot see: laid out, the leading
    // whitespace of `  code` is deleted, and `l|` rstrips only
    // (table.rb:274-276), so the rendered `<pre>` loses two bytes.
    [
      "a literal column behind a title",
      '[cols="1l,1"]\n.Title\n|===\n|  code |b\n|===\n',
    ],
    [
      "a literal column behind an anchor",
      '[cols="1l,1"]\n[[anc]]\n|===\n|  code |b\n|===\n',
    ],
    // A csv table the gate would cut as psv, and a psv table whose
    // separator is not `|`. Both would be laid out under the wrong
    // cell rules entirely.
    [
      "a csv table behind a title",
      "[format=csv]\n.Title\n|===\n| code |b\n|===\n",
    ],
    [
      "a declared separator behind a title",
      "[separator=;]\n.Title\n|===\n;a ;b\n|===\n",
    ],
    // The reference predicate reads the recorded interior, so a title
    // makes the reference itself invisible to it.
    [
      "a referenced cols value behind a title",
      ':n: 2\n\n[cols="{n}*"]\n.Title\n|===\n|a |b\n|===\n',
    ],
    // A SECOND attribute line hides the first the same way: only the
    // last is recorded, where Ruby merges both into one hash.
    [
      "a first attribute line behind a second",
      '[cols="1l,1"]\n[%header]\n|===\n|  code |b\n|===\n',
    ],
  ])("%s", async (_name, input) => {
    await expectTableFormat(input, input);
  });

  // The two controls, so the decline is not simply "anything with a
  // title". A title with NO attribute line hides nothing, and an
  // attribute line standing immediately above the delimiter is
  // recorded however much metadata precedes IT - that one is declined
  // by `literal-cell`, on the column it can now see.
  test("a title with no attribute line is not a decline", async () => {
    await expectTableFormat(
      ".Title\n|===\n|  a |b\n|===\n",
      ".Title\n|===\n|a |b\n|===\n",
    );
  });

  test("an attribute line under a title is recorded", async () => {
    const input = '.Title\n[cols="1l,1"]\n|===\n|  code |b\n|===\n';
    await expectTableFormat(input, input);
  });

  test("an attribute line under an attribute entry is recorded", async () => {
    await expectTableFormat(
      ':attr: v\n[cols="1l,1"]\n|===\n|  code |b\n|===\n',
      ':attr: v\n\n[cols="1l,1"]\n|===\n|  code |b\n|===\n',
    );
  });

  // A BLANK line ends no run on either side:
  // `parse_block_metadata_lines` skips blanks and keeps looping
  // (parser.rb:2014-2021), and this reader holds its run across one
  // too, so the attribute line is recorded and the table declines on
  // the literal column it can see rather than on the run.
  test("a blank line between the attribute line and the table", async () => {
    await expectTableFormat(
      '[cols="1l,1"]\n\n|===\n|  code |b\n|===\n',
      '[cols="1l,1"]\n|===\n|  code |b\n|===\n',
    );
  });

  // The PRICE of counting the run rather than reading it: an
  // attribute line that governs nothing this file reads costs its
  // table the layout all the same, because the node says only THAT a
  // line went unread and never WHAT it said. Render-neutral, and
  // byte-neutral here only because the author already wrote the
  // normal form.
  test("an unread attribute line that changes nothing still declines", async () => {
    await expectTableFormat(
      '[cols="3*"]\n:attr: v\n|===\n|a |b |c\n|===\n',
      '[cols="3*"]\n:attr: v\n\n|===\n|a |b |c\n|===\n',
    );
  });
});
