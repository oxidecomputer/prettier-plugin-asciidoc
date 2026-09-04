/**
 * Coupling: import edges, cycles, self-imports and unresolved relative
 * specifiers, all from `dependency-cruiser`.
 *
 * This used to be a regex import scan plus a hand-rolled
 * Tarjan pass. Both are now an established tool's job — the same tool
 * the architecture suite gates on, so the number in the scorecard and
 * the number in the test can never drift apart.
 *
 * Coupling is the metric complexity cannot see: whether understanding
 * one file means opening six. Cycles are the hard case — a cyclic
 * group has no reading order at all — so they are a gate rather than a
 * report.
 *
 * The DIRECTION of an edge is the other hard case, and it is what the
 * layer rules below state: each one is a direction, not a symbol list,
 * so it costs nothing to maintain and cannot be satisfied by moving a
 * name.
 */
import { realpathSync } from "node:fs";
import path from "node:path";
import {
  cruise,
  type ICruiseResult,
  type IForbiddenRuleType,
} from "dependency-cruiser";
import { ZERO } from "./model.js";

// Index of the last element, for dropping a cycle's repeated tail.
const LAST = -1;

/**
 * The layer rules, as directions.
 *
 * The stack is `ast` ← `constants`/`positions` ← `line-shapes` ←
 * `inline/` ← `build/` ← `lines/`, with `print/` reaching into
 * `parse/` at exactly three deliberate addresses and `parse/` never
 * reaching into `print/`.
 *
 * Each `path` is TAIL-anchored (`(^|/)src/…`) rather than
 * start-anchored, because dependency-cruiser reports a module's
 * `source` relative to the process's own directory: at HEAD that is
 * `src/parse/build/list.ts`, but for a `--base` revision materialized
 * into a temp directory it is `../../private/var/…/src/parse/build/
 * list.ts`. A start-anchored rule would match neither, and a rule that
 * silently matches nothing is the failure mode this whole file's
 * design is written against.
 */
const LAYER_RULES: IForbiddenRuleType[] = [
  {
    name: "print-imports-parse-off-address",
    severity: "error",
    comment:
      "print/ reads parse/ at exactly three addresses — line-shapes.ts for what a re-parsed LINE means, attrlist.ts for where one attribute inside a bracket line ENDS, and inline/quote-boundaries.ts for what may stand beside a constrained formatting MARK. All three exist so the formatter and the parser cannot disagree about a spelling the printer has to reproduce; any other parse/ import is the printer reaching into the parser's interior.",
    from: { path: "(^|/)src/print/" },
    to: {
      path: "(^|/)src/parse/",
      pathNot: String.raw`(^|/)src/parse/(line-shapes|attrlist|inline/quote-boundaries)\.ts$`,
    },
  },
  {
    name: "parse-imports-print",
    severity: "error",
    comment:
      "parse/ never imports print/ DIRECTLY. The parser produces the AST; the printer consumes it, and a direct edge this way makes the two one layer. Only a direct edge: a forbidden rule matches one dependency, and dependency-cruiser's via/viaOnly restrictions narrow CYCLES, not transitive reach (src/validate/matchers.mjs tests them only where a dependency carries a cycle). Six transitive edges stand today, all of them through src/block-metadata.ts, the root-level module whose own header argues for the shared home that makes them legal: src/parse/lines/held-metadata.ts and src/parse/lines/reader.ts each reach src/print/reflow.ts, src/print/serialize-inline.ts and src/print/whitespace-fold.ts. Making the rule transitive is `to: { reachable: true }`, which reports exactly those six and would have to name the shared home as its exception; that is a layering decision, not a rule repair.",
    from: { path: "(^|/)src/parse/" },
    to: { path: "(^|/)src/print/" },
  },
  {
    name: "build-imports-lines",
    severity: "error",
    comment:
      "Builders are pure (lines, index) -> Node constructors BELOW the reader. An import from build/ back up into lines/ inverts the stack and is what stopped the layering from being a rule a tool could enforce.",
    from: { path: "(^|/)src/parse/build/" },
    to: { path: "(^|/)src/parse/lines/" },
  },
];

// Type-only imports count: `import type` still makes one file's meaning
// depend on another's, and excluding them would let a refactor "reduce
// coupling" by adding a keyword. `tsPreCompilationDeps` is what keeps
// them in the graph.
//
// `validate: true` is what ARMS the rule set. It defaults to false, and
// with it off a cruise carrying rules reports zero violations rather
// than an error — the same silent-disarm shape that once switched the
// cycle gate off. `tests/scripts/metrics.test.ts` plants a violating
// tree as the positive control, so the flag going false fails a test
// rather than turning three gates green.
const CRUISE_OPTIONS = {
  doNotFollow: { path: "node_modules" },
  tsPreCompilationDeps: true,
  validate: true,
  ruleSet: { forbidden: LAYER_RULES },
};

/**
 * One cycle's canonical key: the same loop reported from each of its
 * members has to collapse to one entry, so the node list is rotated to
 * start at its lexicographically smallest member.
 * @param cycle - the files of one circular path, in import order
 * @returns a key equal for every rotation of the same cycle
 */
function cycleKey(cycle: string[]): string {
  const [smallest = ""] = cycle.toSorted();
  const at = cycle.indexOf(smallest);
  return [...cycle.slice(at), ...cycle.slice(ZERO, at)].join(" -> ");
}

/** What one cruise says about a tree's imports. */
export interface ImportGraph {
  /** Unique resolved file-to-file edges inside the cruised tree. */
  edges: number;
  /** One file list per circular path, in the order they import. */
  cycles: string[][];
  /** Files that import themselves. */
  selfImports: string[];
  /** Relative specifiers that resolve to no file, as `from -> spec`. */
  unresolved: string[];
  /**
   * Edges that break a layer rule, as `from -> to (rule name)`. Empty
   * is the only passing value; see {@link LAYER_RULES}.
   */
  layerViolations: string[];
}

/**
 * Cruise one checkout's source tree.
 *
 * The tree is named by ABSOLUTE path and `baseDir` is not used:
 * dependency-cruiser reports `source` relative to `baseDir` but
 * `resolved` relative to the process's own directory, so mixing the
 * two silently produced zero edges for any tree that was not the
 * current directory — which is every base revision. With one absolute
 * root, both sides come back on the same base and the caller
 * relativizes them itself.
 * @param root - checkout root, already resolved through symlinks
 * @param directory - the tree to cruise, relative to the root
 * @returns the raw cruise result
 */
async function cruiseTree(
  root: string,
  directory: string,
): Promise<ICruiseResult> {
  const result = await cruise([path.join(root, directory)], {
    ...CRUISE_OPTIONS,
    // `./foo.js` on disk is `./foo.ts`: TypeScript's own resolution
    // rules, which dependency-cruiser applies from the tsconfig.
    tsConfig: { fileName: path.join(root, "tsconfig.json") },
  });
  if (typeof result.output === "string") {
    throw new TypeError("expected a cruise result object, not a report");
  }
  return result.output;
}

/**
 * Import edges, cycles, self-imports and unresolved relative
 * specifiers for one checkout.
 * @param root - checkout root; must contain `tsconfig.json`
 * @param directory - the tree to cruise, relative to the root
 * @returns the coupling facts
 */
export async function cruiseImports(
  root: string,
  directory = "src",
): Promise<ImportGraph> {
  // Through symlinks, because macOS reports the temp directory as
  // `/var/...` while the resolver answers `/private/var/...`, and the
  // two spellings would count one file as two.
  const base = realpathSync(root);
  const output = await cruiseTree(base, directory);
  const relative = (file: string): string =>
    path.relative(base, path.resolve(process.cwd(), file));
  const prefix = `${directory}/`;
  // UNIQUE file-to-file pairs, not dependency entries: two statements
  // reaching the same module (an import and a re-export, say) are one
  // file a reader has to open, and counting them twice would make a
  // split look worse than it is.
  const edges = new Set<string>();
  const selfImports: string[] = [];
  const unresolved: string[] = [];
  for (const module of output.modules) {
    const source = relative(module.source);
    for (const dependency of module.dependencies) {
      if (dependency.couldNotResolve) {
        // External packages are reported unresolvable too when they
        // are not followed; only a RELATIVE specifier that resolves to
        // nothing is a hole in the graph.
        if (dependency.module.startsWith(".")) {
          unresolved.push(`${source} -> ${dependency.module}`);
        }
        continue;
      }
      const target = relative(dependency.resolved);
      if (target === source) {
        selfImports.push(source);
      } else if (target.startsWith(prefix)) {
        edges.add(`${source} -> ${target}`);
      }
    }
  }
  return {
    edges: edges.size,
    cycles: cyclesOf(output, relative),
    selfImports,
    unresolved,
    layerViolations: layerViolationsOf(output, relative),
  };
}

/**
 * Every edge one of the layer rules forbids, once each.
 *
 * Read off the cruise's own violation list, which is populated because
 * `CRUISE_OPTIONS` asks for validation. A violation names its rule, so
 * the message says which DIRECTION was broken rather than just which
 * two files touched.
 * @param output - a cruise result
 * @param relative - maps a cruised path to a root-relative one
 * @returns one `from -> to (rule)` string per forbidden edge
 */
function layerViolationsOf(
  output: ICruiseResult,
  relative: (file: string) => string,
): string[] {
  return output.summary.violations.map(
    (violation) =>
      `${relative(violation.from)} -> ${relative(violation.to)} (${violation.rule.name})`,
  );
}

/**
 * Every circular import path in a cruise result, once each.
 *
 * Read off each dependency's own `circular`/`cycle` fields rather than
 * off a rule violation: the fields are always populated, whereas
 * violations only appear when the cruise is asked to validate a rule
 * set — a distinction that silently disarmed this gate once already.
 * @param output - a cruise result
 * @param relative - maps a cruised path to a root-relative one
 * @returns one file list per cycle, in import order, first file repeated last
 */
function cyclesOf(
  output: ICruiseResult,
  relative: (file: string) => string,
): string[][] {
  const byKey = new Map<string, string[]>();
  for (const module of output.modules) {
    for (const dependency of module.dependencies) {
      if (!dependency.circular) {
        continue;
      }
      const path_ = [
        relative(module.source),
        ...(dependency.cycle ?? []).map((step) => relative(step.name)),
      ];
      // The last hop returns to the start; drop it for the key, keep
      // it in the message so the loop reads as a loop.
      const key = cycleKey(path_.slice(ZERO, LAST));
      if (!byKey.has(key)) {
        byKey.set(key, path_);
      }
    }
  }
  return [...byKey.values()];
}
