/**
 * Shared plumbing for the exit-code-contract suites that drive a real
 * `scripts/` CLI over `spawnSync`: `shape-diff.test.ts`.
 *
 * `scripts/lib/cli.ts` deliberately does not export the harness's own
 * `CANNOT_RUN` (only `cannotRun()`, which sets it), so these are
 * redeclared here rather than imported.
 */
import { spawnSync } from "node:child_process";
import { REPO_ROOT } from "../../scripts/lib/checkout.js";

/** The exit code a harness that could not run has to produce. */
export const CANNOT_RUN = 2;

/** The exit code a gate that failed has to produce. */
export const GATE_FAILED = 1;

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
