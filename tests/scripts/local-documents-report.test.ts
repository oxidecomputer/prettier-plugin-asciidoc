/**
 * The local-documents CLASSIFIER and REPORT (issue #13), against
 * literal results.
 *
 * Every row here is a `CheckResult` this file wrote, which is the
 * point: the failure families have to be testable without a corpus
 * that fails, without a stub of the formatter, and without a fixture
 * that stops failing the day the bug behind it is fixed. The runner's
 * own tests (tests/scripts/local-documents.test.ts) cover the other half -
 * that real documents produce results of this shape.
 */
import { describe, expect, test } from "vitest";
import type {
  CheckName,
  CheckResult,
} from "../../scripts/local-documents-checks.js";
import { classify, reportLines } from "../../scripts/local-documents-report.js";

/**
 * One result for a test row.
 * @param id - the document id
 * @param failures - the checks that failed
 * @param options - what else the row needs to say
 * @param options.unassessed - the checks that could not be assessed
 * @param options.detail - the result's detail clause
 * @param options.elapsed - the wall time to report
 * @param options.size - how many characters the document holds
 * @returns the result
 */
function result(
  id: string,
  failures: CheckName[],
  options: {
    unassessed?: CheckName[];
    detail?: string;
    elapsed?: number;
    size?: number;
  } = {},
): CheckResult {
  return {
    id,
    size: options.size ?? 100,
    elapsed: options.elapsed ?? 1,
    failures,
    unassessed: options.unassessed ?? [],
    detail: options.detail ?? "",
  };
}

describe("classify", () => {
  test("an empty run is a run of nothing, not a clean run", () => {
    const summary = classify([]);
    expect(summary.documents).toBe(0);
    expect(summary.failing).toBe(0);
    expect(summary.failed).toEqual([]);
    expect(summary.slowest).toEqual([]);
  });

  test("counts the documents and the ones that failed something", () => {
    const summary = classify([
      result("a", []),
      result("b", ["idempotence"]),
      result("c", ["format", "render"]),
    ]);
    expect(summary.documents).toBe(3);
    expect(summary.failing).toBe(2);
  });

  test("a document counts once per family it failed, in check order", () => {
    const summary = classify([
      result("a", ["render"]),
      result("b", ["format", "render"]),
      result("c", ["idempotence"]),
    ]);
    expect(summary.failed).toEqual([
      { family: "format", documents: ["b"] },
      { family: "idempotence", documents: ["c"] },
      { family: "render", documents: ["a", "b"] },
    ]);
  });

  test("families nothing landed in are dropped, not printed as zeroes", () => {
    const summary = classify([result("a", ["reformat"])]);
    expect(summary.failed.map((roll) => roll.family)).toEqual(["reformat"]);
  });

  test("unassessed checks are rolled up apart from failures", () => {
    const summary = classify([
      result("a", [], { unassessed: ["render"] }),
      result("b", ["format"], {
        unassessed: ["reformat", "idempotence", "render"],
      }),
    ]);
    expect(summary.failed).toEqual([{ family: "format", documents: ["b"] }]);
    expect(summary.unassessed).toEqual([
      { family: "reformat", documents: ["b"] },
      { family: "idempotence", documents: ["b"] },
      { family: "render", documents: ["a", "b"] },
    ]);
  });

  test("the slowest documents come first, and the total is the sum", () => {
    const summary = classify([
      result("a", [], { elapsed: 10 }),
      result("b", [], { elapsed: 300 }),
      result("c", [], { elapsed: 20 }),
    ]);
    expect(summary.slowest.map((one) => one.id)).toEqual(["b", "c", "a"]);
    expect(summary.elapsed).toBe(330);
  });

  test("the largest documents come first", () => {
    const summary = classify([
      result("a", [], { size: 10 }),
      result("b", [], { size: 300 }),
      result("c", [], { size: 20 }),
    ]);
    expect(summary.largest.map((one) => one.id)).toEqual(["b", "c", "a"]);
  });
});

/**
 * The report over one run's results, classified the way the command
 * does it - once, so the exit code and the report read the same
 * numbers.
 * @param results - the run's results
 * @param limit - how many failing documents to name
 * @returns the report's lines
 */
const report = (results: CheckResult[], limit: number): string[] =>
  reportLines(classify(results), limit);

describe("reportLines", () => {
  test("a clean run says so, and says how long it took", () => {
    const lines = report(
      [result("a", [], { elapsed: 1200 }), result("b", [], { elapsed: 300 })],
      20,
    );
    expect(lines[0]).toBe("local-docs: 2 documents, 0 failing (1.5 s)");
    expect(lines).toContain(
      "local-docs: every document parsed, settled and rendered the same",
    );
  });

  test("a clean run claims only the checks that RAN", () => {
    // A headline saying every document "rendered the same" over
    // renders that never happened is the quiet failure this
    // repository's exit-code doctrine exists against. Parsing and
    // settling WERE measured, so the run is still clean and still
    // exits 0 - the sentence is the part that has to be honest.
    const lines = report([result("a", [], { unassessed: ["render"] })], 20);
    expect(lines[1]).toContain("unassessed checks:");
    expect(lines).toContain(
      "local-docs: every document parsed and settled (unassessed: 1 render)",
    );
    expect(lines.join("\n")).not.toContain("rendered the same");
  });

  test("a clean run whose reformat was unassessed still claims render", () => {
    const lines = report([result("a", [], { unassessed: ["reformat"] })], 20);
    expect(lines).toContain(
      "local-docs: every document parsed, settled and rendered the same (unassessed: 1 reformat)",
    );
  });

  test("failures are counted by family and then named one per line", () => {
    const lines = report(
      [
        result("9901.adoc", ["idempotence"], {
          detail: "the second format pass changed the output",
          size: 12,
        }),
        result("9902.adoc", ["format", "render"], {
          detail: "format threw: boom",
          size: 34,
        }),
      ],
      20,
    );
    expect(lines).toEqual([
      "local-docs: 2 documents, 2 failing (0.0 s)",
      "local-docs: failures by check:",
      "      1 format",
      "      1 idempotence",
      "      1 render",
      "local-docs: the 2 failing documents:",
      "  9901.adoc [idempotence] the second format pass changed the output",
      "  9902.adoc [format, render] format threw: boom",
      "local-docs: slowest: 9901.adoc 1 ms, 9902.adoc 1 ms",
      "local-docs: largest: 9902.adoc 34 chars, 9901.adoc 12 chars",
    ]);
  });

  test("the limit truncates the named documents and says it did", () => {
    const lines = report([result("a", ["render"]), result("b", ["render"])], 1);
    expect(lines).toContain("local-docs: 1 of 2 failing documents:");
    expect(lines.filter((line) => line.startsWith("  a "))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("  b "))).toHaveLength(0);
  });

  test("a clean run prints no failure table at all", () => {
    const lines = report([result("a", [])], 20);
    expect(lines.join("\n")).not.toContain("failures by check");
  });

  test("a run of no documents reports the headline and nothing else", () => {
    // Unreachable from the command - the measured-nothing floor fires
    // first - but reachable from the exported function, and the
    // slowest and largest lines have nothing to say about zero
    // documents.
    expect(report([], 20)).toEqual([
      "local-docs: 0 documents, 0 failing (0.0 s)",
      "local-docs: every document parsed, settled and rendered the same",
    ]);
  });
});
