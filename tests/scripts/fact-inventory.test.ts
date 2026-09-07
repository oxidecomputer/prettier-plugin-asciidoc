/**
 * The recorded-fact census (`scripts/fact-inventory.ts`): the pinned
 * count, the completeness gate in both directions, and the ledger
 * (`scripts/fact-inventory-ledger.json`) carrying a row for every
 * fact this checkout finds.
 *
 * A planted tree here carries the REAL ledger beside its planted
 * `src/ast.ts`, because the ledger is where a fact's classification
 * is written: a checkout without one has no FACTS half at all, and
 * the stale-row row below would then be measuring the missing file
 * rather than the check it is about.
 *
 * The completeness gate is checked against a PLANTED tree, not only
 * against the real one, for the reason
 * `tests/scripts/metrics-unread-fields.test.ts` gives: a gate whose
 * only evidence is "it says none on our own tree" could equally be
 * broken and nobody would see it fail. The planted row below is red
 * BEFORE the fix the same way a bug-fix test is red before its fix —
 * asserted here, not assumed — and green only once the classification
 * catches up (a ledger row, or an `EXEMPT` row, whichever the field
 * is).
 *
 * One row here is about a different kind of correctness: an EXEMPT
 * reason that CLAIMS the printer does not read the field is the one
 * part of the classification a compiler can settle, and
 * `scripts/fact-inventory-reads.ts` settles it. The planted controls
 * for that scan are `tests/scripts/fact-inventory-reads.test.ts`'s.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { EXEMPT } from "../../scripts/fact-inventory-classification.js";
import { unreadClaimFailures } from "../../scripts/fact-inventory-reads.js";
import {
  LEDGER_FILE,
  REPARSE_LEDGER_FILE,
  astFields,
  factInventoryFailures,
  factKey,
  factReasons,
  ledgerFailures,
  recordedFacts,
} from "../../scripts/fact-inventory.js";
import { isObject } from "../../scripts/metrics/json.js";
import { REPO_ROOT } from "../../scripts/metrics/model.js";
import { REPARSE_FAMILIES } from "../conformance/reparse-ledger.js";
import { inCheckout } from "../lib/checkout.js";

/**
 * The family vocabulary the ledger's `reparseFamilySizes` must mirror,
 * read from the enumeration that owns it rather than restated here -
 * a second list would be the drift the check exists to catch.
 */
const DECLARED_FAMILIES = Object.keys(REPARSE_FAMILIES);

/** The real checkout's fact count, as of this commit. */
const PINNED_FACT_COUNT = 78;

/**
 * The checked-in ledger's own bytes, for planting beside a planted
 * `src/ast.ts`. Read rather than written out here: a fixture ledger
 * would be a second copy of the fact classification, which is the
 * duplication the ledger exists to hold alone.
 */
const REAL_LEDGER = readFileSync(path.join(REPO_ROOT, LEDGER_FILE), "utf8");

describe("the real checkout", () => {
  test("has no unclassified or stale field", () => {
    expect(factInventoryFailures(REPO_ROOT)).toEqual([]);
  });

  test("realizes the pinned fact count", () => {
    expect(recordedFacts(REPO_ROOT)).toHaveLength(PINNED_FACT_COUNT);
  });

  test("every recorded fact states why it is one", () => {
    // The ledger's key set IS the fact set now, so "has a row" is
    // true by construction and no longer worth asserting. What a row
    // can still omit is the classification itself, and a fact with no
    // stated reason is a field nobody classified.
    const parsed: unknown = JSON.parse(REAL_LEDGER);
    if (!isObject(parsed) || !isObject(parsed.facts)) {
      throw new TypeError(`${LEDGER_FILE}: expected {facts: {...}}`);
    }
    const { facts: ledgerFacts } = parsed;
    const unreasoned = Object.entries(ledgerFacts)
      .filter(
        ([, row]) => (isObject(row) ? row.reason : undefined) === undefined,
      )
      .map(([key]) => key);
    expect(unreasoned, "ledger rows with no `reason`").toEqual([]);
    expect(new Set(factReasons(REPO_ROOT).keys())).toEqual(
      new Set(Object.keys(ledgerFacts)),
    );
  });

  test("a ledger row with no reason is reported (red before the reason field)", () => {
    // Red before `reason` moved into the ledger: nothing read the
    // rows for a classification at all, so a row that stated none was
    // as green as one that did.
    const stripped: unknown = JSON.parse(REAL_LEDGER);
    if (!isObject(stripped) || !isObject(stripped.facts)) {
      throw new TypeError(`${LEDGER_FILE}: expected {facts: {...}}`);
    }
    const row = stripped.facts["ItemBody.trailingContinuation"];
    if (!isObject(row)) {
      throw new TypeError(`${LEDGER_FILE}: expected a row for that fact`);
    }
    delete row.reason;
    const failures = inCheckout(
      {
        "src/ast.ts": readFileSync(path.join(REPO_ROOT, "src/ast.ts"), "utf8"),
        [LEDGER_FILE]: JSON.stringify(stripped),
      },
      (root) => factInventoryFailures(root),
    );
    expect(
      failures.filter((message) =>
        message.includes("ItemBody.trailingContinuation"),
      ),
    ).toHaveLength(1);
  });

  test("the ledger agrees with what it counts", () => {
    expect(ledgerFailures(REPO_ROOT, DECLARED_FAMILIES)).toEqual([]);
  });

  // Red before the reclassification this test ships with, which is the
  // whole of issue #204: it reported Node.position (15 reads),
  // Location.line (14) and Location.column (2), every one of them
  // carrying a reason that said the printer did not read it. Those
  // three are FACTS now, so the claim the remaining rows make is true
  // and this reads empty. It fails again the moment a row asserts
  // something about reads that the compiler can see is false.
  test("no exempt row claims a read the printer makes", () => {
    expect(unreadClaimFailures(REPO_ROOT, EXEMPT)).toEqual([]);
  });
});

/**
 * A minimal `src/ast.ts` this suite can plant: one interface the
 * walker reads exactly like the real file's, so a planted field
 * behaves the way a real one would.
 * @param extraField - one more property line to add to the interface,
 *   or omitted for the baseline (fully classified) tree
 * @returns the file's text
 */
function plantedAst(extraField?: string): string {
  return [
    "export interface PlantedNode {",
    '  type: "planted";',
    "  value: string;",
    extraField ?? "",
    "}",
    "",
  ].join("\n");
}

describe("factInventoryFailures on a planted tree", () => {
  test("is clean when every field is classified", () => {
    const failures = inCheckout(
      { "src/ast.ts": plantedAst(), [LEDGER_FILE]: REAL_LEDGER },
      (root) => factInventoryFailures(root),
    );
    // PlantedNode.type and .value are in neither half, so the
    // baseline itself is expected to be red — this is the mutation
    // being applied FIRST, per the perturbation-proof discipline: the
    // next test shows the SAME shape passes once classified.
    expect(failures).not.toEqual([]);
  });

  test("catches a new field ast.ts grows with no ledger row (red before, green after)", () => {
    const before = inCheckout({ "src/ast.ts": plantedAst() }, (root) =>
      astFields(root),
    );
    const beforeKeys = new Set(before.map(factKey));
    expect(
      beforeKeys.has("PlantedNode.newSpelling"),
      "the field must not exist before the plant, or the mutation below proves nothing",
    ).toBe(false);

    const afterFailures = inCheckout(
      {
        "src/ast.ts": plantedAst("  newSpelling: boolean;"),
        [LEDGER_FILE]: REAL_LEDGER,
      },
      (root) => factInventoryFailures(root),
    );
    expect(
      afterFailures.some((message) =>
        message.includes("PlantedNode.newSpelling"),
      ),
      "a field with no ledger row and no EXEMPT row must be reported",
    ).toBe(true);
  });

  test("catches a ledger row naming a field that is gone (stale, the reverse direction)", () => {
    // The ledger classifies ItemBody.trailingContinuation as a fact;
    // a planted tree that never declares ItemBody at all
    // must report every ledger and EXEMPT row as stale, this one included,
    // proving the reverse-direction check bites and not only the
    // forward one the test above already covers.
    const failures = inCheckout(
      { "src/ast.ts": plantedAst(), [LEDGER_FILE]: REAL_LEDGER },
      (root) => factInventoryFailures(root),
    );
    expect(
      failures.some((message) =>
        message.includes("ItemBody.trailingContinuation"),
      ),
    ).toBe(true);
  });
});

/**
 * A ledger this suite can plant: one fact row claiming one family on
 * one basis, and a sizes map, so a planted disagreement behaves the
 * way a real one would.
 * @param basis - the basis the single row claims
 * @param sizes - the `reparseFamilySizes` map to record
 * @param family - the family the single row claims, defaulting to a
 *   declared one so a test perturbing the BASIS does not perturb the
 *   family at the same time
 * @returns the file's text
 */
function plantedLedger(
  basis: string,
  sizes: Record<string, number>,
  family = "indent-dropped",
): string {
  return JSON.stringify({
    note: "planted",
    reparseFamilySizes: sizes,
    facts: {
      "PlantedNode.field": {
        lemmaTest: "tests/planted.test.ts",
        landedLemma: false,
        reparseFamilies: [{ basis, family, note: "planted" }],
      },
    },
  });
}

/**
 * A reparse ledger this suite can plant: one row per named family, so
 * a planted size disagreement is measured off real rows rather than
 * off a number the test also wrote.
 * @param families - the family each planted row carries
 * @returns the file's text
 */
const plantedRows = (families: string[]): string =>
  JSON.stringify({
    note: "planted",
    rows: families.map((family, index) => ({
      id: `planted/${String(index)}`,
      pass: "p1",
      signature: "[] -> []",
      family,
    })),
  });

describe("ledgerFailures on a planted tree", () => {
  const DECLARED = ["indent-dropped", "blank-dropped"];

  test("is clean when the basis is legal and the sizes match the rows", () => {
    // The UNMUTATED baseline, asserted before anything is perturbed:
    // a planted pair that already disagreed would make every row
    // below pass for the wrong reason.
    const failures = inCheckout(
      {
        [LEDGER_FILE]: plantedLedger("argued", {
          "indent-dropped": 2,
          "blank-dropped": 0,
        }),
        [REPARSE_LEDGER_FILE]: plantedRows([
          "indent-dropped",
          "indent-dropped",
        ]),
      },
      (root) => ledgerFailures(root, DECLARED),
    );
    expect(failures).toEqual([]);
  });

  test("catches a basis outside the closed list", () => {
    const failures = inCheckout(
      {
        [LEDGER_FILE]: plantedLedger("mesured", {
          "indent-dropped": 2,
          "blank-dropped": 0,
        }),
        [REPARSE_LEDGER_FILE]: plantedRows([
          "indent-dropped",
          "indent-dropped",
        ]),
      },
      (root) => ledgerFailures(root, DECLARED),
    );
    expect(failures.some((message) => message.includes('"mesured"'))).toBe(
      true,
    );
  });

  test("catches a claimed family the reparse ledger does not declare", () => {
    // The sizes map was already held to the declared names; the
    // per-fact claims that SPEND those names were not, so a misspelt
    // family read as attribution while naming a mechanism no row can
    // ever be tagged with.
    const failures = inCheckout(
      {
        [LEDGER_FILE]: plantedLedger(
          "argued",
          { "indent-dropped": 2, "blank-dropped": 0 },
          "indent-droped",
        ),
        [REPARSE_LEDGER_FILE]: plantedRows([
          "indent-dropped",
          "indent-dropped",
        ]),
      },
      (root) => ledgerFailures(root, DECLARED),
    );
    expect(
      failures.some((message) =>
        message.includes('claims the family "indent-droped"'),
      ),
    ).toBe(true);
  });

  test("catches a size that has gone stale against the rows", () => {
    // The exact drift this check was added for: a fix empties a
    // family and the recorded size still names its old row count.
    const failures = inCheckout(
      {
        [LEDGER_FILE]: plantedLedger("argued", {
          "indent-dropped": 2,
          "blank-dropped": 70,
        }),
        [REPARSE_LEDGER_FILE]: plantedRows([
          "indent-dropped",
          "indent-dropped",
        ]),
      },
      (root) => ledgerFailures(root, DECLARED),
    );
    expect(
      failures.some((message) =>
        message.includes("reparseFamilySizes.blank-dropped records 70"),
      ),
    ).toBe(true);
  });

  test("catches a sizes key naming no declared family", () => {
    const failures = inCheckout(
      {
        [LEDGER_FILE]: plantedLedger("argued", {
          "indent-dropped": 2,
          "blank-dropped": 0,
          "blank-droped": 0,
        }),
        [REPARSE_LEDGER_FILE]: plantedRows([
          "indent-dropped",
          "indent-dropped",
        ]),
      },
      (root) => ledgerFailures(root, DECLARED),
    );
    expect(
      failures.some((message) => message.includes("names blank-droped")),
    ).toBe(true);
  });
});
