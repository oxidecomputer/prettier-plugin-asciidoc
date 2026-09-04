/**
 * What a build actually sees: the PROCESS exit code.
 *
 * The gate functions are unit-tested in `metrics.test.ts` against
 * synthetic snapshots; this drives the real CLI over throwaway
 * checkouts, so the wiring between a failure and the code the shell
 * reads is covered too — including the distinction the whole
 * `scripts/` exit-code contract rests on: 1 means the gate failed, 2
 * means the scorecard could not run.
 */
import { describe, test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "../../scripts/lib/checkout.js";
import { inCheckout } from "../lib/checkout.js";
import { gateFailures, measuredNothing } from "../../scripts/metrics/gates.js";
import { makeSnapshot } from "./metrics-snapshot.js";

/**
 * Run `bun scripts/metrics.ts --root <checkout>` over a minimal
 * checkout the CLI can measure.
 * @param files - file name to contents, under `src`
 * @returns the process's exit code and stderr
 */
function runCli(files: Record<string, string>): {
  status: number;
  stderr: string;
} {
  return inCheckout(
    {
      "package.json": JSON.stringify({
        name: "fixture",
        private: true,
        type: "module",
        main: "src/index.ts",
      }),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          module: "ES2022",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      }),
      ...Object.fromEntries(
        Object.entries(files).map(([name, contents]) => [
          `src/${name}`,
          contents,
        ]),
      ),
    },
    (root) => {
      const result = spawnSync(
        "bun",
        [path.join(REPO_ROOT, "scripts/metrics.ts"), "--root", root],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      return { status: result.status ?? -1, stderr: result.stderr };
    },
  );
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

  test("exits 2 on an argument it does not know, having measured nothing", () => {
    const result = spawnSync(
      "bun",
      [path.join(REPO_ROOT, "scripts/metrics.ts"), "--nope"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("unknown argument --nope");
  });

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

// The floor is not a gate: it is the answer to "did this measure
// anything at all?", which the CLI turns into exit 2 rather than 1.
// Without it an empty `src` scores a perfect card — no cycles, no
// unused exports, no escape hatches, all of them vacuously.
describe("the measured-nothing floor", () => {
  test("a real tree clears it", () => {
    expect(
      measuredNothing(makeSnapshot({ files: 36, exportedSymbols: 214 })),
    ).toBeUndefined();
  });

  test("a tree too small to be this repository does not", () => {
    const complaint = measuredNothing(
      makeSnapshot({ files: 2, exportedSymbols: 3 }),
    );
    expect(complaint).toContain("2 file(s)");
    expect(complaint).toContain("did not load");
  });

  test("an empty tree passes every gate, which is the point", () => {
    const empty = makeSnapshot({ files: 0, exportedSymbols: 0 });
    expect(gateFailures(empty)).toEqual([]);
    expect(measuredNothing(empty)).toBeDefined();
  });

  test("a foreign --root checkout has no floor: it is not ours to size", () => {
    expect(
      measuredNothing(
        makeSnapshot({ files: 1, exportedSymbols: 1, repository: false }),
      ),
    ).toBeUndefined();
  });
});
