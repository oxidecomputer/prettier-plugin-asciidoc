/**
 * The classification grid: every reader state the reader can reach,
 * crossed with every line shape the registry knows, checked against
 * the pinned Asciidoctor oracle.
 *
 * WHAT IT CLAIMS, exactly: over the DERIVED-REACHABLE ReaderContext
 * states (reader-context-space.ts, held to the reader in
 * reader-context-space.test.ts) and the REGISTRY line shapes
 * (`CONSTRUCTS`, interruption-probes.ts), wherever the reader
 * actually classifies one of those lines in one of those states,
 * `classifyLine` agrees with the oracle about whether the open block
 * continued.
 *
 * WHAT IT DOES NOT COVER. Line texts outside that construct list: a
 * shape nobody added a row for is probed in no state at all, so the
 * grid widens the STATE axis to exhaustion while the SHAPE axis stays
 * the registry's own roster. And cells the reader never asks about,
 * which is the qualifier above and needs its own paragraph.
 *
 * WHY THE QUALIFIER. A cell is a question - "this line, in this
 * state" - and for some cells the reader never asks it: the extent
 * scans decide a list item's buffer before any line inside it is
 * classified, so a line that ends the item is cut away rather than
 * classified inside it. The document that realizes such a cell still
 * renders, and the oracle still answers, but its answer is about a
 * structure the classifier was never consulted on, so comparing the
 * two would report a disagreement that no output can show. Each cell
 * is therefore ASKED of the reader first (the classifier is
 * instrumented and the document parsed), and only the cells the
 * reader reached carry the claim. The cells it does not reach are
 * counted rather than dropped, so the reach itself is pinned: a
 * change that carries the reader into one of them turns the
 * disagreement into a failure here.
 *
 * The instrumentation can only make this stricter. A line text that
 * also occurs in the probe's own prefix could mark a cell reached
 * that this document did not reach, which adds a check; it can never
 * excuse one, because a cell is excused only by the absence of the
 * pair.
 *
 * It generalizes tests/conformance/interruption.test.ts, which probes
 * one document shape per paragraph context with the enclosing list
 * style fixed at undefined for all but one of them. Ten of those
 * sixteen probes stand at states the reader never hands
 * `classifyLine`: eight because an item-confined reader always
 * carries a style (`listItemText`, `listItem`, `dlistItem` and
 * `dlistItemTextOnly` are probed with none), and two because a
 * verbatim run never classifies a first line. Their answers are right
 * anyway, the classifier reading
 * `openListStyle` only in the `listContinuation` arm, but a probe
 * standing outside the reachable set is a sample rather than a claim
 * about the reader. The grid replaces the sample with the
 * enumeration.
 *
 * `classifyLine` is the domain on purpose, and one pair sits outside
 * it: src/parse/lines/description-list.ts asks
 * `interruptsParagraph(run.follower, "dlistItem")` through the
 * function's DEFAULT reader, which is `BLOCK_START_CONTEXT`, so
 * (`dlistItem`, no style, a later line) is a question the registry is
 * really asked and the reader never routes through the classifier.
 * The answer there cannot differ from the gridded `dlistItem` rows -
 * `openListStyle` is read in the `listContinuation` arm alone - but
 * a claim that named the whole registry rather than the classifier
 * would be one pair wider than what is measured here.
 */
import { describe, expect, test, vi } from "vitest";
import type {
  ParagraphContext,
  ReaderContext,
} from "../../src/parse/line-shapes.js";
import {
  continuesParagraph,
  CONSTRUCTS,
  oracleInterrupts,
} from "./interruption-probes.js";
import {
  blockStartContexts,
  contextKey,
  openParagraphProbes,
} from "./reader-context-space.js";
// Type-only, so it is erased before the hoisted mock factory below runs.
import type * as ClassifyModule from "../../src/parse/lines/classify.js";

// Which (line, state) questions the reader asked while a document was
// being parsed. Keyed through JSON so a line's own text can never run
// into the state that follows it.
const trace = vi.hoisted(() => ({ asked: new Set<string>(), on: false }));

// The reader keeps no record of the state it classified a line in
// (`classifyTrace` reports the line and the verdict, not the state),
// so the classifier is wrapped to report it. The wrapper delegates,
// which is what lets this file's own direct calls stay honest.
vi.mock("../../src/parse/lines/classify.js", async () => {
  const actual = await vi.importActual<typeof ClassifyModule>(
    "../../src/parse/lines/classify.js",
  );
  const { contextKey: keyOf } = await import("./reader-context-space.js");
  return {
    ...actual,
    classifyLine: (line: string, reader: ReaderContext) => {
      if (trace.on) {
        trace.asked.add(`${JSON.stringify(line)}${keyOf(reader)}`);
      }
      return actual.classifyLine(line, reader);
    },
  };
});

// Imported after the mock, so the parse below reports through it.
const { parse } = await import("../../src/parser.js");
const { classifyLine } = await import("../../src/parse/lines/classify.js");

/** One cell where the classifier and the oracle disagreed. */
interface Disagreement {
  /** The reader state, as {@link contextKey} spells it. */
  readonly state: string;
  /** The construct's row name. */
  readonly construct: string;
  /** The document both sides were asked about. */
  readonly document: string;
}

/** What one sweep of the whole grid found. */
interface GridRun {
  /** Cells swept: reachable states x registry constructs. */
  readonly cells: number;
  /** Of those, the ones the reader put to the classifier. */
  readonly asked: number;
  /** Disagreements in cells the reader ASKED - the claim's failures. */
  readonly failures: Disagreement[];
  /** Disagreements in cells it never asked, by paragraph context. */
  readonly latent: Map<ParagraphContext, number>;
}

// The filler that puts the probed line where the state says it is.
// The same spelling the reachability test realizes a state with, so
// the document the oracle reads is the document the reader was
// observed reaching the state in.
const LATER_LINE_FILLER = "mid line\n";

/**
 * Sweeps the whole grid: every reachable open-paragraph state, every
 * registry construct.
 * @returns the counts and the disagreements, split by whether the
 *   reader asked the cell's question
 */
async function sweepGrid(): Promise<GridRun> {
  const failures: Disagreement[] = [];
  const latent = new Map<ParagraphContext, number>();
  let cells = 0;
  let asked = 0;
  for (const { reader, prefix } of openParagraphProbes()) {
    const filler = reader.firstLineAfterStart ? "" : LATER_LINE_FILLER;
    const state = contextKey(reader);
    for (const [construct, text] of CONSTRUCTS) {
      const [line] = text.split("\n");
      const document = `${prefix}\n${filler}${text}\nlast line\n`;
      cells += 1;
      trace.asked = new Set<string>();
      trace.on = true;
      parse(document);
      trace.on = false;
      const reached = trace.asked.has(`${JSON.stringify(line)}${state}`);
      if (reached) {
        asked += 1;
      }
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose: nine thousand concurrent renders exhaust memory
      const oracleEnded = await oracleInterrupts(text, prefix, filler);
      const classifierEnded = !continuesParagraph(classifyLine(line, reader));
      if (classifierEnded === oracleEnded) {
        continue;
      }
      if (reached) {
        failures.push({ state, construct, document });
      } else {
        const context = reader.openParagraph;
        latent.set(context, (latent.get(context) ?? 0) + 1);
      }
    }
  }
  return { cells, asked, failures, latent };
}

// One sweep for the whole file: the three tests below read different
// facts out of the same run rather than sweeping the grid three times.
const grid = await sweepGrid();

describe("classifyLine over the reachable grid", () => {
  test("agrees with the oracle in every cell the reader asks about", () => {
    expect(grid.failures).toEqual([]);
  });

  // The grid's size and its reach, pinned as numbers. A construct row
  // or a reachable state that appears or disappears moves `cells`; a
  // change in what the extent scans cut away before classification
  // moves `asked`. Both are deliberate changes, and both should be
  // read before the number here is updated.
  //
  // CONSTRUCTS grew by one row (`openBlockTilde`, issue #64): 188 new
  // cells (one row x every reachable state), 26 of them asked and 22
  // of the rest counted below as a `verbatimStyled` latent
  // disagreement - the tilde spelling falls into the SAME issue #187
  // family every other delimiter-opening construct already does.
  test("is the size and reach the enumeration predicts", () => {
    const { cells, asked } = grid;
    expect(openParagraphProbes()).toHaveLength(188);
    expect(CONSTRUCTS).toHaveLength(55);
    expect(cells).toBe(10_340);
    expect(asked).toBe(7679);
  });

  // Why the 23 states with NO open paragraph are enumerated and not
  // gridded: `classifyLine` returns `classifyBlockStart(line)`
  // whenever `openParagraph` is undefined (classify.ts), so the other
  // two fields are not read and all 23 are one equivalence class.
  // Asked over every construct rather than a sample of line texts,
  // because the whole point is that no line distinguishes them.
  test("collapses to one class where no paragraph is open", () => {
    const [base] = blockStartContexts();
    for (const reader of blockStartContexts()) {
      for (const [construct, text] of CONSTRUCTS) {
        const [line] = text.split("\n");
        expect(
          classifyLine(line, reader),
          `${construct} in ${contextKey(reader)}`,
        ).toEqual(classifyLine(line, base));
      }
    }
  });

  // The cells the reader never asks about, where the registry's
  // answer and the oracle's differ anyway. Each is a model row that
  // is wrong in isolation and unreachable in practice, and the count
  // is pinned so that neither half changes quietly. Two families,
  // one issue each:
  //
  // - issue #187, 355 cells (was 333: `openBlockTilde`, a delimiter
  //   like every other in this family, adds 22): a verbatim styled
  //   paragraph inside a list item, where Ruby's read_lines_until
  //   still ends at the item's own boundary. The registry's
  //   `verbatimStyled` row is written for the document-level case, as
  //   ParagraphContext says.
  // - issue #188, 18 cells: a SIBLING description-list term inside a
  //   description item, which ends a `+`-attached paragraph (12) and
  //   an indented literal run (6) although `interruptsParagraph`'s
  //   listContinuation arm compares marker styles only.
  //
  // Fixing either row moves its cells from this census to the asked
  // side, so both numbers below change when the issue closes.
  test("names the disagreements the reader keeps away from", () => {
    const { latent } = grid;
    expect(Object.fromEntries(latent)).toEqual({
      verbatimStyled: 355,
      listContinuation: 12,
      literalParagraph: 6,
    });
  });
});
