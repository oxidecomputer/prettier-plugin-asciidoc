/**
 * Issue #74: reflow under width pressure once a curved quote has
 * become text / span / text instead of one text run. The join
 * boundaries the printer computes (src/print/span-edges.ts,
 * src/print/inline.ts) sit on each side of a span rather than inside
 * a single run, so this file exercises the packer (`wrap`,
 * src/print/reflow.ts) against real and synthetic long curved-quote
 * lines at several `printWidth` values, rather than re-testing the
 * boundary logic itself (tests/format/curved-quotes.test.ts already
 * does that).
 *
 * Every row is asserted for RENDER equality against its source (never
 * byte identity against the source - reflow moves line breaks by
 * design) and for stability under a second format at the same width.
 * Test inputs are checked in, never generated or read from another
 * file at runtime: every source below is inlined, and the six corpus
 * lines were extracted from vendor/asciidoctor-corpus/docs.jsonl and
 * are reproduced here verbatim.
 */
import { describe, expect, test } from "vitest";
import { formatAdoc, renderedHtml } from "../helpers.js";

/**
 * One row's verdict at one width: the formatted output renders
 * identically to the source, and formatting it again at the same
 * width changes nothing.
 * @param source - the row's document, without its trailing newline
 * @param printWidth - the column budget to format at
 */
async function expectRow(source: string, printWidth: number): Promise<void> {
  const input = `${source}\n`;
  const out = await formatAdoc(input, { printWidth });
  expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  expect(await formatAdoc(out, { printWidth })).toBe(out);
}

/**
 * One row's verdict at the default width, pinned to exact bytes:
 * used only where the pinned bytes are themselves the finding (the
 * corpus lines' reflow breaks), not a general-purpose
 * assertion for width-pressure rows.
 * @param source - the row's document, without its trailing newline
 * @param expected - the exact formatted bytes
 */
async function expectFixedBytes(
  source: string,
  expected: string,
): Promise<void> {
  const input = `${source}\n`;
  const out = await formatAdoc(input);
  expect(out).toBe(expected);
  expect(await renderedHtml(out)).toBe(await renderedHtml(input));
  expect(await formatAdoc(out)).toBe(out);
}

const WIDTHS = [40, 60, 80] as const;

// The corpus's own long curved-quote lines (vendor/asciidoctor-corpus/docs.jsonl,
// docs/modules/ROOT/pages/index.adoc and two manpage-doc pages within the
// same corpus file), reproduced inline so the rows read without a
// runtime corpus dependency.
const CORPUS_LINES: readonly string[] = [
  'When we use the name "`Asciidoctor`" in this area of the documentation, we\'re referring to the core Asciidoctor Ruby processor, abbreviated as _Asciidoctor core_ or _Asciidoctor Ruby_.',
  'Subsequent sections are optional, but typical sections include "`Description`", "`Options`", "`Bugs`", "`See Also`", "`Copyright`", and "`Author`".',
  'The first section is mandatory, must be titled "`Name`" (or "`NAME`"), and must contain a single paragraph (usually a single line) consisting of a list of one or more comma-separated command name(s) separated from the command\'s purpose by a dash character (e.g., `progname - does stuff` or `name1, name2 - does stuff`).',
  'This command sets the `mantitle` to "`othername`", the `manvolnum` to "`7`", and generates the file [.path]_progname.7_.',
  'There are additional "`unofficial`" converters for Asciidoctor which are not listed on this page.',
  '$ "`\\which apt-get || \\which dnf || \\which yum || \\which brew`" install python # <.>',
];

describe("width rows: the corpus's own long curved-quote lines", () => {
  test.each(
    CORPUS_LINES.flatMap((source) =>
      WIDTHS.map((printWidth) => [source, printWidth] as const),
    ),
  )("%s (width %i)", async (source, printWidth) => {
    await expectRow(source, printWidth);
  });
});

// Synthetic width-pressure rows the corpus does not have. The second
// row breaks INSIDE the curved span's content (between the emphasis
// and "eeee") at width 40 - legal because the oracle's own
// double-quoted pattern carries the /m flag over a CC_ALL content
// group, which matches a newline (asciidoctor.rb l.428, l.450: CC_ALL,
// the double-quoted QUOTE_SUBS entry). The third and fourth push the
// whole pair itself to a line boundary - at width 40 the pair (a
// single-word content, so open mark, word and close mark are one
// fused atom - src/print/inline.ts's pushSpanAtoms) heads or trails a
// wrapped line whole.
const SYNTHETIC_LINES: readonly string[] = [
  'x "`aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk`" y',
  'x "`__aaaa bbbb cccc dddd__ eeee ffff gggg hhhh iiii jjjj`" y',
  'aaaa bbbb cccc dddd eeee ffff gggg "`hhhh`" iiii jjjj kkkk llll',
  'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk "`llll`"',
];

describe("width rows: synthetic width-pressure rows", () => {
  test.each(
    SYNTHETIC_LINES.flatMap((source) =>
      WIDTHS.map((printWidth) => [source, printWidth] as const),
    ),
  )("%s (width %i)", async (source, printWidth) => {
    await expectRow(source, printWidth);
  });
});

describe("the column-zero question", () => {
  // A curved quote's CLOSING mark never fuses as a PREFIX the way the
  // opening mark does. appendSpan / pushSpanAtoms (src/print/inline.ts)
  // fuse the open mark onto the FRONT of the first content atom and
  // the close mark onto the BACK of the last one - a SUFFIX - so a
  // width break in front of that atom puts the fused atom's own
  // content character at column 0, never the closing mark's bytes.
  // Swept every printWidth from 20 to 100 against this row (and the
  // two multi-word synthetic rows above): no output line ever starts
  // with "`\"" or "`'" - the closing mark cannot reach column 0 by
  // width pressure alone, only detachedMarks's raw-line/hard-break
  // paths ever put a mark alone at the head of a line, and neither
  // applies here. This is why no block-start-hazard.ts change is
  // needed: the module never sees a bare delimiter at a line head.
  // The symmetric direction rides the same sweep: the OPEN mark is
  // fused as a PREFIX onto the first content atom, so a line can
  // never end with a bare open mark either.
  test("no delimiter heads or trails a wrapped line, across a width sweep", async () => {
    const rows = [
      'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii "`jjjj kkkk`" llll',
      ...SYNTHETIC_LINES,
    ];
    const widths = Array.from({ length: 81 }, (_unused, index) => 20 + index);
    const pairs: Array<readonly [string, number]> = [];
    for (const source of rows) {
      for (const printWidth of widths) {
        pairs.push([source, printWidth]);
      }
    }
    const outputs = await Promise.all(
      pairs.map(
        async ([source, printWidth]) =>
          await formatAdoc(`${source}\n`, { printWidth }),
      ),
    );
    for (const out of outputs) {
      for (const line of out.split("\n")) {
        expect(line.startsWith('`"')).toBe(false);
        expect(line.startsWith("`'")).toBe(false);
        expect(line.endsWith('"`')).toBe(false);
        expect(line.endsWith("'`")).toBe(false);
      }
    }
  });

  // The closest a width break comes to putting a closing delimiter
  // at the head of a wrapped line: at width 51 the fused atom
  // carrying the close mark ("kkkk`\"") heads the second line, with
  // the mark itself trailing the atom's own content character rather
  // than leading it. Render-equal and idempotent either way.
  test('aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii "`jjjj kkkk`" llll (width 51)', async () => {
    await expectRow(
      'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii "`jjjj kkkk`" llll',
      51,
    );
  });
});

describe("the corpus lines did not move", () => {
  // Each row's formatted bytes at the default width (80), pinned as
  // a regression net. Measured identical, byte for byte, to the same
  // six lines formatted before any curved-quote AST or printer
  // support existed (and re-measured at the branch parent) - the
  // curved-quote printer work did not move a single corpus reflow
  // break. That
  // holds because a curved quote's marks fuse onto the adjacent
  // content character exactly where the source's own lack of
  // whitespace already glued a literal `"`/`` ` `` there; the atom
  // list `wrap` (src/print/reflow.ts) packs is unchanged either way.
  test.each<[string, string]>([
    [
      CORPUS_LINES[0],
      'When we use the name "`Asciidoctor`" in this area of the documentation, we\'re\nreferring to the core Asciidoctor Ruby processor, abbreviated as _Asciidoctor\ncore_ or _Asciidoctor Ruby_.\n',
    ],
    [
      CORPUS_LINES[1],
      'Subsequent sections are optional, but typical sections include "`Description`",\n"`Options`", "`Bugs`", "`See Also`", "`Copyright`", and "`Author`".\n',
    ],
    [
      CORPUS_LINES[2],
      'The first section is mandatory, must be titled "`Name`" (or "`NAME`"), and must\ncontain a single paragraph (usually a single line) consisting of a list of one\nor more comma-separated command name(s) separated from the command\'s purpose by\na dash character (e.g., `progname - does stuff` or `name1, name2 - does stuff`).\n',
    ],
    [
      CORPUS_LINES[3],
      'This command sets the `mantitle` to "`othername`", the `manvolnum` to "`7`", and\ngenerates the file [.path]_progname.7_.\n',
    ],
    [
      CORPUS_LINES[4],
      'There are additional "`unofficial`" converters for Asciidoctor which are not\nlisted on this page.\n',
    ],
    [
      CORPUS_LINES[5],
      '$ "`\\which apt-get || \\which dnf || \\which yum || \\which brew`" install\npython # <.>\n',
    ],
  ])("%s", async (source, expected) => {
    await expectFixedBytes(source, expected);
  });
});
