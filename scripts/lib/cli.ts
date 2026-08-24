/**
 * The exit-code contract every script under `scripts/` obeys, and the
 * two lines of plumbing that make it cheap to obey.
 *
 * Three codes, because two are not enough:
 *
 * - **0 — pass.** The gate held, or the tool did what it was asked.
 * - **1 — the gate FAILED.** A real regression: a cycle, a widened
 *   contract, a differing case, a shape whose render no longer matches.
 *   Somebody has to look at the code.
 * - **2 — the harness COULD NOT RUN.** Bad arguments, an unknown base
 *   revision, a corpus that did not load, an empty measurement.
 *   Nothing was proved either way, and somebody has to look at the
 *   HARNESS.
 *
 * The distinction is the whole point: a gate that cannot tell "I
 * checked and it is broken" from "I checked nothing" is a gate that
 * goes quiet exactly when its inputs disappear, and in CI the quiet
 * failure is the expensive one — it turns into a green tick. Every
 * measured-nothing floor in this directory (`parity`'s
 * `MINIMUM_CASES`, `shape-diff`'s missing-id report, the scorecard's
 * source floor) exits 2, never 1 and never 0.
 */

/** The gate failed: a real regression, in the code. */
export const GATE_FAILED = 1;

// The harness could not run. Not exported: {@link cannotRun} is the
// only way to set it, so a script cannot half-report the condition by
// setting the code without saying what stopped it. Passing (0) is the
// default `process.exitCode` and is never assigned anywhere.
const CANNOT_RUN = 2;

/** The spellings that ask for the usage string. */
const HELP_FLAGS = new Set(["--help", "-h", "help"]);

/**
 * Did the command line ask for help?
 *
 * Checked before anything else parses, so `--help` works on a script
 * whose required arguments are missing — which is the only time
 * anybody types it.
 * @param argv - the arguments after the script name
 * @returns whether any of them is a help flag
 */
export function wantsHelp(argv: readonly string[]): boolean {
  return argv.some((argument) => HELP_FLAGS.has(argument));
}

/**
 * Print a usage string on stdout and pass.
 *
 * Asking for help is not an error, so it exits 0 and prints on stdout
 * where a pipe can read it.
 * @param usage - the script's USAGE text, without a trailing newline
 */
export function printUsage(usage: string): void {
  process.stdout.write(`${usage}\n`);
}

/**
 * Report that the harness could not run, and set the exit code.
 *
 * `process.exitCode` rather than `process.exit()`: an immediate exit
 * skips the `finally` blocks that delete materialized checkouts, and
 * a leaked one is hundreds of megabytes.
 * @param message - one line saying what stopped it, without a newline
 */
export function cannotRun(message: string): void {
  process.stderr.write(`${message}\n`);
  process.exitCode = CANNOT_RUN;
}
