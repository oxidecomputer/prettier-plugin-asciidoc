/**
 * The witness file's own gate.
 *
 * The documents in it are inputs a later task will need in order to
 * fail; the risk this file guards is that one of them quietly stops
 * being reachable - a corpus id that no longer resolves, or a row
 * that loses its source. Either is a silent weakening, so each is a
 * row here.
 */
import { describe, expect, it } from "vitest";
import {
  loadWitnesses,
  witnessDocuments,
  WITNESS_PATH,
} from "./divergence-witnesses.js";

describe("the divergence witnesses", () => {
  it("loads and validates", () => {
    expect(loadWitnesses().length).toBeGreaterThan(0);
  });

  it("carries a source for every witness that is not a corpus case", () => {
    for (const witness of loadWitnesses()) {
      if (witness.origin === "corpus") {
        continue;
      }
      expect(witness.source, witness.id).not.toBe("");
    }
  });

  it("resolves every corpus witness against the loaded corpus", () => {
    // `witnessDocuments` throws on an id that resolves to nothing, so
    // this row is the resolution check as well as a shape check.
    const documents = witnessDocuments();
    expect(documents).toHaveLength(loadWitnesses().length);
    for (const [index, text] of documents.entries()) {
      expect(text, String(index)).not.toBe("");
    }
  });

  it("names every witness once", () => {
    const ids = loadWitnesses().map((witness) => witness.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects a corpus row that carries a source", () => {
    // The union makes that state unrepresentable in TypeScript; this
    // row is the same guarantee for the FILE, which is only JSON.
    //
    // The fixture is well formed apart from the one fault, and the
    // assertion names the validation branch's own text. Pointing this
    // at a non-JSON file instead would pass on the SyntaxError out of
    // JSON.parse without the validation ever running - a green row
    // asserting nothing it claims.
    expect(() =>
      loadWitnesses("tests/lib/fixtures/corpus-witness-with-source.json"),
    ).toThrow("a corpus witness carries no source");
  });

  it("names the checked-in file", () => {
    expect(WITNESS_PATH).toBe("tests/format/divergence-witnesses.json");
  });
});
