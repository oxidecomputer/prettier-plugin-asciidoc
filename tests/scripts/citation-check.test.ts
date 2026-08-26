/**
 * Unit tests for `scripts/citation-check.ts`: the command line, the
 * measured-nothing floor, the exit-code decision, the file walk and the
 * trailing-newline rule the range check rests on.
 *
 * Split out of tests/scripts/citations.test.ts to keep both files under
 * the project's `max-lines` ceiling; that file covers the grammar and
 * the two checks, this one covers everything around them.
 *
 * `verdict` is driven with literal reports rather than by running the
 * gate over the tree: the three decisions worth pinning here are that
 * the floor is a 2 and not a 0, that one failure is a 1, and that a
 * contextless reference is neither.
 *
 * This file is one of the four the checker does not scan
 * (`NOT_SCANNED`) - see that constant for why.
 */
import path from "node:path";
import { describe, expect, test } from "vitest";
import { IDENTIFIER_WINDOW, type Citation } from "../../scripts/citations.js";
import {
  MINIMUM_CITATIONS,
  NOT_SCANNED,
  SCANNED,
  parseArguments,
  sourceLines,
  sources,
  verdict,
  type Report,
} from "../../scripts/citation-check.js";

/** The repository root, from this test file's own location. */
const ROOT = path.resolve(import.meta.dirname, "../..");

describe("splitting a cited file into lines", () => {
  test("the final newline does not open a line", () => {
    // The whole range check rests on this: counting the empty string
    // after the last newline would let a citation name one line past
    // the end of the file and pass.
    expect(sourceLines("a\nb\n")).toEqual(["a", "b"]);
  });

  test("a file with no final newline keeps its last line", () => {
    expect(sourceLines("a\nb")).toEqual(["a", "b"]);
  });

  test("only ONE trailing empty line is dropped", () => {
    expect(sourceLines("a\n\n")).toEqual(["a", ""]);
  });
});

describe("what the gate scans", () => {
  test("src, tests and scripts, and nothing else", () => {
    expect(SCANNED).toEqual(["src", "tests", "scripts"]);
  });

  test("the walk finds TypeScript files under a scanned directory", () => {
    const found = sources(ROOT, "scripts");
    expect(found).toContain("scripts/parity-ledger.ts");
    expect(found.every((name) => name.endsWith(".ts"))).toBe(true);
    expect(found).toEqual(found.toSorted());
  });

  test("the checker's own sources are exempt from its own walk", () => {
    // They are the one place where citation-shaped text is DATA: the
    // grammar's comments quote the spellings it refuses, and the
    // grammar tests' rows are made of them.
    expect(NOT_SCANNED.has("scripts/citations.ts")).toBe(true);
    for (const directory of SCANNED) {
      for (const name of sources(ROOT, directory)) {
        expect(NOT_SCANNED.has(name)).toBe(false);
      }
    }
  });

  test("a directory that is not there is empty, not an error", () => {
    expect(sources(ROOT, "no-such-directory")).toEqual([]);
  });
});

/**
 * One stand-in checked citation, so a report can be given a size.
 * @returns a citation with nothing in it but a shape
 */
function one(): Citation {
  return {
    file: "parser.rb",
    ranges: [{ start: 1, end: 1 }],
    spelling: "parser.rb:1",
    source: "t.ts",
    line: 1,
    comment: "",
  };
}

/**
 * Build a report for a verdict test.
 * @param counts - the run's shape
 * @param counts.checked - how many citations were checked
 * @param counts.skipped - how many the missing oracle skipped
 * @param counts.failures - the failure lines it collected
 * @param counts.contextless - the bare-reference lines it collected
 * @returns the report
 */
function measured(counts: {
  checked: number;
  skipped?: number;
  failures?: string[];
  contextless?: string[];
}): Report {
  return {
    checked: Array.from({ length: counts.checked }, one),
    skipped: counts.skipped ?? 0,
    unanchored: 0,
    contextless: counts.contextless ?? [],
    failures: counts.failures ?? [],
    perFile: new Map([["parser.rb", counts.checked]]),
  };
}

describe("the verdict a run earns", () => {
  test("one citation short of the floor is CANNOT RUN, not a pass", () => {
    // The measured-nothing floor: a gate that cannot tell "I checked
    // and it is broken" from "I checked nothing" goes quiet exactly
    // when its inputs disappear, and in CI the quiet failure is a
    // green tick.
    const said = verdict(
      measured({ checked: MINIMUM_CITATIONS - 1 }),
      IDENTIFIER_WINDOW,
    );
    expect(said.kind).toBe("cannot-run");
    expect(said.kind === "cannot-run" && said.message).toContain(
      `below the floor of ${String(MINIMUM_CITATIONS)}`,
    );
  });

  test.each([MINIMUM_CITATIONS, MINIMUM_CITATIONS + 1])(
    "%d citations is at or above the floor",
    (checked) => {
      expect(verdict(measured({ checked }), IDENTIFIER_WINDOW).kind).toBe(
        "clean",
      );
    },
  );

  test("skipped and FAILED citations count toward the floor", () => {
    // A tree of a hundred citations, some of them unreadable, has not
    // "lost its roots" - it has failures, and saying which is the whole
    // point of the 1/2 split.
    const said = verdict(
      measured({
        checked: MINIMUM_CITATIONS - 5,
        skipped: 4,
        failures: ["t.ts:1: unreadable citation"],
      }),
      IDENTIFIER_WINDOW,
    );
    expect(said.kind).toBe("failed");
  });

  test("a failure is reported and earns the gate-failed code", () => {
    const said = verdict(
      measured({
        checked: MINIMUM_CITATIONS,
        failures: ["t.ts:9: cites line 9999 of the file"],
      }),
      IDENTIFIER_WINDOW,
    );
    expect(said.kind).toBe("failed");
    expect(said.kind === "failed" && said.lines).toContain(
      "t.ts:9: cites line 9999 of the file",
    );
  });

  test("contextless references are summarized per file, never listed", () => {
    // Eighty-odd of them, none a failure. A clean run that scrolls a
    // screen of not-failures is a run people stop reading.
    const said = verdict(
      measured({
        checked: MINIMUM_CITATIONS,
        contextless: ["src/a.ts:3\tbare", "src/a.ts:9\tbare"],
      }),
      IDENTIFIER_WINDOW,
    );
    expect(said.kind).toBe("clean");
    const printed = said.kind === "clean" ? said.lines.join("\n") : "";
    expect(printed).toContain(
      "bare line references naming no file: src/a.ts 2",
    );
    expect(printed).toContain("2 naming no file");
    expect(printed).not.toContain("src/a.ts:3");
  });

  test("a missing oracle install is said out loud, not failed", () => {
    const said = verdict(
      measured({ checked: MINIMUM_CITATIONS, skipped: 6 }),
      IDENTIFIER_WINDOW,
    );
    expect(said.kind).toBe("clean");
    expect(said.kind === "clean" && said.lines.join("\n")).toContain(
      "SKIPPED 6 oracle citations",
    );
  });

  test("the census names the busiest cited file first", () => {
    const report = measured({ checked: 100 });
    report.perFile = new Map([
      ["rx.rb", 2],
      ["parser.rb", 9],
    ]);
    const said = verdict(report, IDENTIFIER_WINDOW);
    expect(said.kind === "clean" && said.lines[0]).toBe(
      "citations: parser.rb 9, rx.rb 2",
    );
  });
});

describe("the command line", () => {
  test("defaults to the recorded window and no listing", () => {
    expect(parseArguments([])).toEqual({
      window: IDENTIFIER_WINDOW,
      list: false,
    });
  });

  test("takes --window and --list", () => {
    expect(parseArguments(["--window", "9", "--list"])).toEqual({
      window: 9,
      list: true,
    });
  });

  test.each([["--bogus"], ["--window"], ["--window", "wide"]])(
    "refuses %s",
    (...argv) => {
      // An unknown argument is an error rather than a shrug: a silently
      // dropped `--window` would report a run nobody asked for. `main`
      // turns the throw into the harness's exit 2.
      expect(() => parseArguments(argv)).toThrow(TypeError);
    },
  );
});
