/**
 * The RECORDED MINIMUMS: one committed number per source file for
 * line coverage and one for mutation score, plus the classified list
 * of what is NOT going to reach 100%.
 *
 * A recorded minimum is the lowest score a file is allowed to report.
 * The name is the contract, spelled out rather than coined, so a
 * reader meeting the file for the first time needs no glossary.
 *
 * Two metrics, ONE model, because they fail the same way. Both are
 * ratcheted HARD — below the recorded minimum is exit 1, not a
 * warning. The
 * design doc proposed soft ratchets; the maintainer's ruling
 * (2026-08-24) upgraded them, and the argument is the one this whole
 * directory is built on: a soft ratchet is a printout, and a printout
 * nobody has to answer for drifts. What makes hardness affordable is
 * not a lower threshold, it is the EXCEPTIONS list — the honest
 * answer to "some code cannot be reasonably tested without
 * contortions" is to name that code, classify it, and say why, rather
 * than to slacken the number for every other file at the same time.
 *
 * The taxonomy, in the maintainer's words:
 *
 * - **`now`** — fixable now. A test would kill it today and nobody
 *   has written it. The row is a TODO with a place to live.
 * - **`when`** — fixable when some condition holds. The reason field
 *   carries the TRIGGER, so the row can be re-read the day the
 *   condition changes rather than becoming folklore.
 * - **`never`** — not practical to fix. An equivalent mutant, or a
 *   branch the type system already forbids, where the only "test" is
 *   a test-only construction of unreachable state.
 *
 * The minimums themselves are MEASURED-NOW values rounded DOWN (see
 * {@link roundDown}), never aspirations: a minimum above the measured
 * score fails on the commit that writes it, and a minimum set to the
 * exact measurement fails on timing flap alone (a mutant that times
 * out on a loaded machine and is killed on an idle one moves the
 * score by a tenth). Raising a minimum RIDES THE COMMIT THAT EARNS
 * IT — that is the whole ratchet.
 *
 * Where the two metrics differ is only in cost, and so in WHO checks
 * them: coverage is seconds, so `bun run coverage` runs it and CI's
 * blocking job runs that; mutation is ~11 minutes, so the comparison
 * is a post-run step of `bun run mutate`, which is manual and
 * periodic. `bun run metrics` checks neither number — it never runs
 * the suite — but it does check the file's COMPLETENESS, which is
 * cheap and is the direction a minimums file rots in: a new source file
 * with no row is a file with no recorded minimum at all.
 *
 * Everything here reads the MEASURED checkout, so a base revision
 * with no minimums file reads as undefined — no minimums — and this
 * counter ratchets from absent instead of from zero.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isArray, isObject, strictJson } from "./json.js";
import { ZERO } from "./model.js";

/** Where the minimums file lives, in every checkout. */
export const MINIMUMS_FILE = "scripts/metrics/score-minimums.json";

// Exactly the keys the file, a file row and an exception row may
// carry. Unknown keys are rejected rather than ignored: a typo'd key
// is silently dropped, and a dropped minimum is a minimum of zero.
const TOP_KEYS = new Set(["note", "files", "exceptions"]);
const ROW_KEYS = new Set(["coverage", "mutation"]);
const EXCEPTION_KEYS = ["file", "what", "class", "reason"];

// The one key an exception row MAY carry on top of those four:
// `formerly`, the citations in its `what` that name a tree the move
// this row records has already left. `bun run internal-citations`
// reads it and exempts exactly those from the line check; nothing
// here reads it, and it is listed only so a row carrying one is not
// rejected as a typo.
const OPTIONAL_EXCEPTION_KEYS = new Set(["formerly"]);

/** The three ways a gap between the minimum and 100% is classified. */
const CLASSES = ["now", "when", "never"];

// Percentages, for the range check. Named because
// `no-magic-numbers` is on and because 100 appearing bare in a
// comparison is exactly the sort of number a reader has to guess at.
const LOWEST = 0;
const HIGHEST = 100;

// Minimums are rounded DOWN to a tenth of a percent: see the module
// comment on timing flap.
const TENTHS = 10;

/** One file's two minimums. */
interface MinimumRow {
  /** Lowest acceptable v8 LINE coverage, as a percentage. */
  readonly coverage: number;
  /** Lowest acceptable StrykerJS mutation score, as a percentage. */
  readonly mutation: number;
}

/** One classified reason a file does not reach 100%. */
interface MinimumException {
  /** The file it is about, relative to the checkout root. */
  readonly file: string;
  /** The mutant or the region: enough to find it again. */
  readonly what: string;
  /** `now`, `when` or `never`; see the module comment. */
  readonly class: string;
  /** Why — and, for `when`, the trigger that would change it. */
  readonly reason: string;
}

/** A minimums file that read as one. */
export interface Minimums {
  /** Minimums by file path, relative to the checkout root. */
  readonly files: ReadonlyMap<string, MinimumRow>;
  /** The classified exceptions, in file order. */
  readonly exceptions: readonly MinimumException[];
}

/** A minimums read: the minimums, or every reason it is not a minimums file. */
export interface MinimumsRead {
  /** The minimums, or undefined when the file could not be read as one. */
  readonly minimums: Minimums | undefined;
  /** One message per fault; empty means it parsed and validated. */
  readonly faults: readonly string[];
}

/** What this module contributes to one revision's snapshot. */
export interface MinimumsFacts {
  /** Files carrying a recorded minimum, or undefined with no file. */
  readonly recorded: number | undefined;
  /** Classified exceptions, or undefined where there is no file. */
  readonly exceptions: number | undefined;
  /**
   * Why the file could not be read, or where it has gone stale
   * against the source tree. A gate at HEAD; at an archived base
   * nothing reads it.
   */
  readonly faults: readonly string[];
}

/**
 * Round a measured percentage DOWN to a tenth, which is what a
 * recorded minimum is allowed to be.
 *
 * Down, not nearest: a minimum is a promise the next run can keep,
 * and rounding 98.65 up to 98.7 makes the very run that wrote it
 * fail.
 * @param percent - the measured percentage
 * @returns the same number rounded down to one decimal place
 */
export function roundDown(percent: number): number {
  return Math.floor(percent * TENTHS) / TENTHS;
}

/**
 * Validate one file row.
 * @param raw - the parsed value at that key
 * @param file - the key, for the message
 * @returns the row, or the reason it is not one
 */
function validateRow(
  raw: unknown,
  file: string,
): { row: MinimumRow | undefined; fault: string | undefined } {
  const at = `${MINIMUMS_FILE}: files[${JSON.stringify(file)}]`;
  if (!isObject(raw) || isArray(raw)) {
    return { row: undefined, fault: `${at}: not an object` };
  }
  const unknown = Object.keys(raw).filter((key) => !ROW_KEYS.has(key));
  if (unknown.length > ZERO) {
    return {
      row: undefined,
      fault: `${at}: unknown key(s) ${unknown.join(", ")}`,
    };
  }
  const { coverage, mutation } = raw;
  for (const [name, value] of [
    ["coverage", coverage],
    ["mutation", mutation],
  ] as const) {
    if (typeof value !== "number" || value < LOWEST || value > HIGHEST) {
      return {
        row: undefined,
        fault: `${at}: ${name} must be a percentage between ${String(LOWEST)} and ${String(HIGHEST)}`,
      };
    }
  }
  if (typeof coverage !== "number" || typeof mutation !== "number") {
    // Unreachable given the loop above; present so the returned row is
    // typed without an assertion, which this scorecard counts.
    return { row: undefined, fault: `${at}: malformed` };
  }
  return { row: { coverage, mutation }, fault: undefined };
}

/**
 * Validate one exception row.
 * @param raw - one element of the exceptions array
 * @param index - its position, for the message
 * @returns the exception, or the reason it is not one
 */
function validateException(
  raw: unknown,
  index: number,
): { exception: MinimumException | undefined; fault: string | undefined } {
  const at = `${MINIMUMS_FILE}: exceptions[${String(index)}]`;
  if (!isObject(raw) || isArray(raw)) {
    return { exception: undefined, fault: `${at}: not an object` };
  }
  const unknown = Object.keys(raw).filter(
    (key) => !EXCEPTION_KEYS.includes(key) && !OPTIONAL_EXCEPTION_KEYS.has(key),
  );
  if (unknown.length > ZERO) {
    return {
      exception: undefined,
      fault: `${at}: unknown key(s) ${unknown.join(", ")}`,
    };
  }
  const missing = EXCEPTION_KEYS.filter((key) => {
    const value: unknown = raw[key];
    return typeof value !== "string" || value === "";
  });
  if (missing.length > ZERO) {
    return {
      exception: undefined,
      fault: `${at}: missing or non-string ${missing.join(", ")}`,
    };
  }
  const { file, what, class: classification, reason } = raw;
  if (
    typeof file !== "string" ||
    typeof what !== "string" ||
    typeof classification !== "string" ||
    typeof reason !== "string"
  ) {
    // Unreachable given `missing`; present so the row is typed
    // without an assertion.
    return { exception: undefined, fault: `${at}: malformed` };
  }
  if (!CLASSES.includes(classification)) {
    return {
      exception: undefined,
      fault: `${at}: class must be one of ${CLASSES.join(", ")} (fixable now / fixable when <condition> / not practical to fix)`,
    };
  }
  return {
    exception: { file, what, class: classification, reason },
    fault: undefined,
  };
}

/** The minimums file's two sections, before their rows are validated. */
interface MinimumsShape {
  /** The `files` object, keyed by source path. */
  readonly files: Record<string, unknown>;
  /** The `exceptions` array. */
  readonly exceptions: readonly unknown[];
}

/**
 * Check the file's outer shape: the two sections and no unknown key.
 * @param value - the parsed file
 * @returns the two sections, or the reason it is not a minimums file
 */
function readShape(value: unknown): {
  shape: MinimumsShape | undefined;
  fault: string | undefined;
} {
  if (!isObject(value) || isArray(value)) {
    return { shape: undefined, fault: `${MINIMUMS_FILE}: not a JSON object` };
  }
  const unknown = Object.keys(value).filter((key) => !TOP_KEYS.has(key));
  if (unknown.length > ZERO) {
    return {
      shape: undefined,
      fault: `${MINIMUMS_FILE}: unknown key(s) ${unknown.join(", ")}`,
    };
  }
  const { files, exceptions } = value;
  if (!isObject(files) || isArray(files)) {
    return {
      shape: undefined,
      fault: `${MINIMUMS_FILE}: files must be an object keyed by source path`,
    };
  }
  if (!isArray(exceptions)) {
    return {
      shape: undefined,
      fault: `${MINIMUMS_FILE}: exceptions must be an array`,
    };
  }
  return { shape: { files, exceptions }, fault: undefined };
}

/**
 * Validate every exception row.
 * @param raw - the `exceptions` array
 * @returns the rows, and one fault per row that is not one
 */
function readExceptions(raw: readonly unknown[]): {
  exceptions: MinimumException[];
  faults: string[];
} {
  const exceptions: MinimumException[] = [];
  const faults: string[] = [];
  for (const [index, element] of raw.entries()) {
    const { exception, fault } = validateException(element, index);
    if (exception === undefined) {
      faults.push(fault ?? `${MINIMUMS_FILE}: malformed`);
    } else {
      exceptions.push(exception);
    }
  }
  return { exceptions, faults };
}

/**
 * Read one checkout's minimums file, STRICTLY.
 *
 * A syntax error, a wrong shape or a malformed row is a FAULT rather
 * than a row to skip, for the reason every registry here is strict: a
 * file that reads SHORT holds fewer minimums, and fewer minimums is the
 * direction that looks green.
 *
 * A MISSING file is not a fault here — it is simply no minimums, which
 * is what lets an archived base ratchet from absent. Whether HEAD may
 * be missing it is `gates.ts`'s decision.
 * @param root - the measured checkout root
 * @returns the minimums, or every reason the file is not a minimums file
 */
export function readMinimums(root: string): MinimumsRead {
  const file = path.join(root, MINIMUMS_FILE);
  if (!existsSync(file)) {
    return { minimums: undefined, faults: [] };
  }
  const { value, fault } = strictJson(
    MINIMUMS_FILE,
    readFileSync(file, "utf8"),
  );
  if (fault !== undefined) {
    return { minimums: undefined, faults: [fault] };
  }
  const { shape, fault: shapeFault } = readShape(value);
  if (shape === undefined) {
    return {
      minimums: undefined,
      faults: [shapeFault ?? `${MINIMUMS_FILE}: malformed`],
    };
  }
  const { files: rawFiles, exceptions: rawExceptions } = shape;
  const faults: string[] = [];
  const files = new Map<string, MinimumRow>();
  for (const [name, raw] of Object.entries(rawFiles)) {
    const { row, fault: rowFault } = validateRow(raw, name);
    if (row === undefined) {
      faults.push(rowFault ?? `${MINIMUMS_FILE}: malformed`);
    } else {
      files.set(name, row);
    }
  }
  const { exceptions, faults: exceptionFaults } = readExceptions(rawExceptions);
  faults.push(...exceptionFaults);
  // A malformed row invalidates the FILE, not just that row: a short
  // minimums file passes every comparison it no longer makes.
  return faults.length > ZERO
    ? { minimums: undefined, faults }
    : { minimums: { files, exceptions }, faults: [] };
}

/**
 * The minimums file's COMPLETENESS against the source tree.
 *
 * The only rot a cheap check can see, and the one that matters: a
 * source file with no row has no minimum, and a row naming a file that
 * is gone makes the file read as an audit of code that no longer
 * exists. The NUMBERS are checked by the runs that measure them.
 * @param minimums - the minimums, as read from that checkout
 * @param sourceFiles - every measured `src` file, root-relative
 * @returns one message per missing or stale row
 */
export function minimumsStaleness(
  minimums: Minimums,
  sourceFiles: readonly string[],
): string[] {
  const failures: string[] = [];
  const present = new Set(sourceFiles);
  for (const file of sourceFiles) {
    if (!minimums.files.has(file)) {
      failures.push(
        `${MINIMUMS_FILE}: ${file} has no recorded minimum — a source file with none has a minimum of zero. Measure it (\`bun run coverage\`, \`bun run mutate\`) and record the rounded-down numbers`,
      );
    }
  }
  for (const file of minimums.files.keys()) {
    if (!present.has(file)) {
      failures.push(
        `${MINIMUMS_FILE}: files names ${file}, which is not a measured source file (stale row — delete it)`,
      );
    }
  }
  for (const exception of minimums.exceptions) {
    if (!present.has(exception.file)) {
      failures.push(
        `${MINIMUMS_FILE}: exception names ${exception.file}, which is not a measured source file (stale exception — delete it)`,
      );
    }
  }
  return failures;
}

/**
 * Measure one checkout's minimums file.
 * @param root - the measured checkout root
 * @param sourceFiles - every measured `src` file, root-relative
 * @returns the counts and every fault
 */
export function readMinimumsFacts(
  root: string,
  sourceFiles: readonly string[],
): MinimumsFacts {
  const { minimums, faults } = readMinimums(root);
  if (minimums === undefined) {
    // A MISSING file is silence to {@link readMinimums} — that is what
    // lets an archived base ratchet from absent — and a FAULT here,
    // because at HEAD "there are no minimums" is the shape a whole gate
    // family takes when somebody deletes one file. `gates.ts` asks
    // this only of THIS repository.
    return {
      recorded: undefined,
      exceptions: undefined,
      faults:
        faults.length > ZERO
          ? faults
          : [
              `${MINIMUMS_FILE}: not found, so no file has a recorded coverage or mutation minimum`,
            ],
    };
  }
  return {
    recorded: minimums.files.size,
    exceptions: minimums.exceptions.length,
    faults: minimumsStaleness(minimums, sourceFiles),
  };
}

/** Which of the two minimums a comparison is about. */
export type Metric = "coverage" | "mutation";

/** What one minimums comparison found. */
export interface MinimumComparison {
  /** One message per file measured BELOW its recorded minimum; exit 1. */
  readonly below: readonly string[];
  /** One message per recorded file the run did not measure; exit 2. */
  readonly unmeasured: readonly string[];
  /** One message per file risen enough to be worth re-recording. */
  readonly liftable: readonly string[];
}

// How far above its recorded minimum a file may drift before the
// comparison suggests re-recording it. A tenth is the flap band; a
// whole point is usually a real move somebody made.
//
// USUALLY, and the exception is measured: two full mutation runs of
// one unchanged tree reported `src/parse/lines/open-style.ts` at
// 82.08 and at 83.2, because a loaded machine turns SURVIVED mutants
// into TIMEOUTs and a timeout counts as beaten. So a mutation
// suggestion is a prompt to check, never an instruction: raise the
// number only when a change in the diff explains the gain. The
// recorded minimum itself held on both runs, which is what rounding
// down conservatively buys.
const LIFT_MARGIN = 1;

/**
 * Compare one run's measurements against the minimums.
 *
 * A file the run did NOT measure is `unmeasured`, never a pass: a
 * gate that goes quiet when its input disappears is not a gate, and
 * "the report did not mention that file" is exactly the shape a
 * scoped or crashed run takes.
 * @param minimums - the minimums, as read from this checkout
 * @param metric - which recorded minimum to compare against
 * @param measured - percentage per file, root-relative paths
 * @returns the files below their recorded minimum, the ones not
 *   measured, and the ones far enough above to be worth re-recording
 */
export function compareMinimums(
  minimums: Minimums,
  metric: Metric,
  measured: ReadonlyMap<string, number>,
): MinimumComparison {
  const below: string[] = [];
  const unmeasured: string[] = [];
  const liftable: string[] = [];
  for (const [file, row] of minimums.files) {
    const minimum = row[metric];
    const percent = measured.get(file);
    if (percent === undefined) {
      // A minimum of ZERO is "this file has nothing to measure" — a file
      // of pure type and constant declarations produces no mutants at
      // all, and Stryker writes no row for it. Silence about such a
      // file is the truth; silence about a file with a real minimum is
      // the shape a scoped or crashed run takes, and that is a 2.
      if (minimum > ZERO) {
        unmeasured.push(
          `${file}: the ${metric} run reported nothing for this file, so its recorded minimum of ${String(minimum)} could not be checked`,
        );
      }
      continue;
    }
    if (percent < minimum) {
      below.push(
        `${file}: ${metric} ${percent.toFixed(1)} is below its recorded minimum ${String(minimum)} — restore it, or lower the recorded minimum in the same commit with the reason, and classify what is missing in ${MINIMUMS_FILE}`,
      );
    } else if (percent - minimum >= LIFT_MARGIN) {
      liftable.push(
        `${file}: ${metric} ${percent.toFixed(1)} against a recorded minimum of ${String(minimum)} — raise the recorded minimum to ${String(roundDown(percent))} on the commit that earned it`,
      );
    }
  }
  return { below, unmeasured, liftable };
}
