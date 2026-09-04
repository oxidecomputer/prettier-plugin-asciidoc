/**
 * The inline sweep: the documents `scripts/inline-registry.ts`
 * generates, run through the same three differential properties
 * `tests/conformance/registry-sweep.ts` runs on the line registry's
 * grids.
 *
 * The two generated sweeps do not overlap. The line registry builds
 * documents out of LINES and never varies the text within one, so no
 * row it mints reaches a mark boundary, an attrlist in front of a
 * span, an escape or a reflow that moves a delimiter away from its
 * content. Those are where the inline reader's bugs have actually
 * been found, and until this sweep existed they had no standing
 * enumeration at all: each was found by a throwaway generator written
 * during the fix and thrown away after it.
 *
 * The verdict is not restated here. `sweepFailures` already runs
 * crash, idempotency and fidelity over any row set, and a second copy
 * of that logic could disagree with the first about what a crash
 * means; this module supplies rows and the two manifests, and borrows
 * the assessment.
 *
 * NO ROW IS RENDER-BLIND. Every context puts the construct inside a
 * block that renders, so the fidelity comparison is never vacuous by
 * construction the way it is for a comment block in the line
 * registry. The flag is set false for every row and nothing here
 * varies it.
 *
 * The row sets are TIERED, and the split is wall time and nothing
 * else:
 *
 * - the DEFAULT tier is the standing grid, clean. 17,349 rows, about
 *   three and a half seconds run on its own.
 * - the DEEP tier is that grid crossed with every byte operator, plus
 *   the whole pair product. 474,908 rows, about two minutes.
 *
 * Both figures are WALL TIME on an idle machine and move with load:
 * inside `bun run test` vitest reports the default tier at nearer six
 * seconds, while the suite's own wall time moves by under a second,
 * because the line registry's default tier is the longer pole. Treat
 * them as the order of magnitude the split was decided on, not as
 * pins.
 *
 * The byte operators are entirely a deep-tier concern, which is a
 * budget ruling and not a claim that they do not matter inline: they
 * multiply the row count by nine, and what the always-on budget buys
 * instead is the whole inline alphabet at every neighbourhood and
 * every context. The pair grid is NOT crossed with them at all - that
 * product is two million rows for a dimension the standing grid
 * already crosses with the same alphabet.
 *
 * Failures are held by two manifests on the same exact-agreement
 * terms the line registry's are: a coordinate must fail exactly the
 * properties its entry names, so a fixed gap turns the row red until
 * the entry is deleted.
 *
 * A LIBRARY module: the row sets and the manifests, with the gates
 * that consume them living in their own test files.
 */

import {
  inlinePairGrid,
  inlineStandingGrid,
  type InlineShape,
} from "../../scripts/inline-registry.js";
import { crossByteOperators } from "./generated-sweep.js";
import { loadQuarantine, type QuarantineEntry } from "./quarantine.js";
import type { SweepRow } from "./registry-sweep.js";

/**
 * One inline sweep row: a `SweepRow` that also remembers which
 * failure class it would belong to.
 *
 * The cluster coordinate rides on the row rather than being parsed
 * back out of the id. The line registry's deep manifest reads its
 * clusters off the id because the id is the only witness it has; here
 * the registry knows the kind, the neighbourhood and the join while
 * it is building the shape, so the answer is carried forward instead
 * of reconstructed - total, and immune to an id-spelling change.
 */
export interface InlineSweepRow extends SweepRow {
  /**
   * The failure class this row joins, WITHOUT the properties it
   * failed: the deep manifest appends those. It is the registry's own
   * cluster, unchanged - the BYTE OPERATOR is deliberately not part
   * of it. Measured: every inline failure class spans all nine
   * operators uniformly, so keying on the operator would turn 24
   * classes into 169 spellings of the same finding, and a class that
   * ever did belong to one operator alone would still move the
   * cluster's count and its digest.
   */
  readonly cluster: string;
}

/** Repo-relative manifest path for the default tier's known failures. */
export const INLINE_SWEEP_QUARANTINE_PATH =
  "tests/conformance/inline-sweep-quarantine.json";

/**
 * Reads the inline sweep's own quarantine manifest. A manifest of its
 * own, for the reason the line registry's sweep has one: these ids
 * name inline coordinates, and one file mixing two id spaces would
 * let a rename in either space silently excuse a failure in the
 * other.
 * @returns map from row id to its expected-failure entry
 */
export function loadInlineQuarantine(): Map<string, QuarantineEntry> {
  return loadQuarantine(INLINE_SWEEP_QUARANTINE_PATH);
}

/**
 * The rows an always-on suite runs: the standing grid, clean.
 * @returns the default-tier rows, in a stable order
 */
export function inlineDefaultTierRows(): InlineSweepRow[] {
  return inlineStandingGrid().map((shape) =>
    toRow(shape, shape.id, shape.input),
  );
}

/**
 * Every row the inline registry can mint: the standing grid clean and
 * under every byte operator, plus the whole pair grid.
 *
 * A SUPERSET of the default tier, deliberately, so one triage run can
 * write both manifests from one sweep instead of assessing the
 * standing grid twice.
 * @returns the deep-tier rows, in a stable order
 */
export function inlineDeepTierRows(): InlineSweepRow[] {
  return [
    ...withOperators(inlineStandingGrid()),
    ...inlinePairGrid().map((shape) => toRow(shape, shape.id, shape.input)),
  ];
}

/**
 * Crosses shapes with the byte-operator dimension, through the shared
 * crossing in `generated-sweep.ts`. The cluster rides along unchanged:
 * a perturbed row joins the failure class of the shape it came from.
 * @param shapes - the realized grid to cross
 * @returns the clean and perturbed rows, in a stable order
 */
function withOperators(shapes: readonly InlineShape[]): InlineSweepRow[] {
  return crossByteOperators(shapes, toRow);
}

/**
 * One realized shape as a sweep row, clean or perturbed.
 * @param shape - the realized shape
 * @param id - the row's id, which carries the byte operator if any
 * @param input - the row's bytes
 * @returns the row
 */
function toRow(shape: InlineShape, id: string, input: string): InlineSweepRow {
  return { id, input, renderBlind: false, cluster: shape.cluster };
}
