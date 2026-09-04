/**
 * The inline sweep's DEFAULT tier, in `bun run test`.
 *
 * The standing grid, clean: every alphabet member of the inline rule
 * table, in every neighbourhood, in every inline-bearing context, run
 * through the crash/idempotency/fidelity properties and pinned to
 * `inline-sweep-quarantine.json` by exact agreement. The actual
 * failing set must equal the manifest entry for entry, so a
 * coordinate that starts failing fails the suite AND a quarantined
 * coordinate that gets fixed fails it too, until its entry is
 * deleted. That second direction is what makes the manifest shrink
 * instead of rot.
 *
 * The byte operators and the pair product are the DEEP tier
 * (`inline-sweep.deep.test.ts`): the split is wall time, measured, and
 * nothing else.
 */
import { describe, expect, test } from "vitest";
import { byId, expectedFailures } from "./generated-sweep.js";
import { inlineDefaultTierRows, loadInlineQuarantine } from "./inline-sweep.js";
import { sweepFailures } from "./registry-sweep.js";

describe("inline sweep (default tier)", () => {
  test("the failing set is exactly the quarantine manifest", async () => {
    expect(byId(await sweepFailures(inlineDefaultTierRows()))).toEqual(
      expectedFailures(loadInlineQuarantine()),
    );
  }, 300_000);
});
