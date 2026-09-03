/**
 * The AST invariants, run over Asciidoctor's own test corpus, plus
 * the negative rows that prove each invariant can fail.
 *
 * This suite replaces two gates that died with the grammar:
 * reader.test.ts's "reader output is always grammatical" (the parser
 * accepted the stream on every corpus document) and its "positions
 * exact" corpus test. Both were proofs about a token stream; these
 * are the same proofs about the tree, carried by the corpus and the
 * deterministic shape grids.
 */
import { describe, test, expect } from "vitest";
import type { Location } from "../../src/ast.js";
import { loadCorpus } from "../conformance/loader.js";
import {
  expectAnnotatedByPairing,
  expectAstInvariants,
  expectContainment,
  expectGapsVerbatim,
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

// (vii)'s ONE exception, exercised rather than described: a `+` a
// nested item pops off its own buffer is printed back from that
// item's tail (`ListItemNode.trailingContinuation`), so the enclosing
// gap that spans the line does not record it too. Writing both
// spellings puts an adjacent `+` pair in the output, which the
// `ListContinuationMarker === this_line` arm freezes on re-read
// (parser.rb l.1443-46).
//
// The corpus rows above hold the equality half — no corpus document
// has this shape — so these are where the exception is measured at
// all. The first two are the two spellings that reach it: a run the
// nested scan erases its `+` into, and the adjacent pair whose SECOND
// `+` the pop takes. The third has the tail one level deeper.
describe("AST invariants: (vii) allows a popped + out of the gap", () => {
  test.each([
    "* a\n** b\n+\n\n\n+\npara\n",
    "* a\n** b\n+\n+\n\n+\npara\n",
    "* a\n** b\n*** c\n+\n\n\n+\npara\n",
  ])("%s", (source) => {
    expectAstInvariants(source);
  });

  // And it stays an exception: with no tail fact under the previous
  // block, the same missing `+` is a failure. The item below records
  // one gap line where the source has two, and no nested item is
  // there to have printed the other.
  test("(vii) bites: a gap short a + no tail prints back fails", () => {
    const bad = {
      type: "document",
      children: [
        {
          type: "list",
          variant: "unordered",
          marker: "*",
          children: [
            {
              type: "listItem",
              markerSpelling: "*",
              text: [
                {
                  type: "text",
                  value: "a",
                  position: { start: at(2, 1), end: at(3, 1) },
                },
              ],
              blocks: [
                {
                  gap: [""],
                  block: {
                    type: "paragraph",
                    children: [],
                    position: { start: at(7, 4), end: at(11, 4) },
                  },
                },
              ],
              position: { start: at(0, 1), end: at(11, 4) },
            },
          ],
          position: { start: at(0, 1), end: at(11, 4) },
        },
      ],
      position: { start: at(0, 1), end: at(11, 4) },
    };
    const source = "* a\n+\n\npara\n";
    // The MESSAGE is asserted, not just the throw: every other way
    // this walk can fail (a content line in the gap, a dropped blank,
    // an entry the source has not got) would also throw, and the row
    // is about the DROP COUNT.
    expect(() => {
      expectGapsVerbatim(source, preorder(bad));
    }).toThrow(/dropped a \+ no tail prints back/v);
  });
});
