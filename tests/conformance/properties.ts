/**
 * The differential properties from issue #7, plus the reflow
 * re-classification invariant from issue #58. For a formatter,
 * correctness is mechanical: it must not crash, it must be idempotent,
 * it must not change what Asciidoctor renders, and it must not change
 * what its own reader reads the document AS. `assessCase` runs all
 * four and reports the set of failures, which the harness compares
 * against the quarantine manifest.
 */

import { formatAdoc, renderedHtml } from "../helpers.js";
import { readingBreaches } from "../lib/reading.js";

/** One of the four differential properties a case can fail. */
export type ConformanceProperty =
  | "crash"
  | "idempotency"
  | "fidelity"
  | "reading";

/** Outcome of running one corpus case through all four properties. */
export interface Assessment {
  /**
   * Failed properties in the fixed order crash, idempotency,
   * fidelity, reading - a set with canonical ordering, so it compares
   * with `toEqual` against manifest entries.
   */
  failures: ConformanceProperty[];
  /**
   * Short human-readable context for the first failure; empty when
   * the case is clean.
   */
  detail: string;
}

/** One property's verdict: whether it failed, and what to say. */
interface Verdict {
  /** Whether the property failed. */
  failed: boolean;
  /** What to add to the assessment's detail, if anything. */
  detail: string | undefined;
}

/**
 * Runs one corpus input through the four differential properties.
 * A crash short-circuits: the others are unassessable without a
 * formatted output, so `["crash"]` stands alone. If the HTML oracle
 * itself throws on the ORIGINAL input, fidelity is vacuous (there is
 * no reference rendering) and is skipped - the detail notes it.
 * @param input - raw AsciiDoc (or arbitrary text) corpus case
 * @returns the failure set and a diagnostic string
 */
export async function assessCase(input: string): Promise<Assessment> {
  const formatted = await formattedPair(input);
  if (formatted.crash !== undefined) {
    return { failures: ["crash"], detail: formatted.crash };
  }
  const { first, second } = formatted;
  const failures: ConformanceProperty[] = [];
  const details: string[] = [];
  if (second !== first) {
    failures.push("idempotency");
    details.push("second format pass changed the output");
  }
  const fidelity = await fidelityVerdict(input, first);
  if (fidelity.failed) {
    failures.push("fidelity");
  }
  if (fidelity.detail !== undefined) {
    details.push(fidelity.detail);
  }
  const reading = readingVerdict(input, first, second);
  if (reading.failed) {
    failures.push("reading");
  }
  if (reading.detail !== undefined) {
    details.push(reading.detail);
  }
  return { failures, detail: details.join("; ") };
}

/**
 * Format the case, then format the result.
 *
 * Crashing on our OWN output is a crash, not an idempotency wrinkle -
 * the formatter produced text it cannot re-parse - so both throws
 * come back the same way.
 * @param input - the corpus case
 * @returns the two passes, or the crash detail that stands alone
 */
async function formattedPair(
  input: string,
): Promise<{ first: string; second: string; crash: string | undefined }> {
  let first = "";
  try {
    first = await formatAdoc(input);
  } catch (error) {
    return { first, second: "", crash: `format threw: ${String(error)}` };
  }
  try {
    return { first, second: await formatAdoc(first), crash: undefined };
  } catch (error) {
    return { first, second: "", crash: `reformat threw: ${String(error)}` };
  }
}

/**
 * The fidelity property: Asciidoctor must render the formatted output
 * the way it renders the input.
 * @param input - the corpus case
 * @param formatted - the once-formatted output
 * @returns the verdict; vacuous when the oracle rejected the input
 */
async function fidelityVerdict(
  input: string,
  formatted: string,
): Promise<Verdict> {
  let before: string | undefined = undefined;
  let rejection: string | undefined = undefined;
  try {
    before = await renderedHtml(input);
  } catch (error) {
    rejection = `oracle rejected original input: ${String(error)}`;
  }
  if (before === undefined) {
    return { failed: false, detail: rejection };
  }
  if ((await renderedHtmlSafe(formatted)) === before) {
    return { failed: false, detail: undefined };
  }
  return {
    failed: true,
    detail: "Asciidoctor renders formatted output differently",
  };
}

/**
 * The REFLOW RE-CLASSIFICATION property (issue #58): every emitted
 * line must re-read as the kind of line the source read as.
 *
 * It needs no oracle - its authority is our own classifier, traced
 * through the reader - and it names WHAT changed and WHERE rather
 * than only that something did. The line is the earlier document's,
 * so `p1 line 412 [cont] -> []` points into the corpus case itself.
 * See tests/lib/reading.ts for the projection and docs/harnesses.md
 * for what it cannot see.
 * @param input - the corpus case
 * @param first - the once-formatted output
 * @param second - the twice-formatted output
 * @returns the verdict
 */
function readingVerdict(input: string, first: string, second: string): Verdict {
  const breaches = readingBreaches(input, first, second);
  if (breaches.length === 0) {
    return { failed: false, detail: undefined };
  }
  const spelled = breaches
    .map(
      (breach) =>
        `${breach.pass} line ${String(breach.line)} ${breach.signature}`,
    )
    .join(", ");
  return {
    failed: true,
    detail: `the formatted output re-reads differently: ${spelled}`,
  };
}

/**
 * Renders formatted output for the fidelity comparison, treating an
 * oracle crash on OUR output as a difference: the original rendered,
 * the formatted version does not, which is a fidelity break however
 * you slice it.
 * @param formatted - formatter output for the case
 * @returns the normalized HTML, or undefined when rendering throws
 */
async function renderedHtmlSafe(
  formatted: string,
): Promise<string | undefined> {
  try {
    return await renderedHtml(formatted);
  } catch {
    return undefined;
  }
}
