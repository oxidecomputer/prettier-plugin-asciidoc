/**
 * The inline sweep's DEEP tier, behind `bun run test:deeply-nested-lists`.
 *
 * The standing grid under every byte operator, plus the whole pair
 * product: any two alphabet members standing in ONE inline run. That
 * pairing is the coordinate the default tier cannot reach and the
 * line registry has no dimension for at all - a span whose printing is
 * right on its own stops being right when a second span shares the
 * fragment, because the two answer to the same whole-fragment scans.
 *
 * It costs about a minute and a half where the default tier costs
 * three and a half seconds, which is the whole reason for the split.
 *
 * The pin is `inline-sweep-deep-manifest.json`, exact in both
 * directions the way the default tier's per-row manifest is. What
 * differs is only its SHAPE: the failing set is four figures wide, so
 * the manifest records clusters (count, five example ids, and the
 * sha256 of the cluster's full sorted id list) rather than rows, and
 * this gate recomputes all three fields.
 *
 * When it disagrees, the full failing list goes to a gitignored dump
 * whose path is printed: the manifest names five ids per cluster and
 * triage needs the rest.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  inlineClusterFacts,
  INLINE_SWEEP_DEEP_DUMP_PATH,
  INLINE_SWEEP_DEEP_MANIFEST_PATH,
} from "./inline-sweep-clusters.js";
import { inlineDeepTierRows } from "./inline-sweep.js";
import {
  dumpText,
  factsOf,
  loadSweepClusters,
  type ClusterFacts,
} from "./registry-sweep-clusters.js";
import { sweepFailures, type SweepFailure } from "./registry-sweep.js";

/**
 * Writes the full failing list where triage can read it, and says
 * where it went.
 * @param failures - every failing row this run found
 */
function dump(failures: readonly SweepFailure[]): void {
  mkdirSync(path.dirname(INLINE_SWEEP_DEEP_DUMP_PATH), { recursive: true });
  writeFileSync(INLINE_SWEEP_DEEP_DUMP_PATH, dumpText(failures));
  // eslint-disable-next-line no-console -- the dump is useless if the gate does not say where it went
  console.error(
    `inline sweep (deep tier): ${String(failures.length)} failing rows written to ${INLINE_SWEEP_DEEP_DUMP_PATH}`,
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

describe("inline sweep (deep tier)", () => {
  test("the failing clusters are exactly the deep manifest", async () => {
    const rows = inlineDeepTierRows();
    const failures = await sweepFailures(rows);
    const actual = asObject(inlineClusterFacts(rows, failures));
    const expected = asObject(
      factsOf(loadSweepClusters(INLINE_SWEEP_DEEP_MANIFEST_PATH)),
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      dump(failures);
    }
    expect(actual).toEqual(expected);
  }, 900_000);
});
