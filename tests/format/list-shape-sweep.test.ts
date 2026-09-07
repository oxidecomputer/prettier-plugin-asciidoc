/**
 * The list-shape sweep, in the default suite.
 *
 * Exhaustive over every body of length 1 to `DEEP_DEPTH` the alphabet
 * spells, plus the named shapes whose bodies are longer, no sampling
 * and no PRNG. `DEEP_DEPTH` in `list-shape-sweep.ts` says why four and
 * not three or five; the mutation harness runs THIS suite, so a mutant
 * the sweep kills has to die at that depth or not at all.
 *
 * FOUR gates, in two pairs. Each pair holds a pinned file to the
 * product one way and to the tree the other way, and the split is
 * what keeps a red run readable:
 *
 * - the SWEEP gates format each document twice and render both sides
 *   (render-equality and idempotence), or re-read the output (the
 *   reflow re-classification invariant, issue #58), and pin the
 *   failing set to the pinned file DERIVED to this product. A new
 *   failure is a regression; a pinned shape that started passing is a
 *   stale entry. They cost the sweep's wall time;
 * - the ORPHAN gates hold the derivation itself to the whole file: an
 *   entry for a document the product does not spell fails here rather
 *   than sitting in `list-shape-allowlist.ts` or `reading-ledger.json`
 *   forever. They only spell the product and compare two sets, so
 *   they cost milliseconds and can name the orphan.
 *
 * A shape leaving either pinned file is progress that must be moved
 * out deliberately, by the commit that fixes its family, and named
 * there.
 */
import { describe, expect, test } from "vitest";
import {
  allowlistFor,
  readingFailures,
  readingLedgerFor,
  sweepFailures,
} from "./list-shape-sweep.js";
import { compareLedgerRows, loadReadingLedger } from "../lib/reading-ledger.js";
import { FAILING_TODAY } from "./list-shape-allowlist.js";

describe("list-shape sweep", () => {
  test("the render-equality/idempotence failing set is exactly the allowlist", async () => {
    const failing = await sweepFailures();
    expect(failing).toEqual(allowlistFor().toSorted());
  }, 300_000);

  // The other half of the allowlist gate, and the cheap half. The
  // derivation above can only see the entries this product spells, so
  // WHICH entries survive the filter is asserted here, against the
  // whole file. Without it an entry no product spells is filtered
  // away and no gate ever mentions it again.
  test("every allowlisted document is one the product spells", () => {
    expect(allowlistFor().toSorted()).toEqual([...FAILING_TODAY].toSorted());
  });
});

// The REFLOW RE-CLASSIFICATION gate (issue #58), over the same
// product. A PARALLEL gate rather than another arm of `sweepFails`:
// the allowlist above states render/idempotence mechanism claims and
// this ledger states reading mechanisms, and the documents that sit in
// both are there for two different reasons. It consults no oracle, so
// it costs a fraction of the sweep beside it.
//
// Most of the ledger's rows are render-EQUAL and idempotent today, so
// the sweep above passes every one of them: this is the population
// issue #58 was filed to enumerate, and no other gate can see it. The
// measured breakdown lives in docs/harnesses.md, beside the refresh
// instruction, so it goes stale in one place rather than two.
describe("reading invariant sweep", () => {
  test("the reading-violation set is exactly the ledger", async () => {
    const failing = await readingFailures();
    expect(failing).toEqual(readingLedgerFor());
  }, 300_000);

  // The ledger's orphan gate, on the terms of the allowlist's above.
  // The ledger is generated from this very product
  // (`bun run reading-ledger --write`), so a row whose document the
  // product does not spell is a stale row, not a filtered one.
  test("every ledgered document is one the product spells", () => {
    expect(readingLedgerFor()).toEqual(
      loadReadingLedger().toSorted(compareLedgerRows),
    );
  });
});
