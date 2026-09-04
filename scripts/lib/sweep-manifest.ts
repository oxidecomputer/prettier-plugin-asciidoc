/**
 * How a generated sweep's triage runner rewrites its manifests: the
 * tag carry-forward rule, the two manifest shapes it produces, and
 * the report it prints on the way.
 *
 * ONE COPY, because this is the rot-deciding logic. The rule is three
 * clauses - a coordinate that still fails keeps whatever it was
 * tagged with, one that has started failing enters `UNTRIAGED`, and
 * one that stopped failing simply LEAVES - and it is the third clause
 * that makes the manifests shrink instead of accumulate: the gates
 * read them as exact agreement, so a fix that retires a coordinate
 * turns the suite red until its entry goes. Two spellings of that
 * rule could disagree about the third clause and nothing would fail;
 * the sweep would just stop ratcheting, quietly, on one of its two
 * grids. The same argument that split `factsOfBuckets` out of one
 * deep manifest applies here with more force.
 *
 * A LIBRARY module, not a command: `scripts/registry-sweep-triage.ts`
 * and `scripts/inline-sweep-triage.ts` import it. Neither the row
 * sets nor the cluster keys live here - those are each sweep's own
 * vocabulary, and this module is deliberately blind to them.
 */
import { writeFileSync } from "node:fs";
import { format } from "prettier";
import type {
  ClusterEntry,
  ClusterFacts,
} from "../../tests/conformance/registry-sweep-clusters.js";
import type { QuarantineEntry } from "../../tests/conformance/quarantine.js";
import type { SweepFailure } from "../../tests/conformance/registry-sweep.js";

/** The tag a coordinate enters a manifest with. */
const UNTRIAGED = "UNTRIAGED";

/** How many ids a cluster names in the printed report. */
const SAMPLE_SIZE = 5;

/**
 * Writes a manifest in Prettier-normal form, so `fmt:check` passes
 * immediately after a rewrite instead of failing until someone runs
 * `bun run fmt`.
 * @param manifestPath - repo-relative file to write
 * @param manifest - the object to serialize
 */
export async function writeManifest(
  manifestPath: string,
  manifest: object,
): Promise<void> {
  writeFileSync(
    manifestPath,
    await format(JSON.stringify(manifest), { parser: "json" }),
  );
}

/**
 * A per-ROW manifest: one entry per failing coordinate, in sorted id
 * order, carrying each surviving row's tag forward.
 * @param failing - the failing rows this sweep found
 * @param existing - the manifest as it stands, for its tags
 * @returns the manifest object
 */
export function rowManifest(
  failing: readonly SweepFailure[],
  existing: ReadonlyMap<string, QuarantineEntry>,
): Record<string, QuarantineEntry> {
  const manifest: Record<string, QuarantineEntry> = {};
  for (const failure of failing.toSorted((a, b) =>
    a.id < b.id ? -1 : Number(a.id > b.id),
  )) {
    manifest[failure.id] = {
      fails: failure.fails,
      issue: existing.get(failure.id)?.issue ?? UNTRIAGED,
    };
  }
  return manifest;
}

/**
 * A per-CLUSTER manifest: the recomputed facts for each failure
 * class, carrying each surviving cluster's tag forward.
 *
 * Insertion order is the caller's cluster order, which `factsOfBuckets`
 * has already sorted by key, so a rewrite that changes one cluster
 * shows a one-cluster diff.
 * @param clusters - the clusters this sweep found
 * @param existing - the manifest as it stands, for its tags
 * @returns the manifest object
 */
export function clusterManifest(
  clusters: ReadonlyMap<string, ClusterFacts>,
  existing: ReadonlyMap<string, ClusterEntry>,
): Record<string, ClusterEntry> {
  const manifest: Record<string, ClusterEntry> = {};
  for (const [key, facts] of clusters) {
    manifest[key] = { ...facts, issue: existing.get(key)?.issue ?? UNTRIAGED };
  }
  return manifest;
}

/**
 * Prints the failing set grouped by cluster: the report a triage run
 * is read for, as opposed to the manifests it writes.
 * @param clusters - the clusters to print, in report order
 * @param log - where to write; the runner passes its own console
 */
export function printClusters(
  clusters: ReadonlyMap<string, ClusterFacts>,
  log: (line: string) => void,
): void {
  for (const [key, facts] of clusters) {
    log(`[${key}] ${String(facts.count)} rows`);
    for (const id of facts.examples.slice(0, SAMPLE_SIZE)) {
      log(`  ${id}`);
    }
    if (facts.count > facts.examples.length) {
      log(`  ... ${String(facts.count - facts.examples.length)} more`);
    }
    log("");
  }
}
