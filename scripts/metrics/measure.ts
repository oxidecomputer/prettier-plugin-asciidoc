/**
 * Assembly of one Snapshot: walk the tree, scan each file, and gather
 * what the tools say about it.
 *
 * Lines are classified by the TypeScript scanner (`scan.ts`), coupling
 * comes from dependency-cruiser (`graph.ts`), complexity from eslint
 * (`complexity.ts`), and dead code from knip and jscpd
 * (`dead-code.ts`). Nothing here counts anything by regex.
 *
 * Code and comment lines are always reported as a PAIR: a refactor that
 * shrinks "lines" by deleting comments has to show up as a comment-line
 * drop, and in this repository the comments are half the file and carry
 * the citations to the Asciidoctor source the parser mirrors.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { measureComplexity } from "./complexity.js";
import { readConformance } from "./conformance.js";
import { readCrossings } from "./crossings.js";
import { readDeadCode } from "./dead-code.js";
import { readDesign } from "./design.js";
import { readMinimumsFacts } from "./score-minimums.js";
import { cruiseImports } from "./graph.js";
import { readInternalSurface } from "./internal-surface.js";
import {
  layersFor,
  ONE,
  perLayer,
  ZERO,
  type FileScan,
  type Layer,
  type LayerTotals,
  type Snapshot,
} from "./model.js";
import { scanSource } from "./scan.js";

/**
 * Every `.ts` file below a directory, recursively.
 * @param directory - directory to walk
 * @returns absolute paths, unsorted
 */
function walkTypeScript(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkTypeScript(full);
    }
    return entry.name.endsWith(".ts") ? [full] : [];
  });
}

/**
 * Scan one file into its per-file counts.
 * @param root - the measured checkout root
 * @param file - absolute path of the file
 * @returns the counts, with a root-relative path
 */
function scanFile(root: string, file: string): FileScan {
  const counts = scanSource(file, readFileSync(file, "utf8"));
  return { path: path.relative(root, file), ...counts };
}

/**
 * Sum the file scans into per-layer size totals.
 * @param scans - one entry per measured file
 * @returns size totals per layer
 */
function aggregateLayers(scans: FileScan[]): Record<Layer, LayerTotals> {
  const totals = perLayer<LayerTotals>(() => ({
    files: ZERO,
    total: ZERO,
    code: ZERO,
    comment: ZERO,
  }));
  for (const scan of scans) {
    for (const layer of layersFor(scan.path)) {
      const { [layer]: entry } = totals;
      entry.files += ONE;
      entry.total += scan.total;
      entry.code += scan.code;
      entry.comment += scan.comment;
    }
  }
  return totals;
}

/**
 * Add up one field over every scanned file.
 * @param scans - one entry per measured file
 * @param pick - the field to total
 * @returns the sum
 */
function total(scans: FileScan[], pick: (scan: FileScan) => number): number {
  let accumulated = ZERO;
  for (const scan of scans) {
    accumulated += pick(scan);
  }
  return accumulated;
}

/**
 * Total the `unreachable(…)` call sites.
 * @param scans - one entry per measured file
 * @returns call sites across `src`
 */
function unreachableSites(scans: FileScan[]): number {
  return total(scans, (scan) => scan.unreachableCalls);
}

/**
 * Every wrapped, uncounted marker in the tree, placed by file and line.
 *
 * Assembled here rather than in `scan.ts` because the scanner reports
 * what one file holds, and only the aggregate knows that file's path.
 * @param scans - one entry per measured file
 * @returns one `file:line: marker` string per near miss
 */
function nearMisses(scans: FileScan[]): string[] {
  return scans.flatMap((scan) =>
    scan.markerNearMisses.map((where) => `${scan.path}:${where}`),
  );
}

/** What one `measure` call is being asked to do. */
export interface Measurement {
  /** Checkout root; must contain `src`. */
  directory: string;
  /** Column label for the table: a revision, or "head". */
  label: string;
  /** Absolute path of the metrics eslint config. */
  configPath: string;
  /**
   * Whether this checkout is THIS repository, and so the one the
   * hand-maintained design registries describe. See
   * `Snapshot.repository`.
   */
  repository: boolean;
}

/**
 * Measure one checkout.
 *
 * Takes an options object rather than five positionals: `label` and
 * `repository` are both "which checkout is this?" and a caller that
 * transposed them would silently gate a base revision.
 * @param measurement - which checkout, labelled how, with which tools
 * @returns the snapshot
 */
export async function measure(measurement: Measurement): Promise<Snapshot> {
  const { directory, label, configPath, repository } = measurement;
  const files = walkTypeScript(path.join(directory, "src")).toSorted();
  const scans = files.map((file) => scanFile(directory, file));
  const design = readDesign(directory);
  const boundaries = readCrossings(directory);
  const graph = await cruiseImports(directory);
  const { cyclomatic, cognitive, cyclomaticOver } = measureComplexity(
    directory,
    configPath,
  );
  return {
    label,
    repository,
    layers: aggregateLayers(scans),
    cyclomatic,
    cognitive,
    cyclomaticOver,
    coupling: {
      importEdges: graph.edges,
      filesInCycles: new Set(graph.cycles.flat()).size,
      cycles: graph.cycles.map((cycle) => cycle.join(" -> ")),
      exportedSymbols: total(scans, (scan) => scan.exports),
      starExports: total(scans, (scan) => scan.starExports),
      unresolved: [...graph.unresolved, ...graph.selfImports],
      layerViolations: graph.layerViolations,
    },
    hatches: {
      eslintDisable: total(scans, (scan) => scan.disables),
      asAssertions: total(scans, (scan) => scan.assertions),
      nonNull: total(scans, (scan) => scan.nonNull),
      anyType: total(scans, (scan) => scan.anyType),
    },
    seams: [...design.seams],
    defense: {
      unreachableCalls: unreachableSites(scans),
      callerContract: total(scans, (scan) => scan.markers.callerContract),
      totalFallback: total(scans, (scan) => scan.markers.totalFallback),
      validOnlyWhen: total(scans, (scan) => scan.markers.validOnlyWhen),
      interiorValidation: design.interiorValidation,
      staleEntries: [...design.staleEntries],
      registryFaults: [...design.registryFaults],
      markerNearMisses: nearMisses(scans),
    },
    crossings: {
      registered: boundaries.registered,
      unregistered: [...boundaries.unregistered],
      stale: [...boundaries.stale],
      faults: [...boundaries.faults],
    },
    harnesses: [...design.harnesses],
    internal: readInternalSurface(directory),
    conformance: readConformance(directory),
    minimums: readMinimumsFacts(
      directory,
      scans.map((scan) => scan.path),
    ),
    dead: readDeadCode(directory),
  };
}
