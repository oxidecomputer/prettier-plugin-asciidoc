/**
 * Unit tests for `scripts/internal-citations.ts`: the citation grammar,
 * the quotation rule, the provenance exemption, the exit-code decision,
 * and the gate run end to end over a checkout written out here.
 *
 * The fixture checkout is the point. Every arm the brief asked for -
 * an entry that holds, one whose line has drifted, one whose quoted
 * text is not there, one that names a tree the move already left -
 * is a row of {@link FIXTURE}, so the failure messages are asserted on
 * rather than described. The real tree is run once at the end, which is
 * the only assertion in this file that can go red because somebody
 * moved code rather than because they changed this gate.
 */
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  MINIMUM_CITATIONS,
  NAMED_ROOTS,
  checkCitation,
  exceptionRows,
  fragmentsAfter,
  parseArguments,
  readTree,
  run,
  scanScope,
  sourceLines,
  verdict,
  type Citation,
  type Report,
  type Tree,
} from "../../scripts/internal-citations.js";

/** The repository root, from this test file's own location. */
const ROOT = path.resolve(import.meta.dirname, "../..");

/**
 * A report with nothing in it, for the arms that add one thing.
 * @returns a report measuring nothing
 */
function emptyReport(): Report {
  return {
    checked: 0,
    quoted: 0,
    exempt: 0,
    paths: 0,
    contextless: [],
    failures: [],
    listing: [],
  };
}

describe("splitting a file into the lines a citation can name", () => {
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

describe("the quoted runs a citation claims are on its line", () => {
  test("the run before the first `->` is the source", () => {
    expect(fragmentsAfter("x `a === b` -> `true` y", 1)).toEqual(["a === b"]);
  });

  test("several runs before a `->` are all the source", () => {
    // Nine cited lines, two things written on them.
    expect(
      fragmentsAfter('x `return "go"` and `return "stop"`s -> `""`', 1),
    ).toEqual(['return "go"', 'return "stop"']);
  });

  test("a run that only appears past a `->` is a replacement, not source", () => {
    expect(fragmentsAfter("x each conjunct -> `true`", 1)).toEqual([]);
  });

  test("an unterminated run is dropped rather than run to the end", () => {
    expect(fragmentsAfter("x `a === b", 1)).toEqual([]);
  });
});

describe("the citation grammar", () => {
  test("a file name binds every reference after it in the scope", () => {
    const { citations } = scanScope("at", "(a.ts:5, :7, :9) `x`");
    expect(citations.map((one) => one.spelling)).toEqual([
      "a.ts:5",
      "a.ts:7",
      "a.ts:9",
    ]);
    expect(citations.every((one) => one.named === "a.ts")).toBe(true);
  });

  test("all three take the same quoted runs, which is how a list reads", () => {
    const { citations } = scanScope("at", "(a.ts:5, :7, :9) `x` -> `y`");
    expect(citations.map((one) => one.fragments)).toEqual([
      ["x"],
      ["x"],
      ["x"],
    ]);
  });

  test("a range is one citation over a span", () => {
    const { citations } = scanScope("at", "b.ts:12-20 `x`");
    expect(citations).toHaveLength(1);
    expect(citations[0]).toMatchObject({
      spelling: "b.ts:12-20",
      from: 12,
      to: 20,
    });
  });

  test("a later name rebinds, so a row can cite two files", () => {
    const { citations } = scanScope("at", "a.ts:1 and b.ts:2");
    expect(citations.map((one) => one.spelling)).toEqual(["a.ts:1", "b.ts:2"]);
  });

  test("the file the scope is about binds a reference that opens it", () => {
    const { citations } = scanScope("at", "at EOF (:786)", "a.ts");
    expect(citations.map((one) => one.spelling)).toEqual(["a.ts:786"]);
  });

  test("a reference with nothing to bind it is reported, not guessed at", () => {
    const scan = scanScope("at", "at EOF (:786)");
    expect(scan.citations).toEqual([]);
    expect(scan.contextless).toEqual(["at: `:786` names no file"]);
  });

  test("a file name with no line after it claims nothing", () => {
    expect(scanScope("at", "see a.ts, it walks the buffer")).toEqual({
      citations: [],
      contextless: [],
    });
  });
});

/**
 * A citation of `a.ts`, spelled the way the scanner spells one.
 * @param from - the first cited line
 * @param to - the last cited line
 * @param fragments - the quoted runs it claims are on them
 * @returns the citation
 */
function cite(from: number, to: number, fragments: string[]): Citation {
  return {
    at: "at",
    spelling: `a.ts:${String(from)}`,
    named: "a.ts",
    from,
    to,
    fragments,
  };
}

describe("holding a citation to the file it names", () => {
  const lines = ["one", "  const two = 2;", "three"];

  test("a quoted run on the cited line holds", () => {
    expect(checkCitation(cite(2, 2, ["const two"]), "a.ts", lines)).toEqual([]);
  });

  test("a quoted run anywhere in a cited RANGE holds", () => {
    expect(checkCitation(cite(1, 3, ["const two"]), "a.ts", lines)).toEqual([]);
  });

  test("one of several quoted runs is enough", () => {
    const failures = checkCitation(
      cite(2, 2, ["nope", "const two"]),
      "a.ts",
      lines,
    );
    expect(failures).toEqual([]);
  });

  test("a citation quoting nothing is checked for its line and no further", () => {
    expect(checkCitation(cite(2, 2, []), "a.ts", lines)).toEqual([]);
  });

  test("a line past the end of the file fails, and says how long it is", () => {
    expect(checkCitation(cite(9, 9, []), "a.ts", lines)).toEqual([
      "at: `a.ts:9` names line 9 of a.ts, which has 3 lines",
    ]);
  });

  test("a quoted run that is not there fails, and prints what is", () => {
    expect(checkCitation(cite(3, 3, ["const two"]), "a.ts", lines)).toEqual([
      "at: `a.ts:3` quotes `const two`, none of which is on a.ts:3, which reads `three`",
    ]);
  });
});

// A checkout with one of each arm in it. `alpha.ts` is what every row
// cites; `former.ts` stands in for the tree a move has already left.
const ALPHA = [
  "export function alpha(xs: readonly string[]): number {",
  "  if (xs.length === 0) return 0;",
  "  return xs.length;",
  "}",
  "// see src/alpha.ts and src/gone.ts",
  "// pinned by tests/alpha.test.ts, measured by scripts/nowhere.ts",
].join("\n");

const FIXTURE: Tree = {
  minimums: JSON.stringify(
    {
      files: {},
      exceptions: [
        {
          file: "src/alpha.ts",
          what: "alpha.ts:2 `xs.length === 0` -> `true` in the empty guard",
          class: "never",
          reason: "holds",
        },
        {
          file: "src/alpha.ts",
          what: "alpha.ts:4 `xs.length === 0` -> `true` in the empty guard",
          class: "never",
          reason: "the line drifted",
        },
        {
          file: "src/alpha.ts",
          what: "alpha.ts:2 `xs.size === 0` -> `true` in the empty guard",
          class: "never",
          reason: "the quoted text is not what is there",
        },
        {
          file: "src/alpha.ts",
          what: "alpha.ts:2 `xs.length === 0` (moved here from former.ts:40) -> `true`",
          formerly: ["former.ts:40"],
          class: "never",
          reason: "the former tree is not this one",
        },
        {
          file: "src/alpha.ts",
          what: "alpha.ts:2 `xs.length === 0` -> `true`",
          formerly: ["former.ts:99"],
          class: "never",
          reason: "an exemption for a citation the row does not write",
        },
      ],
    },
    undefined,
    2,
  ),
  lintConfig: ['      "src/alpha.ts", // :3 `return xs.length;`'].join("\n"),
  sources: new Map([["src/alpha.ts", sourceLines(ALPHA)]]),
  files: new Set(["src/alpha.ts", "tests/alpha.test.ts"]),
};

describe("the gate over a whole checkout", () => {
  const report = run(FIXTURE);

  test("an entry whose line and quoted text are both right holds", () => {
    // Five rows' live citations - the exempt row still has one - plus
    // the lint config's one.
    expect(report.checked).toBe(6);
    expect(report.quoted).toBe(6);
  });

  test("every failure opens with the line it is written on", () => {
    // Which is the whole point of the message: the citing file and the
    // line an editor opens, not just the file that was cited.
    const written = report.failures.filter((one) =>
      one.startsWith("scripts/metrics/score-minimums.json:"),
    );
    expect(written).toHaveLength(3);
  });

  test("an entry whose line has drifted fails, and prints what is there", () => {
    expect(report.failures).toContainEqual(
      expect.stringContaining(
        "`alpha.ts:4` quotes `xs.length === 0`, none of which is on src/alpha.ts:4, which reads `}`",
      ),
    );
  });

  test("an entry whose quoted text is not there fails", () => {
    expect(report.failures).toContainEqual(
      expect.stringContaining(
        "`alpha.ts:2` quotes `xs.size === 0`, none of which is on src/alpha.ts:2, which reads `if (xs.length === 0) return 0;`",
      ),
    );
  });

  test("a citation the row marks as a former tree is counted, not checked", () => {
    // former.ts is in no tree at all; without the exemption it would
    // be a failure, and the row's live citation is checked regardless.
    expect(report.exempt).toBe(1);
    expect(report.failures.join("\n")).not.toContain("former.ts:40");
  });

  test("a `formerly` naming a citation the row does not write is a failure", () => {
    // Which is what stops the field growing into an allowlist.
    expect(report.failures).toContainEqual(
      expect.stringContaining(
        "`formerly` names `former.ts:99`, which this row's `what` does not cite",
      ),
    );
  });

  test("the lint config's deferral comments are checked too", () => {
    expect(report.listing).toContain(
      "eslint.config.js:1\tsrc/alpha.ts:3\tsrc/alpha.ts\treturn xs.length;",
    );
  });

  test("a repo path naming no file fails, wherever it is written", () => {
    expect(report.failures).toContain(
      "src/alpha.ts:5: names src/gone.ts, which does not exist",
    );
  });

  test("the path scan reaches the test and harness trees too", () => {
    // A `src` comment names the test that pins it and the harness that
    // measures it as freely as it names another module, and a renamed
    // file rots all three the same way.
    expect(report.paths).toBe(4);
    expect(report.failures).toContain(
      "src/alpha.ts:6: names scripts/nowhere.ts, which does not exist",
    );
    expect(report.failures.join("\n")).not.toContain("tests/alpha.test.ts");
  });

  test("and nothing else failed", () => {
    expect(report.failures).toHaveLength(5);
  });
});

describe("reading the exception rows", () => {
  test("`formerly` is optional and defaults to nothing", () => {
    const rows = exceptionRows(FIXTURE.minimums);
    expect(rows).toHaveLength(5);
    expect(rows[0].formerly).toEqual([]);
    expect(rows[3].formerly).toEqual(["former.ts:40"]);
  });

  test("a file that is not a minimums file reads as no rows, not a throw", () => {
    expect(exceptionRows("{")).toEqual([]);
    expect(exceptionRows('{"exceptions":"no"}')).toEqual([]);
  });
});

describe("what a run earns", () => {
  test("too few citations is a 2: the scan lost its roots", () => {
    const report = emptyReport();
    report.checked = MINIMUM_CITATIONS - 1;
    expect(verdict(report).kind).toBe("cannot-run");
  });

  test("the floor counts exempt and failed citations too", () => {
    const report = emptyReport();
    report.checked = MINIMUM_CITATIONS - 2;
    report.exempt = 1;
    report.failures = ["one"];
    expect(verdict(report).kind).toBe("failed");
  });

  test("one failure is a 1, and the count is printed", () => {
    const report = emptyReport();
    report.checked = MINIMUM_CITATIONS;
    report.failures = ["one"];
    const said = verdict(report);
    expect(said.kind).toBe("failed");
    expect(said.kind === "failed" ? said.lines.at(-1) : "").toBe(
      `internal-citations: 1 FAILED of ${String(MINIMUM_CITATIONS)} checked`,
    );
  });

  test("a contextless reference is printed and is neither", () => {
    const report = emptyReport();
    report.checked = MINIMUM_CITATIONS;
    report.contextless = ["somewhere: `:5` names no file"];
    const said = verdict(report);
    expect(said.kind).toBe("clean");
    expect(said.kind === "clean" ? said.lines[0] : "").toBe(
      "somewhere: `:5` names no file",
    );
  });
});

describe("the command line", () => {
  test("no arguments does not list", () => {
    expect(parseArguments([])).toBe(false);
  });

  test("`--list` lists", () => {
    expect(parseArguments(["--list"])).toBe(true);
  });

  test("an unknown argument is an error, never a silently dropped flag", () => {
    expect(() => parseArguments(["--window"])).toThrow(TypeError);
  });
});

describe("this repository", () => {
  const report = run(readTree(ROOT));

  test("the trees a comment may name a path in are pinned", () => {
    expect(NAMED_ROOTS).toEqual(["src", "tests", "scripts"]);
  });

  test("the walk finds the source tree, and the trees it may name", () => {
    const tree = readTree(ROOT);
    expect(tree.files.has("tests/scripts/internal-citations.test.ts")).toBe(
      true,
    );
    expect(tree.files.has("scripts/internal-citations.ts")).toBe(true);
    // Citations still resolve against `src` alone.
    expect(tree.sources.has("tests/scripts/internal-citations.test.ts")).toBe(
      false,
    );
  });

  test("the walk finds the source tree", () => {
    // A walk that silently stopped finding files would report a clean
    // run over nothing.
    expect(readTree(ROOT).sources.has("src/print/reflow.ts")).toBe(true);
  });

  test("every repo-internal citation holds", () => {
    expect(report.failures).toEqual([]);
  });

  test("and there are enough of them for the run to have proved anything", () => {
    expect(report.checked).toBeGreaterThanOrEqual(MINIMUM_CITATIONS);
    expect(verdict(report).kind).toBe("clean");
  });
});
