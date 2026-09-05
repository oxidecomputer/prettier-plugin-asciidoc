/**
 * The reparse pin's DEEP tier: the corpus, both registries' standing
 * grids, and the line registry's PAIR grid, which is where the
 * mechanisms this check exists to find actually live - a join, a
 * de-indent and a dropped blank all need an ADJACENCY, and nothing
 * else enumerates adjacencies.
 *
 * A `.deep.test.ts` entry for the reason the registry sweep has one:
 * 87,145 documents formatted twice is more than a suite run on every
 * save can carry and well inside what the blocking deep step
 * (`bun run test:deeply-nested-lists`) can. The default entry gates
 * the same ledger restricted to its corpus rows, so a document cannot
 * be pinned at one tier and not the other.
 */
import { describe, expect, test } from "vitest";
import {
  MINIMUM_POPULATION,
  deepTierCases,
  ledgerKey,
  loadReparseLedger,
  measuredKeys,
} from "./reparse-ledger.js";

describe("the reparse ledger, deep tier", () => {
  test("the measured breaches are exactly the ledgered ones", async () => {
    const cases = deepTierCases();
    // The measured-nothing floor, asserted BEFORE the comparison: set
    // equality is green when both sides are empty, so a population
    // that did not load would pass this gate rather than fail it.
    expect(cases.length).toBeGreaterThanOrEqual(MINIMUM_POPULATION);
    const measured = await measuredKeys(cases);
    const pinned = loadReparseLedger().map((row) => ledgerKey(row));
    expect(measured.toSorted()).toEqual(pinned.toSorted());
  }, 900_000);
});
