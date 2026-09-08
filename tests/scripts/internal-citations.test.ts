/**
 * Unit tests for `scripts/internal-citations.ts`: the pin shape, the
 * quotation rule, the ordinal rule, the exit-code decision, and the
 * gate run end to end over a checkout written out here.
 *
 * The fixture checkout is the point. Every arm the gate can take - a
 * pin that holds, one naming a symbol the file does not declare, one
 * quoting text the symbol's body does not carry, one whose quotation
 * is not unique and says nothing more, one naming an occurrence past
 * the last, one that names the right occurrence, an entry that does
 * not read as a pin at all, a symbol its file has and one it does
 * not, a link tag that resolves and two that cannot - is a row of
 * {@link FIXTURE}, so the failure messages are asserted on rather
 * than described. The real tree is run once at the end, which is the
 * only assertion in this file that can go red because somebody moved
 * code rather than because they changed this gate.
 *
 * The link tags in the fixture are FIXTURES, and the scan does not
 * read this file's own (`LINKS_NOT_SCANNED`,
 * scripts/internal-symbols.ts): two of them have to resolve nowhere,
 * and a gate reading them would fail on its own fixtures.
 */
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  MINIMUM_CITATIONS,
  NAMED_ROOTS,
  checkPin,
  exceptionRows,
  lintPins,
  parseArguments,
  readPin,
  readTree,
  run,
  sourceLines,
  verdict,
  type Pin,
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
    pins: 0,
    paths: 0,
    symbols: 0,
    links: 0,
    anchors: 0,
    failures: [],
    listing: [],
  };
}

describe("splitting a file into the lines the scans read", () => {
  test("the final newline does not open a line", () => {
    // The whole line-by-line scan rests on this: counting the empty
    // string after the last newline would add a line no file has.
    expect(sourceLines("a\nb\n")).toEqual(["a", "b"]);
  });

  test("a file with no final newline keeps its last line", () => {
    expect(sourceLines("a\nb")).toEqual(["a", "b"]);
  });

  test("only ONE trailing empty line is dropped", () => {
    expect(sourceLines("a\n\n")).toEqual(["a", ""]);
  });
});

describe("reading one `cites` entry", () => {
  test("a symbol and a quotation read as a pin with no ordinal", () => {
    expect(readPin("at", "src/a.ts", { symbol: "f", quotes: "x" })).toEqual({
      kind: "pin",
      pin: {
        kind: "sole",
        at: "at",
        file: "src/a.ts",
        symbol: "f",
        quotes: "x",
      },
    });
  });

  test("an ordinal reads as the other variant", () => {
    expect(
      readPin("at", "src/a.ts", { symbol: "f", quotes: "x", ordinal: 2 }),
    ).toEqual({
      kind: "pin",
      pin: {
        kind: "nth",
        at: "at",
        file: "src/a.ts",
        symbol: "f",
        quotes: "x",
        ordinal: 2,
      },
    });
  });

  test("an entry quoting nothing is a fault, not a pin with no check", () => {
    // A pin nothing quotes would resolve its symbol and stop, which is
    // the state a wrong hand correction once hid in.
    expect(readPin("at", "src/a.ts", { symbol: "f" })).toEqual({
      kind: "fault",
      fault: "at: `f` quotes nothing, and a pin nothing quotes is unreviewable",
    });
  });

  test("an entry naming no symbol is a fault", () => {
    expect(readPin("at", "src/a.ts", { quotes: "x" })).toEqual({
      kind: "fault",
      fault: "at: a `cites` entry names no `symbol`",
    });
  });

  test("an unknown key is a fault, never a silently dropped field", () => {
    expect(
      readPin("at", "src/a.ts", { symbol: "f", quotes: "x", line: 5 }),
    ).toEqual({
      kind: "fault",
      fault: "at: a `cites` entry carries unknown key(s) line",
    });
  });

  test("an ordinal that is not a whole number from 1 is a fault", () => {
    expect(
      readPin("at", "src/a.ts", { symbol: "f", quotes: "x", ordinal: 0 }),
    ).toEqual({
      kind: "fault",
      fault: "at: `f` names ordinal 0, which is not a whole number from 1",
    });
  });

  test("an entry that is not an object is a fault", () => {
    expect(readPin("at", "src/a.ts", "f").kind).toBe("fault");
  });
});

/**
 * A pin of `f` in `src/a.ts`, spelled the way a row spells one.
 * @param quotes - the run it claims that body carries
 * @param ordinal - which occurrence, where it names one
 * @returns the pin
 */
function pin(quotes: string, ordinal?: number): Pin {
  const site = { at: "at", file: "src/a.ts", symbol: "f", quotes };
  return ordinal === undefined
    ? { kind: "sole", ...site }
    : { kind: "nth", ...site, ordinal };
}

describe("holding a pin to the symbol it names", () => {
  const bodies = new Map([
    [
      "f",
      ['function f() {\n  return "go";\n  return "go";\n  return "stop";\n}'],
    ],
  ]);

  test("a run the body carries once holds", () => {
    expect(checkPin(pin('return "stop"'), bodies)).toEqual([]);
  });

  test("a symbol the file does not declare fails, and says so", () => {
    expect(checkPin({ ...pin("x"), symbol: "g" }, bodies)).toEqual([
      "at: src/a.ts declares no `g`",
    ]);
  });

  test("a run the body does not carry fails, and prints the run", () => {
    expect(checkPin(pin('return "halt"'), bodies)).toEqual([
      'at: `f` in src/a.ts does not carry `return "halt"`',
    ]);
  });

  test("a run the body carries twice needs an ordinal", () => {
    // Otherwise the pin points at both of them and at neither, which
    // is the ambiguity a line number used to resolve by accident.
    expect(checkPin(pin('return "go"'), bodies)).toEqual([
      'at: `f` in src/a.ts carries `return "go"` 2 times: name the ordinal',
    ]);
  });

  test("an ordinal inside the count holds", () => {
    expect(checkPin(pin('return "go"', 2), bodies)).toEqual([]);
  });

  test("an ordinal past the last occurrence fails, and says how many", () => {
    expect(checkPin(pin('return "go"', 3), bodies)).toEqual([
      'at: `f` in src/a.ts carries `return "go"` 2 times, so there is no 3',
    ]);
  });
});

describe("the pins a lint-config line writes", () => {
  test("one symbol and one quotation is one pin", () => {
    expect(lintPins("at", '      "src/a.ts", // `f`: `return "go";`')).toEqual([
      {
        kind: "sole",
        at: "at",
        file: "src/a.ts",
        symbol: "f",
        quotes: 'return "go";',
      },
    ]);
  });

  test("two symbols sharing one guard is two pins", () => {
    // Which is what one guard written the same way in two functions
    // needs, and the shape the span-edges entry is in.
    const pins = lintPins("at", '  "src/a.ts", // `f`, `g`: `if (x) return;`');
    expect(pins.map((one) => one.symbol)).toEqual(["f", "g"]);
    expect(pins.every((one) => one.quotes === "if (x) return;")).toBe(true);
  });

  test("a deferral quoting nothing claims nothing", () => {
    // The `max-lines` entries beside these write line counts, not code.
    expect(lintPins("at", '      "src/a.ts", // 450 -> 462')).toEqual([]);
  });

  test("a line that is not an entry claims nothing", () => {
    // Nothing binds across lines, so a quoted name in the paragraph
    // above an entry cannot adopt its path.
    expect(lintPins("at", "  // `f` guards src/a.ts with `return;`")).toEqual(
      [],
    );
  });
});

// A checkout with one of each arm in it. `alpha.ts` is what every row
// cites; `twice` is the body that carries one run more than once.
const ALPHA = [
  "export function alpha(xs: readonly string[]): number {",
  "  if (xs.length === 0) return 0;",
  "  return xs.length;",
  "}",
  "export function twice(n: number): string {",
  '  if (n === 0) return "go";',
  '  if (n === 1) return "go";',
  '  return "stop";',
  "}",
  "// see src/alpha.ts and src/gone.ts",
  "// pinned by tests/alpha.test.ts, measured by scripts/nowhere.ts",
  "// the counter (`alpha`, src/alpha.ts) and the one that moved",
  "// (`beta`, src/alpha.ts)",
  "// {@link alpha} counts, {@link gone} is nowhere, and",
  "// {@link shared} is in two files",
].join("\n");

// The two other files the fixture tree declares names in, which is
// what makes `shared` a name no path-less tag can resolve.
const HERE = "export const shared = 1;\n";
const THERE = "const shared = 2;\n";

/**
 * One exception row of the fixture minimums.
 * @param what - the row's prose, which is also where it is found
 * @param cites - the pins it writes
 * @returns the row
 */
function row(what: string, cites: unknown[]): Record<string, unknown> {
  return { file: "src/alpha.ts", what, cites, class: "never", reason: what };
}

const FIXTURE: Tree = {
  minimums: JSON.stringify(
    {
      files: {},
      exceptions: [
        row("holds", [{ symbol: "alpha", quotes: "xs.length === 0" }]),
        row("the symbol is not there", [
          { symbol: "beta", quotes: "xs.length === 0" },
        ]),
        row("the quoted text is not there", [
          { symbol: "alpha", quotes: "xs.size === 0" },
        ]),
        row("the quotation is not unique", [
          { symbol: "twice", quotes: 'return "go"' },
        ]),
        row("the ordinal is past the last", [
          { symbol: "twice", quotes: 'return "go"', ordinal: 3 },
        ]),
        row("the ordinal picks the second", [
          { symbol: "twice", quotes: 'return "go"', ordinal: 2 },
        ]),
        row("the entry does not read as a pin", [{ symbol: "alpha" }]),
      ],
    },
    undefined,
    2,
  ),
  lintConfig: ['      "src/alpha.ts", // `twice`: `return "stop";`'].join("\n"),
  sources: new Map([["src/alpha.ts", sourceLines(ALPHA)]]),
  files: new Set(["src/alpha.ts", "tests/alpha.test.ts", "scripts/alpha.ts"]),
  texts: new Map([
    ["src/alpha.ts", ALPHA],
    ["tests/alpha.test.ts", HERE],
    ["scripts/alpha.ts", THERE],
    ["docs/two.md", "the one that moved (`beta`, `src/alpha.ts`)"],
    ["scripts/two.json", '{ "note": "`beta` (src/alpha.ts) went" }'],
  ]),
  markdown: new Map([["docs/one.md", "## A: b\n[held](#a-b) [dead](#ab)\n"]]),
  present: new Set(["docs/one.md"]),
};

describe("the gate over a whole checkout", () => {
  const report = run(FIXTURE);

  test("every pin whose file was read is counted, held or not", () => {
    // Six rows write a pin; the seventh writes an entry that is not
    // one. The lint config's entry is the seventh pin.
    expect(report.pins).toBe(7);
  });

  test("a pin naming a symbol the file does not declare fails", () => {
    // Red before the pins: the row used to name a LINE, so a rename of
    // `beta` moved nothing and the row went on citing a live line.
    expect(report.failures).toContainEqual(
      expect.stringContaining("src/alpha.ts declares no `beta`"),
    );
  });

  test("a pin quoting text the symbol's body lacks fails", () => {
    expect(report.failures).toContainEqual(
      expect.stringContaining(
        "`alpha` in src/alpha.ts does not carry `xs.size === 0`",
      ),
    );
  });

  test("a pin whose quotation is not unique is told to name the ordinal", () => {
    expect(report.failures).toContainEqual(
      expect.stringContaining(
        '`twice` in src/alpha.ts carries `return "go"` 2 times: name the ordinal',
      ),
    );
  });

  test("a pin naming an occurrence past the last fails", () => {
    expect(report.failures).toContainEqual(
      expect.stringContaining(
        '`twice` in src/alpha.ts carries `return "go"` 2 times, so there is no 3',
      ),
    );
  });

  test("a `cites` entry that is not a pin is a failure, not a skipped check", () => {
    expect(report.failures).toContainEqual(
      expect.stringContaining(
        "`alpha` quotes nothing, and a pin nothing quotes is unreviewable",
      ),
    );
  });

  test("every failure opens with the line it is written on", () => {
    // Which is the whole point of the message: the citing file and the
    // line an editor opens, not just the file that was cited.
    const written = report.failures.filter((one) =>
      one.startsWith("scripts/metrics/score-minimums.json:"),
    );
    expect(written).toHaveLength(5);
  });

  test("the lint config's deferral comments are checked too", () => {
    expect(report.listing).toContain(
      'eslint.config.js:1\tsrc/alpha.ts\t`twice`\treturn "stop";',
    );
  });

  test("a name a document or a ledger note writes is held too", () => {
    // Two record commits left prose naming a function their own commit
    // deleted, one in a document and one in a ledger note, and no scan
    // read either file.
    const dead = report.failures.filter((one) => one.endsWith("no beta"));
    const where = dead.map((one) => one.split(":")[0]);
    expect(where).toEqual(["src/alpha.ts", "docs/two.md", "scripts/two.json"]);
  });

  test("a symbol the cited file has resolves, and one it lacks fails", () => {
    expect(report.symbols).toBe(4);
    expect(report.failures).toContainEqual(
      expect.stringContaining(
        "`beta` names src/alpha.ts, which declares and imports no beta",
      ),
    );
    expect(report.failures.join("\n")).not.toContain("`alpha` names");
  });

  test("a link tag naming nothing in the tree fails", () => {
    expect(report.failures).toContainEqual(
      expect.stringContaining("`{@link gone}` names no gone anything declares"),
    );
  });

  test("a link tag naming what two files declare fails", () => {
    expect(report.failures).toContainEqual(
      expect.stringContaining(
        "`{@link shared}` is declared in 2 files (scripts/alpha.ts, tests/alpha.test.ts), so write the name with its path beside it instead",
      ),
    );
  });

  test("a link tag the citing file declares holds, and all three count", () => {
    expect(report.links).toBe(3);
    expect(report.failures.join("\n")).not.toContain("{@link alpha}");
  });

  test("a repo path naming no file fails, wherever it is written", () => {
    expect(report.failures).toContain(
      "src/alpha.ts:10: names src/gone.ts, which does not exist",
    );
  });

  test("the path scan reaches the test and harness trees too", () => {
    // A `src` comment names the test that pins it and the harness that
    // measures it as freely as it names another module, and a renamed
    // file rots all three the same way.
    expect(report.paths).toBe(6);
    expect(report.failures).toContain(
      "src/alpha.ts:11: names scripts/nowhere.ts, which does not exist",
    );
    expect(report.failures.join("\n")).not.toContain(
      "names tests/alpha.test.ts, which does not exist",
    );
  });

  test("a fragment the heading's slug does not give it fails", () => {
    // Red before the change: a heading's colon is DROPPED, the link
    // that hyphenated one resolved nowhere, and every gate was green.
    expect(report.anchors).toBe(2);
    expect(report.failures).toContain(
      "docs/one.md:2: `#ab` names no heading in docs/one.md",
    );
  });

  test("and nothing else failed", () => {
    expect(report.failures).toHaveLength(13);
  });
});

describe("reading the exception rows", () => {
  const rows = exceptionRows(FIXTURE.minimums);

  test("`cites` is optional and defaults to no pins", () => {
    expect(
      exceptionRows(JSON.stringify({ exceptions: [{ file: "a", what: "b" }] })),
    ).toEqual([
      {
        at: "scripts/metrics/score-minimums.json:1",
        file: "a",
        pins: [],
        faults: [],
      },
    ]);
  });

  test("a row's pins carry the row's file and where it is written", () => {
    expect(rows[0].pins).toHaveLength(1);
    expect(rows[0].pins[0]).toMatchObject({
      file: "src/alpha.ts",
      symbol: "alpha",
      quotes: "xs.length === 0",
    });
    expect(rows[0].at).toMatch(/^scripts\/metrics\/score-minimums\.json:\d+$/v);
  });

  test("an entry that is not a pin lands in the row's faults", () => {
    expect(rows[6].pins).toEqual([]);
    expect(rows[6].faults).toHaveLength(1);
  });

  test("a file that is not a minimums file reads as no rows, not a throw", () => {
    expect(exceptionRows("{")).toEqual([]);
    expect(exceptionRows('{"exceptions":"no"}')).toEqual([]);
  });
});

describe("what a run earns", () => {
  test("too few citations is a 2: the scan lost its roots", () => {
    const report = emptyReport();
    report.pins = MINIMUM_CITATIONS - 1;
    expect(verdict(report).kind).toBe("cannot-run");
  });

  test("the floor counts pins, symbols, link tags and failures", () => {
    const report = emptyReport();
    report.pins = MINIMUM_CITATIONS - 3;
    report.symbols = 1;
    report.links = 1;
    report.failures = ["one"];
    expect(verdict(report).kind).toBe("failed");
  });

  test("doc fragments are counted but do not carry the floor", () => {
    // There are a dozen where the tags number four figures, so a floor
    // they moved would be one a doc edit could trip.
    const report = emptyReport();
    report.anchors = MINIMUM_CITATIONS;
    expect(verdict(report).kind).toBe("cannot-run");
  });

  test("link tags alone can carry the floor", () => {
    // Which the floor's height assumes: the link tags are most of the
    // surface, so a floor they could not reach on their own would be
    // a floor nothing could pass.
    const report = emptyReport();
    report.links = MINIMUM_CITATIONS;
    expect(verdict(report).kind).toBe("clean");
  });

  test("one failure is a 1, and the count is printed", () => {
    const report = emptyReport();
    report.pins = MINIMUM_CITATIONS;
    report.failures = ["one"];
    const said = verdict(report);
    expect(said.kind).toBe("failed");
    expect(said.kind === "failed" ? said.lines.at(-1) : "").toBe(
      `internal-citations: 1 FAILED of ${String(MINIMUM_CITATIONS)} checked`,
    );
  });

  test("a clean run prints what each scan resolved", () => {
    const report = emptyReport();
    report.pins = MINIMUM_CITATIONS;
    report.paths = 2;
    const said = verdict(report);
    expect(said.kind).toBe("clean");
    expect(said.kind === "clean" ? said.lines.at(-1) : "").toBe(
      `internal-citations: ${String(MINIMUM_CITATIONS)} symbol pins hold, 0 symbols and 0 link tags resolve, 0 doc fragments land on a heading, 2 repo paths exist`,
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

  test("the walk finds every surface a citation is written on", () => {
    // A walk that silently stopped finding files would report a clean
    // run over nothing. The path scan still reads `src` alone.
    const tree = readTree(ROOT);
    expect(tree.sources.has("src/print/reflow.ts")).toBe(true);
    expect(tree.texts.has("scripts/deletions.json")).toBe(true);
    expect(tree.markdown.has("docs/harnesses.md")).toBe(true);
    expect(tree.markdown.has("CONTRIBUTING.md")).toBe(true);
    expect(tree.present.has("AGENTS.md")).toBe(true);
    expect(tree.sources.has("scripts/internal-citations.ts")).toBe(false);
  });

  test("every repo-internal citation holds", () => {
    expect(report.failures).toEqual([]);
  });

  test("every mutation-exception row that quotes source writes a pin", () => {
    // The rows this gate was built for: a row anchored to a symbol
    // rather than to a coordinate no edit above it can move.
    expect(report.pins).toBeGreaterThanOrEqual(30);
  });

  test("and there are enough of them for the run to have proved anything", () => {
    // The floor is over all three surfaces together: most of it is
    // link tags, and a floor set against the pins alone would clear on
    // a name scan that resolved nothing at all.
    expect(report.pins + report.symbols + report.links).toBeGreaterThanOrEqual(
      MINIMUM_CITATIONS,
    );
    expect(report.anchors).toBeGreaterThanOrEqual(10);
    expect(verdict(report).kind).toBe("clean");
  });
});
