#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * Reflow-line sweep triage runner. Assesses every document the two
 * declared classes spell against the three differential properties and
 * reports the failures grouped by cluster. With --write it regenerates
 * the sweep's one manifest, the cluster file the suite gates on.
 *
 * Issue tags survive a rewrite by the shared rule in
 * `scripts/lib/sweep-manifest.ts`, which every generated sweep's triage
 * runner writes its manifests through.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the sweep ran, 2 it could not
 * run. There is no 1: the failing set is the REPORT, not a gate - the
 * gate over it is the manifest, which the suite checks.
 */
import { cannotRun, printUsage, wantsHelp } from "./lib/cli.js";
import { writeLedgerFile } from "./lib/ledger-file.js";
import { clusterManifest, printClusters } from "./lib/sweep-manifest.js";
import {
  clusterFactsOfRows,
  loadSweepClusters,
} from "../tests/conformance/registry-sweep-clusters.js";
import { sweepFailures } from "../tests/conformance/registry-sweep.js";
import {
  reflowLineRows,
  REFLOW_LINE_SWEEP_MANIFEST_PATH,
} from "../tests/conformance/reflow-line-sweep.js";

const USAGE = `usage: bun run reflow-line-sweep-triage [--write]

  --write  regenerate the reflow-line sweep manifest from this sweep
  --help   this text

Sweeps every document the hard-break and indented-two-line classes
spell and reports the failures by cluster. --write rewrites
tests/conformance/reflow-line-sweep-manifest.json, one entry per
failure cluster.

exit: 0 the sweep ran, 2 it could not run`;

const ARGUMENT_START = 2;
if (wantsHelp(process.argv.slice(ARGUMENT_START))) {
  printUsage(USAGE);
  process.exit();
}

const write = process.argv.includes("--write");
const rows = reflowLineRows();

// The measured-nothing floor. A table that spelled no rows reports zero
// failures, and with --write it would rewrite the manifest to empty:
// every pin in the suite deleted by a green run.
const MINIMUM_ROWS = 1;
if (rows.length < MINIMUM_ROWS) {
  cannotRun(
    "reflow-line-sweep-triage: the class table spelled 0 rows - nothing was assessed",
  );
  process.exit(process.exitCode);
}

const failures = await sweepFailures(rows);
const clusters = clusterFactsOfRows(rows, failures);

// The counts docs/harnesses.md points readers at instead of printing
// its own copy: the same three numbers `--write` would commit.
console.log(
  `${String(rows.length)} rows, ${String(failures.length)} failing in ${String(clusters.size)} clusters.\n`,
);

printClusters(clusters, (line) => {
  console.log(line);
});

if (write) {
  await writeLedgerFile(
    REFLOW_LINE_SWEEP_MANIFEST_PATH,
    clusterManifest(
      clusters,
      loadSweepClusters(REFLOW_LINE_SWEEP_MANIFEST_PATH),
    ),
  );
  console.log(
    `Wrote ${String(clusters.size)} clusters to ${REFLOW_LINE_SWEEP_MANIFEST_PATH}.`,
  );
}
