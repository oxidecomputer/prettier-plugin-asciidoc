/**
 * The standing grid's expected-diff family assignment
 * (`gridRowFamily`, scripts/shape-registry-families.ts).
 *
 * `shape-diff` is a differential run between two revisions: it needs
 * two checkouts and it is not part of `bun run test`, so nothing in
 * the suite would notice a family that names a perturbation the grid
 * does not generate. That failure is quiet in the worst way - a
 * renamed or mistyped key stops excusing the rows it was written for,
 * and the next differential run STOPS on rows that were meant to be
 * explained, far from the commit that broke it.
 *
 * Three claims, and each of them is a fact the differential run
 * assumes rather than checks: every family the grid cites is in the
 * closed enumeration, every perturbation the table names is one the
 * grid really generates, and no coordinate outside the table's sets
 * gained a family by accident.
 */
import { describe, expect, test } from "vitest";
import { LEDGER_FAMILIES } from "../../scripts/parity.js";
import { PERTURBATIONS, standingGrid } from "../../scripts/shape-registry.js";
import { gridRowFamily } from "../../scripts/shape-registry-families.js";

/** The kind whose rows the table print rules move. */
const TABLE_PIPE = "tablePipe";

/** The one coordinate every OTHER kind is allowed to differ at. */
const TRAILING_PLUS = "trailing-plus-after-close";

describe("the standing grid's family assignment", () => {
  // The enum is closed and `shape-diff` treats `Shape.family` as an
  // opaque string, so a family spelled wrong here is a family that
  // exists nowhere: the row differs, the name matches no declaration,
  // and the run stops with a name nobody can look up.
  test("every family the grid cites is in the closed enumeration", () => {
    const cited = new Set(
      standingGrid()
        .map((shape) => shape.family)
        .filter((family) => family !== undefined),
    );
    // Non-vacuous: the grid cites families, so the check has a
    // population rather than passing on an empty set.
    expect(cited.size).toBeGreaterThan(0);
    for (const family of cited) {
      expect(LEDGER_FAMILIES.families.has(family)).toBe(true);
    }
  });

  // NO DEAD KEY. Three perturbations are named, all for the delimiter
  // respell; a typo in any of them leaves two and this row goes red
  // in the commit that makes it rather than in a differential run
  // nobody ran.
  test("every perturbation the table names is one the grid generates", () => {
    const named = PERTURBATIONS.filter(
      (perturbation) =>
        gridRowFamily(TABLE_PIPE, perturbation.id) !== undefined,
    );
    expect(named.length).toBe(3);
    expect(
      named.every(
        (perturbation) =>
          gridRowFamily(TABLE_PIPE, perturbation.id) ===
          "table-delimiter-length",
      ),
    ).toBe(true);
  });

  // The other twelve kinds keep exactly the answer the perturbation
  // table used to carry, which is what makes this a re-homing of the
  // question rather than a change to it.
  test("no other kind's coordinates changed their answer", () => {
    for (const shape of standingGrid()) {
      const [kind, , perturbation] = shape.id.split("/");
      if (kind === TABLE_PIPE) {
        continue;
      }
      expect(shape.family).toBe(
        perturbation === TRAILING_PLUS ? "no-op-continuation" : undefined,
      );
    }
  });
});
