/**
 * The scorecard measures the codebase, so the scorecard itself has to
 * be measured by something. These tests pin the parts that used to be
 * hand-rolled regexes (Ruling 34): line classification, export
 * counting, escape-hatch counting, the eslint-report parser, the
 * knip-report parser, and one real dependency-cruiser run.
 */
import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
import { perLayer, type Snapshot } from "../../scripts/metrics/model.js";

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

  // Ruling 36: `as const` narrows a literal to its own type and adds
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
    ],
  });

  test("counts every unused-symbol bucket, not just exports", () => {
    expect(countKnipExports(report, "src/")).toBe(4);
  });

  test("counts per directory", () => {
    expect(countKnipExports(report, "scripts/")).toBe(1);
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
  const root = realpathSync(
    mkdtempSync(path.join(tmpdir(), "metrics-fixture-")),
  );
  try {
    mkdirSync(path.join(root, "src"));
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { module: "ES2022", moduleResolution: "bundler" },
        include: ["src/**/*.ts"],
      }),
    );
    for (const [name, contents] of Object.entries(files)) {
      writeFileSync(path.join(root, "src", name), contents);
    }
    return await cruiseImports(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

/**
 * A snapshot with everything at zero except what a gate test varies.
 * @param options - the fields under test
 * @param options.label - the column label
 * @param options.files - files per layer; 0 means the layer is absent
 * @param options.cognitiveMax - cognitive MAX for every layer
 * @param options.cyclomaticOverCount - functions over the cyclomatic tail
 * @param options.disables - `eslint-disable` count
 * @param options.assertions - `as` assertion count
 * @param options.cycles - import cycles, as printable paths
 * @param options.unusedExports - knip unused exports under `src`
 * @returns a complete Snapshot
 */
function makeSnapshot(options: {
  label?: string;
  files?: number;
  cognitiveMax?: number;
  cyclomaticOverCount?: number;
  disables?: number;
  assertions?: number;
  cycles?: string[];
  unusedExports?: number;
}): Snapshot {
  const cycles = options.cycles ?? [];
  return {
    label: options.label ?? "sample",
    layers: perLayer(() => ({
      files: options.files ?? 1,
      total: 10,
      code: 5,
      comment: 5,
    })),
    cyclomatic: perLayer(() => ({
      functions: 1,
      sum: 1,
      max: 1,
      over: options.cyclomaticOverCount ?? 0,
    })),
    cognitive: perLayer(() => ({
      functions: 1,
      sum: 1,
      max: options.cognitiveMax ?? 1,
      over: 0,
    })),
    cyclomaticOver: [],
    coupling: {
      importEdges: 1,
      filesInCycles: new Set(cycles).size,
      cycles,
      exportedSymbols: 1,
      starExports: 0,
      unresolved: [],
    },
    hatches: {
      eslintDisable: options.disables ?? 0,
      asAssertions: options.assertions ?? 0,
      nonNull: 0,
      anyType: 0,
    },
    dead: {
      unusedExports: options.unusedExports ?? 0,
      unusedScriptExports: 0,
      duplicatedPercent: 0,
    },
  };
}

// Ruling 35: the cyclomatic tail is REPORT-ONLY. Cyclomatic complexity
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

  test("a layer that did not exist at the base cannot regress", () => {
    const base = makeSnapshot({ files: 0, cognitiveMax: 0 });
    const head = makeSnapshot({ files: 3, cognitiveMax: 12 });
    expect(gateFailures(head, base)).toEqual([]);
  });

  test("a clean pair passes", () => {
    expect(gateFailures(makeSnapshot({}), makeSnapshot({}))).toEqual([]);
  });
});

// The gate functions are unit-tested above, but what a build actually
// sees is the PROCESS exit code. This drives the real CLI over a
// throwaway checkout, so the wiring between `gateFailures` and
// `process.exitCode` is covered too.
/**
 * Write a minimal checkout the CLI can measure.
 * @param files - file name to contents, under `src`
 * @returns the checkout root
 */
function writeCheckout(files: Record<string, string>): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "metrics-cli-")));
  mkdirSync(path.join(root, "src"));
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "fixture",
      private: true,
      type: "module",
      main: "src/index.ts",
    }),
  );
  writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "ES2022",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
      },
      include: ["src/**/*.ts"],
    }),
  );
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(path.join(root, "src", name), contents);
  }
  return root;
}

/**
 * Run `bun scripts/metrics.ts --root <checkout>`.
 * @param files - the checkout's `src` files
 * @returns the process's exit code and stderr
 */
function runCli(files: Record<string, string>): {
  status: number;
  stderr: string;
} {
  const root = writeCheckout(files);
  try {
    const result = spawnSync("bun", ["scripts/metrics.ts", "--root", root], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    return { status: result.status ?? -1, stderr: result.stderr };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("the command line's exit code", () => {
  const CLI_TIMEOUT = 180_000;

  test(
    "exits 0 on a clean checkout",
    () => {
      const { status, stderr } = runCli({
        "index.ts":
          'import { helper } from "./helper.js";\nexport function run(): string {\n  return helper();\n}\n',
        "helper.ts": 'export function helper(): string {\n  return "ok";\n}\n',
      });
      expect(status, stderr).toBe(0);
    },
    CLI_TIMEOUT,
  );

  test(
    "exits 1 and names the files when a cycle is planted",
    () => {
      const { status, stderr } = runCli({
        "index.ts":
          'import { a } from "./a.js";\nexport function run(): unknown {\n  return a();\n}\n',
        "a.ts":
          'import { b } from "./b.js";\nexport const a = (): unknown => b;\n',
        "b.ts":
          'import { a } from "./a.js";\nexport const b = (): unknown => a;\n',
      });
      expect(status).toBe(1);
      expect(stderr).toContain("import cycle");
      expect(stderr).toContain("src/a.ts");
      expect(stderr).toContain("src/b.ts");
    },
    CLI_TIMEOUT,
  );
});
