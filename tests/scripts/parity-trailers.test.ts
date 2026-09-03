/**
 * Unit tests for the ledger's DECLARATION half: the `Parity-Diff:`
 * commit-message trailer scan, the empty-range refusal of the `git
 * log` wrapper around it, and `reportExpectedDiffs` - the one place a
 * scan failure becomes a failed run.
 *
 * Split out of tests/scripts/parity-ledger.test.ts to keep that file
 * under the project's `max-lines` ceiling; that file keeps the gate
 * itself (`expectedDiffFailures`, the family enum) and the dumper's
 * shape folds. The scan itself later moved to `scripts/parity-trailers.ts`
 * when `parity-ledger.ts` reached the same ceiling on its own account;
 * `reportExpectedDiffs` stayed there, which is why the two imports
 * below name different modules.
 */
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vitest";
import { REPO_ROOT } from "../../scripts/lib/checkout.js";
import { reportExpectedDiffs } from "../../scripts/parity-ledger.js";
import {
  collectExpectedDiffTrailers,
  parseExpectedDiffTrailers,
} from "../../scripts/parity-trailers.js";

/**
 * Whether `git` can see a checkout here at all.
 *
 * A jj workspace of this repository often colocates no `.git` -
 * parallel implementer lanes run exactly that way - and `git
 * rev-parse --git-dir` is the cheapest question that distinguishes
 * "no repository" from every other way `git` can fail (an unknown
 * revision, say, which the test below still wants to exercise).
 * @returns whether a `git` command run here has a repository to read
 */
function hasGitCheckout(): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], {
      cwd: REPO_ROOT,
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

// A synthetic family set, as in parity-ledger.test.ts: the report
// rows below declare nothing, so the enum they run under is only
// scenery.
const SYNTHETIC = {
  families: new Set(["fam-ast", "fam-bytes", "fam-keyed"]),
  formattedOnly: new Set(["fam-bytes"]),
  // Only `fam-keyed` may be declared with a BARE trailer, and the one
  // key it owns is what the blanket rows below strip from both sides.
  blanketKeys: new Map([["fam-keyed", new Set(["recorded"])]]),
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
 * The bare-trailer half of a `reportExpectedDiffs` call: the families
 * a bare trailer declared, the differing-AST ids they run against, and
 * the coverage proof the gate injects.
 */
interface BlanketRun {
  blanket: readonly string[];
  ast: readonly string[];
  covers: (id: string, keys: ReadonlySet<string>) => boolean;
}

/** No bare trailer, no differing case: what the non-blanket rows run. */
const NO_BLANKET: BlanketRun = { blanket: [], ast: [], covers: () => false };

/**
 * Report over otherwise clean streams, capturing what it printed and
 * restoring the process exit code the assertions read.
 * @param trailerFailures - the scan failures to feed the gate
 * @param blanketRun - the bare-trailer half of the same call
 * @param blanketRun.blanket - the families a bare trailer declared
 * @param blanketRun.ast - the ids whose AST differs
 * @param blanketRun.covers - proves one id against a family's keys
 * @returns what was written to stdout, and the exit code it left
 */
function reportTrailerFailures(
  trailerFailures: readonly string[],
  blanketRun: BlanketRun = NO_BLANKET,
): {
  output: string;
  exitCode: number | string | undefined;
} {
  const before = process.exitCode ?? undefined;
  try {
    const output = captureStdout(() => {
      reportExpectedDiffs({
        expectedDiffs: [],
        trailerFailures,
        ast: blanketRun.ast,
        formatted: [],
        headIds: new Set(["a"]),
        headSize: 1,
        baseRoot: "/nonexistent",
        revision: "abc123",
        limit: 20,
        allowParentBlockEnd: false,
        familySets: SYNTHETIC,
        blanket: blanketRun.blanket,
        covers: blanketRun.covers,
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
    ).toEqual({ entries: [], blanket: [], failures: [] });
  });

  test("one trailer, with the surrounding message ignored", () => {
    expect(
      parseExpectedDiffTrailers(
        "fix: a thing\n\nWhy: because.\nParity-Diff: gap-collapse a\nCo-Authored-By: nobody\n",
      ),
    ).toEqual({
      entries: [{ id: "a", family: "gap-collapse" }],
      blanket: [],
      failures: [],
    });
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
      blanket: [],
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
      blanket: [],
      failures: [],
    });
  });

  test("the same id declared twice under one family dedupes silently", () => {
    expect(
      parseExpectedDiffTrailers(
        "a\n\nParity-Diff: author-plus x\n\nb\n\nParity-Diff: author-plus x\n",
      ),
    ).toEqual({
      entries: [{ id: "x", family: "author-plus" }],
      blanket: [],
      failures: [],
    });
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

  // A line with no id is the BLANKET form: it declares the family,
  // not a case, and what it covers is decided later against the
  // family's own AST keys (blanketCoverage, scripts/parity-keys.ts).
  // Whether the family may be declared this way is not the scan's
  // question - the scan reports what was written.
  test("a Parity-Diff line with no id declares the family, not a case", () => {
    expect(
      parseExpectedDiffTrailers("subject\n\nParity-Diff: author-plus\n"),
    ).toEqual({ entries: [], blanket: ["author-plus"], failures: [] });
  });

  test("a bare family repeated across messages is declared once", () => {
    expect(
      parseExpectedDiffTrailers(
        "a\n\nParity-Diff: fam\n\nb\n\nParity-Diff: fam\n",
      ),
    ).toEqual({ entries: [], blanket: ["fam"], failures: [] });
  });

  test("a family may be declared bare and per-id in one range", () => {
    expect(
      parseExpectedDiffTrailers(
        "a\n\nParity-Diff: fam\nParity-Diff: fam one\n",
      ),
    ).toEqual({
      entries: [{ id: "one", family: "fam" }],
      blanket: ["fam"],
      failures: [],
    });
  });

  test("a Parity-Diff line with nothing after the key is malformed", () => {
    const { failures } = parseExpectedDiffTrailers("subject\n\nParity-Diff:\n");
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("malformed trailer");
  });

  test("an indented trailer is read, and a mid-line one is not", () => {
    expect(
      parseExpectedDiffTrailers("subject\n\n    Parity-Diff: author-plus x\n"),
    ).toEqual({
      entries: [{ id: "x", family: "author-plus" }],
      blanket: [],
      failures: [],
    });
    expect(
      parseExpectedDiffTrailers("see Parity-Diff: author-plus x for why\n"),
    ).toEqual({ entries: [], blanket: [], failures: [] });
  });

  test("a CRLF message's trailer parses (the carriage return is trimmed)", () => {
    // Load-bearing: without the trim, `\r` is not matched by `.` and a
    // Windows-authored commit would fail a clean run as malformed.
    expect(
      parseExpectedDiffTrailers(
        "subject\r\n\r\nParity-Diff: author-plus x\r\n",
      ),
    ).toEqual({
      entries: [{ id: "x", family: "author-plus" }],
      blanket: [],
      failures: [],
    });
  });

  test("no space after the colon is accepted", () => {
    expect(
      parseExpectedDiffTrailers("subject\n\nParity-Diff:author-plus x\n"),
    ).toEqual({
      entries: [{ id: "x", family: "author-plus" }],
      blanket: [],
      failures: [],
    });
  });

  test("the family is a single token, and the id is all the rest", () => {
    expect(parseExpectedDiffTrailers("Parity-Diff: a b c\n")).toEqual({
      entries: [{ id: "b c", family: "a" }],
      blanket: [],
      failures: [],
    });
  });

  test("an empty trailer range is refused, not read as no declarations", ({
    skip,
  }) => {
    // This is the one row that shells to the real `git`, over this
    // repository, read-only. A jj workspace with no colocated `.git`
    // cannot run it at all - `git rev-list` fails before it gets the
    // chance to report the empty range - so it skips by name rather
    // than failing the whole suite (and, through it, the coverage
    // gate's floor comparison) on an environment limitation.
    skip(!hasGitCheckout(), "no colocated .git in this checkout");
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

  // The blanket pass is spread into the same failure list
  // (`...blanketPass.failures`). It is the gate relaxation's own
  // refusal path: drop that spread and a bare trailer over a family
  // with no declared keys relaxes the gate anyway, silently.
  test("a bare trailer over a keyless family fails the run", () => {
    const { output, exitCode } = reportTrailerFailures([], {
      blanket: ["fam-ast"],
      ast: [],
      covers: () => false,
    });
    expect(output).toContain("declares no AST keys");
    expect(output).not.toContain("cases match");
    expect(exitCode).toBe(1);
  });

  // What a bare trailer excuses is the whole claim it makes, so the
  // success line says how many ids it covered. The count is taken
  // across the blanket pass (`options.ast.length - ast.length`),
  // which is also what proves the reduced streams reached the gate:
  // an uncovered `a` would fail as undeclared instead.
  test("a covering blanket clears its ids and counts them on the success line", () => {
    const { output, exitCode } = reportTrailerFailures([], {
      blanket: ["fam-keyed"],
      ast: ["a"],
      covers: () => true,
    });
    expect(output).toContain("1 under a bare trailer's declared keys");
    expect(output).toContain("1 expected diffs, all ledgered");
    expect(exitCode).not.toBe(1);
  });

  test("no trailer failure and no diff prints the success line, leaving the exit code alone", () => {
    const before = process.exitCode ?? undefined;
    const { output, exitCode } = reportTrailerFailures([]);
    expect(output).toContain("1 cases match abc123");
    expect(exitCode).toBe(before);
  });
});
