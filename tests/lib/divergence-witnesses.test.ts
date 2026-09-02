/**
 * The witness file's own gate.
 *
 * The documents in it are inputs a later task will need in order to
 * fail; the risk this file guards is that one of them quietly stops
 * being reachable - a corpus id that no longer resolves, a row that
 * loses its source, a depth-5 shape the sweep no longer spells. Every
 * one of those is a silent weakening, so each is a row here.
 */
import { describe, expect, it } from "vitest";
import {
  loadWitnesses,
  witnessDocuments,
  WITNESS_PATH,
} from "./divergence-witnesses.js";
import { DEEP_DEPTH, sweepDocuments } from "../format/list-shape-sweep.js";

describe("the divergence witnesses", () => {
  it("loads and validates", () => {
    const file = loadWitnesses();
    expect(file.witnesses.length).toBeGreaterThan(0);
    expect(file.depthFiveKnownFailures.length).toBeGreaterThan(0);
  });

  it("carries a source for every witness that is not a corpus case", () => {
    for (const witness of loadWitnesses().witnesses) {
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
    expect(documents).toHaveLength(loadWitnesses().witnesses.length);
    for (const [index, text] of documents.entries()) {
      expect(text, String(index)).not.toBe("");
    }
  });

  it("names every witness once", () => {
    const ids = loadWitnesses().witnesses.map((witness) => witness.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the sealed revision's depth-5 shapes inside the sweep product", () => {
    // The gate asks for a failing set that is a SUBSET of this one, so
    // a shape the product no longer spells could never be compared and
    // would sit here forever looking like a live claim.
    const spelled = new Set(sweepDocuments(DEEP_DEPTH));
    for (const failure of loadWitnesses().depthFiveKnownFailures) {
      expect(spelled.has(failure.document), failure.document).toBe(true);
    }
  });

  it("gives every depth-5 shape a mechanism family", () => {
    for (const failure of loadWitnesses().depthFiveKnownFailures) {
      expect(failure.family, failure.document).not.toBe("");
      expect(failure.family, failure.document).not.toBe("UNGROUPED");
    }
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
