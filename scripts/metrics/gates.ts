/**
 * What makes `bun run metrics` fail.
 *
 * Three ABSOLUTE gates, checked with or without a base: an import
 * cycle (a cyclic group has no reading order), a relative import that
 * resolves to nothing (a hole in that graph, so the cycle gate cannot
 * see through it), and an unused export under `src` (the residue of a
 * half-finished deletion).
 *
 * Two RATCHETS, checked only against a `--base`: cognitive MAX per
 * layer, and the escape hatches. Neither may rise. A layer with no
 * files at the base is skipped, since a layer that did not exist
 * cannot have regressed.
 *
 * Deliberately NOT a gate: the count of functions over cyclomatic 10
 * (Ruling 35). Cyclomatic complexity cannot tell a flat `switch` over a
 * discriminated union from three nested loops, and this is a parser —
 * dispatch tables are the shape the code is supposed to have. Gating on
 * it would push the code towards handler tables that score better and
 * read worse, which is the wrong direction and the wrong metric. It
 * stays on the table, with its offenders named, for a human to read.
 * See `docs/simplicity-metrics.md`.
 */
import { LAYERS, ZERO, type Snapshot } from "./model.js";

// The escape-hatch rows, with the label each gets in a failure.
const HATCHES = [
  ["eslint-disable", "eslintDisable"],
  ["as assertions", "asAssertions"],
  ["non-null assertions", "nonNull"],
  ["any", "anyType"],
] as const;

/**
 * The gates that hold with or without a base.
 * @param head - the snapshot for this checkout
 * @returns one message per failure
 */
function absoluteGates(head: Snapshot): string[] {
  const failures: string[] = [];
  if (head.coupling.cycles.length > ZERO) {
    failures.push(
      `import cycle (a cycle has no reading order):\n  ${head.coupling.cycles.join("\n  ")}`,
    );
  }
  if (head.coupling.unresolved.length > ZERO) {
    failures.push(
      `relative import that resolves to nothing (a hole in the import graph):\n  ${head.coupling.unresolved.join("\n  ")}`,
    );
  }
  // Ruling 36: knip is a devDependency and runs every time, so
  // "it did not run" is a failure to report rather than a row to skip.
  // A hard gate that goes quiet when its tool is missing is not a gate.
  if (head.dead.unusedExports === undefined) {
    failures.push(
      "knip did not run, so the unused-export gate could not be checked",
    );
  } else if (head.dead.unusedExports > ZERO) {
    failures.push(
      `knip: ${String(head.dead.unusedExports)} unused export(s) under src/`,
    );
  }
  return failures;
}

/**
 * The ratchets: peak difficulty and escape hatches may not rise.
 *
 * Ratchets are what "apply the metrics constantly" means — a number
 * nobody has to answer for drifts.
 * @param head - the snapshot for this checkout
 * @param base - the base snapshot
 * @returns one message per regression
 */
function ratchets(head: Snapshot, base: Snapshot): string[] {
  const failures: string[] = [];
  for (const layer of LAYERS) {
    if (base.layers[layer].files === ZERO) continue;
    if (head.cognitive[layer].max > base.cognitive[layer].max) {
      failures.push(
        `cognitive MAX ${layer}: ${String(base.cognitive[layer].max)} -> ${String(head.cognitive[layer].max)}`,
      );
    }
  }
  for (const [name, key] of HATCHES) {
    if (head.hatches[key] > base.hatches[key]) {
      failures.push(
        `${name}: ${String(base.hatches[key])} -> ${String(head.hatches[key])}`,
      );
    }
  }
  return failures;
}

/**
 * Every reason this measurement should fail the build.
 * @param head - the snapshot for this checkout
 * @param base - the snapshot for `--base`, when one was given; without
 * it only the absolute gates run
 * @returns the failure messages; empty means exit 0
 */
export function gateFailures(head: Snapshot, base?: Snapshot): string[] {
  return [
    ...absoluteGates(head),
    ...(base === undefined ? [] : ratchets(head, base)),
  ];
}
