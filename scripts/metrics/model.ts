/**
 * The scorecard's vocabulary: what a measurement IS, and which layer
 * each file belongs to.
 *
 * This module is a leaf on purpose — every other module under
 * `scripts/metrics/` imports it and it imports none of them, so the
 * script obeys the same no-cycles rule it measures. The two constants
 * it re-exports come from `scripts/lib/`, which every harness in this
 * directory shares: the repository root and the child-process buffer
 * are facts about the CHECKOUT, not about the scorecard, and one of
 * the three copies they used to have was subtly wrong.
 */

// The three types this leaf does not declare itself: each is shaped
// by the module that READS it — the internal surface, the conformance
// pin, the minimums file — and re-declaring them here would be a second
// spelling of one contract. Type-only imports, so the value graph
// still runs one way.
import type { ConformanceFacts } from "./conformance.js";
import type { MinimumsFacts } from "./score-minimums.js";
import type { InternalFacts } from "./internal-surface.js";

// Re-exported rather than redeclared: the modules under
// `scripts/metrics/` reach the shared vocabulary through this one
// leaf, so a second spelling cannot appear.
export { CHILD_MAX_BUFFER, REPO_ROOT } from "../lib/checkout.js";

// Shared small constants, so the modules under `scripts/metrics/` do
// not each redeclare them.

/** Zero, for counters and empty totals. */
export const ZERO = 0;

/** One, for increments. */
export const ONE = 1;

/** `indexOf`'s miss value. */
export const NOT_FOUND = -1;

/**
 * The comment markers the defense inventory counts, keyed by the
 * {@link Defense} field each one feeds.
 *
 * They live here, in the shared vocabulary, because two modules read
 * them: `scan.ts` counts them out of each file's comment trivia, and
 * `gates.ts` names them in a ratchet failure. Each marker must stay on
 * ONE line where it is written — the count is over comment text, and an
 * 80-column wrap that splits a marker in two hides the defense from the
 * inventory. `docs/harnesses.md` defines what each one means.
 */
export const DEFENSE_MARKERS = {
  callerContract: "Caller contract:",
  totalFallback: "Total fallback:",
  validOnlyWhen: "Valid only when",
} as const;

/** Which {@link Defense} counter one comment marker feeds. */
export type MarkerKey = keyof typeof DEFENSE_MARKERS;

/**
 * The function whose call sites count as a thrown can't-happen guard.
 * Counted as CALL EXPRESSIONS rather than by text: the one
 * prose mention of it under `src` — in `reflow.ts`, explaining why a
 * site is a silent strip instead — must not read as a call.
 */
export const UNREACHABLE_CALLEE = "unreachable";

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

// The printer layer is the `src/print/` directory; the two extra
// alternatives are dead since the modules moved in, kept so the
// pattern also matches historical revisions in differential runs.
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
  /** `unreachable(…)` call sites, as AST call expressions. */
  unreachableCalls: number;
  /** Defense-marker occurrences in this file's comments. */
  markers: Record<MarkerKey, number>;
  /** Markers a line wrap has hidden, as `line: marker`. */
  markerNearMisses: string[];
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

/**
 * What the third-party tools found. Both knip and jscpd are
 * devDependencies and run on every measurement; `undefined` means the
 * tool could not run, not that it was skipped.
 */
export interface DeadCode {
  /** knip unused exports, types and members under `src`. */
  unusedExports: number | undefined;
  /** The same count over `scripts`. */
  unusedScriptExports: number | undefined;
  /**
   * The same count over `tests`: the harness's own shared modules
   * (`tests/helpers.ts`, `tests/lib/*.ts` and the rest), not the
   * `*.test.ts` files themselves, which knip treats as entry points.
   */
  unusedTestExports: number | undefined;
  /** jscpd duplicated-line percentage over `src`, `scripts` and `tests`. */
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
  /**
   * Edges a layer rule forbids, as `from -> to (rule name)`. The
   * layering is a DAG or it is a diagram; see `graph.ts`.
   */
  layerViolations: string[];
}

/**
 * How wide one NAMED cross-module interface is: the size of the
 * vocabulary two modules have to share to meet across it.
 *
 * Named, not inferred: an interface with a name is a seam somebody
 * decided to have, and for a CONTRACT its member count is the
 * denominator in Ousterhout's "deep module" ratio — the thing a
 * refactor can shrink deliberately.
 */
export interface SeamWidth {
  /** The interface's name, as the registry spells it. */
  name: string;
  /** The file it is declared in, relative to the measured root. */
  file: string;
  /**
   * Which kind of crossing it is. A CONTRACT is what an implementer
   * satisfies and is judged by width, so it ratchets; VOCABULARY is
   * data used in interface definitions and is judged by precision, so
   * its width is reported and not ratcheted. See `design.ts`.
   */
  kind: "contract" | "vocabulary";
  /**
   * Property and method signatures on the declaration, or undefined
   * when that file does not declare it at this revision — which is how
   * a seam that did not yet exist ratchets from absent, and (at HEAD)
   * what the head-absent gate fires on.
   */
  members: number | undefined;
  /**
   * Why the seam cannot be measured as declared — it inherits, or it
   * is split across merged declarations — or undefined when it can. A
   * named seam must be ONE flat declaration; see `design.ts`.
   */
  fault: string | undefined;
}

// Not exported, for the same reason `Coupling` and `Hatches` below are
// not: only `Snapshot` names it, and an export nothing imports is
// exactly what the scorecard's knip row counts.
/**
 * The RESIDUAL DEFENSE BURDEN: code that defends against states the
 * types still permit.
 *
 * Type precision — "how much of the invalid space is unrepresentable" —
 * is the formal notion and is not computable here, so this counts the
 * defenses that REMAIN instead. Every field is a budget to ratchet
 * down, and a defense may only be deleted together with its need. See
 * `docs/harnesses.md`.
 */
interface Defense {
  /** `unreachable(…)` call sites under `src`. */
  unreachableCalls: number;
  /** `Caller contract:` marker occurrences under `src`. */
  callerContract: number;
  /** `Total fallback:` marker occurrences under `src`. */
  totalFallback: number;
  /** `Valid only when` marker occurrences under `src`. */
  validOnlyWhen: number;
  /**
   * Hand-audited interior-validation sites: the length of
   * `scripts/metrics/defense-registry.json`, or undefined at a
   * revision that has no registry to read.
   */
  interiorValidation: number | undefined;
  /**
   * Registry entries whose site is gone from the code, as
   * `file: function`. Non-empty means the registry has rotted, which
   * is a hard gate rather than a row.
   */
  staleEntries: string[];
  /**
   * Why the registry could not be read as one: missing, unparseable,
   * or holding a malformed entry. A hard gate at HEAD; at an archived
   * base nothing reads it, which is what keeps a historical revision
   * with no registry reporting `n/a` instead of failing.
   */
  registryFaults: string[];
  /**
   * Markers a line wrap has hidden from the counts, as
   * `file:line: marker`. A hard gate: the marker counters can only
   * fail in this direction, and it reads as progress.
   */
  markerNearMisses: string[];
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

/**
 * The crossings registry's own health: how many cross-directory
 * symbol crossings are named, and both directions of the membership
 * check. See `crossings.ts`.
 */
interface Crossings {
  /** Registry length, or undefined at a revision with no registry. */
  registered: number | undefined;
  /** Crossings no row names, as `file symbol -> importer`. */
  unregistered: string[];
  /** Rows whose crossing is gone, as `file symbol -> importer`. */
  stale: string[];
  /** Why the registry could not be read as one. */
  faults: string[];
}

/** Everything measured at one revision. */
export interface Snapshot {
  /** Column label for the table: a revision, or "head". */
  label: string;
  /**
   * Whether the measured checkout is THIS repository, and so the one
   * this repository's hand-maintained registries describe.
   *
   * False for an archived `--base` revision and for a `--root <dir>`
   * checkout. Those are measured — every number on the table is real —
   * but not JUDGED by the seam list, the interior-validation registry
   * or the marker convention, none of which is a fact about them. See
   * `gates.ts`.
   */
  repository: boolean;
  /** Size per layer. */
  layers: Record<Layer, LayerTotals>;
  /** eslint `complexity` per layer. */
  cyclomatic: Record<Layer, ComplexityTotals>;
  /** `sonarjs/cognitive-complexity` per layer. */
  cognitive: Record<Layer, ComplexityTotals>;
  /**
   * Functions over the cyclomatic tail, by name — the tail count is
   * report-only, and a report-only number is only useful if it says
   * WHICH functions.
   */
  cyclomaticOver: Offender[];
  /** Import edges, cycles and exported symbols. */
  coupling: Coupling;
  /** Escape-hatch counts. */
  hatches: Hatches;
  /** Member count per named seam, in the registry's report order. */
  seams: SeamWidth[];
  /** The residual defense burden. */
  defense: Defense;
  /** The crossings registry's length and both staleness directions. */
  crossings: Crossings;
  /**
   * Resident AGREEMENT HARNESSES, by test path — the category
   * `scripts/metrics/design.ts` defines. The gate is that this stays
   * empty, so a non-empty list is always a failure to read, never a
   * number to compare.
   */
  harnesses: string[];
  /**
   * The `@internal` split of the `src` export surface: how much of it
   * exists for tests alone, and whether the tags are honest. See
   * `scripts/metrics/internal-surface.ts`.
   */
  internal: InternalFacts;
  /**
   * The quarantine manifest's length and the pin that makes moving it
   * deliberate. See `scripts/metrics/conformance.ts`.
   */
  conformance: ConformanceFacts;
  /**
   * The coverage/mutation minimums file's size and health. The NUMBERS
   * are checked by the runs that measure them (`bun run coverage`,
   * `bun run mutate`); the scorecard checks that the file still
   * describes the source tree. See `scripts/metrics/score-minimums.ts`.
   */
  minimums: MinimumsFacts;
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
  if (!file.startsWith("src/")) {
    return [];
  }
  const layers: Layer[] = ["src"];
  if (file.startsWith("src/parse/")) {
    layers.push("src/parse");
  }
  if (file.startsWith("src/parse/lines/")) {
    layers.push("src/parse/lines");
  }
  if (PRINT_FILES.test(file)) {
    layers.push("src/print");
  }
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
