/**
 * The cross-checkout differential's comparison vocabulary.
 *
 * These are the parts that decide what a DIVERGENCE IS - which
 * documents land in which bucket, and what counts as a lost word. The
 * run that produces their inputs formats tens of thousands of
 * documents under three checkouts and takes minutes, so the whole
 * pipeline can only be exercised by hand; keeping the decisions in
 * pure functions is what lets them be pinned here instead.
 *
 * The green-on-baseline self-check is strong evidence that the
 * pipeline works end to end, but it cannot localize a fault and it
 * cannot run in CI. These rows can do both.
 */
import { describe, expect, it } from "vitest";
import {
  byteBucket,
  familiesOf,
  losesWords,
  renderBucket,
  words,
  type TreeReport,
} from "../../scripts/lib/differential.js";
import type { FormattedPair } from "../../scripts/lib/tree-format.js";

/**
 * One document's pair, both passes identical.
 * @param twice - the output both passes produced
 * @returns the pair
 */
function formatted(twice: string): FormattedPair {
  return { kind: "formatted", once: twice, twice };
}

/**
 * A tree that made exactly these outputs, rendering exactly these
 * documents as their source.
 * @param name - what to call it
 * @param outputs - pass-1 output per document; undefined means it threw
 * @param renders - whether pass 1 rendered as the source, per document
 * @returns the report
 */
function tree(
  name: string,
  outputs: ReadonlyArray<string | undefined>,
  renders: readonly boolean[],
): TreeReport {
  const pairs: FormattedPair[] = outputs.map((out) =>
    out === undefined
      ? { kind: "threw", message: "boom" }
      : { kind: "formatted", once: out, twice: out },
  );
  return { name, pairs, renders, wordLoss: 0, threw: 0, unstable: 0 };
}

describe("words", () => {
  it("splits on all six ASCII whitespace characters", () => {
    expect(words("a\tb\nc\vd\fe\rf g")).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
    ]);
  });

  it("drops the empty pieces a whitespace run makes", () => {
    // A run is one separator. Counting the gap between two spaces as a
    // word would report every reflow as a loss.
    expect(words("  a   b  ")).toEqual(["a", "b"]);
  });

  it("has no words in an empty or blank document", () => {
    expect(words("")).toEqual([]);
    expect(words("  \n\t ")).toEqual([]);
  });
});

describe("losesWords", () => {
  it("says no when the words survive a reflow that moved them", () => {
    expect(losesWords("a b\nc\n", formatted("a\nb c\n"))).toBe(false);
  });

  it("says yes when a word is gone", () => {
    expect(losesWords("a b c\n", formatted("a c\n"))).toBe(true);
  });

  it("counts MULTISETS, so losing one of two copies counts", () => {
    // The whole reason the definition is a multiset difference: a
    // set-based test would see `a` on both sides and report nothing.
    expect(losesWords("a a b\n", formatted("a b\n"))).toBe(true);
  });

  it("does not count words the output GAINED", () => {
    expect(losesWords("a\n", formatted("a b c\n"))).toBe(false);
  });

  it("reports no loss for a tree that threw", () => {
    // There is no output to take a multiset of, and "it crashed" is a
    // different report counted in its own column.
    expect(losesWords("a b\n", { kind: "threw", message: "boom" })).toBe(false);
  });
});

describe("renderBucket", () => {
  const documents = ["d0\n", "d1\n", "d2\n"];

  it("holds only what the other tree renders and this one does not", () => {
    const mine = tree("mine", ["x", "y", "z"], [false, true, false]);
    const other = tree("other", ["x", "y", "z"], [true, true, false]);
    const bucket = renderBucket("what", mine, other, documents);
    expect(bucket.rows.map((row) => row.document)).toEqual(["d0\n"]);
  });

  it("is DIRECTIONAL: swapping the trees gives the other set", () => {
    const mine = tree("mine", ["x", "y"], [false, true]);
    const other = tree("other", ["x", "y"], [true, false]);
    expect(
      renderBucket("a", mine, other, ["d0\n", "d1\n"]).rows.map(
        (row) => row.document,
      ),
    ).toEqual(["d0\n"]);
    expect(
      renderBucket("b", other, mine, ["d0\n", "d1\n"]).rows.map(
        (row) => row.document,
      ),
    ).toEqual(["d1\n"]);
  });

  it("says so when a formatter threw instead of reading a diff", () => {
    const mine = tree("mine", [undefined], [false]);
    const other = tree("other", ["* a\n"], [true]);
    expect(renderBucket("what", mine, other, ["d0\n"]).rows[0].signature).toBe(
      "a formatter threw",
    );
  });
});

describe("byteBucket", () => {
  // The class the render buckets cannot see, and the reason this
  // bucket exists: both trees render the document as its source, and
  // they print it two different ways. No render row is produced for it
  // in either direction.
  it("catches a byte difference both trees render identically", () => {
    const mine = tree("mine", ["* a\n"], [true]);
    const other = tree("other", ["* a\n\n"], [true]);
    const documents = ["* a\n"];
    expect(renderBucket("r", mine, other, documents).rows).toHaveLength(0);
    expect(renderBucket("r", other, mine, documents).rows).toHaveLength(0);
    expect(byteBucket("b", mine, other, documents).rows).toHaveLength(1);
  });

  it("is empty when the two trees printed the same bytes", () => {
    const mine = tree("mine", ["* a\n", "* b\n"], [true, true]);
    const other = tree("other", ["* a\n", "* b\n"], [true, false]);
    expect(byteBucket("b", mine, other, ["d0\n", "d1\n"]).rows).toHaveLength(0);
  });

  it("compares pass 1 only, so a stability difference is not a byte difference", () => {
    // Two trees that print the same pass-1 bytes and then diverge on
    // pass 2 differ in STABILITY, which each tree reports for itself.
    const mine: TreeReport = {
      ...tree("mine", ["* a\n"], [true]),
      pairs: [{ kind: "formatted", once: "* a\n", twice: "* a\n" }],
    };
    const other: TreeReport = {
      ...tree("other", ["* a\n"], [true]),
      pairs: [{ kind: "formatted", once: "* a\n", twice: "DIFFERENT" }],
    };
    expect(byteBucket("b", mine, other, ["d0\n"]).rows).toHaveLength(0);
  });

  it("skips a document either tree threw on", () => {
    // There is no output to compare, and the throw is already counted.
    const mine = tree("mine", [undefined], [false]);
    const other = tree("other", ["* a\n"], [true]);
    expect(byteBucket("b", mine, other, ["d0\n"]).rows).toHaveLength(0);
    expect(byteBucket("b", other, mine, ["d0\n"]).rows).toHaveLength(0);
  });

  it("is symmetric, unlike the render buckets", () => {
    const mine = tree("mine", ["* a\n"], [true]);
    const other = tree("other", ["* b\n"], [true]);
    expect(byteBucket("b", mine, other, ["d0\n"]).rows).toHaveLength(1);
    expect(byteBucket("b", other, mine, ["d0\n"]).rows).toHaveLength(1);
  });
});

describe("familiesOf", () => {
  it("groups by signature, largest family first", () => {
    const bucket = {
      what: "what",
      rows: [
        { document: "a", signature: "[x] -> []" },
        { document: "b", signature: "" },
        { document: "c", signature: "[x] -> []" },
        { document: "d", signature: "[x] -> []" },
      ],
    };
    expect(
      familiesOf(bucket).map(([signature, rows]) => [signature, rows.length]),
    ).toEqual([
      ["[x] -> []", 3],
      ["", 1],
    ]);
  });

  it("keeps every row, so a family split loses nothing", () => {
    const bucket = {
      what: "what",
      rows: [
        { document: "a", signature: "p" },
        { document: "b", signature: "q" },
      ],
    };
    const total = familiesOf(bucket).reduce(
      (sum, [, rows]) => sum + rows.length,
      0,
    );
    expect(total).toBe(bucket.rows.length);
  });
});
