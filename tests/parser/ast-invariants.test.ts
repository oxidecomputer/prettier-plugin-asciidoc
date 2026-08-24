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
import { describe, test, expect } from "vitest";
import fc from "fast-check";
import type { Location } from "../../src/ast.js";
import { loadCorpus } from "../conformance/loader.js";
import { randomInput, readerDocument } from "../fuzz/arbitraries.js";
import { fuzzParameters } from "../fuzz/config.js";
import {
  expectAnnotatedByPairing,
  expectAstInvariants,
  expectContainment,
  expectItemSiblingMonotonicity,
  expectMasqueradeSourceDelimiter,
} from "./ast-invariants.js";
import { preorder } from "./ast-walk.js";

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

/**
 * A `Location` fixture for the negative rows below: column is always
 * 1, since none of them exercise column-sensitive behavior.
 * @param offset - the character offset
 * @param line - the one-based line number
 * @returns a location a synthetic node's position can use
 */
function at(offset: number, line: number): Location {
  return { offset, line, column: 1 };
}

describe("AST invariants: negative rows", () => {
  test("(xi) bites: a recorded annotation with no attribute sibling fails", () => {
    const position = {
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 4, line: 1, column: 5 },
    };
    const bad = {
      type: "document",
      children: [
        {
          type: "delimitedBlock",
          variant: "listing",
          form: "paragraph",
          content: "x",
          annotatedBy: "source",
          position,
        },
      ],
      position,
    };
    expect(() => {
      expectAnnotatedByPairing(bad);
    }).toThrow();
  });

  test("(viii) bites: an admonition child escaping its span fails", () => {
    const outer = {
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: 10, line: 1, column: 11 },
    };
    const inner = {
      start: { offset: 20, line: 3, column: 1 },
      end: { offset: 30, line: 3, column: 11 },
    };
    const bad = {
      type: "document",
      children: [
        {
          type: "admonition",
          variant: "note",
          form: "example",
          text: [],
          // Starts after the admonition's own span ends — the escape
          // shape (viii) must catch now that admonition is a
          // spanning container.
          children: [{ type: "paragraph", children: [], position: inner }],
          position: outer,
        },
      ],
      position: outer,
    };
    expect(() => {
      expectContainment(bad);
    }).toThrow();
  });

  test("(viii-b) bites: an over-spanning item block fails", () => {
    const item = {
      type: "listItem",
      checkbox: undefined,
      calloutNumber: undefined,
      text: [
        {
          type: "text",
          value: "a",
          position: { start: at(2, 1), end: at(3, 1) },
        },
      ],
      blocks: [
        {
          gap: [],
          // Starts BEFORE the text ends — the silent over-span shape.
          block: {
            type: "paragraph",
            children: [],
            position: { start: at(1, 1), end: at(6, 2) },
          },
        },
      ],
      trailingContinuation: false,
      position: { start: at(0, 1), end: at(6, 2) },
    };
    expect(() => {
      expectItemSiblingMonotonicity([item]);
    }).toThrow();
  });

  test("(xiii) bites: a delimited verse with no sourceDelimiter fails", () => {
    const bad = {
      type: "document",
      children: [
        {
          type: "delimitedBlock",
          variant: "verse",
          form: "delimited",
          content: "x",
          position: { start: at(0, 1), end: at(12, 3) },
        },
      ],
      position: { start: at(0, 1), end: at(12, 3) },
    };
    expect(() => {
      expectMasqueradeSourceDelimiter(preorder(bad));
    }).toThrow();
  });
});
