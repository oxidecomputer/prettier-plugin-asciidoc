#!/usr/bin/env bun
/**
 * The recorded-minimums gate: measure one of the two per-file scores
 * and compare this checkout against the minimums recorded in
 * `scripts/metrics/score-minimums.json`.
 *
 * Two modes, because the two metrics cost three orders of magnitude
 * apart:
 *
 * - `--coverage` RUNS the suite with v8 line coverage and compares.
 *   It is seconds, so `bun run coverage` is a CI-blocking step and
 *   the minimums are checked on every push.
 * - `--mutation` READS the report `stryker run` just wrote and
 *   compares. The run itself is ~11 minutes, so it stays manual and
 *   periodic; `bun run mutate` invokes this as its last step, which is
 *   what keeps "the score dropped" from being something a human has to
 *   notice in 3,500 lines of progress output.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 every recorded minimum held,
 * 1 a file measured BELOW its recorded minimum, 2 the comparison
 * could not be made — no minimums file, no report, or a recorded file
 * the run never mentioned.
 * That last one is a 2 and not a 0 on purpose: "the report did not
 * mention that file" is the shape a scoped or crashed run takes, and a
 * gate that goes quiet when its input disappears is not a gate.
 *
 * The suite-size row rides on `--coverage` because that is where the
 * suite actually runs. It is REPORT-ONLY and always will be: a ratchet
 * on suite size penalizes adding a spec-citation pin, which is the
 * opposite of what this repository wants. The right signal is
 * "8,472 → 12,000 in one change, explain that in the task report".
 * It is NOT on the `bun run metrics` table for the reason nothing else
 * measured-by-running is: the scorecard does not run the suite, and a
 * number cached from the last run that did would print stale.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { CHILD_MAX_BUFFER, REPO_ROOT } from "./lib/checkout.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import { isArray, isObject, strictJson } from "./metrics/json.js";
import {
  compareMinimums,
  MINIMUMS_FILE,
  readMinimums,
  type Metric,
} from "./metrics/score-minimums.js";

const USAGE = `usage: bun run coverage
       bun run mutate            (invokes this with --mutation)
       bun scripts/score-minimums.ts --coverage | --mutation

  --coverage   run the suite with v8 line coverage, then check the minimums
  --mutation   check the minimums against the StrykerJS report just written
  --help       this text

exit: 0 every recorded minimum held, 1 a file is below one, 2 could not run`;

const ARGUMENT_START = 2;

/** Where `vitest --coverage` writes its per-file summary. */
const COVERAGE_SUMMARY = "reports/coverage/coverage-summary.json";

/** Where the vitest json reporter writes the suite's own shape. */
const SUITE_REPORT = "reports/coverage/suite.json";

/** Where `stryker run` writes its report; see `stryker.config.json`. */
const MUTATION_REPORT = "reports/mutation/mutation.json";

// A mutant in one of these states is a mutant the suite BEAT; one in
// `Survived` or `NoCoverage` is one it missed. Everything else —
// `CompileError`, `RuntimeError`, `Ignored` — is not evidence about
// the suite either way and leaves the fraction entirely.
const BEATEN = new Set(["Killed", "Timeout"]);
const MISSED = new Set(["Survived", "NoCoverage"]);

const PERCENT = 100;

const MILLISECONDS_PER_SECOND = 1000;

/**
 * A count the reporter may not have written.
 * @param value - the reported number, if there was one
 * @returns the number, or "n/a"
 */
function count(value: unknown): string {
  return typeof value === "number" ? String(value) : "n/a";
}

/**
 * Run the suite with coverage and the json reporter.
 * @returns the wall time in milliseconds, or undefined when vitest
 *   itself failed — in which case there is nothing honest to compare
 */
function runSuite(): number | undefined {
  const started = Date.now();
  const result = spawnSync(
    "bunx",
    [
      "vitest",
      "run",
      "--coverage",
      "--reporter=default",
      "--reporter=json",
      `--outputFile=${SUITE_REPORT}`,
    ],
    { cwd: REPO_ROOT, stdio: "inherit", maxBuffer: CHILD_MAX_BUFFER },
  );
  return result.status === 0 ? Date.now() - started : undefined;
}

/**
 * Read a JSON report written by one of the tools.
 * @param file - repo-relative path
 * @returns the parsed value, or undefined when it is not there or not
 *   JSON
 */
function readReport(file: string): unknown {
  const absolute = path.join(REPO_ROOT, file);
  if (!existsSync(absolute)) {
    return undefined;
  }
  const { value } = strictJson(file, readFileSync(absolute, "utf8"));
  return value;
}

/**
 * Per-file LINE coverage, out of `coverage-summary.json`.
 *
 * Lines, not statements or branches: it is the number the minimums file
 * names, and the one a reader can check by eye against the html
 * report.
 * @returns percentage per repo-relative source path
 */
function coverageByFile(): Map<string, number> | undefined {
  const report = readReport(COVERAGE_SUMMARY);
  if (!isObject(report)) {
    return undefined;
  }
  const measured = new Map<string, number>();
  for (const [file, entry] of Object.entries(report)) {
    // The summary carries a synthetic `total` row alongside the files.
    if (file === "total" || !isObject(entry)) {
      continue;
    }
    const { lines } = entry;
    if (!isObject(lines)) {
      continue;
    }
    const { pct } = lines;
    if (typeof pct !== "number") {
      continue;
    }
    measured.set(path.relative(REPO_ROOT, file), pct);
  }
  return measured;
}

/**
 * One file's mutation score: what fraction of the mutants the suite
 * had an opinion about it BEAT.
 * @param mutants - the report's mutant list for one file
 * @returns the percentage, or undefined when no mutant was evidence
 */
function scoreOf(mutants: readonly unknown[]): number | undefined {
  let beaten = 0;
  let missed = 0;
  for (const mutant of mutants) {
    if (!isObject(mutant)) {
      continue;
    }
    const { status } = mutant;
    if (typeof status !== "string") {
      continue;
    }
    if (BEATEN.has(status)) {
      beaten += 1;
    }
    if (MISSED.has(status)) {
      missed += 1;
    }
  }
  // A file whose every mutant was a compile error yields no score at
  // all. Undefined, never zero: reporting it as 0% would fail every
  // recorded minimum it has, and nothing was measured.
  if (beaten + missed === 0) {
    return undefined;
  }
  return (beaten * PERCENT) / (beaten + missed);
}

/**
 * Per-file mutation score, out of the StrykerJS report.
 * @returns percentage per repo-relative source path
 */
function mutationByFile(): Map<string, number> | undefined {
  const report = readReport(MUTATION_REPORT);
  if (!isObject(report)) {
    return undefined;
  }
  const { files } = report;
  if (!isObject(files)) {
    return undefined;
  }
  const measured = new Map<string, number>();
  for (const [file, entry] of Object.entries(files)) {
    if (!isObject(entry)) {
      continue;
    }
    const { mutants } = entry;
    if (!isArray(mutants)) {
      continue;
    }
    const score = scoreOf(mutants);
    if (score !== undefined) {
      measured.set(file, score);
    }
  }
  return measured;
}

/**
 * Print the report-only suite-size row.
 * @param wallMilliseconds - how long the run took, wall clock
 */
function printSuiteSize(wallMilliseconds: number): void {
  const report = readReport(SUITE_REPORT);
  const tests = isObject(report) ? report.numTotalTests : undefined;
  // `testResults` is one entry per FILE. Deliberately not
  // `numTotalTestSuites`, which counts `describe` blocks — 567 of them
  // against 105 files as this is written, and a row labelled "test
  // files" carrying the describe count is worse than no row.
  const results = isObject(report) ? report.testResults : undefined;
  const files = isArray(results) ? results.length : undefined;
  const seconds = (wallMilliseconds / MILLISECONDS_PER_SECOND).toFixed(1);
  process.stdout.write(
    `\nsuite size (report-only — never a ratchet: a budget here penalizes adding a spec-citation pin):\n  tests       ${count(tests)}\n  test files  ${count(files)}\n  wall time   ${seconds}s\n`,
  );
}

/**
 * Compare one metric's measurements against the minimums and report.
 * @param metric - which recorded minimum to check
 * @param measured - percentage per repo-relative source path
 */
function check(metric: Metric, measured: Map<string, number>): void {
  const { minimums, faults } = readMinimums(REPO_ROOT);
  if (faults.length > 0) {
    cannotRun(faults.join("\n"));
    return;
  }
  if (minimums === undefined) {
    cannotRun(
      `${MINIMUMS_FILE}: not found, so there is nothing to compare ${metric} against`,
    );
    return;
  }
  const { below, unmeasured, liftable } = compareMinimums(
    minimums,
    metric,
    measured,
  );
  if (liftable.length > 0) {
    process.stdout.write(
      `\n${metric} above its recorded minimum (raise it on the commit that earned it):\n  ${liftable.join("\n  ")}\n`,
    );
  }
  // BELOW outranks UNMEASURED, and the order is the contract: a file
  // that definitely lost ground is evidence about the CODE (1), and a
  // run that could not reach every file is evidence about the HARNESS
  // (2). A scoped run has both, and the 1 is the one worth acting on.
  if (unmeasured.length > 0) {
    process.stderr.write(
      `the ${metric} run measured nothing for ${String(unmeasured.length)} recorded file(s), so their minimums were not checked:\n  ${unmeasured.join("\n  ")}\n`,
    );
  }
  if (below.length > 0) {
    process.stderr.write(
      `${metric} below its recorded minimum:\n  ${below.join("\n  ")}\n`,
    );
    process.exitCode = GATE_FAILED;
    return;
  }
  if (unmeasured.length > 0) {
    cannotRun(
      `${metric}: ${String(unmeasured.length)} recorded file(s) were not measured, so their minimums neither held nor failed`,
    );
    return;
  }
  process.stdout.write(
    `\n${metric}: every one of ${String(minimums.files.size)} recorded file(s) held its minimum.\n`,
  );
}

/**
 * Run the mode the command line asked for.
 */
function main(): void {
  const argv = process.argv.slice(ARGUMENT_START);
  if (wantsHelp(argv)) {
    printUsage(USAGE);
    return;
  }
  const coverage = argv.includes("--coverage");
  const mutation = argv.includes("--mutation");
  if (coverage === mutation) {
    cannotRun("score-minimums: pass exactly one of --coverage and --mutation");
    return;
  }
  if (coverage) {
    const wall = runSuite();
    if (wall === undefined) {
      cannotRun(
        "the suite did not pass under coverage, so no recorded minimum was checked",
      );
      return;
    }
    printSuiteSize(wall);
    const measured = coverageByFile();
    if (measured === undefined) {
      cannotRun(`${COVERAGE_SUMMARY}: not written, or not a summary`);
      return;
    }
    check("coverage", measured);
    return;
  }
  const measured = mutationByFile();
  if (measured === undefined) {
    cannotRun(
      `${MUTATION_REPORT}: not written, or not a StrykerJS report — run \`bun run mutate\``,
    );
    return;
  }
  check("mutation", measured);
}

try {
  main();
} catch (error) {
  cannotRun(error instanceof Error ? error.message : String(error));
}
