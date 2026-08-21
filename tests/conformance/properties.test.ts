import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test, expect } from "vitest";
import { assessCase } from "./properties.js";
import { loadQuarantine } from "./quarantine.js";

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
    const order = ["crash", "idempotency", "fidelity"];
    const indexes = result.failures.map((f) => order.indexOf(f));
    expect([...indexes].toSorted((a, b) => a - b)).toEqual(indexes);
  });
});

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
    const directory = mkdtempSync(path.join(tmpdir(), "quarantine-test-"));
    const manifest = path.join(directory, "quarantine.json");
    try {
      writeFileSync(manifest, "[]\n");
      expect(() => loadQuarantine(manifest)).toThrowError(
        `${manifest}: expected an object`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("rejects a malformed entry", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "quarantine-test-"));
    const manifest = path.join(directory, "quarantine.json");
    try {
      writeFileSync(manifest, '{"case#t#0":{"fails":[],"issue":"#1"}}\n');
      expect(() => loadQuarantine(manifest)).toThrowError(
        `${manifest}: malformed entry for case#t#0`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
