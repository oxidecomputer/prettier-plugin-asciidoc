#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * Registry-sweep triage runner. Assesses every generated row the
 * shape registry can mint against the three differential properties
 * and reports the failures grouped by cluster. With --write, it
 * regenerates BOTH of the sweep's manifests: the default tier's
 * per-row file and the deep tier's compressed cluster file.
 *
 * One sweep writes both because the deep tier CONTAINS the default
 * tier: the default rows are the standing grid crossed with the byte
 * operators and the deep rows are that list plus the pair grid, so
 * running the default tier again after the deep one would spend five
 * more seconds re-deriving a subset of what it already has, and two
 * separate runs could disagree if anything nondeterministic ever
 * crept in.
 *
 * Issue tags survive a rewrite the way `scripts/conformance-triage.ts`
 * keeps them: a row or cluster that still fails keeps whatever it was
 * tagged with, a new one enters as UNTRIAGED, and one that stopped
 * failing simply leaves. That last case is the point of both
 * manifests - the gates read them as exact agreement, so a fix that
 * retires a coordinate turns the suite red until the entry goes.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the sweep ran, 2 it could not
 * run. There is no 1: the failing set is the REPORT, not a gate - the
 * gates over it are the two manifests, which the suite checks.
 */
import { writeFileSync } from "node:fs";
import { format } from "prettier";
import { cannotRun, printUsage, wantsHelp } from "./lib/cli.js";
import {
  clusterFacts,
  loadSweepClusters,
  SWEEP_DEEP_MANIFEST_PATH,
  type ClusterEntry,
} from "../tests/conformance/registry-sweep-clusters.js";
import {
  defaultTierRows,
  deepTierRows,
  loadSweepQuarantine,
  sweepFailures,
  SWEEP_QUARANTINE_PATH,
  type SweepFailure,
} from "../tests/conformance/registry-sweep.js";
import type { QuarantineEntry } from "../tests/conformance/quarantine.js";

const USAGE = `usage: bun run registry-sweep-triage [--write]

  --write  regenerate both registry-sweep manifests from this sweep
  --help   this text

Sweeps every generated row (both grids, clean and byte-perturbed) and
reports the failures by cluster. --write rewrites
tests/conformance/registry-sweep-quarantine.json (the default tier,
one entry per row) and tests/conformance/registry-sweep-deep-manifest.json
(the deep tier, one entry per cluster).

exit: 0 the sweep ran, 2 it could not run`;

const ARGUMENT_START = 2;
if (wantsHelp(process.argv.slice(ARGUMENT_START))) {
  printUsage(USAGE);
  process.exit();
}

const write = process.argv.includes("--write");
const rows = deepTierRows();

// The measured-nothing floor. A registry that spelled no rows reports
// zero failures, and with --write it would rewrite both manifests to
// empty: every pin in the suite deleted by a green run.
const MINIMUM_ROWS = 1;
if (rows.length < MINIMUM_ROWS) {
  cannotRun(
    "registry-sweep-triage: the registry spelled 0 rows - nothing was assessed",
  );
  process.exit(process.exitCode);
}

const failures = await sweepFailures(rows);
const defaultIds = new Set(defaultTierRows().map((row) => row.id));
const defaultFailures = failures.filter((failure) =>
  defaultIds.has(failure.id),
);

console.log(
  `${String(rows.length)} rows (${String(defaultIds.size)} default tier), ${String(failures.length)} failing (${String(defaultFailures.length)} default tier).\n`,
);

const clusters = clusterFacts(failures);
const SAMPLE_SIZE = 5;
for (const [key, facts] of clusters) {
  console.log(`[${key}] ${String(facts.count)} rows`);
  for (const id of facts.examples.slice(0, SAMPLE_SIZE)) {
    console.log(`  ${id}`);
  }
  if (facts.count > facts.examples.length) {
    console.log(`  ... ${String(facts.count - facts.examples.length)} more`);
  }
  console.log("");
}

/**
 * Writes a manifest in Prettier-normal form, so `fmt:check` passes
 * immediately after a --write instead of failing until someone runs
 * `bun run fmt`.
 * @param manifestPath - repo-relative file to write
 * @param manifest - the object to serialize
 */
async function writeManifest(
  manifestPath: string,
  manifest: object,
): Promise<void> {
  writeFileSync(
    manifestPath,
    await format(JSON.stringify(manifest), { parser: "json" }),
  );
}

/**
 * The default tier's per-row manifest: one entry per failing row, in
 * sorted id order.
 * @param failing - the default-tier failing rows
 * @returns the manifest object
 */
function defaultManifest(
  failing: readonly SweepFailure[],
): Record<string, QuarantineEntry> {
  const existing = loadSweepQuarantine();
  const manifest: Record<string, QuarantineEntry> = {};
  for (const failure of failing.toSorted((a, b) =>
    a.id < b.id ? -1 : Number(a.id > b.id),
  )) {
    manifest[failure.id] = {
      fails: failure.fails,
      issue: existing.get(failure.id)?.issue ?? "UNTRIAGED",
    };
  }
  return manifest;
}

/**
 * The deep tier's cluster manifest, carrying forward each surviving
 * cluster's issue tag.
 * @returns the manifest object
 */
function deepManifest(): Record<string, ClusterEntry> {
  const existing = loadSweepClusters();
  const manifest: Record<string, ClusterEntry> = {};
  for (const [key, facts] of clusters) {
    manifest[key] = {
      ...facts,
      issue: existing.get(key)?.issue ?? "UNTRIAGED",
    };
  }
  return manifest;
}

if (write) {
  await writeManifest(SWEEP_QUARANTINE_PATH, defaultManifest(defaultFailures));
  await writeManifest(SWEEP_DEEP_MANIFEST_PATH, deepManifest());
  console.log(
    `Wrote ${String(defaultFailures.length)} entries to ${SWEEP_QUARANTINE_PATH} and ${String(clusters.size)} clusters to ${SWEEP_DEEP_MANIFEST_PATH}.`,
  );
}
