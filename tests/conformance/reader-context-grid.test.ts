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
 * `openList` only in the arms that read the enclosing list, but a
 * probe standing outside the reachable set is a sample rather than a
 * claim about the reader. The grid replaces the sample with the
 * enumeration.
 *
 * `classifyLine` is the domain on purpose, and one pair sits outside
 * it: src/parse/lines/description-list.ts asks
 * `interruptsParagraph(run.follower, "dlistItem")` through the
 * function's DEFAULT reader, which is `BLOCK_START_CONTEXT`, so
 * (`dlistItem`, no style, a later line) is a question the registry is
 * really asked and the reader never routes through the classifier.
 * The answer there cannot differ from the gridded `dlistItem` rows -
 * `dlistItem`'s row of ENCLOSING_LIST_RULE is `nothing`, so the open
 * list is not read for it at all - but a claim that named the whole
 * registry rather than the classifier would be one pair wider than
 * what is measured here.
 */
import { describe, expect, test, vi } from "vitest";
import type {
  AttributeRunReading,
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
  cellKey,
  contextKey,
  openParagraphProbes,
} from "./reader-context-space.js";
import { attributeRunAhead } from "../../src/parse/lines/description-list.js";
import { splitLines } from "../../src/parse/lines/split.js";
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
  const { cellKey: keyOf } = await import("./reader-context-space.js");
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

/**
 * The item scan's verdict at one document position - the one
 * {@link ReaderContext} field a probe cannot carry, because it is a
 * fact about the lines BELOW the classified line rather than about
 * the prefix that opens the state.
 *
 * The scan's own question, asked through the scan's own function
 * ({@link attributeRunAhead}), so this cannot drift from what the
 * reader does with the same document. Three conditions narrow it to
 * the cells the scan really decides that way, and each is one Ruby
 * writes:
 *
 * - the cut is DLIST-only (parser.rb l.1463), which is the
 *   `description` test below;
 * - it is skipped while a `+` stands directly above the line
 *   (`continuation != :active`, l.1463), which no probe document
 *   spells: every prefix carrying a continuation puts at least one
 *   content line between it and the construct;
 * - the scan has to READ the line to ask at all, and an INDENTED
 *   line above it hands the rest of the item to `read_lines_until`
 *   instead (l.1488-1496), so the arm never sees what that slurp
 *   swallowed.
 *
 * The third is why the context is read here. `literalParagraph` is
 * exactly the state an indented line opens, and its probe's whole
 * tail is slurped: `term1:: desc` / `+` / `  indented first` /
 * `mid line` / `[source]` really does classify that `[source]` inside
 * the item. It is also the state where the reading changes no answer,
 * because `ENCLOSING_LIST_RULE`'s `styledVerbatimRun` row
 * (src/parse/line-shapes-interruption.ts) is the only one that reads
 * the field, and that row is `verbatimStyled`'s. So outside
 * `verbatimStyled` the two readings are ONE state to `classifyLine`,
 * the way the twenty-three block-start states are one, and naming
 * them apart in {@link cellKey} would only lose cells the reader does
 * ask about.
 *
 * It lives here rather than beside the rest of the state derivation
 * for a mechanical reason: the hoisted mock factory below awaits an
 * import of reader-context-space.ts, so a src import that reaches the
 * classifier from that module would deadlock the factory.
 * @param document - the document the cell is measured on
 * @param at - index of the classified line within it
 * @param reader - the probe's state, for the enclosing list and the
 *   open paragraph
 * @returns which reading the reader would carry at that line
 */
function attributeRunIn(
  document: string,
  at: number,
  reader: ReaderContext,
): AttributeRunReading {
  const { openList } = reader;
  if (
    reader.openParagraph !== "verbatimStyled" ||
    openList?.kind !== "description"
  ) {
    return "runIsInTheItem";
  }
  const run = attributeRunAhead(splitLines(document), at, openList.delimiter);
  return run !== undefined && !run.concat ? "runEndsTheItem" : "runIsInTheItem";
}

/** One cell where the classifier and the oracle disagreed. */
interface Disagreement {
  /** The reader state, as {@link cellKey} spells it. */
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
    // Where the construct's first line lands in the document below:
    // the prefix's own lines, then the filler line where there is
    // one. Read off the two strings the document is built from, so it
    // cannot drift from them.
    const constructAt = prefix.split("\n").length + (filler === "" ? 0 : 1);
    for (const [construct, text] of CONSTRUCTS) {
      const [line] = text.split("\n");
      const document = `${prefix}\n${filler}${text}\nlast line\n`;
      // The state is the PROBE's for five of its fields and the
      // CELL's for the sixth: the item scan's verdict at a block
      // attribute run is a fact about the lines below the construct,
      // so it varies with the construct rather than with the prefix
      // (see ReaderContext.attributeRun).
      const cell: ReaderContext = {
        ...reader,
        attributeRun: attributeRunIn(document, constructAt, reader),
      };
      const state = cellKey(cell);
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
      const classifierEnded = !continuesParagraph(classifyLine(line, cell));
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
  // Both numbers held across the #188 fix and the registry half of
  // #187: those closed 365 cells the reader was never asking about,
  // so the reach was exactly what it was and the census below is what
  // moved.
  //
  // `asked` then rose from 7,679 to 7,723 with the READER half. A
  // styled verbatim run inside a list item reaches the item scan's
  // continuation placeholder, a cell blanked in place over the
  // author's `+`, and it now asks the registry about that `+` rather
  // than about the blank written over it (verbatimRunExtent,
  // src/parse/lines/paragraph-reader.ts). The 44 cells are the row
  // being consulted where it was previously only correct: the same
  // answer, now measured.
  //
  // Three of the 61 construct rows are the SPACED Markdown rules,
  // which carry rows of their own because each is also a marker line
  // and so answers the interruption question differently from the
  // tight spelling: 3 x 188 of the cells and 550 of the asked ones
  // are theirs.
  //
  // A fix that only closes cells the reader never asks about moves
  // neither number: the #187/#188 fixes closed 365 such cells and the
  // reach was unchanged. Three anchor id-class rows (issue #203) moved
  // both, because a row is 188 cells of grid whether or not any of
  // them disagrees.
  //
  // Three attribute-entry spellings then joined the roster with the
  // registry's name class (issue #246), each a whole 188-state
  // column: `cells` rose from 11,468 to 12,032 and `asked` from 8,765
  // to 9,329. No cell of any of the three disagrees with the oracle,
  // so the reach is what grew and the verdicts did not move.
  //
  // Two bracketed-text spellings joined it with the block attribute
  // line's own lead class (issue #257), for `cells` 12,032 to 12,408
  // and `asked` 9,329 to 9,705, which is both columns asked in every
  // state. Both are TEXT rows: the spellings that ARE attribute lines
  // cannot ride this roster, because the oracle's block count cannot
  // see one inside a list item (interruption-probes.ts says why, and
  // interruption.test.ts pins them by paragraph count instead).
  //
  // Neither number moved when the cell key gained the item scan's
  // verdict (issue #245, {@link cellKey}). The reading is a state
  // distinction in one context only ({@link attributeRunIn} says
  // which and why), and the sixteen cells it changes the ANSWER for
  // are cells the reader never asked: they left the latent census
  // below rather than joining `asked`.
  test("is the size and reach the enumeration predicts", () => {
    const { cells, asked } = grid;
    expect(openParagraphProbes()).toHaveLength(188);
    expect(CONSTRUCTS).toHaveLength(66);
    expect(cells).toBe(12_408);
    expect(asked).toBe(9705);
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
  // answer and the oracle's differ anyway. Each would be a model row
  // that is wrong in isolation and unreachable in practice, and the
  // census is pinned so that neither half changes quietly.
  //
  // EMPTY, and it is the empty case that carries the claim: every
  // cell of the grid now agrees with the oracle, whether or not the
  // reader asks it. Three families closed and are gone from the
  // census:
  //
  // - issue #187's 347 cells: a delimited block line and a sibling
  //   item inside a styled verbatim run in a list item, and the lone
  //   `+` that does NOT end one there.
  // - issue #188, 18 cells: a SIBLING description-list term inside a
  //   description item, which ends a `+`-attached paragraph (12) and
  //   an indented literal run (6) where the arm compared marker
  //   styles only. Now every sibling rule asks
  //   `is_sibling_list_item?`'s own question.
  // - issue #245, 16 cells: a block attribute line (`[source]`,
  //   `[[x]]`, and the two non-ASCII id spellings of the anchor
  //   beside it) inside a `+`-attached styled verbatim run in a
  //   description item, one per delimiter per spelling. The oracle
  //   ends the run there because the ITEM SCAN cut in front of the
  //   line (parser.rb l.1462-1482), which is a fact about the lines
  //   BELOW it and so not one the classifier could read off the line
  //   - answering it from the line alone cut the run early and let
  //   the printer join the lines under it inside a listing block.
  //   The verdict now arrives as `ReaderContext.attributeRun` and
  //   {@link attributeRunIn} gives each cell the reading its own
  //   document realizes. These sixteen are still cells the reader
  //   does not ask, because a line the scan cut at is not in the
  //   buffer it reads; what changed is that the answer no longer
  //   depends on their never being asked. The reading's own two
  //   verdicts are crossed against the oracle in
  //   tests/conformance/attribute-run-cut.test.ts.
  //
  // A NEW entry here is a model row that answers one setting's
  // question in another, which is what all three issues were.
  test("names the disagreements the reader keeps away from", () => {
    const { latent } = grid;
    expect(Object.fromEntries(latent)).toEqual({});
  });
});
