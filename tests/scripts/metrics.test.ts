/**
 * The scorecard measures the codebase, so the scorecard itself has to
 * be measured by something. These tests pin the parts that used to be
 * hand-rolled regexes: line classification, export
 * counting, escape-hatch counting, the eslint-report parser, the
 * knip-report parser, and one real dependency-cruiser run.
 */
import { describe, test, expect } from "vitest";
import { scanSource } from "../../scripts/metrics/scan.js";
import {
  aggregate,
  parseReport,
  CYCLOMATIC_VALUE,
  COGNITIVE_VALUE,
} from "../../scripts/metrics/complexity.js";
import { countKnipExports } from "../../scripts/metrics/dead-code.js";
import { cruiseImports } from "../../scripts/metrics/graph.js";
import { gateFailures } from "../../scripts/metrics/gates.js";
import { makeSnapshot } from "./metrics-snapshot.js";
import { inCheckoutAsync } from "../lib/checkout.js";

/**
 * Scan a snippet as if it were a source file.
 * @param text - the snippet
 * @returns the counts
 */
function scan(text: string): ReturnType<typeof scanSource> {
  return scanSource("sample.ts", text);
}

describe("line classification", () => {
  // The blind spots a regex line counter has by construction. Every
  // row here is a case the old `startsWith("//")` scanner got wrong or
  // could only get right by accident.
  test.each([
    [
      "a line comment on its own line",
      "// c\ncode();\n",
      { code: 1, comment: 1, blank: 0 },
    ],
    ["a blank line", "code();\n\n", { code: 1, comment: 0, blank: 1 }],
    [
      "a block comment over three lines",
      "/*\n * c\n */\ncode();\n",
      { code: 1, comment: 3, blank: 0 },
    ],
    [
      "JSDoc above a declaration",
      "/** doc\n * more\n */\nconst a = 1;\n",
      { code: 1, comment: 3, blank: 0 },
    ],
    [
      "a one-line block comment before code",
      "/* c */ code();\n",
      { code: 1, comment: 0, blank: 0 },
    ],
    [
      "a block comment opened mid-line",
      "code(); /* c\nstill\n*/ more();\n",
      { code: 2, comment: 1, blank: 0 },
    ],
    [
      "`//` inside a string",
      'const s = "// not a comment";\n',
      { code: 1, comment: 0, blank: 0 },
    ],
    [
      "a trailing comment after division",
      "const r = a / b; // c\n",
      { code: 1, comment: 0, blank: 0 },
    ],
    [
      "a regex literal containing a slash",
      "const r = /a\\/b/v;\n// c\n",
      { code: 1, comment: 1, blank: 0 },
    ],
  ])("counts %s", (_name, text, expected) => {
    const counts = scan(text);
    expect(
      { code: counts.code, comment: counts.comment, blank: counts.blank },
      text,
    ).toEqual(expected);
  });

  test("total matches wc -l, with or without a trailing newline", () => {
    expect(scan("a();\nb();\n").total).toBe(2);
    expect(scan("a();\nb();").total).toBe(2);
  });
});

describe("export counting", () => {
  test.each([
    ["a declaration", "export const a = 1;\n", 1],
    ["two names in one statement", "export const a = 1, b = 2;\n", 2],
    ["a named export list", "export { a, b, c };\n", 3],
    ["a re-export list", 'export type { A, B } from "./x.js";\n', 2],
    ["a default export", "export default value;\n", 1],
    ["a default function", "export default function f(): void {}\n", 1],
    ["a star re-export", 'export * from "./x.js";\n', 1],
    ["a namespaced star re-export", 'export * as ns from "./x.js";\n', 1],
    ["an interface", "export interface A {\n  a: number;\n}\n", 1],
    ["a non-exported declaration", "const a = 1;\n", 0],
  ])("counts %s", (_name, text, exports) => {
    expect(scan(text).exports).toBe(exports);
  });

  test("reports star re-exports separately, since their names are unknowable", () => {
    const counts = scan('export * from "./x.js";\nexport const a = 1;\n');
    expect(counts.exports).toBe(2);
    expect(counts.starExports).toBe(1);
  });
});

describe("escape-hatch counting", () => {
  test("counts an `as` assertion but not an `import * as` binding", () => {
    const counts = scan(
      'import * as T from "./t.js";\nconst x = y as T.Foo;\n',
    );
    expect(counts.assertions).toBe(1);
  });

  test("counts an angle-bracket assertion", () => {
    expect(scan("const x = <Foo>y;\n").assertions).toBe(1);
  });

  // `as const` narrows a literal to its own type and adds
  // `readonly` — it can never widen a value into a lie the way
  // `x as Foo` can, so it is not an escape hatch.
  test("does not count `as const`", () => {
    const counts = scan(
      "const table = [1, 2] as const;\nconst x = y as Foo;\n",
    );
    expect(counts.assertions).toBe(1);
  });

  test("counts non-null assertions and `any` in type position", () => {
    const counts = scan("let u: any;\nconst z = w!.a;\n");
    expect(counts.nonNull).toBe(1);
    expect(counts.anyType).toBe(1);
  });

  test("does not count the English words in a comment", () => {
    const counts = scan("// any line, as a rule, is not code!\nconst a = 1;\n");
    expect([counts.anyType, counts.assertions, counts.nonNull]).toEqual([
      0, 0, 0,
    ]);
  });

  test("counts an eslint-disable comment once", () => {
    const counts = scan(
      "// eslint-disable-next-line no-console -- why\nconsole.log(1);\n",
    );
    expect(counts.disables).toBe(1);
  });
});

describe("eslint report parsing", () => {
  const report = JSON.stringify([
    {
      filePath: "/repo/src/a.ts",
      messages: [
        {
          ruleId: "complexity",
          message: "Function 'f' has a complexity of 12. Maximum allowed is 0.",
        },
        {
          ruleId: "sonarjs/cognitive-complexity",
          message:
            "Refactor this function to reduce its Cognitive Complexity from 17 to the 0 allowed.",
        },
        { ruleId: "no-console", message: "Unexpected console statement." },
      ],
    },
  ]);

  test("reads cyclomatic values out of the message text", () => {
    const totals = aggregate({
      report: parseReport(report),
      root: "/repo",
      ruleId: "complexity",
      valuePattern: CYCLOMATIC_VALUE,
      tail: 10,
    });
    expect(totals.src).toEqual({ functions: 1, sum: 12, max: 12, over: 1 });
  });

  test("reads cognitive values, and ignores other rules", () => {
    const totals = aggregate({
      report: parseReport(report),
      root: "/repo",
      ruleId: "sonarjs/cognitive-complexity",
      valuePattern: COGNITIVE_VALUE,
      tail: 15,
    });
    expect(totals.src).toEqual({ functions: 1, sum: 17, max: 17, over: 1 });
  });

  test("survives output that is not a report", () => {
    expect(parseReport("not json")).toEqual([]);
  });
});

describe("knip report parsing", () => {
  const report = JSON.stringify({
    issues: [
      {
        file: "src/a.ts",
        exports: [{ name: "x" }],
        types: [{ name: "T" }],
        enumMembers: [{ name: "E" }],
        namespaceMembers: [{ name: "N" }],
      },
      { file: "scripts/b.ts", exports: [{ name: "y" }] },
      { file: "tests/c.ts", exports: [{ name: "z" }] },
    ],
  });

  test("counts every unused-symbol bucket, not just exports", () => {
    expect(countKnipExports(report, "src/")).toBe(4);
  });

  test("counts per directory", () => {
    expect(countKnipExports(report, "scripts/")).toBe(1);
    expect(countKnipExports(report, "tests/")).toBe(1);
  });

  test("survives output that is not a report", () => {
    expect(countKnipExports("knip crashed", "src/")).toBeUndefined();
  });
});

/**
 * Write a tiny checkout with the given files and cruise it.
 * @param files - file name to contents, under `src`
 * @returns the coupling facts for that tree
 */
async function cruiseFixture(
  files: Record<string, string>,
): Promise<Awaited<ReturnType<typeof cruiseImports>>> {
  return await inCheckoutAsync(
    {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { module: "ES2022", moduleResolution: "bundler" },
        include: ["src/**/*.ts"],
      }),
      ...Object.fromEntries(
        Object.entries(files).map(([name, contents]) => [
          `src/${name}`,
          contents,
        ]),
      ),
    },
    cruiseImports,
  );
}

describe("dependency-cruiser coupling", () => {
  test("finds a three-file cycle and names its files", async () => {
    const graph = await cruiseFixture({
      "a.ts":
        'import { b } from "./b.js";\nexport const a = (): unknown => b;\n',
      "b.ts":
        'import { c } from "./c.js";\nexport const b = (): unknown => c;\n',
      "c.ts":
        'import { a } from "./a.js";\nexport const c = (): unknown => a;\n',
    });
    expect(graph.cycles).toHaveLength(1);
    expect(new Set(graph.cycles[0])).toEqual(
      new Set(["src/a.ts", "src/b.ts", "src/c.ts"]),
    );
    expect(graph.edges).toBe(3);
  });

  test("reports no cycle for an acyclic tree, and counts its edges", async () => {
    const graph = await cruiseFixture({
      "a.ts":
        'import { b } from "./b.js";\nexport const a = (): unknown => b;\n',
      "b.ts": "export const b = 1;\n",
    });
    expect(graph.cycles).toEqual([]);
    expect(graph.edges).toBe(1);
  });

  test("counts a type-only import as an edge", async () => {
    const graph = await cruiseFixture({
      "a.ts":
        'import type { B } from "./b.js";\nexport const a = (b: B): B => b;\n',
      "b.ts": "export interface B {\n  x: number;\n}\n",
    });
    expect(graph.edges).toBe(1);
  });

  test("reports a relative import that resolves to nothing", async () => {
    const graph = await cruiseFixture({
      "a.ts": 'import { gone } from "./missing.js";\nexport const a = gone;\n',
    });
    expect(graph.unresolved).toEqual(["src/a.ts -> ./missing.js"]);
  });
});

// The POSITIVE CONTROL for the layer rules. dependency-cruiser's
// `validate` option defaults to FALSE, and with it off a cruise
// carrying rules reports zero violations rather than an error — the
// same silent-disarm shape that switched the cycle gate off once
// already. A planted violation is the only thing that can tell "the
// tree is clean" apart from "the rules never ran", so it is a fixture
// here rather than an assertion about our own tree.
describe("layer rules", () => {
  test("names the rule a forbidden edge breaks", async () => {
    const graph = await cruiseFixture({
      "parse/build/b.ts":
        'import type { L } from "../lines/l.js";\nexport const b = (l: L): L => l;\n',
      "parse/lines/l.ts": "export interface L {\n  x: number;\n}\n",
    });
    expect(graph.layerViolations).toEqual([
      "src/parse/build/b.ts -> src/parse/lines/l.ts (build-imports-lines)",
    ]);
  });

  test("lets the same edge through in the layered direction", async () => {
    const graph = await cruiseFixture({
      "parse/lines/l.ts":
        'import type { B } from "../build/b.js";\nexport const l = (b: B): B => b;\n',
      "parse/build/b.ts": "export interface B {\n  x: number;\n}\n",
    });
    expect(graph.layerViolations).toEqual([]);
  });

  test("lets print reach parse at its two addresses, and nowhere else", async () => {
    const graph = await cruiseFixture({
      "print/p.ts":
        'import type { S } from "../parse/line-shapes.js";\nimport type { A } from "../parse/attrlist.js";\nimport type { P } from "../parse/positions.js";\nexport const p = (s: S, a: A, q: P): [S, A, P] => [s, a, q];\n',
      "parse/line-shapes.ts": "export interface S {\n  x: number;\n}\n",
      "parse/attrlist.ts": "export interface A {\n  x: number;\n}\n",
      "parse/positions.ts": "export interface P {\n  x: number;\n}\n",
    });
    expect(graph.layerViolations).toEqual([
      "src/print/p.ts -> src/parse/positions.ts (print-imports-parse-off-address)",
    ]);
  });
});
// The cyclomatic tail is REPORT-ONLY. Cyclomatic complexity
// cannot tell a flat `switch` over a discriminated union from three
// nested loops, and in a parser the dispatch is the shape the code is
// supposed to have — gating on it would push the code towards handler
// tables that score better and read worse.
describe("gates and ratchets", () => {
  test("a cyclomatic-tail increase alone does not fail", () => {
    const base = makeSnapshot({ cyclomaticOverCount: 1 });
    const head = makeSnapshot({ cyclomaticOverCount: 4 });
    expect(gateFailures(head, base)).toEqual([]);
  });

  test("a cognitive MAX increase fails, naming the layer", () => {
    const base = makeSnapshot({ cognitiveMax: 14 });
    const head = makeSnapshot({ cognitiveMax: 15 });
    const failures = gateFailures(head, base);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures[0]).toContain("cognitive MAX");
    expect(failures[0]).toContain("14 -> 15");
  });

  test("an escape-hatch increase fails", () => {
    const base = makeSnapshot({ disables: 21 });
    const head = makeSnapshot({ disables: 22 });
    expect(gateFailures(head, base)).toEqual(["eslint-disable: 21 -> 22"]);
  });

  test("an import cycle fails with or without a base", () => {
    const head = makeSnapshot({ cycles: ["src/a.ts -> src/b.ts -> src/a.ts"] });
    expect(gateFailures(head)).toHaveLength(1);
    expect(gateFailures(head)[0]).toContain("src/a.ts -> src/b.ts");
    expect(gateFailures(head, makeSnapshot({}))).toHaveLength(1);
  });

  test("an unused export under src fails", () => {
    const head = makeSnapshot({ unusedExports: 2 });
    expect(gateFailures(head)).toEqual(["knip: 2 unused export(s) under src/"]);
  });

  test("an untagged test-only export fails", () => {
    const head = makeSnapshot({ untaggedInternal: ["src/a.ts:helper …"] });
    expect(gateFailures(head)).toEqual(["src/a.ts:helper …"]);
  });

  test("a stale @internal tag fails too", () => {
    const head = makeSnapshot({ staleInternalTags: ["src/a.ts:helper …"] });
    expect(gateFailures(head)).toEqual(["src/a.ts:helper …"]);
  });

  test("neither is judged on a checkout that is not ours", () => {
    const head = makeSnapshot({
      repository: false,
      untaggedInternal: ["src/a.ts:helper …"],
      staleInternalTags: ["src/b.ts:other …"],
    });
    expect(gateFailures(head)).toEqual([]);
  });

  test("an unused export under scripts fails too", () => {
    const head = makeSnapshot({ unusedScriptExports: 3 });
    expect(gateFailures(head)).toEqual([
      "knip: 3 unused export(s) under scripts/",
    ]);
  });

  test("an unused export under tests fails too", () => {
    const head = makeSnapshot({ unusedTestExports: 5 });
    expect(gateFailures(head)).toEqual([
      "knip: 5 unused export(s) under tests/",
    ]);
  });

  test("duplication over the recorded ceiling fails", () => {
    const head = makeSnapshot({ duplicatedPercent: 5 });
    expect(gateFailures(head)).toEqual([
      "jscpd: 5% duplicated lines exceeds the 1.8% ceiling",
    ]);
  });

  test("duplication at the recorded ceiling passes", () => {
    const head = makeSnapshot({ duplicatedPercent: 1.8 });
    expect(gateFailures(head)).toEqual([]);
  });

  test("a layer that did not exist at the base cannot regress", () => {
    const base = makeSnapshot({ files: 0, cognitiveMax: 0 });
    const head = makeSnapshot({ files: 3, cognitiveMax: 12 });
    expect(gateFailures(head, base)).toEqual([]);
  });

  test("a clean pair passes", () => {
    expect(gateFailures(makeSnapshot({}), makeSnapshot({}))).toEqual([]);
  });
});
