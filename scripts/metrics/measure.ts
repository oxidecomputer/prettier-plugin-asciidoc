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
import { readDeadCode } from "./dead-code.js";
import { cruiseImports } from "./graph.js";
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
    if (entry.isDirectory()) return walkTypeScript(full);
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
  for (const scan of scans) accumulated += pick(scan);
  return accumulated;
}

/**
 * Measure one checkout.
 * @param directory - checkout root; must contain `src`
 * @param label - column label for the table
 * @param configPath - absolute path of the metrics eslint config
 * @param duplication - also run jscpd (report-only)
 * @returns the snapshot
 */
export async function measure(
  directory: string,
  label: string,
  configPath: string,
  duplication: boolean,
): Promise<Snapshot> {
  const files = walkTypeScript(path.join(directory, "src")).toSorted();
  const scans = files.map((file) => scanFile(directory, file));
  const graph = await cruiseImports(directory);
  const { cyclomatic, cognitive, cyclomaticOver } = measureComplexity(
    directory,
    configPath,
  );
  return {
    label,
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
    },
    hatches: {
      eslintDisable: total(scans, (scan) => scan.disables),
      asAssertions: total(scans, (scan) => scan.assertions),
      nonNull: total(scans, (scan) => scan.nonNull),
      anyType: total(scans, (scan) => scan.anyType),
    },
    dead: readDeadCode(directory, duplication),
  };
}
