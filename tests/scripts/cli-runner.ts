/**
 * Shared plumbing for the exit-code-contract suites that drive a real
 * `scripts/` CLI over `spawnSync`: `migration-diff.test.ts`,
 * `probe-domains.test.ts`, `shape-diff.test.ts`.
 *
 * `scripts/lib/cli.ts` deliberately does not export the harness's own
 * `CANNOT_RUN` (only `cannotRun()`, which sets it), so these are
 * redeclared here rather than imported.
 */
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../../scripts/lib/checkout.js";
import { plantCheckout } from "../lib/checkout.js";

/** The exit code a harness that could not run has to produce. */
export const CANNOT_RUN = 2;

/** The exit code a gate that failed has to produce. */
export const GATE_FAILED = 1;

/**
 * Write a stand-in checkout for `--reference`/`--base` to format the
 * domain in.
 *
 * The differential reaches another tree through that tree's own
 * `tests/helpers.js`, so a directory holding one IS a reference or a
 * base as far as the run is concerned.
 * @param formatBody - the body of the stand-in `formatAdoc`
 * @returns the checkout root
 */
export function writeStandInCheckout(formatBody: string): string {
  return plantCheckout({
    "package.json": JSON.stringify({
      name: "stand-in",
      private: true,
      type: "module",
    }),
    "tests/helpers.js": `export async function formatAdoc(source) {\n${formatBody}\n}\n`,
  });
}

/**
 * Run a `scripts/` CLI and report the code a shell would read.
 * @param script - the script's path, relative to the repo root
 * @param argv - the arguments after the script name
 * @returns the process exit code
 */
export function runCli(script: string, argv: readonly string[]): number {
  const result = spawnSync("bun", [script, ...argv], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return result.status ?? -1;
}
