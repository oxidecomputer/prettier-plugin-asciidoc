/**
 * The list-shape sweep at DEPTH 4, in the default suite.
 *
 * Exhaustive over every body of length 1 to `SHALLOW_DEPTH` the alphabet
 * spells, plus the named shapes whose bodies are longer, no sampling
 * and no PRNG. `list-shape-sweep.deep.test.ts` sweeps the same
 * machinery outside the default suite and compares against the two
 * pinned files WHOLE rather than filtered; the machinery is one
 * module so the entries cannot disagree about what a document is.
 *
 * WHY FOUR and not the three the split was specified at: the mutation
 * harness runs THIS suite, not `test:deeply-nested-lists`, so every mutant the sweep
 * used to kill has to be killed at this depth or not at all.
 * Measured on a seeded `list-hazard.ts` mutant (`startsWith` to
 * `endsWith` on the comment head): survives depth 3, dies at depth 4.
 * See {@link SHALLOW_DEPTH}.
 *
 * The allowlist is DERIVED, not copied: `allowlistFor(SHALLOW_DEPTH)`
 * is `FAILING_TODAY` filtered to the documents this product spells,
 * and this entry asserts set equality against exactly that. WHICH
 * entries survive the filter is read off `list-shape-allowlist.ts`
 * rather than restated here, so the two cannot drift apart. A shape
 * can never be allowlisted here without being allowlisted for the
 * deep entry first, and a new failure at any depth up to
 * SHALLOW_DEPTH fails `bun run test`.
 */
import { describe, expect, test } from "vitest";
import {
  allowlistFor,
  readingFailures,
  readingLedgerFor,
  SHALLOW_DEPTH,
  sweepFailures,
} from "./list-shape-sweep.js";

describe("list-shape sweep (depth 4)", () => {
  test("the render-equality/idempotence failing set is exactly the allowlist", async () => {
    const failing = await sweepFailures(SHALLOW_DEPTH);
    expect(failing).toEqual(allowlistFor(SHALLOW_DEPTH).toSorted());
  }, 300_000);
});

// The REFLOW RE-CLASSIFICATION gate (issue #58), over the same
// product. A PARALLEL gate rather than another arm of `sweepFails`:
// the allowlist above states render/idempotence mechanism claims and
// this ledger states reading mechanisms, and the documents that sit in
// both are there for two different reasons. It consults no oracle, so
// it costs a fraction of the sweep beside it.
//
// The ledger is DERIVED to this depth from the whole file, the same
// way `allowlistFor` derives: a document cannot be ledgered here
// without being ledgered for the deep entry first.
describe("reading invariant sweep (depth 4)", () => {
  test("the reading-violation set is exactly the ledger", async () => {
    const failing = await readingFailures(SHALLOW_DEPTH);
    expect(failing).toEqual(readingLedgerFor(SHALLOW_DEPTH));
  }, 300_000);
});
