/**
 * The deep manifest's loader, on the terms `loadQuarantine` is tested
 * on in properties.test.ts: the checked-in file stays well-formed,
 * and the two shapes that would silently excuse real failures are
 * rejected outright.
 *
 * The malformed cases are a TABLE rather than one example, because
 * every guard in the entry validator is a place a hand-edited
 * manifest can go wrong, and a validator with an unexercised guard is
 * a validator nobody can trust to be strict.
 */
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test, expect, onTestFinished } from "vitest";
import { loadSweepClusters } from "./registry-sweep-clusters.js";
import { plantCheckout } from "../lib/checkout.js";

/** A hex sha256 of the right width, for the well-formed fields. */
const DIGEST = "a".repeat(64);

/** The committed manifest fixtures, from this file's own path. */
const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
);

/**
 * Writes a scratch manifest holding the given text and hands back its
 * path, registering its removal with the running test so the caller
 * stays a flat assertion rather than a nested callback.
 * @param text - the manifest file's contents
 * @returns the scratch file's path
 */
function scratchManifest(text: string): string {
  const directory = plantCheckout({ "manifest.json": text });
  onTestFinished(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return path.join(directory, "manifest.json");
}

/** One rejected cluster body, and what makes it wrong. */
const MALFORMED: ReadonlyArray<{
  readonly why: string;
  readonly body: string;
}> = [
  {
    why: "no count",
    body: `{"examples":["a"],"sha256":"${DIGEST}","issue":"#1"}`,
  },
  {
    why: "a count of zero, which no cluster can have",
    body: `{"count":0,"examples":["a"],"sha256":"${DIGEST}","issue":"#1"}`,
  },
  {
    why: "no examples, so the cluster names nothing",
    body: `{"count":2,"examples":[],"sha256":"${DIGEST}","issue":"#1"}`,
  },
  {
    why: "more examples than a cluster may name",
    body: `{"count":9,"examples":["a","b","c","d","e","f"],"sha256":"${DIGEST}","issue":"#1"}`,
  },
  {
    why: "an example that is not a row id",
    body: `{"count":2,"examples":[7],"sha256":"${DIGEST}","issue":"#1"}`,
  },
  {
    why: "a digest of the wrong width",
    body: '{"count":2,"examples":["a"],"sha256":"abc","issue":"#1"}',
  },
  {
    why: "a digest that is not hex",
    body: `{"count":2,"examples":["a"],"sha256":"${"z".repeat(64)}","issue":"#1"}`,
  },
  {
    why: "no issue tag",
    body: `{"count":2,"examples":["a"],"sha256":"${DIGEST}"}`,
  },
  { why: "not an object at all", body: "null" },
];

describe("loadSweepClusters", () => {
  test("loads the checked-in manifest", () => {
    // Asserts only that the checked-in manifest stays parseable and
    // well-formed, whatever is in it - an empty manifest passes.
    const clusters = loadSweepClusters();
    for (const [key, entry] of clusters) {
      expect(key.length).toBeGreaterThan(0);
      expect(entry.count).toBeGreaterThan(0);
      expect(entry.examples.length).toBeGreaterThan(0);
      expect(entry.examples.length).toBeLessThanOrEqual(entry.count);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/v);
      expect(entry.issue.length).toBeGreaterThan(0);
    }
  });

  test("rejects a JSON array root", () => {
    // typeof [] === "object", so without an explicit check an array
    // manifest would validate vacuously (empty) or key clusters by
    // index - either way silently excusing real failures.
    const manifest = scratchManifest("[]\n");
    expect(() => loadSweepClusters(manifest)).toThrowError(
      `${manifest}: expected an object`,
    );
  });

  test("names the file and the way out when the manifest is not JSON", () => {
    // Red before the parse guard: the bare JSON.parse threw
    // "Expected property name or '}' in JSON at position 2", naming
    // neither the file nor the way out, from deep in the import chain
    // of whichever triage script was running. The fixture is committed
    // rather than planted because the bytes under test are exactly
    // what a merge tool leaves behind.
    const manifest = path.join(FIXTURES, "conflicted-manifest.json");
    expect(() => loadSweepClusters(manifest)).toThrowError(manifest);
    expect(() => loadSweepClusters(manifest)).toThrowError(
      "Unresolved conflict markers",
    );
    expect(() => loadSweepClusters(manifest)).toThrowError(
      "resolve the file or delete it",
    );
  });

  test.each(MALFORMED)("rejects a cluster with $why", ({ body }) => {
    const manifest = scratchManifest(`{"standing/clean/fidelity":${body}}\n`);
    expect(() => loadSweepClusters(manifest)).toThrowError(
      `${manifest}: malformed cluster for standing/clean/fidelity`,
    );
  });
});
