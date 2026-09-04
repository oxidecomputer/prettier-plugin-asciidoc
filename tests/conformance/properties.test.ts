import path from "node:path";
import { describe, test, expect } from "vitest";
import { assessCase } from "./properties.js";
import { loadQuarantine } from "./quarantine.js";
import { inCheckout } from "../lib/checkout.js";

describe("assessCase", () => {
  test("clean input passes all properties", async () => {
    const result = await assessCase("= Title\n\nA paragraph.\n");
    expect(result.failures).toEqual([]);
  });

  // The properties are differential, so the only way to unit-test the
  // failure paths without depending on a live formatter gap (which
  // would break these tests the day the gap is fixed) is shape-level.
  // Real failures are exercised by the differential run over the
  // Asciidoctor corpus, not here.
  test("failures are reported in fixed property order", async () => {
    const result = await assessCase("= Title\n");
    // Whatever the outcome, ordering must be a subsequence of the
    // canonical order so quarantine set-comparison is deterministic.
    const order = ["crash", "idempotency", "fidelity", "reading"];
    const indexes = result.failures.map((f) => order.indexOf(f));
    expect([...indexes].toSorted((a, b) => a - b)).toEqual(indexes);
  });

  // The reading detail names WHERE as well as what: a signature alone
  // is enough for a six-line case and not enough for a corpus
  // document of several hundred lines. This one document is a live
  // gap (#17's continuation-dropped; the previous witnesses closed
  // with #43 and then #65) rather than a shape, deliberately - it is
  // a ledger row in tests/format/reading-ledger.json, so the day the
  // gap closes this row moves with the ledger. Its violation is on
  // line 3 of 6, so the reported line is the line and not the end.
  test("a reading failure is reported with its line", async () => {
    const result = await assessCase("* a\n\n+\n* a\n\n+\n");
    expect(result.failures).toContain("reading");
    expect(result.detail).toContain(
      "re-reads differently: p1 line 3 [cont marker:unordered:* cont] -> [marker:unordered:*]",
    );
  });
});

/**
 * Asserts that a planted `quarantine.json` fails to load with the
 * given message.
 * @param directory - the checkout root
 * @param expected - the exact error message
 */
function expectQuarantineRejected(directory: string, expected: string): void {
  const manifest = path.join(directory, "quarantine.json");
  expect(() => loadQuarantine(manifest)).toThrowError(expected);
}

describe("loadQuarantine", () => {
  test("loads the checked-in manifest", () => {
    // Asserts only that the checked-in manifest stays parseable and
    // well-formed, whatever is in it — an empty manifest passes.
    const quarantine = loadQuarantine();
    for (const [id, entry] of quarantine) {
      expect(id.length).toBeGreaterThan(0);
      expect(entry.fails.length).toBeGreaterThan(0);
      expect(entry.issue.length).toBeGreaterThan(0);
    }
  });

  test("rejects a JSON array root", () => {
    // typeof [] === "object", so without an explicit check an array
    // manifest would validate vacuously (empty) or key entries by
    // index — either way silently excusing real failures.
    inCheckout({ "quarantine.json": "[]\n" }, (directory) => {
      expectQuarantineRejected(
        directory,
        `${path.join(directory, "quarantine.json")}: expected an object`,
      );
    });
  });

  test("rejects a malformed entry", () => {
    inCheckout(
      { "quarantine.json": '{"case#t#0":{"fails":[],"issue":"#1"}}\n' },
      (directory) => {
        expectQuarantineRejected(
          directory,
          `${path.join(directory, "quarantine.json")}: malformed entry for case#t#0`,
        );
      },
    );
  });
});
