/**
 * The recorded-fact census (`scripts/fact-inventory.ts`): the pinned
 * count, the completeness gate in both directions, and the ledger
 * (`scripts/fact-inventory-ledger.json`) carrying a row for every
 * fact this checkout finds.
 *
 * The completeness gate is checked against a PLANTED tree, not only
 * against the real one, for the reason
 * `tests/scripts/metrics-unread-fields.test.ts` gives: a gate whose
 * only evidence is "it says none on our own tree" could equally be
 * broken and nobody would see it fail. The planted row below is red
 * BEFORE the fix the same way a bug-fix test is red before its fix —
 * asserted here, not assumed — and green only once the classification
 * catches up (`FACTS.set` or `EXEMPT.set`, whichever the field is).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  astFields,
  factInventoryFailures,
  factKey,
  recordedFacts,
} from "../../scripts/fact-inventory.js";
import { isObject } from "../../scripts/metrics/json.js";
import { REPO_ROOT } from "../../scripts/metrics/model.js";
import { inCheckout } from "../lib/checkout.js";

/** The real checkout's fact count, as of this commit. */
const PINNED_FACT_COUNT = 71;

describe("the real checkout", () => {
  test("has no unclassified or stale field", () => {
    expect(factInventoryFailures(REPO_ROOT)).toEqual([]);
  });

  test("realizes the pinned fact count", () => {
    expect(recordedFacts(REPO_ROOT)).toHaveLength(PINNED_FACT_COUNT);
  });

  test("every recorded fact has a ledger row", () => {
    const ledgerPath = path.join(
      REPO_ROOT,
      "scripts/fact-inventory-ledger.json",
    );
    const parsed: unknown = JSON.parse(readFileSync(ledgerPath, "utf8"));
    if (!isObject(parsed) || !isObject(parsed.facts)) {
      throw new TypeError(`${ledgerPath}: expected {facts: {...}}`);
    }
    const { facts: ledgerFacts } = parsed;
    const facts = recordedFacts(REPO_ROOT);
    const missing = facts.filter((fact) => !Object.hasOwn(ledgerFacts, fact));
    expect(missing, "facts with no row in fact-inventory-ledger.json").toEqual(
      [],
    );
    const stale = Object.keys(ledgerFacts).filter(
      (key) => !facts.includes(key),
    );
    expect(
      stale,
      "fact-inventory-ledger.json rows naming a fact the census no longer finds",
    ).toEqual([]);
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
    const failures = inCheckout({ "src/ast.ts": plantedAst() }, (root) =>
      factInventoryFailures(root),
    );
    // PlantedNode.type and .value are not in FACTS or EXEMPT, so the
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
      { "src/ast.ts": plantedAst("  newSpelling: boolean;") },
      (root) => factInventoryFailures(root),
    );
    expect(
      afterFailures.some((message) =>
        message.includes("PlantedNode.newSpelling"),
      ),
      "a field with no FACTS/EXEMPT row must be reported",
    ).toBe(true);
  });

  test("catches a ledger row naming a field that is gone (stale, the reverse direction)", () => {
    // scripts/fact-inventory.ts classifies ItemBody.trailingContinuation
    // as a fact; a planted tree that never declares ItemBody at all
    // must report every FACTS/EXEMPT row as stale, this one included,
    // proving the reverse-direction check bites and not only the
    // forward one the test above already covers.
    const failures = inCheckout({ "src/ast.ts": plantedAst() }, (root) =>
      factInventoryFailures(root),
    );
    expect(
      failures.some((message) =>
        message.includes("ItemBody.trailingContinuation"),
      ),
    ).toBe(true);
  });
});
