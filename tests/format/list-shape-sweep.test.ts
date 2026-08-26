/**
 * The list-shape sweep at DEPTH 4, in the default suite.
 *
 * Exhaustive over every body of length 1-4 the ten symbols spell, plus
 * the named shapes whose bodies are longer — 11,128 documents in 1.6s,
 * no sampling and no PRNG. Its deeper half lives in
 * `list-shape-sweep.deep.test.ts` and runs under `bun run test:deeply-nested-lists`;
 * the split is wall time and nothing else (the depth-5 product was
 * 25.6s of a 26.1s suite), and the machinery both entries sweep is one
 * module so they cannot disagree about what a document is.
 *
 * WHY FOUR and not the three the split was specified at: the mutation
 * harness runs THIS suite, not `test:deeply-nested-lists`, so every mutant the sweep
 * used to kill has to be killed at the shallow depth or not at all.
 * Measured on a seeded `list-hazard.ts` mutant (`startsWith` →
 * `endsWith` on the comment head): survives depth 3, dies at depth 4.
 * See {@link SHALLOW_DEPTH}.
 *
 * The allowlist is DERIVED, not copied: `allowlistFor(4)` is the deep
 * sweep\'s 158-entry allowlist filtered to the documents this shallower
 * product spells — 4 of them today. A shape can never be allowlisted
 * here without being allowlisted in the deep sweep first, and a new
 * failure at any depth ≤ 4 fails `bun run test`.
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
// The ledger is DERIVED to this depth from the depth-5 file, the same
// way `allowlistFor` derives: a document cannot be ledgered here
// without being ledgered in the deep sweep first.
describe("reading invariant sweep (depth 4)", () => {
  test("the reading-violation set is exactly the ledger", async () => {
    const failing = await readingFailures(SHALLOW_DEPTH);
    expect(failing).toEqual(readingLedgerFor(SHALLOW_DEPTH));
  }, 300_000);
});
