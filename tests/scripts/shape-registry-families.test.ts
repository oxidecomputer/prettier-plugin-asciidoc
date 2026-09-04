/**
 * The standing grid's expected-diff family assignment
 * (`gridRowFamily`, scripts/shape-registry-families.ts).
 *
 * `shape-diff` is a differential run between two revisions: it needs
 * two checkouts and it is not part of `bun run test`, so nothing in the
 * suite would notice a family that names a perturbation the grid does
 * not generate. That failure is quiet in the worst way - a renamed or
 * mistyped key stops excusing the rows it was written for, and the
 * next differential run STOPS on rows that were meant to be explained,
 * far from the commit that broke it.
 *
 * Four claims, and each of them is a fact the differential run
 * assumes rather than checks: every family the grid cites is in the
 * closed enumeration, every perturbation the table names is one the
 * grid really generates, the four leaf kinds whose fence the
 * shortest-safe speller respells answer for it at the one coordinate
 * that moves them, and no coordinate outside those sets gained a
 * family by accident.
 */
import { describe, expect, test } from "vitest";
import { LEDGER_FAMILIES } from "../../scripts/parity.js";
import { PERTURBATIONS, standingGrid } from "../../scripts/shape-registry.js";
import { gridRowFamily } from "../../scripts/shape-registry-families.js";

/** The kind whose rows the table print rules move. */
const TABLE_PIPE = "tablePipe";

/** The one coordinate every OTHER kind is allowed to differ at. */
const TRAILING_PLUS = "trailing-plus-after-close";

/** The coordinate at which a delimited leaf block's own fence moves. */
const LONGER_INSIDE = "longer-delimiter-inside";

/** The leaf kinds whose fence the shortest-safe speller respells. */
const BLOCK_DELIMITER_KINDS = ["listing", "literal", "pass", "commentBlock"];

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

  // NO DEAD KEY. Eight perturbations are named, five for the row
  // consolidation and three for the delimiter respell; a typo in any
  // of them leaves seven and this row goes red in the commit that
  // makes it rather than in a differential run nobody ran.
  test("every perturbation the table names is one the grid generates", () => {
    const named = PERTURBATIONS.filter(
      (perturbation) =>
        gridRowFamily(TABLE_PIPE, perturbation.id) !== undefined,
    );
    expect(named.length).toBe(8);
    expect(
      named.filter(
        (perturbation) =>
          gridRowFamily(TABLE_PIPE, perturbation.id) === "table-layout",
      ).length,
    ).toBe(5);
  });

  // The leaf-fence coordinate, asked of the map and of the realized
  // grid. The kind list is the load-bearing half: a fifth kind added
  // to it would excuse rows nothing measured, and a kind dropped from
  // it stops excusing rows the speller really moves, which is the
  // quiet failure this file exists to make loud.
  test("the four leaf kinds answer for their fence's own coordinate", () => {
    for (const kind of BLOCK_DELIMITER_KINDS) {
      expect(gridRowFamily(kind, LONGER_INSIDE)).toBe("block-delimiter-length");
    }
    const rows = standingGrid().filter(
      (shape) =>
        shape.id.split("/")[2] === LONGER_INSIDE &&
        BLOCK_DELIMITER_KINDS.includes(shape.id.split("/")[0]),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const shape of rows) {
      expect(shape.family).toBe("block-delimiter-length");
    }
  });

  // The other kinds keep exactly the answer the perturbation table
  // used to carry, which is what holds the leaf-fence entry to the
  // four kinds and the one coordinate it was measured for: a parent
  // wrapper answering it, or a leaf answering it at a second
  // perturbation, shows up here.
  test("no other kind's coordinates changed their answer", () => {
    for (const shape of standingGrid()) {
      const [kind, , perturbation] = shape.id.split("/");
      if (kind === TABLE_PIPE) {
        continue;
      }
      if (
        perturbation === LONGER_INSIDE &&
        BLOCK_DELIMITER_KINDS.includes(kind)
      ) {
        continue;
      }
      expect(shape.family).toBe(
        perturbation === TRAILING_PLUS ? "no-op-continuation" : undefined,
      );
    }
  });
});
