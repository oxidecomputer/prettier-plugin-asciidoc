/**
 * The list-shape sweep over `DEEP_DEPTH`, against the WHOLE of both
 * pinned files.
 *
 * It is NOT in the default suite: it runs under
 * `bun run test:deeply-nested-lists`, in CI's blocking `gates` job, and as the
 * prelude to `bun run mutate` and `bun run mutate:full` so a mutation
 * baseline is never taken without it.
 *
 * Same alphabet, same named shapes, same verdict as
 * `list-shape-sweep.test.ts`, and today the same depth. What is only
 * here is the UNFILTERED comparison: this entry holds the FULL
 * `FAILING_TODAY` and the full reading ledger, so an entry for a
 * document no product spells fails here rather than being filtered
 * away and sitting in its file forever. A new failure is a
 * regression; a shape leaving either file is progress that must be
 * moved out deliberately, by the commit that fixes its family, and
 * named there. Nothing here samples.
 */
import { describe, expect, test } from "vitest";
import {
  DEEP_DEPTH,
  readingFailures,
  sweepFailures,
} from "./list-shape-sweep.js";
import { compareLedgerRows, loadReadingLedger } from "../lib/reading-ledger.js";
import { FAILING_TODAY } from "./list-shape-allowlist.js";

describe("list-shape sweep (deep, whole allowlist)", () => {
  test("the render-equality/idempotence failing set is exactly the allowlist", async () => {
    const failing = await sweepFailures(DEEP_DEPTH);
    expect(failing).toEqual([...FAILING_TODAY].toSorted());
  }, 600_000);
});

// The REFLOW RE-CLASSIFICATION gate (issue #58) over the whole
// ledger, by strict set equality, on the same terms as the allowlist
// above - a new violation is a regression, and a document leaving the
// ledger is progress the fixing commit refreshes deliberately
// (`bun run reading-ledger --write`) and names.
//
// The WHOLE file, unfiltered, exactly as the allowlist gate above
// compares against all of FAILING_TODAY. The default entry gates
// against the rows its product spells and can see no further; this
// entry sweeps the product the ledger was generated from, so a row
// for a document the product no longer spells has nowhere left to
// hide and fails here.
//
// Most of these rows are render-EQUAL and idempotent today, so the
// sweep above passes every one of them: this is the population issue
// #58 was filed to enumerate, and no other gate can see it. The
// measured breakdown lives in docs/harnesses.md, beside the refresh
// instruction, so it goes stale in one place rather than two.
describe("reading invariant sweep (deep, whole ledger)", () => {
  test("the reading-violation set is exactly the ledger", async () => {
    const failing = await readingFailures(DEEP_DEPTH);
    expect(failing).toEqual(loadReadingLedger().toSorted(compareLedgerRows));
  }, 600_000);
});
