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
 * it were free.
 */
import { describe, expect, test } from "vitest";
import { byId, expectedFailures } from "./generated-sweep.js";
import {
  loadSweepQuarantine,
  defaultTierRows,
  sweepFailures,
} from "./registry-sweep.js";

describe("registry sweep (default tier)", () => {
  test("the failing set is exactly the quarantine manifest", async () => {
    expect(byId(await sweepFailures(defaultTierRows()))).toEqual(
      expectedFailures(loadSweepQuarantine()),
    );
  }, 300_000);
});
