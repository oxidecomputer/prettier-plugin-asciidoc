/**
 * The AST invariants, run over everything: Asciidoctor's own test
 * corpus, the reader line soup that found plan 2's two ordering bugs,
 * and random Unicode.
 *
 * This suite replaces two gates that die with the grammar:
 * reader.test.ts's "reader output is always grammatical" (the parser
 * accepted the stream on every corpus document) and its "positions
 * exact" corpus test. Both were proofs about a token stream; these are
 * the same proofs about the tree.
 *
 * The run counts are the ones mutation testing chose in plan 2 (3000
 * for the reader soup, 200 for random Unicode) and they are
 * load-bearing: the two ordering regressions are caught at 3000 and
 * NOT at 300.
 */
import { describe, test } from "vitest";
import fc from "fast-check";
import { loadCorpus } from "../conformance/loader.js";
import { randomInput, readerDocument } from "../fuzz/arbitraries.js";
import { fuzzParameters } from "../fuzz/config.js";
import { expectAstInvariants } from "./ast-invariants.js";

describe("AST invariants: corpus", () => {
  const cases = loadCorpus().flatMap((group) => group.cases);
  test.each(cases.map((one) => [one.id, one.input] as const))(
    "%s",
    (_id, source) => {
      expectAstInvariants(source);
    },
  );
});

describe("AST invariants: fuzz", () => {
  test("reader line soup holds every invariant", () => {
    fc.assert(
      fc.property(readerDocument, (source) => {
        expectAstInvariants(source);
      }),
      fuzzParameters({ numRuns: 3000 }),
    );
  });
  test("random Unicode input holds every invariant", () => {
    fc.assert(
      fc.property(randomInput, (source) => {
        expectAstInvariants(source);
      }),
      fuzzParameters({ numRuns: 200 }),
    );
  });
});
