/**
 * The reflow-line sweep's gate, in `bun run test`.
 *
 * Every document the two declared classes spell, run through the
 * crash/idempotency/fidelity properties and pinned to
 * `reflow-line-sweep-manifest.json` by exact agreement: the recomputed
 * clusters must equal the manifest cluster for cluster, so a document
 * that starts failing fails the suite AND a pinned document that gets
 * fixed fails it too, until its cluster's count and digest are
 * rewritten. That second direction is what makes the manifest shrink
 * instead of rot.
 *
 * ONE TIER. The population is an order of magnitude short of the
 * registry sweeps' and finishes inside the critical path the
 * list-shape sweep already sets in this suite, so there is no wall
 * time here to move into `bun run test:deeply-nested-lists` and no
 * deep entry to pin a population from. This file holds both jobs: the
 * manifest and the population it was measured over.
 *
 * The population pin is what a manifest cannot say. A class dropped
 * from the table takes its failures with it, and the manifest would
 * then agree with itself over whatever is left; the row counts are the
 * only thing that reds.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  clusterFactsOfRows,
  dumpText,
  factsOf,
  loadSweepClusters,
  type ClusterFacts,
} from "./registry-sweep-clusters.js";
import { sweepFailures, type SweepFailure } from "./registry-sweep.js";
import {
  reflowLineRows,
  REFLOW_LINE_SWEEP_DUMP_PATH,
  REFLOW_LINE_SWEEP_MANIFEST_PATH,
  type ReflowLineRow,
} from "./reflow-line-sweep.js";

/**
 * How many rows each class mints. The second number is smaller than
 * the document count `indented-two-line` spells, because the four
 * symbols the two alphabets share are minted by whichever class comes
 * first in the table: these are counts of ROWS, which is what the
 * sweep runs.
 *
 * Directionless, like the other census pins: neither a bigger nor a
 * smaller number is a win, and the number moves in the same commit as
 * the change that earns it.
 */
const CLASS_ROWS: Record<string, number> = {
  // Separators from five digits up, which is where
  // `unicorn/numeric-separators-style` starts requiring them and
  // rejecting them below.
  "hard-break": 14_449,
  "indented-two-line": 7859,
};

/** How many rows the whole table yields, the two classes deduplicated. */
const POPULATION = 22_308;

/**
 * Writes the full failing list where triage can read it, and says
 * where it went.
 * @param failures - every failing row this run found
 */
function dump(failures: readonly SweepFailure[]): void {
  mkdirSync(path.dirname(REFLOW_LINE_SWEEP_DUMP_PATH), { recursive: true });
  writeFileSync(REFLOW_LINE_SWEEP_DUMP_PATH, dumpText(failures));
  // eslint-disable-next-line no-console -- the dump is useless if the gate does not say where it went
  console.error(
    `reflow-line sweep: ${String(failures.length)} failing rows written to ${REFLOW_LINE_SWEEP_DUMP_PATH}`,
  );
}

/**
 * How many rows each class minted.
 * @param rows - the whole population
 * @returns the per-class row counts, keyed by class name
 */
function rowsPerClass(rows: readonly ReflowLineRow[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.cluster] = (counts[row.cluster] ?? 0) + 1;
  }
  return counts;
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

describe("reflow-line sweep", () => {
  test("the table yields both classes, at the pinned row counts", () => {
    // Red under a table missing a class: the per-class tally loses a
    // key, which names the class that went, and the total moves. Both
    // are asserted because the total alone would also be satisfied by
    // one class growing while the other vanished.
    const rows = reflowLineRows();
    expect(rowsPerClass(rows)).toEqual(CLASS_ROWS);
    expect(rows).toHaveLength(POPULATION);
    // Issue #302 names this document: it renders with two literal plus
    // signs, formats to a hard break, and no other enumeration in the
    // tree spells it.
    const inputs = rows.map((row) => row.input);
    expect(inputs).toContain("* a\n +\n +\n");
    // The two checklist documents the marker-line dimension exists
    // for. The first duplicated its checkbox until the item's text
    // node learned to start past the prefix it no longer holds
    // (`stripCheckboxPrefix`, src/parse/build/list.ts): with that
    // offset taken back out it formats to `* [ ] [ ] a`, and rows
    // under every head fail beside it, so this pin is what keeps them
    // spellable. Before this dimension no sweep, quarantine, manifest
    // or ledger document in the tree spelled a checklist marker at
    // all. The second is #316's shape, carried as a witness because
    // no marker line spells a head with nothing behind it.
    expect(inputs).toContain("* [ ] a\n// c\n +\n");
    expect(inputs).toContain("* [ ] +\n   +\n  z\n");
  });

  test("the failing clusters are exactly the manifest", async () => {
    const rows = reflowLineRows();
    const failures = await sweepFailures(rows);
    const actual = asObject(clusterFactsOfRows(rows, failures));
    const expected = asObject(
      factsOf(loadSweepClusters(REFLOW_LINE_SWEEP_MANIFEST_PATH)),
    );
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      dump(failures);
    }
    expect(actual).toEqual(expected);
  }, 300_000);
});
