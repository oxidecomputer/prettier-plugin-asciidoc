#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * The DEEP sweeps, as their own entry: every `*.deep.test.ts` file,
 * in the two cadences the files are partitioned into.
 *
 *   bun run test:deeply-nested-lists   the per-push entry
 *   bun run test:batched-sweeps        the batched entry
 *
 * PER PUSH, two products under `vitest.sweep.config.ts`. The registry
 * sweep's deep tier is the first gate: both shape-registry grids, each
 * under the byte operators it declares, pinned to the cluster manifest
 * in `tests/conformance/registry-sweep-deep-manifest.json`. The
 * reparse ledger is the second: the corpus, both registries' standing
 * grids and the line registry's pair grid, each document formatted and
 * handed back to the reader, pinned to
 * `tests/conformance/reparse-ledger.json`.
 *
 * BATCHED, one product under `vitest.batched-sweep.config.ts`: the
 * inline sweep's deep tier, the inline registry's standing grid under
 * every byte operator plus its whole pair product, pinned to
 * `tests/conformance/inline-sweep-deep-manifest.json`. It costs more
 * wall time than the per-push products put together, so it runs at
 * integration points the way the whitespace battery, the reference
 * diff and mutation testing do, and not on every push.
 *
 * WHY NEITHER IS IN `bun run test`. These products cost wall time a
 * run on every save should not pay, and a suite nobody runs on every
 * save is a suite that stops being run. Moving one out would weaken it
 * if nothing else changed, so two things do not: the per-push entry is
 * a step in CI's BLOCKING `gates` job, and it is the prelude to
 * `bun run mutate` and `bun run mutate:full`, so no mutation baseline
 * is ever taken over a tree it has not passed. Neither samples.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the sweeps ran and their
 * failing sets matched the ledger and the cluster manifests, 1 a GATE
 * failed - a shape regressed, or a pinned shape
 * started passing and its entry is stale, 2 the harness could not
 * run: a bad argument, vitest missing, or a run that collected FEWER
 * tests than the entry this script exists to run. That last one is
 * the reason this script exists rather than a bare
 * `vitest run --config`: `passWithNoTests` is on for the repository,
 * so a config typo that collects nothing exits 0, and a green tick
 * for a sweep that swept nothing is the expensive failure.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import { isObject, strictJson } from "./metrics/json.js";

const USAGE = `usage: bun run test:deeply-nested-lists
       bun run test:batched-sweeps

  --batched   the batched entry: the inline sweep's deep tier alone
  --help      this text

Without --batched, runs the per-push deep entry under
vitest.sweep.config.ts: the registry sweep's deep tier (both
shape-registry grids, each under the byte operators it declares) and
the reparse ledger over the corpus, both standing grids and the line
pair grid.

With --batched, runs the batched deep entry under
vitest.batched-sweep.config.ts: the inline sweep's deep tier, the
inline standing grid under every byte operator plus its pair product.
It is minutes rather than seconds, so it runs at integration points
and not on every push.

exit: 0 the failing sets matched the ledger and the cluster manifests,
1 a gate failed, 2 could not run`;

/** Vitest's own exit code for "a test failed". */
const VITEST_TESTS_FAILED = 1;

/** The flag that selects the batched entry over the per-push one. */
const BATCHED_FLAG = "--batched";

/** One deep entry: the vitest config it runs and the floor it holds. */
interface DeepEntry {
  /** The vitest config collecting this entry's `*.deep.test.ts` files. */
  readonly config: string;
  /**
   * A run that collected fewer tests than this swept nothing. The
   * exact count of the entry's gates on purpose: a lower floor would
   * let one of them be dropped, renamed out of the glob or skipped and
   * still report a green tick, which is the silent green this script
   * exists to make impossible.
   */
  readonly minimumTests: number;
}

/**
 * The per-push entry's floor.
 *
 * TWO, one per gate it runs: the registry sweep's deep tier and the
 * reparse ledger over its own deep population. It was five while the
 * inline sweep's deep tier ran here, and four while the list-shape
 * sweep and the reflow re-classification ledger over that same
 * product did. The inline tier is the batched entry below now, and
 * the list-shape pair spelled the product `bun run test` already
 * sweeps, so its two gates are in the default suite.
 */
const PER_PUSH_GATES = 2;

/**
 * The batched entry's floor.
 *
 * ONE: the inline sweep's deep tier is its only gate. The floor is
 * worth more here than in the per-push entry rather than less, since a
 * batched run is asked for rarely and by hand, so nothing else would
 * notice its config collecting nothing.
 */
const BATCHED_GATES = 1;

/** The per-push entry. */
const PER_PUSH: DeepEntry = {
  config: "vitest.sweep.config.ts",
  minimumTests: PER_PUSH_GATES,
};

/** The batched entry. */
const BATCHED: DeepEntry = {
  config: "vitest.batched-sweep.config.ts",
  minimumTests: BATCHED_GATES,
};

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
 * Run one deep vitest entry and set this process's exit code.
 *
 * A function rather than top-level statements so the report directory
 * is removed on every path: `process.exit()` skips `finally`, which is
 * why nothing here calls it.
 * @param entry - which deep entry to run
 * @param reportFile - where to have the json reporter write
 */
function sweep(entry: DeepEntry, reportFile: string): void {
  const run = spawnSync(
    "bunx",
    [
      "vitest",
      "run",
      "--config",
      entry.config,
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${reportFile}`,
    ],
    { stdio: "inherit" },
  );
  if (run.error !== undefined) {
    cannotRun(
      `test-deeply-nested-lists: could not start vitest - ${run.error.message}`,
    );
    return;
  }
  // The measured-nothing floor, read from the REPORTER rather than
  // from the exit code: `passWithNoTests` makes an empty run a pass.
  const total = testsRun(reportFile);
  if (total === undefined) {
    cannotRun(
      `test-deeply-nested-lists: no run report at ${reportFile} - nothing was swept`,
    );
    return;
  }
  if (total < entry.minimumTests) {
    // The COUNT, not a fixed zero. Collecting none means the config
    // matched no file at all; collecting some but not all means a
    // sweep was renamed out of the glob or skipped, which is the case
    // this floor mostly exists for and the one a "collected 0" line
    // would send a reader looking in the wrong place.
    cannotRun(
      `test-deeply-nested-lists: the run collected ${String(total)} test(s), fewer than the ${String(entry.minimumTests)} deep gates: a *.deep.test.ts file is missing from ${entry.config}'s globs, or one of its tests is skipped`,
    );
    return;
  }
  if (run.status === VITEST_TESTS_FAILED) {
    console.error(
      `test-deeply-nested-lists: a failing set did not match its manifest (${String(total)} test(s) ran)`,
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
// The only accepted command line other than help is the bare batched
// flag, so anything else is reported WHOLE: naming just the first
// argument sent a reader looking at `--batched` when the mistake was
// the word after it.
const batched = argv.length === 1 && argv[0] === BATCHED_FLAG;
if (wantsHelp(argv)) {
  printUsage(USAGE);
} else if (argv.length > 0 && !batched) {
  cannotRun(
    `test-deeply-nested-lists: unexpected arguments: ${argv.join(" ")}\n${USAGE}`,
  );
} else {
  const reportDirectory = mkdtempSync(
    path.join(tmpdir(), "test-deeply-nested-lists-"),
  );
  try {
    sweep(
      batched ? BATCHED : PER_PUSH,
      path.join(reportDirectory, "report.json"),
    );
  } finally {
    rmSync(reportDirectory, { recursive: true, force: true });
  }
}
