/**
 * The list-shape sweep at DEPTH 5 — the whole product, 111,121
 * documents, ~26 s.
 *
 * It is NOT in the default suite, and that is the only difference from
 * `list-shape-sweep.test.ts`: same alphabet, same named shapes, same
 * verdict, same strict set-equality against the same allowlist. It ran
 * in `bun run test` and owned the suite's entire wall time; it now runs
 * under `bun run test:deeply-nested-lists`, in CI's blocking `gates` job, and as the
 * prelude to `bun run mutate` and `bun run mutate:full` so a mutation
 * baseline is never taken without it.
 *
 * This entry holds the FULL 158-entry assertion. A new failure is a
 * regression; a shape leaving the list is progress that must be moved
 * out of `list-shape-allowlist.ts` deliberately, by the commit that
 * fixes its family, and named there. Nothing here samples.
 */
import { describe, expect, test } from "vitest";
import { DEEP_DEPTH, sweepFailures } from "./list-shape-sweep.js";
import { FAILING_TODAY } from "./list-shape-allowlist.js";

describe("list-shape sweep (depth 5, deep)", () => {
  test("the render-equality/idempotence failing set is exactly the allowlist", async () => {
    const failing = await sweepFailures(DEEP_DEPTH);
    expect(failing).toEqual([...FAILING_TODAY].toSorted());
  }, 600_000);
});
