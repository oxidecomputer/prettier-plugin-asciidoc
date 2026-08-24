/**
 * The three differential properties from issue #7. For a formatter,
 * correctness is mechanical: it must not crash, it must be idempotent,
 * and it must not change what Asciidoctor renders. `assessCase` runs
 * all three and reports the set of failures, which the harness
 * compares against the quarantine manifest.
 */

import { formatAdoc, renderedHtml } from "../helpers.js";

/** One of the three differential properties a case can fail. */
export type ConformanceProperty = "crash" | "idempotency" | "fidelity";

/** Outcome of running one corpus case through all three properties. */
export interface Assessment {
  /**
   * Failed properties in the fixed order crash, idempotency,
   * fidelity — a set with canonical ordering, so it compares with
   * `toEqual` against manifest entries.
   */
  failures: ConformanceProperty[];
  /**
   * Short human-readable context for the first failure; empty when
   * the case is clean.
   */
  detail: string;
}

/**
 * Runs one corpus input through the three differential properties.
 * A crash short-circuits: idempotency and fidelity are unassessable
 * without a formatted output, so `["crash"]` stands alone. If the
 * HTML oracle itself throws on the ORIGINAL input, fidelity is
 * vacuous (there is no reference rendering) and is skipped — the
 * detail notes it.
 * @param input - raw AsciiDoc (or arbitrary text) corpus case
 * @returns the failure set and a diagnostic string
 */
export async function assessCase(input: string): Promise<Assessment> {
  let first = "";
  let formatError: string | undefined = undefined;
  try {
    first = await formatAdoc(input);
  } catch (error) {
    formatError = String(error);
  }
  if (formatError !== undefined) {
    return { failures: ["crash"], detail: `format threw: ${formatError}` };
  }
  const failures: ConformanceProperty[] = [];
  const details: string[] = [];
  try {
    const second = await formatAdoc(first);
    if (second !== first) {
      failures.push("idempotency");
      details.push("second format pass changed the output");
    }
  } catch (error) {
    // Crashing on our OWN output is a crash, not an idempotency
    // wrinkle — the formatter produced text it cannot re-parse.
    return {
      failures: ["crash"],
      detail: `reformat threw: ${String(error)}`,
    };
  }
  let before: string | undefined = undefined;
  try {
    before = await renderedHtml(input);
  } catch (error) {
    details.push(`oracle rejected original input: ${String(error)}`);
  }
  if (before !== undefined && (await renderedHtmlSafe(first)) !== before) {
    failures.push("fidelity");
    details.push("Asciidoctor renders formatted output differently");
  }
  return { failures, detail: details.join("; ") };
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
