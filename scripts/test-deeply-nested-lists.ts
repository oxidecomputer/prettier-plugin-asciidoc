#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * The DEEP sweeps, as their own entry: every `*.deep.test.ts` file,
 * which today means the exhaustive depth-5 list-shape product —
 * 111,121 documents, gated TWICE over. The render/idempotence entry
 * formats each document twice and renders both sides, pinned to the
 * allowlist by strict set equality; the reflow re-classification
 * entry (issue #58) re-reads each document's output and pins the
 * violating set to `tests/format/reading-ledger.json` the same way.
 * Two tests, one product.
 *
 *   bun run test:deeply-nested-lists
 *
 * WHY IT IS NOT IN `bun run test`. It was, and it cost 25.6 s of a
 * 26.1 s suite: one test owned the whole wall time, and a suite nobody
 * can run on every save is a suite that stops being run. Moving it out
 * would weaken it if nothing else changed, so two things did: it is a
 * step in CI's BLOCKING `gates` job, and it is the prelude to
 * `bun run mutate` and `bun run mutate:full`, so no mutation baseline
 * is ever taken over a tree it has not passed. The default suite keeps
 * the same sweep at DEPTH 4 against a derived subset of the same
 * allowlist — four rather than three because the mutation harness runs
 * the default suite and not this script, and a mutant the sweep used to
 * kill has to die at the shallow depth or not at all. Neither samples.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the sweeps ran and their
 * failing sets matched the allowlist and the ledger, 1 a GATE failed —
 * a shape regressed, or an allowlisted shape started passing and its
 * entry is stale, 2 the harness could not run: a bad argument, vitest
 * missing, or a run that collected FEWER tests than the entries this
 * script exists to run. That last one is the reason this script exists
 * rather than a bare `vitest run --config`: `passWithNoTests` is on
 * for the repository, so a config typo that collects nothing exits 0,
 * and a green tick for a sweep that swept nothing is the expensive
 * failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import { isObject, strictJson } from "./metrics/json.js";

const USAGE = `usage: bun run test:deeply-nested-lists

  --help   this text

Runs every *.deep.test.ts under vitest.sweep.config.ts: the exhaustive
depth-5 list-shape sweep (111,121 documents) and the reflow
re-classification ledger over the same product.

exit: 0 the failing sets matched the allowlist and the ledger,
1 a gate failed, 2 could not run`;

/** Vitest's own exit code for "a test failed". */
const VITEST_TESTS_FAILED = 1;

/**
 * A run that collected fewer tests than this swept nothing.
 *
 * TWO, because the deep entry gates the product twice over: the
 * render/idempotence sweep and the reflow re-classification ledger. A
 * floor of one would let either of them be dropped, renamed out of the
 * glob or skipped and still report a green tick - the silent green
 * this script exists to make impossible.
 */
const MINIMUM_TESTS = 2;

/**
 * How many tests the run reported, or undefined when it left no
 * report at all.
 * @param reportFile - where the json reporter was told to write
 * @returns the realized test count, or undefined
 */
function testsRun(reportFile: string): number | undefined {
  if (!existsSync(reportFile)) {
    return undefined;
  }
  const { value } = strictJson(reportFile, readFileSync(reportFile, "utf8"));
  if (!isObject(value) || typeof value.numTotalTests !== "number") {
    return undefined;
  }
  return value.numTotalTests;
}

/**
 * Run the deep vitest entry and set this process's exit code.
 *
 * A function rather than top-level statements so the report directory
 * is removed on every path: `process.exit()` skips `finally`, which is
 * why nothing here calls it.
 * @param reportFile - where to have the json reporter write
 */
function sweep(reportFile: string): void {
  const run = spawnSync(
    "bunx",
    [
      "vitest",
      "run",
      "--config",
      "vitest.sweep.config.ts",
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${reportFile}`,
    ],
    { stdio: "inherit" },
  );
  if (run.error !== undefined) {
    cannotRun(
      `test-deeply-nested-lists: could not start vitest — ${run.error.message}`,
    );
    return;
  }
  // The measured-nothing floor, read from the REPORTER rather than
  // from the exit code: `passWithNoTests` makes an empty run a pass.
  const total = testsRun(reportFile);
  if (total === undefined) {
    cannotRun(
      `test-deeply-nested-lists: no run report at ${reportFile} — nothing was swept`,
    );
    return;
  }
  if (total < MINIMUM_TESTS) {
    cannotRun(
      "test-deeply-nested-lists: the run collected 0 tests — vitest.sweep.config.ts matched no *.deep.test.ts file",
    );
    return;
  }
  if (run.status === VITEST_TESTS_FAILED) {
    console.error(
      `test-deeply-nested-lists: the failing set did not match the allowlist (${String(total)} test(s) ran)`,
    );
    process.exitCode = GATE_FAILED;
    return;
  }
  if (run.status !== 0) {
    cannotRun(
      `test-deeply-nested-lists: vitest exited ${String(run.status)} without running the gate`,
    );
    return;
  }
  console.log(`test-deeply-nested-lists: ${String(total)} deep sweep(s) held.`);
}

const ARGUMENT_START = 2;
const argv = process.argv.slice(ARGUMENT_START);
if (wantsHelp(argv)) {
  printUsage(USAGE);
} else if (argv.length > 0) {
  cannotRun(
    `test-deeply-nested-lists: unexpected argument ${argv[0]}\n${USAGE}`,
  );
} else {
  const reportDirectory = mkdtempSync(
    path.join(tmpdir(), "test-deeply-nested-lists-"),
  );
  try {
    sweep(path.join(reportDirectory, "report.json"));
  } finally {
    rmSync(reportDirectory, { recursive: true, force: true });
  }
}
