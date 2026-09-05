/**
 * The reachable-state enumeration, held to the reader two ways.
 *
 * `reader-context-space.ts` DERIVES which ReaderContext states the
 * reader can build, from the five sites that build one. A derivation
 * can be wrong in two directions, so both are checked here:
 *
 * - Nothing the reader does is outside it. The reader is instrumented
 *   over the differential corpus, the shape registry's standing grid
 *   and every probe document, and every state observed must be one
 *   the derivation names. A state that occurs and was derived
 *   unreachable is a hole in the derivation, not a row to add to the
 *   observed side.
 * - Nothing in it is a fiction. Each open-paragraph probe's own
 *   document must actually put a line in the state the probe claims,
 *   or the grid built on it (`reader-context-grid.test.ts`) would be
 *   asking the oracle about a document that realizes something else.
 *
 * The subset direction is the load-bearing one: the grid's coverage
 * claim is "every state the reader can reach", and only this test
 * connects that phrase to the reader.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import type { ReaderContext } from "../../src/parse/line-shapes.js";
import { CALLOUT_STYLE, listMarkerStyle } from "../../src/parse/line-shapes.js";
import { standingGrid } from "../../scripts/shape-registry.js";
import { loadCorpus } from "./loader.js";
// Type-only, so it is erased before the hoisted mock factory below runs.
import type * as ClassifyModule from "../../src/parse/lines/classify.js";
import {
  CONFINEMENT_STYLES,
  contextKey,
  DESCRIPTION_DELIMITERS,
  deriveReachableContexts,
  LIST_MARKER_STYLES,
  openerFor,
  openParagraphProbes,
  textOnlyOpenerFor,
} from "./reader-context-space.js";

// The states the instrumented reader saw, keyed by contextKey. Held
// through vi.hoisted because the mock factory below is hoisted above
// every import in this file.
const trace = vi.hoisted(() => ({ seen: new Set<string>(), on: false }));

// The reader hands `classifyLine` its context at four sites and keeps
// no other record of it; `classifyTrace` reports the line and the
// verdict but not the state they were decided in. Wrapping the
// classifier is what makes the state observable without changing
// src/ to report it.
vi.mock("../../src/parse/lines/classify.js", async () => {
  const actual = await vi.importActual<typeof ClassifyModule>(
    "../../src/parse/lines/classify.js",
  );
  // The key comes from the enumeration's own spelling, so the
  // observed side and the derived side can never disagree about how a
  // state is written down.
  const { contextKey: keyOf } = await import("./reader-context-space.js");
  return {
    ...actual,
    classifyLine: (line: string, reader: ReaderContext) => {
      if (trace.on) {
        trace.seen.add(keyOf(reader));
      }
      return actual.classifyLine(line, reader);
    },
  };
});

// Imported after the mock so the parser's own import of the
// classifier resolves to the wrapper.
const { parse } = await import("../../src/parser.js");
const { classifyLine } = await import("../../src/parse/lines/classify.js");

/**
 * Parses every document with the trace on and hands back the states
 * that occurred.
 * @param documents - the documents to read
 * @returns the observed state keys
 */
function statesOver(documents: readonly string[]): Set<string> {
  trace.seen = new Set<string>();
  trace.on = true;
  try {
    for (const document of documents) {
      parse(document);
    }
    return trace.seen;
  } finally {
    trace.on = false;
  }
}

// The two documents a probe's prefix makes: the probed line directly
// after the block start, and one line further down.
const FILLERS: readonly string[] = ["", "mid line\n"];

/**
 * Every document the derivation is cross-checked over: real prose,
 * the generated grid that reaches coordinates prose does not, and the
 * probe documents themselves.
 * @returns the documents, in a fixed order
 */
function crossCheckDocuments(): string[] {
  const corpus = loadCorpus().flatMap((group) =>
    group.cases.map((each) => each.input),
  );
  const grid = standingGrid().map((shape) => shape.input);
  const probes = openParagraphProbes().flatMap(({ prefix }) =>
    FILLERS.map((filler) => `${prefix}\n${filler}last line\n`),
  );
  return [...corpus, ...grid, ...probes];
}

// The registry's own marker alternations (src/parse/line-shapes.ts),
// as source text. LIST_MARKER_STYLES is a transcription of what these
// three can produce, and they are regex FRAGMENTS rather than
// exported values, so nothing in the type system links the two: widen
// either alternation and the enumeration keeps its eighteen keys, the
// 414/211 arithmetic still holds, and the grid quietly loses the rows
// the new style would have opened.
//
// Two tests hold the transcription, and the division of labour
// matters. The spelling roster below is pushed through
// `listMarkerStyle` ITSELF, so the style set comes back from src
// rather than being restated here; and the alternations the roster
// was written from are pinned as text, so a widening fails loudly and
// says which roster to widen with it.
const MARKER_ALTERNATIONS: Readonly<Record<string, string>> = {
  UNORDERED_MARKER_SOURCE: String.raw`\*{1,5}|-|\u{2022}`,
  ORDERED_MARKER_SOURCE: String.raw`\.{1,5}|\d+\.|[a-zA-Z]\.|[IVXivx]+\)`,
  CALLOUT_MARKER_SOURCE: String.raw`<(?<callout>\d+|\.)>`,
};

/**
 * The alternation one named constant is declared with, read out of
 * the registry's source text.
 * @param source - the whole of src/parse/line-shapes.ts
 * @param name - the constant's name
 * @returns the raw pattern text, or undefined where no such
 *   declaration stands (a rename, or a spelling other than
 *   `String.raw`)
 */
function alternationIn(source: string, name: string): string | undefined {
  const head = `const ${name} = String.raw\``;
  const start = source.indexOf(head);
  if (start === -1) {
    return undefined;
  }
  const end = source.indexOf("`", start + head.length);
  return end === -1 ? undefined : source.slice(start + head.length, end);
}

// Every spelling those alternations admit, generated where a branch
// is a run or a character class. The roster's job is to reach
// `listMarkerStyle` with the whole IMAGE of the patterns, so that the
// style keys are the registry's answers and not this file's.
const ROMAN_LETTERS = ["I", "V", "X", "i", "v", "x"];
const ASCII_LETTERS = Array.from({ length: 26 }, (_unused, index) =>
  String.fromCodePoint(97 + index),
);
const RUN_LENGTHS = [1, 2, 3, 4, 5];

/**
 * The marker spellings the three alternations accept.
 * @returns one line-leading marker per spelling, gap and text
 *   excluded
 */
function markerSpellings(): string[] {
  const romanPairs = ROMAN_LETTERS.flatMap((first) =>
    ROMAN_LETTERS.map((second) => `${first}${second})`),
  );
  return [
    ...RUN_LENGTHS.map((length) => "*".repeat(length)),
    "-",
    "\u{2022}",
    ...RUN_LENGTHS.map((length) => ".".repeat(length)),
    "0.",
    "1.",
    "7.",
    "42.",
    "2020.",
    ...ASCII_LETTERS.flatMap((letter) => [
      `${letter}.`,
      `${letter.toUpperCase()}.`,
    ]),
    ...ROMAN_LETTERS.map((letter) => `${letter})`),
    ...romanPairs,
    "XIV)",
    "xiv)",
    "<1>",
    "<7>",
    "<.>",
  ];
}

describe("the marker style list is the registry's own", () => {
  test.each(Object.keys(MARKER_ALTERNATIONS))(
    "%s is the alternation the roster was written from",
    (name) => {
      const source = readFileSync("src/parse/line-shapes.ts", "utf8");
      const { [name]: pinned } = MARKER_ALTERNATIONS;
      expect(
        alternationIn(source, name),
        `${name} changed: widen markerSpellings() and LIST_MARKER_STYLES with it`,
      ).toBe(pinned);
    },
  );

  test("every spelling they admit resolves into LIST_MARKER_STYLES", () => {
    const spellings = markerSpellings();
    expect(
      spellings.filter(
        (marker) => listMarkerStyle(`${marker} x`) === undefined,
      ),
      "spellings the registry does not read as a marker",
    ).toEqual([]);
    const resolved = spellings
      .map((marker) => listMarkerStyle(`${marker} x`))
      .filter((style) => style !== undefined);
    expect([...new Set(resolved)].toSorted()).toEqual(
      [...LIST_MARKER_STYLES].toSorted(),
    );
  });
});

describe("the probe documents spell the styles they claim", () => {
  test.each(LIST_MARKER_STYLES)("%s opens a list of its own style", (style) => {
    const opener = openerFor(style);
    expect(opener, `no opener for ${style}`).toBeDefined();
    expect(listMarkerStyle(opener ?? ""), opener).toBe(style);
  });

  test.each(DESCRIPTION_DELIMITERS)("%s opens a description list", (style) => {
    const opener = openerFor(style);
    expect(opener, `no opener for ${style}`).toBeDefined();
    // The term line's own classification carries the delimiter, which
    // is what an item confinement built from it will hold.
    const kind = classifyLine(opener ?? "", {
      openParagraph: undefined,
      openListStyle: undefined,
      firstLineAfterStart: false,
      nextLine: undefined,
    });
    expect(kind.kind).toBe("dlistTerm");
    expect(kind.kind === "dlistTerm" ? kind.delimiter : undefined).toBe(style);
  });

  test.each(DESCRIPTION_DELIMITERS)(
    "%s opens a TEXTLESS description item",
    (style) => {
      const opener = textOnlyOpenerFor(style);
      expect(opener, `no text-only opener for ${style}`).toBeDefined();
      const kind = classifyLine(opener ?? "", {
        openParagraph: undefined,
        openListStyle: undefined,
        firstLineAfterStart: false,
        nextLine: undefined,
      });
      expect(kind.kind).toBe("dlistTerm");
      expect(kind.kind === "dlistTerm" ? kind.delimiter : undefined).toBe(
        style,
      );
      // The whole point of the text-only opener: no inline description
      // trails the delimiter.
      expect(
        kind.kind === "dlistTerm" ? kind.descriptionStart : undefined,
      ).toBeUndefined();
    },
  );
});

describe("the derived state space", () => {
  // The arithmetic the derivation's exclusions are subtracted from,
  // pinned so that widening any of the three fields (a new paragraph
  // context, a new marker family, a new delimiter) shows up here as
  // well as in the enumeration.
  test("is the stated fraction of the unconstrained space", () => {
    const styles = CONFINEMENT_STYLES.length + 1;
    const paragraphContexts = 8 + 1;
    const unconstrained = paragraphContexts * styles * 2;
    expect(styles).toBe(23);
    expect(unconstrained).toBe(414);
    expect(deriveReachableContexts()).toHaveLength(211);
  });

  test("names every state exactly once", () => {
    const keys = deriveReachableContexts().map((each) => contextKey(each));
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("the reader stays inside the derived space", () => {
  test("the observed states are exactly the derived ones", () => {
    const derived = new Set(
      deriveReachableContexts().map((each) => contextKey(each)),
    );
    const observed = statesOver(crossCheckDocuments());
    // The load-bearing direction: a state the reader reached that the
    // derivation excludes means an exclusion argument is wrong, and
    // the grid built on the derivation has a blind spot.
    expect(
      [...observed].filter((key) => !derived.has(key)).toSorted(),
      "states the reader reached that the derivation excludes",
    ).toEqual([]);
    // The other direction is not a claim about the reader - a derived
    // state with no document behind it would still be reachable in
    // principle - but leaving it unpinned would let a state be
    // derived, never realized, and quietly contribute nothing to the
    // grid.
    expect(
      [...derived].filter((key) => !observed.has(key)).toSorted(),
      "derived states no document in the cross-check realizes",
    ).toEqual([]);
  });

  test.each(openParagraphProbes())(
    "$reader.openParagraph in $reader.openListStyle first=$reader.firstLineAfterStart is realized",
    ({ reader, prefix }) => {
      const filler = reader.firstLineAfterStart ? "" : "mid line\n";
      const observed = statesOver([`${prefix}\n${filler}last line\n`]);
      expect([...observed]).toContain(contextKey(reader));
    },
  );
});

// A style the derivation lists but no probe can open would leave a
// silent hole: the grid would simply have fewer rows. Both style
// tables are asked for an opener above, and the callout style is
// called out here because its opener is the one that is not the style
// key with a word after it.
test("the callout style has an opener of a different shape", () => {
  expect(openerFor(CALLOUT_STYLE)).toBe("<1> item");
});
