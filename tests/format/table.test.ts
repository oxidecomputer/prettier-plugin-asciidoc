import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * Passthrough contract: line-for-line with each line's
 * rstripped bytes exact, render-equal (the oracle's reader rstrips
 * every line before parsing — prepare_source_string), idempotent.
 * @param input - the document
 * @param expected - the exact formatted bytes
 */
async function expectTableFormat(
  input: string,
  expected: string,
): Promise<void> {
  const output = await formatAdoc(input);
  expect(output).toBe(expected);
  expect(await renderedHtml(output)).toBe(await renderedHtml(input));
  expect(await formatAdoc(output)).toBe(output);
}

describe("tables pass through line-for-line (issue #10 interim fix)", () => {
  test("the #10 corruption shape survives", async () => {
    const input = "|===\n|a |b\n\n|c |d\n|===\n";
    await expectTableFormat(input, input);
  });

  test.each([
    [",===\na,b\n,===\n"],
    [":===\na:b\n:===\n"],
    ["!===\n!a\n!===\n"],
  ])("%j passes through", async (input) => {
    await expectTableFormat(input, input);
  });

  test("blank lines inside a table are preserved", async () => {
    const input = "|===\n|a\n\n\n|b\n|===\n";
    await expectTableFormat(input, input);
  });

  test("|==== inside an open |=== table is content, to EOF", async () => {
    const input = "|===\n|a\n|====\n\nafter\n";
    await expectTableFormat(input, input);
  });

  test("an unterminated table runs to EOF", async () => {
    const input = "|===\n|a |b\n";
    await expectTableFormat(input, input);
  });

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

  test("trailing whitespace on an interior line and on the closing line formats to the rstripped spelling", async () => {
    await expectTableFormat(
      "|===\n|a \n|=== \nafter\n",
      "|===\n|a\n|===\n\nafter\n",
    );
  });

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
 * Every row below is one syntax the reader now has to understand -
 * a cell spec, a cutting scheme, a comment, a boundary - and every
 * one of them formats to itself. What these rows own is that reading
 * a surface never moves a byte. They do NOT own WHAT was read, and
 * cannot: the printer replays a table's recorded bytes, so every row
 * here stays green under a mis-read cell. Read them as the byte half
 * of a claim whose other half is pinned in three other files.
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
    // form that stands for three cells.
    ["a colspan cell spec", "|===\n2+|spanning\n|a |b\n|===\n"],
    [
      "a cell spec naming a rowspan, both alignments and a style",
      "|===\n.2+^.^h|a |b\n|c\n|===\n",
    ],
    ["a duplicating cell spec", "|===\n3*|x\n|===\n"],
    // An `a|` cell's interior is left exactly as found, nested table
    // included. Reading INTO it is the deferred half of this feature.
    [
      "an a| cell holding a nested !=== table",
      "|===\na|\n!===\n!n\n!===\n|===\n",
    ],
    // Escaping. Mid-line the backslash only hides the separator; at
    // end of line it also holds the cell open across the line break,
    // which is the one place the cut spans two source lines.
    ["an escaped separator inside a cell", "|===\n|a \\| b |c\n|===\n"],
    ["an escaped separator at end of line", "|===\n|a\\|\nb |c\n|===\n"],
    ["a dsv escaped delimiter at end of line", ":===\na\\:\nb:c\n:===\n"],
    // csv escapes nothing: a separator inside a cell has to be quoted,
    // and an unclosed quote is what holds the cell open.
    ["csv quoting around an embedded separator", ',===\n"a,b",c\n,===\n'],
    // Cutting resolved from the attribute line rather than from the
    // delimiter: `tsv` is csv with a tab, and `separator=` replaces
    // the format's own character.
    ["a tsv table", "[format=tsv]\n|===\na\tb\n|===\n"],
    ["a declared separator", "[separator=;]\n|===\n;a ;b\n|===\n"],
    // Boundaries: a `//` line inside a cell is dropped from the cell's
    // text and kept in the bytes, and a blank line before the first
    // row belongs to no cell at all.
    ["a // line inside a cell", "|===\n|a\n// c\n|b\n|===\n"],
    ["a leading blank line", "|===\n\n|a\n|===\n"],
    // Column records: a plain count, a semicolon-separated pair, and a
    // record with nothing in it.
    ["a cols count", '[cols="3"]\n|===\n|a |b |c\n|===\n'],
    ["a semicolon-separated cols list", '[cols="1;2"]\n|===\n|a |b\n|===\n'],
    ["an empty cols record", '[cols=",1"]\n|===\n|a |b\n|===\n'],
  ])("%s", async (_name, input) => {
    await expectTableFormat(input, input);
  });

  // `///` is NOT a comment block opener inside a table: the oracle
  // drops a `//` line and keeps this one, so its cell reads `a\n///`.
  // The bytes are kept either way, which is why the row can be stated
  // without deciding the question the reader had to decide.
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
  // start rewriting them silently.
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
  // This row cannot fail for that reason ON ITS OWN: the printer
  // replays the table's bytes, so it stays green whichever separator
  // the reader chose. The load-bearing pin is the `nested-psv` row at
  // tests/parser/table.test.ts:43, which asserts the resolved cutting
  // is `{ format: "psv", separator: "|" }`. This row is the byte half
  // of that, and it is written out because the surface has no corpus
  // coverage to fall back on.
  test("a top-level !=== table cuts on |", async () => {
    await expectTableFormat("!===\n|a |b\n!===\n", "!===\n|a |b\n!===\n");
  });
});
