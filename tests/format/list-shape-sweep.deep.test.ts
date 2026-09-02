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
 * This entry holds the FULL 26-entry assertion. A new failure is a
 * regression; a shape leaving the list is progress that must be moved
 * out of `list-shape-allowlist.ts` deliberately, by the commit that
 * fixes its family, and named there. Nothing here samples.
 */
import { describe, expect, test } from "vitest";
import {
  DEEP_DEPTH,
  readingFailures,
  sweepFailures,
} from "./list-shape-sweep.js";
import { compareLedgerRows, loadReadingLedger } from "../lib/reading-ledger.js";
import { FAILING_TODAY } from "./list-shape-allowlist.js";

describe("list-shape sweep (depth 5, deep)", () => {
  test("the render-equality/idempotence failing set is exactly the allowlist", async () => {
    const failing = await sweepFailures(DEEP_DEPTH);
    expect(failing).toEqual([...FAILING_TODAY].toSorted());
  }, 600_000);
});

// The REFLOW RE-CLASSIFICATION gate (issue #58) at full depth: the
// whole ledger, by strict set equality, on the same terms as the
// allowlist above - a new violation is a regression, and a document
// leaving the ledger is progress the fixing commit refreshes
// deliberately (`bun run reading-ledger --write`) and names.
//
// The WHOLE file, unfiltered, exactly as the allowlist gate above
// compares against all of FAILING_TODAY. The depth-4 entry gates
// against the rows its shallower product spells, because it cannot
// see the rest; this entry sweeps the product the ledger was
// generated from, so a row for a document the product no longer
// spells has nowhere left to hide and fails here.
//
// Most of these rows are render-EQUAL and idempotent today, so the
// sweep above passes every one of them: this is the population issue
// #58 was filed to enumerate, and no other gate can see it. The
// measured breakdown lives in docs/harnesses.md, beside the refresh
// instruction, so it goes stale in one place rather than two.
describe("reading invariant sweep (depth 5, deep)", () => {
  test("the reading-violation set is exactly the ledger", async () => {
    const failing = await readingFailures(DEEP_DEPTH);
    expect(failing).toEqual(loadReadingLedger().toSorted(compareLedgerRows));
  }, 600_000);
});
