/**
 * The Snapshot builder the gate tests drive `gateFailures` with.
 *
 * Shared by `metrics.test.ts` and `metrics-design.test.ts` rather than
 * copied: a gate test is only meaningful if every OTHER field is at a
 * passing value, so there must be exactly one place that says what
 * "everything else is fine" looks like.
 */
import {
  perLayer,
  type SeamWidth,
  type Snapshot,
} from "../../scripts/metrics/model.js";

/**
 * A snapshot with everything at a passing value except what a gate
 * test varies.
 * @param options - the fields under test
 * @param options.label - the column label
 * @param options.repository - whether this checkout is the one the
 *   design registries describe; defaults to true
 * @param options.files - files per layer; 0 means the layer is absent
 * @param options.cognitiveMax - cognitive MAX for every layer
 * @param options.cyclomaticOverCount - functions over the cyclomatic tail
 * @param options.disables - `eslint-disable` count
 * @param options.assertions - `as` assertion count
 * @param options.cycles - import cycles, as printable paths
 * @param options.unusedExports - knip unused exports under `src`
 * @param options.seams - seam widths; an absent seam has no members
 * @param options.totalFallback - `Total fallback:` marker count
 * @param options.interiorValidation - registry length; omitted means
 *   the revision has no registry at all
 * @param options.staleEntries - registry entries whose site is gone
 * @param options.registryFaults - why the registry could not be read
 * @param options.nearMisses - markers a line wrap has hidden
 * @param options.harnesses - declared agreement harnesses
 * @returns a complete Snapshot
 */
export function makeSnapshot(options: {
  label?: string;
  repository?: boolean;
  files?: number;
  cognitiveMax?: number;
  cyclomaticOverCount?: number;
  disables?: number;
  assertions?: number;
  cycles?: string[];
  unusedExports?: number;
  seams?: SeamWidth[];
  totalFallback?: number;
  interiorValidation?: number;
  staleEntries?: string[];
  registryFaults?: string[];
  nearMisses?: string[];
  harnesses?: string[];
}): Snapshot {
  const cycles = options.cycles ?? [];
  return {
    label: options.label ?? "sample",
    // The gate tests are about THIS repository's registries, so the
    // default is the judged case; `repository: false` is set explicitly
    // by the test that pins the --root/--base exemption.
    repository: options.repository ?? true,
    layers: perLayer(() => ({
      files: options.files ?? 1,
      total: 10,
      code: 5,
      comment: 5,
    })),
    cyclomatic: perLayer(() => ({
      functions: 1,
      sum: 1,
      max: 1,
      over: options.cyclomaticOverCount ?? 0,
    })),
    cognitive: perLayer(() => ({
      functions: 1,
      sum: 1,
      max: options.cognitiveMax ?? 1,
      over: 0,
    })),
    cyclomaticOver: [],
    coupling: {
      importEdges: 1,
      filesInCycles: new Set(cycles).size,
      cycles,
      exportedSymbols: 1,
      starExports: 0,
      unresolved: [],
    },
    hatches: {
      eslintDisable: options.disables ?? 0,
      asAssertions: options.assertions ?? 0,
      nonNull: 0,
      anyType: 0,
    },
    seams: options.seams ?? [],
    defense: makeDefense(options),
    harnesses: options.harnesses ?? [],
    dead: {
      unusedExports: options.unusedExports ?? 0,
      unusedScriptExports: 0,
      duplicatedPercent: 0,
    },
  };
}

/**
 * The defense half of the snapshot, split out so `makeSnapshot` stays
 * under the complexity limit: every field is either a fixture value or
 * a passing default.
 * @param options - the same options `makeSnapshot` took
 * @param options.totalFallback - `Total fallback:` marker count
 * @param options.interiorValidation - registry length, or absent
 * @param options.staleEntries - entries whose site is gone
 * @param options.registryFaults - why the registry could not be read
 * @param options.nearMisses - markers a line wrap has hidden
 * @returns a complete Defense
 */
function makeDefense(options: {
  totalFallback?: number;
  interiorValidation?: number;
  staleEntries?: string[];
  registryFaults?: string[];
  nearMisses?: string[];
}): Snapshot["defense"] {
  return {
    unreachableCalls: 0,
    callerContract: 0,
    totalFallback: options.totalFallback ?? 0,
    validOnlyWhen: 0,
    interiorValidation: options.interiorValidation,
    staleEntries: options.staleEntries ?? [],
    registryFaults: options.registryFaults ?? [],
    markerNearMisses: options.nearMisses ?? [],
  };
}

/**
 * One seam-width row for the seam ratchet's tests.
 * @param name - the seam's name
 * @param members - its member count; omitted means the measured
 *   revision does not declare that interface, which is how a seam
 *   ratchets from absent at a BASE and what the head-absent gate
 *   fires on at HEAD
 * @param fault - why it cannot be measured, for the flatness gate
 * @returns the row
 */
export function seam(
  name: string,
  members?: number,
  fault?: string,
): SeamWidth {
  return { name, file: `src/${name}.ts`, members, fault };
}
