/**
 * The registry sweep: the documents `scripts/shape-registry.ts`
 * generates, run through the differential properties that
 * `tests/conformance/properties.ts` runs on vendored corpus files.
 *
 * The two suites do not overlap. The corpus is real prose, so it says
 * how the formatter behaves on documents people wrote; the registry
 * grids are built to reach coordinates no corpus contains (a block
 * that never terminates, a near miss beside its valid twin, the
 * ingest bytes Asciidoctor erases before a vendored file could ever
 * carry them). Shape-diff already runs those coordinates, but only
 * for base-vs-head byte equality: it can hold the whole grid stable
 * while every row of it crashes. This module supplies the missing
 * verdict, so a grid coordinate that throws, formats unstably, or
 * changes what Asciidoctor renders is a red test rather than a stable
 * wrong answer.
 *
 * Three properties, not five. `reading`, the reflow
 * re-classification invariant, stays a corpus-suite property, so a
 * sweep failure set is always a subset of the manifest's five-property
 * vocabulary rather than a different vocabulary of its own.
 * `reduction` (issue #220) stays a corpus-suite property too. This grid
 * is built OF near-miss delimiters, and the reduction order reads a
 * delimiter's minimum as a constant where the printer derives it from
 * the block's content, so the two disagree about which run is redundant
 * on a slice of these rows. Part of that slice is real printer
 * behaviour rather than a measure limit (issue #226), and the measure
 * cannot separate the two here. The count, the classification and the
 * extension that would fix it are in `reduction-order.ts` (its "WHERE
 * IT IS NOT RUN" paragraph), which is the one place they are written.
 *
 * Failures are held by `registry-sweep-quarantine.json` on the same
 * exact-agreement terms as `quarantine.json`: a coordinate must fail
 * exactly the properties its entry names, so a fixed gap turns the
 * row red until the entry is deleted.
 *
 * The row sets are TIERED because the pair grid is quadratic in the
 * construct alphabet. `defaultTierRows()` is what an always-on suite
 * can afford; `deepTierRows()` is both grids and belongs to a
 * `.deep.test.ts` entry (see vitest.sweep.config.ts). The split is a
 * budget ruling, not a coverage claim: every deep row is a row the
 * default tier would run if it were free.
 *
 * A LIBRARY module: the row sets and the verdict, with the gates that
 * consume them living in their own test files.
 */

import type { ByteOperatorEntry } from "../../scripts/shape-registry-byte-operators.js";
import {
  BYTE_OPERATORS,
  PAIR_BYTE_OPERATORS,
  pairGrid,
  standingGrid,
  type Shape,
} from "../../scripts/shape-registry.js";
import { formatAdoc, renderedHtml } from "../helpers.js";
import { crossByteOperators } from "./generated-sweep.js";
import type { ConformanceProperty } from "./properties.js";
import { loadQuarantine, type QuarantineEntry } from "./quarantine.js";

/** One generated document, ready to run the properties against. */
export interface SweepRow {
  /**
   * The registry coordinate. A byte-perturbed row appends
   * `@<operatorId>` to the coordinate it was derived from, so the
   * manifest can name the perturbed row and the clean one separately.
   */
  readonly id: string;
  /** The whole document. */
  readonly input: string;
  /**
   * True when the fidelity property is SKIPPED for this row. The
   * registry sets it for coordinates whose render comparison is
   * vacuous or already known to diverge; a byte operator does not
   * change that, so perturbed rows inherit it from their base.
   */
  readonly renderBlind: boolean;
}

/** One row's verdict. Rows that fail nothing mint no entry. */
export interface SweepFailure {
  /** The row's coordinate. */
  readonly id: string;
  /**
   * The properties it failed, in the manifest's canonical order
   * (crash, idempotency, fidelity), so the result compares against a
   * manifest entry with `toEqual`.
   */
  readonly fails: ConformanceProperty[];
}

/** Repo-relative manifest path for the sweep's known failures. */
export const SWEEP_QUARANTINE_PATH =
  "tests/conformance/registry-sweep-quarantine.json";

/**
 * Reads the sweep's own quarantine manifest. A separate manifest from
 * the corpus suite's because the two suites key by different id
 * spaces: a corpus case id names a vendored file, a sweep id names a
 * grid coordinate, and one file mixing both would let a rename in
 * either space silently excuse a failure in the other.
 * @returns map from sweep row id to its expected-failure entry
 */
export function loadSweepQuarantine(): Map<string, QuarantineEntry> {
  return loadQuarantine(SWEEP_QUARANTINE_PATH);
}

/**
 * The rows an always-on suite runs: the standing grid, clean and
 * under every byte operator.
 *
 * The pair grid is entirely a deep-tier concern. The standing grid
 * crossed with the operators already spends the whole budget on its
 * own; the pair grid's narrowest useful slice, its unperturbed
 * `doc`-container rows, would roughly double that, and the full pair
 * product is orders of magnitude past it again. What the standing
 * grid buys with the room is the byte operators, the one dimension no
 * other gate reaches at all.
 * @returns the default-tier rows, in a stable order
 */
export function defaultTierRows(): SweepRow[] {
  return crossed(standingGrid(), BYTE_OPERATORS);
}

/**
 * Every row this sweep consumes: the standing grid under the whole
 * byte-operator dimension, then the pair grid under the shorter set
 * that grid declares.
 *
 * The two grids cross with DIFFERENT operator sets, which is the pair
 * grid's own decision and written down at `PAIR_BYTE_OPERATORS`: the
 * pair product is quadratic in the construct alphabet, and the seven
 * operators it does not carry were measured to change no row's
 * verdict there. `registry-sweep.test.ts` pins how many rows this
 * yields, so a grid dropped from the list is a red test rather than a
 * faster run.
 * @returns the deep-tier rows, in a stable order
 */
export function deepTierRows(): SweepRow[] {
  return [
    ...crossed(standingGrid(), BYTE_OPERATORS),
    ...crossed(pairGrid(), PAIR_BYTE_OPERATORS),
  ];
}

/**
 * Runs the three properties over the given rows.
 *
 * Sequential, one row at a time: both `formatAdoc` and `renderedHtml`
 * are CPU-bound work on this thread, so overlapping the awaits buys
 * no wall time and would only make a crashing row harder to locate.
 * @param rows - the rows to assess
 * @returns one entry per FAILING row, in row order; a clean sweep
 *   returns the empty array
 */
export async function sweepFailures(
  rows: readonly SweepRow[],
): Promise<SweepFailure[]> {
  const failures: SweepFailure[] = [];
  for (const row of rows) {
    // eslint-disable-next-line no-await-in-loop -- see the JSDoc
    const fails = await rowFailures(row);
    if (fails.length > 0) {
      failures.push({ id: row.id, fails });
    }
  }
  return failures;
}

/**
 * The verdict for one row. A crash stands alone: without a formatted
 * output the other two properties are unassessable, and crashing on
 * our OWN output is still a crash, so both throws come back the same
 * way.
 *
 * The oracle is consulted only when the formatter changed bytes. A
 * byte-identical output renders identically by construction, and the
 * two render calls it would take are the sweep's dominant per-row
 * cost, so skipping them is what makes a grid of this size runnable
 * at all.
 * @param row - the row to assess
 * @returns the failed properties in canonical order
 */
async function rowFailures(row: SweepRow): Promise<ConformanceProperty[]> {
  const formatted = await formatTwice(row.input);
  if (formatted.kind === "crashed") {
    return ["crash"];
  }
  const { once, twice } = formatted;
  const fails: ConformanceProperty[] = [];
  if (twice !== once) {
    fails.push("idempotency");
  }
  if (
    !row.renderBlind &&
    once !== row.input &&
    !(await sameRender(row.input, once))
  ) {
    fails.push("fidelity");
  }
  return fails;
}

/**
 * The two format passes, or the crash that replaces both of them. A
 * union rather than a pair of maybe-strings: there is no state where
 * one pass exists and the other does not, and this way no caller can
 * read a pass that never ran.
 */
type FormatOutcome =
  | {
      /** Discriminant: one of the two passes threw. */
      readonly kind: "crashed";
    }
  | {
      /** Discriminant: both passes returned. */
      readonly kind: "formatted";
      /** The formatter's output for the row's document. */
      readonly once: string;
      /** The formatter's output for `once`. */
      readonly twice: string;
    };

/**
 * Formats the document, then formats the result. Both throws come
 * back as the same crash: a formatter that cannot re-parse its own
 * output has produced bad text, not merely an unstable one.
 * @param input - the row's document
 * @returns the two passes, or the crash verdict
 */
async function formatTwice(input: string): Promise<FormatOutcome> {
  try {
    const once = await formatAdoc(input);
    return { kind: "formatted", once, twice: await formatAdoc(once) };
  } catch {
    return { kind: "crashed" };
  }
}

/**
 * The fidelity comparison: Asciidoctor must render the formatted
 * output the way it renders the input.
 *
 * Two asymmetric throws, matching `renderedHtmlSafe` in
 * properties.ts. A throw on the INPUT means there is no reference
 * rendering, so the property is vacuous and the row passes; a throw
 * on OUR output is a difference, because the original rendered and
 * the formatted version does not.
 * @param input - the row's document
 * @param formatted - the once-formatted output
 * @returns true when the two render the same, or when the oracle
 *   rejected the input outright
 */
async function sameRender(input: string, formatted: string): Promise<boolean> {
  const before = await renderedHtmlSafe(input);
  if (before === undefined) {
    return true;
  }
  return (await renderedHtmlSafe(formatted)) === before;
}

/**
 * Renders one document, reporting an oracle throw as undefined so the
 * caller decides what a rejection means on each side of the
 * comparison.
 * @param document - the document to render
 * @returns the normalized HTML, or undefined when rendering throws
 */
async function renderedHtmlSafe(document: string): Promise<string | undefined> {
  try {
    return await renderedHtml(document);
  } catch {
    return undefined;
  }
}

/**
 * Crosses shapes with one byte-operator set, through the shared
 * crossing in `generated-sweep.ts`.
 *
 * `family` is deliberately dropped on the way: it is shape-diff's
 * base-vs-head vocabulary, and a row being an expected PARITY diff
 * says nothing about whether it satisfies the properties.
 * `renderBlind` is carried, because a perturbed row is blind exactly
 * where the shape it came from was.
 * @param shapes - the realized grid to cross
 * @param operators - the operator set that grid crosses with
 * @returns the clean and perturbed rows, in a stable order
 */
function crossed(
  shapes: readonly Shape[],
  operators: readonly ByteOperatorEntry[],
): SweepRow[] {
  return crossByteOperators(shapes, operators, (shape, id, input) => ({
    id,
    input,
    renderBlind: shape.renderBlind,
  }));
}
