#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * Inline-sweep triage runner. Assesses every generated row the inline
 * registry can mint against the three differential properties and
 * reports the failures grouped by cluster. With --write, it
 * regenerates BOTH of the sweep's manifests: the default tier's
 * per-row file and the deep tier's compressed cluster file.
 *
 * One sweep writes both because the deep tier CONTAINS the default
 * tier: the default rows are the standing grid clean and the deep
 * rows are that grid under every byte operator plus the pair product,
 * so running the default tier again after the deep one would
 * re-derive a subset of what it already has, and two separate runs
 * could disagree if anything nondeterministic ever crept in.
 *
 * Issue tags survive a rewrite by the shared rule in
 * `scripts/lib/sweep-manifest.ts`, which both generated sweeps' triage
 * runners write their manifests through.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the sweep ran, 2 it could not
 * run. There is no 1: the failing set is the REPORT, not a gate - the
 * gates over it are the two manifests, which the suite checks.
 */
import { cannotRun, printUsage, wantsHelp } from "./lib/cli.js";
import {
  clusterManifest,
  printClusters,
  rowManifest,
  writeManifest,
} from "./lib/sweep-manifest.js";
import {
  inlineClusterFacts,
  INLINE_SWEEP_DEEP_MANIFEST_PATH,
} from "../tests/conformance/inline-sweep-clusters.js";
import {
  inlineDefaultTierRows,
  inlineDeepTierRows,
  INLINE_SWEEP_QUARANTINE_PATH,
  loadInlineQuarantine,
} from "../tests/conformance/inline-sweep.js";
import { loadSweepClusters } from "../tests/conformance/registry-sweep-clusters.js";
import { sweepFailures } from "../tests/conformance/registry-sweep.js";

const USAGE = `usage: bun run inline-sweep-triage [--write]

  --write  regenerate both inline-sweep manifests from this sweep
  --help   this text

Sweeps every generated inline row (the standing grid clean and byte-
perturbed, plus the pair product) and reports the failures by cluster.
--write rewrites tests/conformance/inline-sweep-quarantine.json (the
default tier, one entry per row) and
tests/conformance/inline-sweep-deep-manifest.json (the deep tier, one
entry per cluster).

exit: 0 the sweep ran, 2 it could not run`;

const ARGUMENT_START = 2;
if (wantsHelp(process.argv.slice(ARGUMENT_START))) {
  printUsage(USAGE);
  process.exit();
}

const write = process.argv.includes("--write");
const rows = inlineDeepTierRows();

// The measured-nothing floor. A registry that spelled no rows reports
// zero failures, and with --write it would rewrite both manifests to
// empty: every pin in the suite deleted by a green run.
const MINIMUM_ROWS = 1;
if (rows.length < MINIMUM_ROWS) {
  cannotRun(
    "inline-sweep-triage: the registry spelled 0 rows - nothing was assessed",
  );
  process.exit(process.exitCode);
}

const failures = await sweepFailures(rows);
const defaultIds = new Set(inlineDefaultTierRows().map((row) => row.id));
const defaultFailures = failures.filter((failure) =>
  defaultIds.has(failure.id),
);

const clusters = inlineClusterFacts(rows, failures);

// The counts docs/harnesses.md points readers at instead of printing
// its own copy: rows.length/failures.length are the deep manifest's
// current row total, clusters.size its current cluster count, and
// defaultFailures.length the default-tier quarantine's current entry
// count - the same three numbers `--write` would commit.
console.log(
  `${String(rows.length)} rows (${String(defaultIds.size)} default tier), ${String(failures.length)} failing in ${String(clusters.size)} clusters (${String(defaultFailures.length)} default tier).\n`,
);

printClusters(clusters, (line) => {
  console.log(line);
});

if (write) {
  await writeManifest(
    INLINE_SWEEP_QUARANTINE_PATH,
    rowManifest(defaultFailures, loadInlineQuarantine()),
  );
  await writeManifest(
    INLINE_SWEEP_DEEP_MANIFEST_PATH,
    clusterManifest(
      clusters,
      loadSweepClusters(INLINE_SWEEP_DEEP_MANIFEST_PATH),
    ),
  );
  console.log(
    `Wrote ${String(defaultFailures.length)} entries to ${INLINE_SWEEP_QUARANTINE_PATH} and ${String(clusters.size)} clusters to ${INLINE_SWEEP_DEEP_MANIFEST_PATH}.`,
  );
}
