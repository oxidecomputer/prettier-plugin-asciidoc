/**
 * The quarantine manifest (issue #7): known-failing corpus cases,
 * keyed by case ID, each tagged with the properties it fails and the
 * gap issue it maps to. The harness asserts EXACT agreement between a
 * case's actual failures and its manifest entry, so a fixed gap turns
 * quarantined cases red until the entry is removed — the manifest
 * shrinks monotonically and fixes get pinned. Stored as JSON (not TS)
 * so `scripts/conformance-triage.ts` can rewrite it mechanically.
 */

import { readFileSync } from "node:fs";
import type { ConformanceProperty } from "./properties.js";

/** Manifest record for one known-failing case. */
export interface QuarantineEntry {
  /**
   * Properties the case is expected to fail, in canonical order.
   */
  fails: ConformanceProperty[];
  /**
   * Gap issue reference like `#10`, or `UNTRIAGED` for cases the
   * triage script found but nobody has mapped yet.
   */
  issue: string;
}

/** Repo-relative manifest path; the triage script writes this file. */
export const QUARANTINE_PATH = "tests/conformance/quarantine.json";

const PROPERTIES = new Set<string>([
  "crash",
  "idempotency",
  "fidelity",
  "reading",
]);

/**
 * Type guard for validating a QuarantineEntry. Checks that the value
 * has the correct structure and content.
 * @param value - unknown value from JSON
 * @returns true if value is a valid QuarantineEntry
 */
function isQuarantineEntry(
  value: unknown,
): value is { fails: ConformanceProperty[]; issue: string } {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // Check each property with targeted type assertions; the typeof check
  // above guarantees value is an object, so property access is safe
  const { fails, issue } = value as { fails?: unknown; issue?: unknown };
  return (
    Array.isArray(fails) &&
    fails.length > 0 &&
    fails.every(
      (f): f is ConformanceProperty =>
        typeof f === "string" && PROPERTIES.has(f),
    ) &&
    typeof issue === "string"
  );
}

/**
 * Parses and validates the manifest. Validation is strict because a
 * malformed entry would silently excuse real failures.
 * @param manifestPath - manifest file to read; defaults to the
 *   checked-in manifest, overridable only so tests can exercise the
 *   validation paths against scratch files
 * @returns map from case ID to its expected-failure entry
 */
export function loadQuarantine(
  manifestPath: string = QUARANTINE_PATH,
): Map<string, QuarantineEntry> {
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  // Arrays are objects to typeof, but an array manifest (e.g. a file
  // accidentally written as []) would validate vacuously or key
  // entries by index — reject it outright.
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${manifestPath}: expected an object`);
  }
  const quarantine = new Map<string, QuarantineEntry>();
  for (const [id, value] of Object.entries(parsed)) {
    if (!isQuarantineEntry(value)) {
      throw new Error(`${manifestPath}: malformed entry for ${id}`);
    }
    quarantine.set(id, value);
  }
  return quarantine;
}
