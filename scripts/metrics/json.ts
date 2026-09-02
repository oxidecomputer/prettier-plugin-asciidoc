/**
 * Narrowing helpers for the JSON this script reads back from other
 * tools (eslint, knip, jscpd).
 *
 * The narrowing is done with type PREDICATES rather than `as`
 * assertions: the scorecard counts `as` assertions as an escape hatch,
 * and a measuring tool that cheats on the thing it measures is
 * worthless. `instanceof Object` is how "a non-null object" is spelled
 * without writing `null`, which the repository's lint config bans.
 *
 * There is exactly ONE assertion here, in `parseJson`:
 * `JSON.parse` is typed `any`, and `as unknown` WIDENS that to the type
 * every caller then has to narrow. It is the opposite of the escape
 * hatch the metric is about — it takes the `any` away.
 */
import { NOT_FOUND } from "./model.js";

/**
 * Narrow an unknown value to an object with unknown properties.
 * @param value - anything, typically straight out of `JSON.parse`
 * @returns whether it is a non-null, non-primitive object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value instanceof Object;
}

/**
 * Narrow an unknown value to an array of unknown elements.
 * @param value - anything, typically straight out of `JSON.parse`
 * @returns whether it is an array
 */
export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Parse JSON without throwing: a tool that printed a banner, a
 * progress line or nothing at all should degrade to "no measurement",
 * never to a crashed scorecard.
 * @param text - the tool's stdout, possibly with leading noise
 * @returns the parsed value, or undefined when it was not JSON
 */
export function parseJson(text: string): unknown {
  const from = firstOf(text.indexOf("{"), text.indexOf("["));
  if (from === NOT_FOUND) {
    return undefined;
  }
  try {
    return JSON.parse(text.slice(from)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The earlier of two `indexOf` results, ignoring misses.
 * @param left - one index, or NOT_FOUND
 * @param right - the other index, or NOT_FOUND
 * @returns the smaller present index, or NOT_FOUND when both missed
 */
function firstOf(left: number, right: number): number {
  if (left === NOT_FOUND) {
    return right;
  }
  if (right === NOT_FOUND) {
    return left;
  }
  return Math.min(left, right);
}

/**
 * Recover a child process's stdout from the error `execFileSync`
 * throws on a non-zero exit. eslint exits non-zero whenever any file
 * has an error-severity message, and its JSON report — the thing we
 * came for — is on stdout regardless.
 * @param error - the value thrown by `execFileSync`
 * @returns the captured stdout, when there was any
 */
export function stdoutOf(error: unknown): string | undefined {
  if (!isObject(error)) {
    return undefined;
  }
  const { stdout } = error;
  return typeof stdout === "string" && stdout !== "" ? stdout : undefined;
}

/** A strict parse: the value, or the syntax error to report. */
export interface StrictParse {
  /** The parsed value, or undefined when the text is not JSON. */
  readonly value: unknown;
  /** The syntax error, prefixed with the file's name, or undefined. */
  readonly fault: string | undefined;
}

/**
 * `JSON.parse` with the syntax error reported rather than swallowed.
 *
 * Deliberately not {@link parseJson}, which is documented for TOOL
 * STDOUT: that one skips leading noise up to the first `[` and
 * degrades a syntax error to "no measurement". Those are the right
 * semantics for knip's output and the wrong ones for a REVIEWED FILE
 * in the repository, where a file that reads short is the failure the
 * whole registry family exists to prevent.
 * @param label - the file's repo-relative path, for the message
 * @param text - the file's bytes
 * @returns the parsed value, or the syntax error to report
 */
export function strictJson(label: string, text: string): StrictParse {
  try {
    return { value: JSON.parse(text), fault: undefined };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { value: undefined, fault: `${label}: not valid JSON (${detail})` };
  }
}
