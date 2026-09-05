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
 * Six claims, and each of them is a fact the differential run
 * assumes rather than checks: every family the grid cites is in the
 * closed enumeration, every perturbation the table names is one the
 * grid really generates, the four leaf kinds whose fence the
 * shortest-safe speller respells answer for it at the one coordinate
 * that moves them, the description container answers its own family
 * for every row inside it, `openBlockTilde` answers its own family at
 * every coordinate because the base registry has no such kind at all,
 * and no coordinate outside those sets and the two blankets gained a
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

/** The container every row of which the description read moved. */
const DESCRIPTION = "dlist-desc";

/** The kind whose base registry has no dimension at all (issue #64). */
const OPEN_BLOCK_TILDE = "openBlockTilde";

/**
 * A container the description blanket must not reach, used wherever a
 * row asks what a kind and a perturbation answer on their own. Its
 * sibling `dlist-desc-line` is the sharper of the two, since the
 * blanket's prefix would swallow it under a looser test.
 */
const PLAIN = "doc";

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
        gridRowFamily(TABLE_PIPE, PLAIN, perturbation.id) !== undefined,
    );
    expect(named.length).toBe(8);
    expect(
      named.filter(
        (perturbation) =>
          gridRowFamily(TABLE_PIPE, PLAIN, perturbation.id) === "table-layout",
      ).length,
    ).toBe(5);
  });

  // The leaf-fence coordinate, asked of the map and of the realized
  // grid. The kind list is the load-bearing half: a fifth kind added
  // to it would excuse rows nothing measured, and a kind dropped from
  // it stops excusing rows the speller really moves, which is the
  // quiet failure this file exists to make loud. Asked at a PLAIN
  // container, because inside a description the container answers
  // first and the row below pins that precedence.
  test("the four leaf kinds answer for their fence's own coordinate", () => {
    for (const kind of BLOCK_DELIMITER_KINDS) {
      expect(gridRowFamily(kind, PLAIN, LONGER_INSIDE)).toBe(
        "block-delimiter-length",
      );
    }
    const rows = standingGrid().filter((shape) => {
      const [kind, container, perturbation] = shape.id.split("/");
      return (
        perturbation === LONGER_INSIDE &&
        container !== DESCRIPTION &&
        BLOCK_DELIMITER_KINDS.includes(kind)
      );
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const shape of rows) {
      expect(shape.family).toBe("block-delimiter-length");
    }
  });

  // The container arm, asked directly and asked of the realized grid.
  // Directly, because the arm has to answer for coordinates the two
  // per-kind rules also claim - a `tablePipe` termination and a leaf
  // fence - which is the precedence the measurement forced, and over
  // the grid, because a container the blanket silently stopped
  // covering is the failure this file exists to make loud.
  test("every row inside the description container takes its family", () => {
    expect(gridRowFamily(TABLE_PIPE, DESCRIPTION, "closed")).toBe(
      "description-list-item",
    );
    expect(gridRowFamily("listing", DESCRIPTION, LONGER_INSIDE)).toBe(
      "description-list-item",
    );
    expect(gridRowFamily("listing", DESCRIPTION, TRAILING_PLUS)).toBe(
      "description-list-item",
    );
    const rows = standingGrid().filter(
      (shape) => shape.id.split("/")[1] === DESCRIPTION,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const shape of rows) {
      expect(shape.family).toBe("description-list-item");
    }
  });

  // Whole-KIND, not one coordinate: unlike the four leaf kinds above,
  // which already existed and only moved at their fence's own
  // perturbation, `openBlockTilde` is a kind the base registry has no
  // dimension for at all, so every container and every perturbation
  // of it is a genuine diff from base and needs the family - there is
  // no coordinate of this kind that is expected byte-identical.
  test("openBlockTilde answers its own family at every coordinate", () => {
    expect(gridRowFamily(OPEN_BLOCK_TILDE, PLAIN, "closed")).toBe(
      "open-block-tilde",
    );
    expect(gridRowFamily(OPEN_BLOCK_TILDE, DESCRIPTION, "closed")).toBe(
      "description-list-item",
    );
    const rows = standingGrid().filter(
      (shape) => shape.id.split("/")[0] === OPEN_BLOCK_TILDE,
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const shape of rows) {
      const [, container] = shape.id.split("/");
      expect(shape.family).toBe(
        container === DESCRIPTION
          ? "description-list-item"
          : "open-block-tilde",
      );
    }
  });

  // The two READING coordinate sets, named one by one rather than
  // blanketed, so the test can state them the same way: exactly these
  // ids answer the reading families and no sibling coordinate does.
  // A prefix or perturbation match would show up here as one of the
  // untouched kinds at the same perturbation answering a family.
  const UNDERLINED_TITLE_IDS = [
    "example/after-h0-adjacent/foreign-marker-inside",
    "example/after-h0-adjacent/heading-inside",
    "example/in-example/closed",
    "example/in-example/closed-no-final-newline",
    "example/in-example/closed-then-text-adjacent",
    "example/in-example/heading-inside",
    "example/in-example/longer-delimiter-inside",
    "example/in-example/terminator-trailing-ws",
    "example/in-example/unterminated",
    "example/in-example/unterminated-then-blank-text",
    "listing/after-h0-adjacent/foreign-marker-inside",
    "listing/after-h0-adjacent/heading-inside",
    "pass/after-h0-adjacent/foreign-marker-inside",
    "pass/after-h0-adjacent/heading-inside",
    "setext/trailing-underline/doc",
    "setext/nested-listing/doc",
    "setext/underlined-title/doc",
  ];
  const MARKDOWN_BREAK_IDS = [
    "listing/after-h0-adjacent/near-miss-terminator-inside",
    "openBlock/after-h0-adjacent/longer-delimiter-inside",
    "quote/after-h0-adjacent/near-miss-terminator-inside",
    "sidebar/after-h0-adjacent/near-miss-terminator-inside",
  ];

  test("the reading coordinates answer their families, and only they do", () => {
    const byId = new Map(standingGrid().map((shape) => [shape.id, shape]));
    for (const id of UNDERLINED_TITLE_IDS) {
      expect(byId.get(id)?.family, id).toBe("underlined-section-title");
    }
    for (const id of MARKDOWN_BREAK_IDS) {
      expect(byId.get(id)?.family, id).toBe("markdown-thematic-break");
    }
    // The same perturbation at a kind the reading does not reach:
    // `example` is the one whose interior spells a title at
    // `near-miss-terminator-inside`, and `sidebar` is not.
    expect(
      byId.get("sidebar/after-h0-adjacent/foreign-marker-inside")?.family,
    ).toBeUndefined();
  });

  // Every coordinate outside those five sets keeps exactly the answer
  // the perturbation table used to carry, which is what holds the
  // blanket to its one container and the leaf-fence entry to its four
  // kinds and one perturbation: a prefix match would show up here as
  // `dlist-desc-line` answering the description family, and a parent
  // wrapper answering the fence family would show up the same way.
  test("no other kind or container changed its answer", () => {
    const reading = new Set([...UNDERLINED_TITLE_IDS, ...MARKDOWN_BREAK_IDS]);
    for (const shape of standingGrid()) {
      const [kind, container, perturbation] = shape.id.split("/");
      if (
        kind === TABLE_PIPE ||
        kind === OPEN_BLOCK_TILDE ||
        container === DESCRIPTION
      ) {
        continue;
      }
      if (reading.has(shape.id)) {
        continue;
      }
      if (
        perturbation === LONGER_INSIDE &&
        BLOCK_DELIMITER_KINDS.includes(kind)
      ) {
        continue;
      }
      expect(shape.family, shape.id).toBe(
        perturbation === TRAILING_PLUS ? "no-op-continuation" : undefined,
      );
    }
    const line = standingGrid().filter(
      (shape) => shape.id.split("/")[1] === "dlist-desc-line",
    );
    expect(line.length).toBeGreaterThan(0);
    expect(
      line.every((shape) => shape.family !== "description-list-item"),
    ).toBe(true);
  });
});
