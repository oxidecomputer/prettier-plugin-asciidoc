/**
 * Unit tests for the ledger's DECLARATION half: the `Parity-Diff:`
 * commit-message trailer scan, the empty-range refusal of the `git
 * log` wrapper around it, and `reportExpectedDiffs` - the one place a
 * scan failure becomes a failed run.
 *
 * Split out of tests/scripts/parity-ledger.test.ts to keep that file
 * under the project's `max-lines` ceiling; that file keeps the gate
 * itself (`expectedDiffFailures`, the family enum) and the dumper's
 * shape folds.
 */
import { describe, expect, test } from "vitest";
import {
  collectExpectedDiffTrailers,
  parseExpectedDiffTrailers,
  reportExpectedDiffs,
} from "../../scripts/parity-ledger.js";

// A synthetic family set, as in parity-ledger.test.ts: the report
// rows below declare nothing, so the enum they run under is only
// scenery.
const SYNTHETIC = {
  families: new Set(["fam-ast", "fam-bytes"]),
  formattedOnly: new Set(["fam-bytes"]),
};

/**
 * Run `body` with `process.stdout.write` captured.
 * @param body - what to run
 * @returns everything the run wrote to stdout
 */
function captureStdout(body: () => void): string {
  const chunks: string[] = [];
  const real = process.stdout.write.bind(process.stdout);
  const capture = (chunk: string | Uint8Array): boolean => {
    chunks.push(
      typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
    );
    return true;
  };
  process.stdout.write = capture as typeof process.stdout.write;
  try {
    body();
  } finally {
    process.stdout.write = real;
  }
  return chunks.join("");
}

/**
 * Report over otherwise clean streams, capturing what it printed and
 * restoring the process exit code the assertions read.
 * @param trailerFailures - the scan failures to feed the gate
 * @returns what was written to stdout, and the exit code it left
 */
function reportTrailerFailures(trailerFailures: readonly string[]): {
  output: string;
  exitCode: number | string | undefined;
} {
  const before = process.exitCode ?? undefined;
  try {
    const output = captureStdout(() => {
      reportExpectedDiffs({
        expectedDiffs: [],
        trailerFailures,
        ast: [],
        formatted: [],
        headIds: new Set(["a"]),
        headSize: 1,
        baseRoot: "/nonexistent",
        revision: "abc123",
        limit: 20,
        allowParentBlockEnd: false,
        familySets: SYNTHETIC,
        reportCase: () => {
          throw new Error("no case differs, so none may be detailed");
        },
      });
    });
    return { output, exitCode: process.exitCode ?? undefined };
  } finally {
    // Leaving a 1 behind would fail the whole vitest process.
    process.exitCode = before;
  }
}

describe("parseExpectedDiffTrailers: the declaration scan", () => {
  // The scan is the whole ledger now, so a trailer that reads as
  // prose would excuse a diff nobody declared and a trailer that
  // reads as a declaration when it is not would fail a clean run.
  // Every row here but the last is the pure function; the git call
  // that feeds it (collectExpectedDiffTrailers) has exactly one rule
  // of its own, the empty-range refusal, and that row runs the real
  // `git rev-list` over this repository (read-only, and `HEAD..HEAD`
  // is empty in every checkout).

  test("a message with no trailers declares nothing", () => {
    expect(
      parseExpectedDiffTrailers("fix: a thing\n\nprose about the thing\n"),
    ).toEqual({ entries: [], failures: [] });
  });

  test("one trailer, with the surrounding message ignored", () => {
    expect(
      parseExpectedDiffTrailers(
        "fix: a thing\n\nWhy: because.\nParity-Diff: gap-collapse a\nCo-Authored-By: nobody\n",
      ),
    ).toEqual({ entries: [{ id: "a", family: "gap-collapse" }], failures: [] });
  });

  test("trailers union across several messages, in first-seen order", () => {
    expect(
      parseExpectedDiffTrailers(
        "second commit\n\nParity-Diff: author-plus b\n\nfirst commit\n\nParity-Diff: gap-collapse a\n",
      ),
    ).toEqual({
      entries: [
        { id: "b", family: "author-plus" },
        { id: "a", family: "gap-collapse" },
      ],
      failures: [],
    });
  });

  test("an id keeps its spaces, hashes and punctuation", () => {
    const id = "lists_test.rb#consecutive list continuation lines are folded#0";
    expect(
      parseExpectedDiffTrailers(
        `subject\n\nParity-Diff: no-op-continuation-tree ${id}\n`,
      ),
    ).toEqual({
      entries: [{ id, family: "no-op-continuation-tree" }],
      failures: [],
    });
  });

  test("the same id declared twice under one family dedupes silently", () => {
    expect(
      parseExpectedDiffTrailers(
        "a\n\nParity-Diff: author-plus x\n\nb\n\nParity-Diff: author-plus x\n",
      ),
    ).toEqual({ entries: [{ id: "x", family: "author-plus" }], failures: [] });
  });

  test("the same id under two families is a failure naming both", () => {
    const { entries, failures } = parseExpectedDiffTrailers(
      "a\n\nParity-Diff: author-plus x\n\nb\n\nParity-Diff: gap-collapse x\n",
    );
    expect(entries).toEqual([{ id: "x", family: "author-plus" }]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("author-plus");
    expect(failures[0]).toContain("gap-collapse");
  });

  test("a repeated contradiction is reported once, not once per repeat", () => {
    // The dedupe rule exists to be quiet about a rebase that
    // duplicated a trailer; reporting the same conflict twice for the
    // duplicate would defeat it.
    const { entries, failures } = parseExpectedDiffTrailers(
      "a\n\nParity-Diff: author-plus x\n\nb\n\nParity-Diff: gap-collapse x\n\nc\n\nParity-Diff: gap-collapse x\n",
    );
    expect(entries).toEqual([{ id: "x", family: "author-plus" }]);
    expect(failures).toHaveLength(1);
  });

  test("a Parity-Diff line with no id is malformed, not prose", () => {
    const { entries, failures } = parseExpectedDiffTrailers(
      "subject\n\nParity-Diff: author-plus\n",
    );
    expect(entries).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("malformed trailer");
    expect(failures[0]).toContain("Parity-Diff: author-plus");
  });

  test("a Parity-Diff line with nothing after the key is malformed", () => {
    const { failures } = parseExpectedDiffTrailers("subject\n\nParity-Diff:\n");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("malformed trailer");
  });

  test("an indented trailer is read, and a mid-line one is not", () => {
    expect(
      parseExpectedDiffTrailers("subject\n\n    Parity-Diff: author-plus x\n"),
    ).toEqual({ entries: [{ id: "x", family: "author-plus" }], failures: [] });
    expect(
      parseExpectedDiffTrailers("see Parity-Diff: author-plus x for why\n"),
    ).toEqual({ entries: [], failures: [] });
  });

  test("a CRLF message's trailer parses (the carriage return is trimmed)", () => {
    // Load-bearing: without the trim, `\r` is not matched by `.` and a
    // Windows-authored commit would fail a clean run as malformed.
    expect(
      parseExpectedDiffTrailers(
        "subject\r\n\r\nParity-Diff: author-plus x\r\n",
      ),
    ).toEqual({ entries: [{ id: "x", family: "author-plus" }], failures: [] });
  });

  test("no space after the colon is accepted", () => {
    expect(
      parseExpectedDiffTrailers("subject\n\nParity-Diff:author-plus x\n"),
    ).toEqual({ entries: [{ id: "x", family: "author-plus" }], failures: [] });
  });

  test("the family is a single token, and the id is all the rest", () => {
    expect(parseExpectedDiffTrailers("Parity-Diff: a b c\n")).toEqual({
      entries: [{ id: "b c", family: "a" }],
      failures: [],
    });
  });

  test("an empty trailer range is refused, not read as no declarations", () => {
    // git exits 0 on `a..a` with no output, which reads exactly like a
    // clean scan - and `--expected-diffs-trailers HEAD` under jj is
    // how a local run gets one. The throw makes parity exit 2.
    expect(() => collectExpectedDiffTrailers("HEAD", "HEAD")).toThrow(
      "contains no commits",
    );
  });
});

describe("reportExpectedDiffs: the line that turns a scan into a failure", () => {
  // The composition `[...trailerFailures, ...expectedDiffFailures(...)]`
  // is the only place a malformed or contradictory declaration becomes
  // a FAILURE. Drop that spread and every such declaration is prose
  // again, silently: the pure scan still reports it, and nothing
  // prints it or exits on it.

  test("a trailer failure alone fails the run and suppresses the success line", () => {
    const { output, exitCode } = reportTrailerFailures([
      'expected-diffs: malformed trailer "Parity-Diff: author-plus" - the syntax is "Parity-Diff: <family> <id>"',
    ]);
    expect(output).toContain("malformed trailer");
    expect(output).not.toContain("cases match");
    expect(exitCode).toBe(1);
  });

  test("no trailer failure and no diff prints the success line, leaving the exit code alone", () => {
    const before = process.exitCode ?? undefined;
    const { output, exitCode } = reportTrailerFailures([]);
    expect(output).toContain("1 cases match abc123");
    expect(exitCode).toBe(before);
  });
});
