/**
 * The scorecard's vocabulary: what a measurement IS, and which layer
 * each file belongs to.
 *
 * This module is a leaf on purpose — every other module under
 * `scripts/metrics/` imports it and it imports none of them, so the
 * script obeys the same no-cycles rule it measures.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repository root. Every absolute path the script hands to a
 * child process (the eslint binary, the plugin modules, `git`) is
 * built from this, so a base revision measured in a temp directory
 * still uses THIS checkout's tools.
 */
export const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

// Shared small constants, so the modules under `scripts/metrics/` do
// not each redeclare them.

/** Zero, for counters and empty totals. */
export const ZERO = 0;

/** One, for increments. */
export const ONE = 1;

/** `indexOf`'s miss value. */
export const NOT_FOUND = -1;

/**
 * Buffer for child-process output. An eslint JSON report for `src` at
 * threshold 0 runs to a few hundred kilobytes, uncomfortably close to
 * the default 1 MB pipe buffer.
 */
export const CHILD_MAX_BUFFER = 268_435_456;

/**
 * The layers the scorecard reports separately. `src/parse` includes
 * `src/parse/lines`, and `src` includes everything, so a file counts
 * in every layer that contains it.
 */
export type Layer = "src" | "src/parse" | "src/parse/lines" | "src/print";

/** Print order for the layers. */
export const LAYERS: Layer[] = [
  "src",
  "src/parse",
  "src/parse/lines",
  "src/print",
];

// The printer layer is not a directory: it is `src/print*.ts` plus the
// two modules only the printer uses.
const PRINT_FILES = /^src\/(?:print|reflow\.ts|serialize-inline\.ts)/v;

/** Line and escape-hatch counts for one file. */
export interface FileScan {
  /** Path relative to the measured root, in posix spelling. */
  path: string;
  /** Every line, including blanks and comments (`wc -l`). */
  total: number;
  /** Lines that are empty after trimming. */
  blank: number;
  /** Lines that are only a comment. */
  comment: number;
  /** Lines that carry code. */
  code: number;
  /** `eslint-disable` occurrences. */
  disables: number;
  /** `as SomeType` assertions in code. */
  assertions: number;
  /** Non-null assertions (`value!.field`) in code. */
  nonNull: number;
  /** `any` in type position, which should stay 0. */
  anyType: number;
  /** Exported NAMES: `export { a, b }` is two, not one. */
  exports: number;
  /** `export * from "…"` statements, one each inside `exports`. */
  starExports: number;
}

/** Size totals for one layer. */
export interface LayerTotals {
  /** Number of TypeScript files in the layer. */
  files: number;
  /** Total lines (`wc -l`). */
  total: number;
  /** Non-blank, non-comment lines. */
  code: number;
  /** Comment lines. */
  comment: number;
}

/** One function a report-only metric wants a human to look at. */
export interface Offender {
  /** `path/to/file.ts:line`, relative to the measured root. */
  where: string;
  /** The function's name, as eslint spells it. */
  what: string;
  /** The metric's value for that function. */
  value: number;
}

/** Distribution of one complexity metric over one layer. */
export interface ComplexityTotals {
  /** How many functions were measured. */
  functions: number;
  /** Sum over all functions: the layer's total difficulty. */
  sum: number;
  /** The worst single function: the layer's peak difficulty. */
  max: number;
  /** How many functions exceed the metric's tail threshold. */
  over: number;
}

/** What the optional third-party tools found, where they ran. */
export interface DeadCode {
  /** knip unused exports, types and members under `src`. */
  unusedExports: number | undefined;
  /** The same count over `scripts`, which is measured but not gated. */
  unusedScriptExports: number | undefined;
  /** jscpd duplicated-line percentage over `src`. */
  duplicatedPercent: number | undefined;
}

// Not exported: only `Snapshot` names these, and an export nothing
// imports is exactly what the scorecard's knip row counts.
/** How coupled the measured files are to each other. */
interface Coupling {
  /** Unique relative-import edges between measured files. */
  importEdges: number;
  /** Files sitting in an import cycle. A cycle has no reading order. */
  filesInCycles: number;
  /** One `a -> b -> a` string per cycle, for the failure message. */
  cycles: string[];
  /** Exported names across the tree; see `FileScan.exports`. */
  exportedSymbols: number;
  /** How many of those are `export * from "…"` statements. */
  starExports: number;
  /** Relative import specifiers that resolve to no file. */
  unresolved: string[];
}

/** Places where a human, not the type system, carries an invariant. */
interface Hatches {
  /** `eslint-disable` comments. */
  eslintDisable: number;
  /** `as SomeType` assertions. */
  asAssertions: number;
  /** Non-null assertions. */
  nonNull: number;
  /** `any` in type position. */
  anyType: number;
}

/** Everything measured at one revision. */
export interface Snapshot {
  /** Column label for the table: a revision, or "head". */
  label: string;
  /** Size per layer. */
  layers: Record<Layer, LayerTotals>;
  /** eslint `complexity` per layer. */
  cyclomatic: Record<Layer, ComplexityTotals>;
  /** `sonarjs/cognitive-complexity` per layer. */
  cognitive: Record<Layer, ComplexityTotals>;
  /**
   * Functions over the cyclomatic tail, by name — the tail count is
   * report-only, and a report-only number is only useful if it says
   * WHICH functions (Ruling 35).
   */
  cyclomaticOver: Offender[];
  /** Import edges, cycles and exported symbols. */
  coupling: Coupling;
  /** Escape-hatch counts. */
  hatches: Hatches;
  /** Optional tools; `undefined` where they did not run. */
  dead: DeadCode;
}

/**
 * Which layers a file belongs to.
 *
 * A path outside `src` belongs to NO layer rather than falling into
 * the `src` total: that turns a path-resolution bug into visible zeros
 * instead of a silently wrong aggregate.
 * @param file - file path relative to the measured checkout root
 * @returns every layer that contains the file, outermost first
 */
export function layersFor(file: string): Layer[] {
  if (!file.startsWith("src/")) return [];
  const layers: Layer[] = ["src"];
  if (file.startsWith("src/parse/")) layers.push("src/parse");
  if (file.startsWith("src/parse/lines/")) layers.push("src/parse/lines");
  if (PRINT_FILES.test(file)) layers.push("src/print");
  return layers;
}

/**
 * Build a record with one fresh entry per layer, so callers can add
 * into it without an `undefined` check on every key.
 * @param make - factory for one layer's zero value
 * @returns a record keyed by every layer
 */
export function perLayer<T>(make: () => T): Record<Layer, T> {
  return {
    src: make(),
    "src/parse": make(),
    "src/parse/lines": make(),
    "src/print": make(),
  };
}
