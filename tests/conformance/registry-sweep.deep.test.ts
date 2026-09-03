/**
 * The registry sweep's DEEP tier, behind `bun run test:deeply-nested-lists`.
 *
 * Both grids, clean and under every byte operator, run through the
 * crash/idempotency/fidelity properties. It costs minutes where the
 * default tier costs seconds, which is the whole reason for the
 * split: the always-on suite gets the standing grid and this entry
 * gets the pair product on top.
 *
 * The pin is `registry-sweep-deep-manifest.json`, and it is exact in
 * both directions the way the default tier's per-row manifest is.
 * What differs is only its SHAPE: the failing set is five figures
 * wide, so the manifest records clusters (count, five example ids,
 * and the sha256 of the cluster's full sorted id list) rather than
 * rows, and this gate recomputes all three fields. See
 * `registry-sweep-clusters.ts` for why that stays exact.
 *
 * When it disagrees, the full failing list goes to a gitignored dump
 * whose path is printed: the manifest names five ids per cluster and
 * triage needs the rest.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  clusterFacts,
  dumpText,
  factsOf,
  loadSweepClusters,
  SWEEP_DEEP_DUMP_PATH,
  type ClusterFacts,
} from "./registry-sweep-clusters.js";
import {
  deepTierRows,
  sweepFailures,
  type SweepFailure,
} from "./registry-sweep.js";

/**
 * Writes the full failing list where triage can read it, and says
 * where it went.
 * @param failures - every failing row this run found
 */
function dump(failures: readonly SweepFailure[]): void {
  mkdirSync(path.dirname(SWEEP_DEEP_DUMP_PATH), { recursive: true });
  writeFileSync(SWEEP_DEEP_DUMP_PATH, dumpText(failures));
  // eslint-disable-next-line no-console -- the dump is useless if the gate does not say where it went
  console.error(
    `registry sweep (deep tier): ${String(failures.length)} failing rows written to ${SWEEP_DEEP_DUMP_PATH}`,
  );
}

/**
 * A cluster map as a plain object, so `toEqual` reports a per-cluster
 * diff instead of a Map diff.
 * @param clusters - the clusters to flatten
 * @returns the same clusters keyed by cluster key
 */
function asObject(
  clusters: ReadonlyMap<string, ClusterFacts>,
): Record<string, ClusterFacts> {
  return Object.fromEntries(clusters);
}

describe("registry sweep (deep tier)", () => {
  test("the failing clusters are exactly the deep manifest", async () => {
    const failures = await sweepFailures(deepTierRows());
    const actual = asObject(clusterFacts(failures));
    const expected = asObject(factsOf(loadSweepClusters()));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      dump(failures);
    }
    expect(actual).toEqual(expected);
  }, 900_000);
});
