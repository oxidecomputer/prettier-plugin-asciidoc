/**
 * The seam-decidability census: for every (reader state, line
 * construct) cell of the classification grid, the SHORTEST line-start
 * prefix and line-end suffix that fix `classifyLine`'s
 * continue-or-interrupt verdict no matter what bytes stand between
 * them.
 *
 * WHY THE QUESTION IS ASKED. A line packer that joins source words
 * onto an output line has to know, at each seam, whether the line it
 * is building would still be read as the paragraph it came from. If
 * the answer is a function of a bounded window at the two ends, the
 * check is O(1) per seam and can be compiled to a lookup table; if it
 * is a function of the whole line, the check costs one classification
 * per flushed line. This census measures which of the two each
 * construct is, rather than assuming either.
 *
 * WHAT A WINDOW MEANS, exactly. A window is a byte count `p` at the
 * line start and a byte count `s` at the line end, with `p + s` no
 * greater than the line's own length. It DECIDES a cell when, for
 * every filler in the probed alphabet, `prefix + filler + suffix`
 * classifies to the same continue-or-interrupt verdict as the
 * construct's own line does in that state. The empty filler is in
 * every alphabet, so a window that decides also decides for the line
 * that is nothing but its own two ends.
 *
 * WHAT IT IS NOT. It is not a proof over all byte strings: an
 * alphabet is finite and a line is not. A window this census calls
 * deciding is one no probed filler could move; a construct it calls
 * whole-line is one where some probed filler moved every window,
 * which IS a proof in that direction. So the census is exact on the
 * whole-line side and an upper bound on the windowed side, and the
 * alphabet below is written to be adversarial for that reason: it
 * carries every construct's own spelling, every run of every byte
 * those spellings use, and every head and tail of each, so that a
 * filler which respells the line as some other construct is in the
 * set whenever the registry knows that construct.
 *
 * TWO ALPHABETS, because the difference between them is the finding.
 * The ordinary-text alphabet holds letters, digits and spaces alone -
 * the interior of a line whose words carry no AsciiDoc punctuation.
 * The registry alphabet adds the punctuation the registry itself
 * spells. A construct that is windowed under the first and whole-line
 * under the second is one whose seam check is decidable only when the
 * bytes between the ends are known to be inert, which is a fact about
 * the packer's input, not about the classifier.
 *
 * A LIBRARY module with a printer: the pinned gate
 * (tests/conformance/seam-window-census.test.ts) imports the census,
 * and `bun scripts/seam-window-census.ts` prints the table it pins.
 */
import { classifyLine } from "../src/parse/lines/classify.js";
import type { ReaderContext } from "../src/parse/line-shapes.js";
import {
  CONSTRUCTS,
  continuesParagraph,
} from "../tests/conformance/interruption-probes.js";
import {
  contextKey,
  openParagraphProbes,
} from "../tests/conformance/reader-context-space.js";

// How far a run of one byte is repeated in the registry alphabet.
// Four is what the registry's own longest fixed-length delimiter
// needs (`----`, `====`, `++++`, `~~~~`): a filler shorter than the
// delimiter cannot respell a line as one.
const RUN_LENGTH = 4;

// How many leading bytes of a construct's own spelling go into the
// alphabet as a filler of their own. Same four, and for the same
// reason: the head of a delimiter is what turns a shorter run into a
// long enough one when it lands beside the window's own prefix.
const HEAD_LENGTH = 4;

/**
 * The first line of each construct - what the grid classifies, and
 * what this census measures a window for. A registry row may spell a
 * whole delimited block; only its opening line is ever handed to the
 * classifier.
 * @returns one line per construct row, in registry order
 */
function constructLines(): Array<[string, string]> {
  return CONSTRUCTS.map(([name, text]) => {
    const [line] = text.split("\n");
    return [name, line];
  });
}

/**
 * The interior bytes a line packer may be assumed to join when its
 * words carry no AsciiDoc punctuation: letters, digits and the spaces
 * between them, plus the empty interior.
 *
 * Held apart from the registry alphabet so the census can say which
 * constructs are decidable only under this assumption.
 * @returns the ordinary-text fillers
 */
export function ordinaryTextAlphabet(): readonly string[] {
  return ["", "x", "word", "a b", " ", "  ", "0", "12", "Word"];
}

/**
 * Every filler the census probes a window with: the ordinary-text
 * ones, plus everything derived from the registry's own construct
 * spellings.
 *
 * DERIVED, never hand-listed, so a construct added to the registry
 * roster widens the alphabet in the same change instead of leaving a
 * hazard the census cannot see. Four derivations:
 *
 * 1. Each construct's own line, and that line with a leading space -
 *    the shape a reflowed word run takes when a construct's spelling
 *    lands mid-line.
 * 2. Runs of every byte those lines use, up to {@link RUN_LENGTH} -
 *    which is what turns `*` into `***` and `-` into `----` beside a
 *    window's own prefix.
 * 3. The leading bytes of each line, up to {@link HEAD_LENGTH}, for
 *    the same reason one step less directly.
 * 4. Every TAIL of each line. A window that holds one byte of the
 *    line start and nothing else is respelled by the rest of some
 *    other construct: `<` plus `1> item` is a callout marker, and no
 *    head, run or whole line spells that filler. Leaving tails out
 *    once let two rows of one state contradict each other, which the
 *    table-conflict count below is what caught.
 *
 * Ordered most-discriminating first (the empty interior, then the
 * construct spellings, then the runs) purely so a window that fails
 * fails on its first few probes; the census result does not depend on
 * the order.
 * @returns the registry fillers, deduplicated, in probe order
 */
export function registryAlphabet(): readonly string[] {
  const lines = constructLines().map(([, line]) => line);
  const bytes = new Set<string>();
  for (const line of lines) {
    for (const byte of line) {
      bytes.add(byte);
    }
  }
  const runs: string[] = [];
  for (const byte of bytes) {
    let run = "";
    for (let count = 0; count < RUN_LENGTH; count += 1) {
      run += byte;
      runs.push(run);
    }
  }
  const heads = lines.flatMap((line) =>
    Array.from({ length: Math.min(HEAD_LENGTH, line.length) }, (_unused, at) =>
      line.slice(0, at + 1),
    ),
  );
  const tails = lines.flatMap((line) =>
    Array.from({ length: line.length }, (_unused, at) => line.slice(at + 1)),
  );
  return [
    ...new Set([
      "",
      ...lines,
      ...lines.map((line) => ` ${line}`),
      ...runs,
      ...heads,
      ...tails,
      ...ordinaryTextAlphabet(),
    ]),
  ];
}

/** A window: bytes held at the line start and at the line end. */
interface SeamWindow {
  /** Bytes of the line's start the window holds. */
  readonly prefixBytes: number;
  /** Bytes of the line's end the window holds. */
  readonly suffixBytes: number;
}

/** What the census found for one (state, construct) cell. */
type CellWindow =
  | {
      /** Some window decides the cell. */
      readonly kind: "windowed";
      /** The shortest one, prefix-heaviest among equals. */
      readonly window: SeamWindow;
    }
  | {
      /** No window decides it; the check must read the whole line. */
      readonly kind: "wholeLine";
    };

/**
 * Whether the open block keeps going through `line` in `reader` -
 * the seam question in the form the packer asks it.
 * @param line - the candidate output line
 * @param reader - the state the line would be classified in
 * @returns true when the line does not end the open block
 */
function joinVerdict(line: string, reader: ReaderContext): boolean {
  return continuesParagraph(classifyLine(line, reader));
}

/** One cell's question, carried whole rather than as four arguments. */
interface Cell {
  /** The construct's own line, the window's own source of bytes. */
  readonly line: string;
  /** The state the line is classified in. */
  readonly reader: ReaderContext;
  /** The fillers a window is probed against. */
  readonly alphabet: readonly string[];
  /** The verdict the construct's own line carries in that state. */
  readonly verdict: boolean;
}

/**
 * Whether one window fixes the verdict across the whole alphabet.
 * @param cell - the question, its state and its filler alphabet
 * @param window - the candidate window
 * @returns true when no filler moves the verdict
 */
function decides(cell: Cell, window: SeamWindow): boolean {
  const prefix = cell.line.slice(0, window.prefixBytes);
  const suffix =
    window.suffixBytes === 0
      ? ""
      : cell.line.slice(cell.line.length - window.suffixBytes);
  return cell.alphabet.every(
    (filler) =>
      joinVerdict(prefix + filler + suffix, cell.reader) === cell.verdict,
  );
}

/**
 * The shortest deciding window for one cell, or the verdict that no
 * window shorter than the line decides it.
 *
 * Ties on total length are broken toward the PREFIX (`p` counts down
 * from `k`), because an anchored line-start check is the shape most
 * of the registry's own patterns take and the shape a packer can
 * evaluate while it still has the line's head in hand.
 * @param line - the construct's own line
 * @param reader - the state
 * @param alphabet - the fillers to probe between the two ends
 * @returns the minimal window, or the whole-line verdict
 */
function minimalWindow(
  line: string,
  reader: ReaderContext,
  alphabet: readonly string[],
): CellWindow {
  const cell = { line, reader, alphabet, verdict: joinVerdict(line, reader) };
  for (let total = 0; total <= line.length; total += 1) {
    for (let prefixBytes = total; prefixBytes >= 0; prefixBytes -= 1) {
      const window = { prefixBytes, suffixBytes: total - prefixBytes };
      if (decides(cell, window)) {
        return { kind: "windowed", window };
      }
    }
  }
  return { kind: "wholeLine" };
}

/** What the census found for one construct, across every state. */
interface ConstructRow {
  /** The registry row's name. */
  readonly construct: string;
  /** The line the classifier is asked about. */
  readonly line: string;
  /** Cells where a window decides. */
  readonly windowedCells: number;
  /** Cells where no window shorter than the line does. */
  readonly wholeLineCells: number;
  /**
   * The longest minimal window over the windowed cells, which is the
   * window a table would have to hold for this construct. Zero when
   * every cell is whole-line.
   */
  readonly windowBytes: number;
}

/** One census run, over one alphabet. */
export interface SeamCensus {
  /** Which fillers the windows were probed against. */
  readonly alphabet: "ordinary text" | "registry";
  /** Reachable open-paragraph states swept. */
  readonly states: number;
  /** Registry constructs swept. */
  readonly constructs: number;
  /** States x constructs. */
  readonly cells: number;
  /** Cells a window decides. */
  readonly windowedCells: number;
  /** Cells no window decides. */
  readonly wholeLineCells: number;
  /**
   * Construct names with at least one whole-line cell, sorted. This
   * is the roster the "factors through a bounded window" question is
   * answered with: a construct whose verdict needs the whole line in
   * even one reachable state does not factor through a window, since
   * the packer stands in every reachable state at some seam.
   */
  readonly wholeLineConstructs: readonly string[];
  /**
   * Construct names with NO windowed cell at all, sorted. The weaker
   * reading of the same question, kept beside the strong one so the
   * two cannot be confused for each other when the numbers are read
   * back.
   */
  readonly alwaysWholeLineConstructs: readonly string[];
  /** The longest window any cell needed. */
  readonly windowBytes: number;
  /** Distinct (state, prefix, suffix) rows a generated table holds. */
  readonly tableEntries: number;
  /**
   * Table rows that contradict a row they subsume: two rows of one
   * state where every line matching the longer also matches the
   * shorter, and the two carry opposite verdicts. A lookup built on
   * such a pair has no answer, so this must be zero for the table to
   * be a table at all.
   */
  readonly tableConflicts: number;
  /** One row per construct, in registry order. */
  readonly rows: readonly ConstructRow[];
}

/** A generated table row, before it is counted. */
interface TableRow {
  /** The window's line-start bytes. */
  readonly prefix: string;
  /** The window's line-end bytes. */
  readonly suffix: string;
  /** What the window says about a line that matches it. */
  readonly verdict: boolean;
}

/**
 * Whether every line matching `wide` also matches `narrow` - the
 * subsumption that makes two rows of one state comparable.
 * @param narrow - the possibly shorter window
 * @param wide - the possibly longer window
 * @returns true when `wide`'s matches are a subset of `narrow`'s
 */
function subsumes(narrow: TableRow, wide: TableRow): boolean {
  return (
    wide.prefix.startsWith(narrow.prefix) && wide.suffix.endsWith(narrow.suffix)
  );
}

/**
 * The contradictions among one state's table rows.
 * @param rows - the state's rows, deduplicated
 * @returns how many ordered pairs contradict
 */
function conflictsWithin(rows: readonly TableRow[]): number {
  let conflicts = 0;
  for (const narrow of rows) {
    for (const wide of rows) {
      if (
        narrow !== wide &&
        subsumes(narrow, wide) &&
        narrow.verdict !== wide.verdict
      ) {
        conflicts += 1;
      }
    }
  }
  return conflicts;
}

/**
 * Sweeps the whole grid and reports the census for one alphabet.
 *
 * The state axis is the reachable OPEN-PARAGRAPH states
 * (tests/conformance/reader-context-space.ts), which is the axis the
 * classification grid pins; the states with no open paragraph are one
 * equivalence class the grid enumerates separately, and a seam
 * question is vacuous there because every line at a block start opens
 * something.
 * @param alphabet - which filler set to probe windows against
 * @returns the counts, the per-construct rows and the table size
 */
export function seamWindowCensus(alphabet: SeamCensus["alphabet"]): SeamCensus {
  const fillers =
    alphabet === "registry" ? registryAlphabet() : ordinaryTextAlphabet();
  const lines = constructLines();
  const probes = openParagraphProbes();
  const windowed = new Map<string, number>();
  const wholeLine = new Map<string, number>();
  const bytesFor = new Map<string, number>();
  const byState = new Map<string, Map<string, TableRow>>();
  for (const { reader } of probes) {
    const state = contextKey(reader);
    let rows = byState.get(state);
    if (rows === undefined) {
      rows = new Map<string, TableRow>();
      byState.set(state, rows);
    }
    for (const [construct, line] of lines) {
      const found = minimalWindow(line, reader, fillers);
      if (found.kind === "wholeLine") {
        wholeLine.set(construct, (wholeLine.get(construct) ?? 0) + 1);
        continue;
      }
      windowed.set(construct, (windowed.get(construct) ?? 0) + 1);
      const total = found.window.prefixBytes + found.window.suffixBytes;
      bytesFor.set(construct, Math.max(bytesFor.get(construct) ?? 0, total));
      const prefix = line.slice(0, found.window.prefixBytes);
      const suffix =
        found.window.suffixBytes === 0
          ? ""
          : line.slice(line.length - found.window.suffixBytes);
      rows.set(`${prefix} ${suffix}`, {
        prefix,
        suffix,
        verdict: joinVerdict(line, reader),
      });
    }
  }
  return summarize(alphabet, lines, probes.length, {
    windowed,
    wholeLine,
    bytesFor,
    byState,
  });
}

/** The per-construct tallies one sweep accumulated. */
interface Tallies {
  /** Windowed cells per construct. */
  readonly windowed: ReadonlyMap<string, number>;
  /** Whole-line cells per construct. */
  readonly wholeLine: ReadonlyMap<string, number>;
  /** Longest minimal window per construct. */
  readonly bytesFor: ReadonlyMap<string, number>;
  /** The generated table, by state. */
  readonly byState: ReadonlyMap<string, ReadonlyMap<string, TableRow>>;
}

/**
 * The construct names of some rows, in a fixed order so a roster can
 * be compared against a written-down one.
 * @param rows - the rows to name
 * @returns their construct names, sorted
 */
function byName(rows: readonly ConstructRow[]): string[] {
  return rows
    .map((row) => row.construct)
    .toSorted((left, right) => left.localeCompare(right));
}

/**
 * Turns one sweep's tallies into the census it reports.
 * @param alphabet - which filler set the sweep used
 * @param lines - the constructs, in registry order
 * @param states - how many states were swept
 * @param tallies - what the sweep accumulated
 * @returns the census
 */
function summarize(
  alphabet: SeamCensus["alphabet"],
  lines: ReadonlyArray<[string, string]>,
  states: number,
  tallies: Tallies,
): SeamCensus {
  const rows = lines.map(([construct, line]) => ({
    construct,
    line,
    windowedCells: tallies.windowed.get(construct) ?? 0,
    wholeLineCells: tallies.wholeLine.get(construct) ?? 0,
    windowBytes: tallies.bytesFor.get(construct) ?? 0,
  }));
  let tableEntries = 0;
  let tableConflicts = 0;
  for (const stateRows of tallies.byState.values()) {
    tableEntries += stateRows.size;
    tableConflicts += conflictsWithin([...stateRows.values()]);
  }
  let windowedCells = 0;
  let wholeLineCells = 0;
  let windowBytes = 0;
  for (const row of rows) {
    windowedCells += row.windowedCells;
    wholeLineCells += row.wholeLineCells;
    windowBytes = Math.max(windowBytes, row.windowBytes);
  }
  return {
    alphabet,
    states,
    constructs: lines.length,
    cells: states * lines.length,
    windowedCells,
    wholeLineCells,
    wholeLineConstructs: byName(rows.filter((row) => row.wholeLineCells > 0)),
    alwaysWholeLineConstructs: byName(
      rows.filter((row) => row.windowedCells === 0),
    ),
    windowBytes,
    tableEntries,
    tableConflicts,
    rows,
  };
}

/**
 * The census's own table, one line per construct: the window that
 * decides every state, or how many states admit none.
 *
 * This is what the pinned gate holds, so it is a STRING per row
 * rather than a structure: the row a change moves reads as a
 * sentence in the diff.
 * @param census - one census run
 * @returns one line per construct, in registry order
 */
export function tableLines(census: SeamCensus): string[] {
  return census.rows.map((row) => {
    const verdict =
      row.wholeLineCells === 0
        ? `windowed at ${String(row.windowBytes)} bytes`
        : `whole-line in ${String(row.wholeLineCells)} of ${String(census.states)} states`;
    return `${row.construct}: ${verdict}`;
  });
}

/**
 * The census as the lines a reader sees: one row per construct, then
 * the totals that summarize them.
 * @param census - one census run
 * @returns the report lines, without trailing newlines
 */
function censusReport(census: SeamCensus): string[] {
  return [
    `seam-window census (${census.alphabet} alphabet)`,
    `  ${String(census.cells)} cells = ${String(census.states)} states x ${String(census.constructs)} constructs`,
    ...tableLines(census).map((line) => `  ${line}`),
    `  windowed cells: ${String(census.windowedCells)}`,
    `  whole-line cells: ${String(census.wholeLineCells)}`,
    `  whole-line construct kinds: ${String(census.wholeLineConstructs.length)}`,
    `  construct kinds with no windowed state at all: ${String(census.alwaysWholeLineConstructs.length)}`,
    `  longest window: ${String(census.windowBytes)} bytes`,
    `  generated table entries: ${String(census.tableEntries)}`,
    `  table conflicts: ${String(census.tableConflicts)}`,
  ];
}

if (import.meta.main) {
  for (const alphabet of ["ordinary text", "registry"] as const) {
    for (const line of censusReport(seamWindowCensus(alphabet))) {
      process.stdout.write(`${line}\n`);
    }
  }
}
