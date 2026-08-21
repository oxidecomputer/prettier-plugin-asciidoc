import { describe, test, expect } from "vitest";
import { loadCorpus } from "./loader.js";
import { assessCase, type ConformanceProperty } from "./properties.js";
import { loadQuarantine } from "./quarantine.js";

// The differential conformance suite (issue #7): every corpus case
// must agree EXACTLY with the quarantine manifest about which
// properties it fails. Both directions matter — an unexpected failure
// is a newly discovered gap; an unexpected pass means a gap was fixed
// and the manifest entry must be deleted so the fix stays pinned.
const groups = loadCorpus();
const quarantine = loadQuarantine();

/**
 * Builds the assertion message for one case: guidance for a newly
 * discovered gap or a newly fixed case, otherwise the assessment's
 * own diagnostic detail.
 * @param failures - properties the case actually failed, this run
 * @param expected - properties the manifest says the case should fail
 * @param detail - diagnostic string from `assessCase`
 * @returns the message to attach to the `expect` assertion
 */
function conformanceHint(
  failures: ConformanceProperty[],
  expected: ConformanceProperty[],
  detail: string,
): string {
  if (failures.length > 0 && expected.length === 0) {
    return (
      `newly discovered gap (${detail}) — map it to an issue ` +
      `and quarantine it via: bun run triage --write`
    );
  }
  if (failures.length === 0 && expected.length > 0) {
    return (
      "case now passes — delete its quarantine entry " +
      "(bun run triage --write) so the fix stays pinned"
    );
  }
  return detail;
}

for (const group of groups) {
  describe(`conformance: ${group.name}`, () => {
    // Titles are corpus case IDs — this suite is fully data-driven
    // over ~1,600 generated cases. Rows are [id, input] tuples so
    // `%s` prints the ID plain (interpolating a string PROPERTY
    // would quote it).
    const rows = group.cases.map(({ id, input }): [string, string] => [
      id,
      input,
    ]);
    test.each(rows)("%s", async (id, input) => {
      const expected = quarantine.get(id)?.fails ?? [];
      const { failures, detail } = await assessCase(input);
      const hint = conformanceHint(failures, expected, detail);
      // vitest's expect() accepts an optional message as its second
      // argument (see vitest/valid-expect in eslint.config.js).
      expect(failures, hint).toEqual(expected);
    });
  });
}

describe("quarantine manifest", () => {
  test("has no stale entries", () => {
    // An entry for a case that no longer exists can only excuse
    // nothing — it is leftover noise from a re-vendor and must go.
    const ids = new Set(groups.flatMap((g) => g.cases).map((c) => c.id));
    const stale = [...quarantine.keys()].filter((id) => !ids.has(id));
    expect(stale, "run: bun run triage --write").toEqual([]);
  });
});
