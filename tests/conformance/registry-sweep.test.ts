/**
 * The registry sweep's DEFAULT tier, in `bun run test`.
 *
 * The standing grid crossed with the byte operators, run through the
 * crash/idempotency/fidelity properties and pinned to
 * `registry-sweep-quarantine.json` by exact agreement, in the
 * `tests/format/list-shape-sweep.test.ts` style: the actual failing
 * set must equal the manifest entry for entry, so a coordinate that
 * starts failing fails the suite AND a quarantined coordinate that
 * gets fixed fails it too, until its entry is deleted. That second
 * direction is what makes the manifest shrink instead of rot.
 *
 * The pair grid and its perturbations are the DEEP tier
 * (`registry-sweep.deep.test.ts`): the split is wall time, measured,
 * and nothing else. Every deep row is a row this entry would run if
 * it were free, which is also why this file's own rows are a strict
 * subset of the deep tier's and run again there in CI's blocking job.
 * Kept here anyway: StrykerJS never sees the deep tier, so this file
 * is the only registry-sweep coverage a mutation run gets.
 *
 * It is also where the DEEP tier's population is pinned, for that
 * same reason: the deep entry's own gate is its failure manifest,
 * which says nothing about a grid that stopped being swept, and no
 * mutation run reaches the deep file to notice.
 */
import { describe, expect, test } from "vitest";
import { byId, expectedFailures } from "./generated-sweep.js";
import {
  deepTierRows,
  defaultTierRows,
  loadSweepQuarantine,
  sweepFailures,
} from "./registry-sweep.js";

/**
 * How many rows `deepTierRows()` yields: the standing grid crossed
 * with `BYTE_OPERATORS`, then the pair grid crossed with
 * `PAIR_BYTE_OPERATORS`, each shape contributing its unperturbed row
 * plus one row per operator that changed its bytes.
 *
 * It counts the rows the sweep CONSUMES, not `pairGrid().length`,
 * which the census already pins. A grid can be dropped from
 * `deepTierRows()` without any generator shrinking, and the deep
 * manifest would then agree with itself over whatever is left: every
 * cluster it names comes from the pair grid, so losing the standing
 * half moves nothing, and losing the pair half empties the manifest
 * in the direction an exact pin is meant to catch but a hand
 * regenerating it would not question.
 *
 * Directionless, like the census pins: neither a bigger nor a smaller
 * number is a win, and the number moves in the same commit as the
 * change that earns it.
 */
const DEEP_TIER_ROWS = 56_181;

describe("registry sweep (default tier)", () => {
  test("the failing set is exactly the quarantine manifest", async () => {
    expect(byId(await sweepFailures(defaultTierRows()))).toEqual(
      expectedFailures(loadSweepQuarantine()),
    );
  }, 300_000);

  test("the deep tier consumes both grids, at the pinned row count", () => {
    // Red before the pin existed under a `deepTierRows()` that
    // dropped either grid: the count alone catches that, and the
    // prefix assertions say which half went so the failure names the
    // grid rather than an arithmetic difference.
    const rows = deepTierRows();
    expect(rows).toHaveLength(DEEP_TIER_ROWS);
    expect(rows.some((row) => row.id.startsWith("pair/"))).toBe(true);
    expect(rows.some((row) => !row.id.startsWith("pair/"))).toBe(true);
  });
});
