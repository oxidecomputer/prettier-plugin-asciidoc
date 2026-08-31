/**
 * `scanCurvedQuotes`'s own unit rows: where the two curved-quote rows
 * (`QUOTE_SUBS` rows 3 and 4, asciidoctor.rb l.449-452) put their
 * delimiters in one fragment, measured against the oracle's render
 * before each row was written.
 *
 * Each row states the fragment and the delimiters the scan must report,
 * as `[offset, spelling, side]` triples, sorted by offset. An empty
 * expectation is itself the assertion for the rows where neither row
 * matches.
 */
import { describe, expect, test } from "vitest";
import {
  scanCurvedQuotes,
  type CurvedDelimiter,
} from "../../src/parse/inline/curved-quotes.js";
import {
  QUOTE_ROW,
  seesCurvedRewrite,
  type MarkKind,
  type QuoteRowKey,
} from "../../src/parse/inline/quote-boundaries.js";

/** One expected delimiter, as a flat triple for a readable table. */
type ExpectedDelimiter = readonly [
  offset: number,
  quote: CurvedDelimiter["quote"],
  side: CurvedDelimiter["side"],
];

/**
 * The scan's delimiters, as sorted triples comparable to
 * {@link ExpectedDelimiter} rows.
 * @param text - the fragment to scan
 * @returns one triple per delimiter, offset-ascending
 */
function delimitersOf(text: string): ExpectedDelimiter[] {
  return [...scanCurvedQuotes(text).delimiters.entries()]
    .toSorted(([left], [right]) => left - right)
    .map(([offset, { quote, side }]) => [offset, quote, side] as const);
}

describe("scanCurvedQuotes", () => {
  test.each([
    // The plain match.
    [
      'x "`a`" y',
      [
        [2, "double", "open"],
        [5, "double", "close"],
      ],
    ],
    // The single row, same shape.
    [
      "x '`a`' y",
      [
        [2, "single", "open"],
        [5, "single", "close"],
      ],
    ],
    // Row 2 takes the first and last backtick; the inner two stay
    // literal content.
    [
      '"``a``"',
      [
        [0, "double", "open"],
        [5, "double", "close"],
      ],
    ],
    // No closing delimiter: the backticks stay the monospaced rows'.
    ['x "``a`` y', []],
    // The single row is blocked by the ';' the double row wrote.
    [
      "x \"`a`\"'`b`' y",
      [
        [2, "double", "open"],
        [5, "double", "close"],
      ],
    ],
    // Both rows match and CROSS; the scan reports all four, arbitration
    // is span-pairing.ts's job.
    [
      "x '`a \"`b`' c`\" y",
      [
        [2, "single", "open"],
        [6, "double", "open"],
        [9, "single", "close"],
        [13, "double", "close"],
      ],
    ],
    // ';' is in the left exclusion class.
    ['x ;"`a`" y', []],
    // A word character in front.
    ['x a"`b`" y', []],
    // A word character behind.
    ['x "`a`"b y', []],
    // Content may not begin or end with whitespace.
    ['x "` a `" y', []],
    // The escape arm, substitutors.rb l.1420-1426: a match whose
    // boundary character is itself a backslash is stripped and left
    // literal, never converted.
    ['x \\"`a`" y', []],
    // The single row's extra backtick exclusion, asciidoctor.rb l.452:
    // a backtick in front of `'` is the closing half of another pair.
    ["x `'`a`' y", []],
  ] as const)("%j", (text, expected) => {
    const scan = scanCurvedQuotes(text);
    expect(delimitersOf(text)).toEqual(expected);
    // Masking replaces each delimiter with exactly CURVED_WIDTH
    // characters (curved-quotes.ts's maskDelimiters), so an offset
    // means the same position in `view` as in `text` for every row.
    expect(scan.view.length).toBe(text.length);
  });
});

describe("scanCurvedQuotes: view", () => {
  test.each([
    // The plain match: the delimiter's own first and last character.
    ['x "`a`" y', "x &;a&; y"],
    // No closing delimiter: unmasked, identical to the input.
    ['x "``a`` y', 'x "``a`` y'],
    // The single row is blocked by the ';' the double row wrote, so
    // only the double pair is masked; the single pair's own backticks
    // and quotes stay literal in the view.
    ["x \"`a`\"'`b`' y", "x &;a&;'`b`' y"],
  ] as const)("%j", (text, expected) => {
    const { view } = scanCurvedQuotes(text);
    expect(view).toBe(expected);
    expect(view.length).toBe(text.length);
  });
});

describe("QUOTE_ROW", () => {
  // The order the ten rows run in (asciidoctor.rb l.446-464): the two
  // curved rows sit at indices 2 and 3, strong ahead of them and
  // monospace/italic/mark behind - the whole reason strong is immune to
  // the curved rewrite and the other three are not.
  const rowsInOrder: readonly QuoteRowKey[] = [
    "boldUnconstrained",
    "boldConstrained",
    "curvedDouble",
    "curvedSingle",
    "monospaceUnconstrained",
    "monospaceConstrained",
    "italicUnconstrained",
    "italicConstrained",
    "highlightUnconstrained",
    "highlightConstrained",
  ];

  test("the ten rows run in QUOTE_SUBS order", () => {
    expect(rowsInOrder.map((key) => QUOTE_ROW[key].order)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  // The eight mark rows write an element; the two curved rows write an
  // entity - MEASURED (quote-boundaries.ts's own citation note), which
  // is why only these two rows are asked about here.
  test("the curved rows' edges are the entity's first and last character", () => {
    expect(QUOTE_ROW.curvedDouble).toMatchObject({
      opensWith: "&",
      closesWith: ";",
    });
    expect(QUOTE_ROW.curvedSingle).toMatchObject({
      opensWith: "&",
      closesWith: ";",
    });
  });
});

describe("seesCurvedRewrite", () => {
  // Bold's unconstrained row is index 0, ahead of the two curved rows
  // (indices 2 and 3); the other three marks' unconstrained rows sit
  // behind them - the whole reason strong is immune to the curved
  // rewrite and the other three are not (quote-boundaries.ts).
  test.each<[MarkKind, boolean]>([
    ["bold", false],
    ["italic", true],
    ["monospace", true],
    ["highlight", true],
  ])("%s sees the curved rewrite: %s", (kind, expected) => {
    expect(seesCurvedRewrite(kind)).toBe(expected);
  });
});
