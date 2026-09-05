/**
 * Dead code (knip) and duplication (jscpd).
 *
 * Both are devDependencies and both run on EVERY invocation: the
 * unused-exports gate and the duplication ceiling are both HARD
 * gates, and a gate that is silent by default is not a gate. If
 * either tool cannot run at all, that is a failure to report, not a
 * row to skip.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { isArray, isObject, parseJson, stdoutOf } from "./json.js";
import { CHILD_MAX_BUFFER, REPO_ROOT, ZERO, type DeadCode } from "./model.js";

// jscpd's clone-detection floor. Small enough to catch a copied
// helper, large enough not to flag every three-line guard.
const MIN_LINES = "5";
const MIN_TOKENS = "50";

// Every bucket knip reports an unused SYMBOL in. `types`,
// `enumMembers` and `namespaceMembers` were missing from an earlier
// version of this count, which is how two dead exported types went
// unnoticed.
const KNIP_SYMBOL_BUCKETS = [
  "exports",
  "types",
  "enumMembers",
  "namespaceMembers",
];

/**
 * Resolve a tool to its installed binary. Both tools this file runs
 * are devDependencies, so there is no download fallback: a missing
 * binary means `bun install` was not run, and that is a failure to
 * report, not a reason to fetch one over the network.
 * @param tool - npm binary name
 * @returns the command and its leading arguments, or undefined when
 * the tool is not installed
 */
function toolCommand(tool: string): [string, string[]] | undefined {
  const local = path.join(REPO_ROOT, "node_modules/.bin", tool);
  return existsSync(local) ? [local, []] : undefined;
}

/**
 * Run knip and return its JSON report.
 *
 * Unused exports are the residue a half-finished deletion leaves
 * behind, which is exactly what a refactor's final task should be
 * looking for.
 * @param directory - checkout root to analyse
 * @returns knip's stdout, or undefined when it could not run at all
 */
function runKnip(directory: string): string | undefined {
  const command = toolCommand("knip");
  if (command === undefined) {
    return undefined;
  }
  const [binary, lead] = command;
  const arguments_ = [...lead, "--no-progress", "--reporter", "json"];
  try {
    return execFileSync(binary, arguments_, {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: CHILD_MAX_BUFFER,
      // Its stderr is not ours to print: knip complains about a
      // missing `vitest/config` in a base copy that has no
      // `node_modules`, and still produces the report we want. That
      // missing `node_modules` also means the base column can
      // OVERSTATE the branch's improvement (e.g. reporting 7 → 0 when
      // the true baseline, run with node_modules present, is already
      // 0): the head column is the gate; the base column is advisory
      // only, not evidence of a fix.
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    // knip exits non-zero whenever it has findings, which is the
    // normal case for it. The report is still on the error's stdout.
    return stdoutOf(error);
  }
}

/**
 * Count unused exported symbols under one directory in a knip report.
 * @param output - knip's stdout
 * @param prefix - the directory prefix to count, e.g. `src/`
 * @returns the count, or undefined when the output was not the report
 */
export function countKnipExports(
  output: string,
  prefix: string,
): number | undefined {
  const parsed = parseJson(output);
  if (!isObject(parsed)) {
    return undefined;
  }
  const { issues } = parsed;
  if (!isArray(issues)) {
    return undefined;
  }
  let count = ZERO;
  for (const raw of issues) {
    if (!isObject(raw)) {
      continue;
    }
    const { file } = raw;
    if (typeof file !== "string" || !file.startsWith(prefix)) {
      continue;
    }
    for (const bucket of KNIP_SYMBOL_BUCKETS) {
      const { [bucket]: found } = raw;
      if (isArray(found)) {
        count += found.length;
      }
    }
  }
  return count;
}

// The trees jscpd scans. A tree this checkout does not have (a
// planted fixture with only `src/`) is not an error: jscpd reports
// zero files found under it and moves on.
const DUPLICATION_TREES = ["src", "scripts", "tests"];

/**
 * Duplicated-line percentage over `src`, `scripts` and `tests`, via
 * jscpd.
 * @param directory - checkout root to analyse
 * @returns the percentage, or undefined when jscpd did not run
 */
function runJscpd(directory: string): number | undefined {
  const command = toolCommand("jscpd");
  if (command === undefined) {
    return undefined;
  }
  const [binary, lead] = command;
  const reportDirectory = mkdtempSync(path.join(tmpdir(), "metrics-jscpd-"));
  try {
    execFileSync(
      binary,
      [
        ...lead,
        ...DUPLICATION_TREES,
        "--min-lines",
        MIN_LINES,
        "--min-tokens",
        MIN_TOKENS,
        "--reporters",
        "json",
        "--output",
        reportDirectory,
        "--silent",
      ],
      {
        cwd: directory,
        encoding: "utf8",
        maxBuffer: CHILD_MAX_BUFFER,
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    return readJscpdPercentage(path.join(reportDirectory, "jscpd-report.json"));
  } catch {
    return undefined;
  } finally {
    rmSync(reportDirectory, { recursive: true, force: true });
  }
}

/**
 * Read the duplication percentage out of a jscpd JSON report.
 * @param file - path of the report jscpd wrote
 * @returns the percentage, or undefined when it is not in the report
 */
function readJscpdPercentage(file: string): number | undefined {
  const parsed = parseJson(readFileSync(file, "utf8"));
  if (!isObject(parsed)) {
    return undefined;
  }
  const { statistics } = parsed;
  if (!isObject(statistics)) {
    return undefined;
  }
  const { total } = statistics;
  if (!isObject(total)) {
    return undefined;
  }
  const { percentage } = total;
  return typeof percentage === "number" ? percentage : undefined;
}

/**
 * Measure dead code and duplication, always.
 * @param directory - checkout root to analyse
 * @returns the counts; `undefined` for either tool means it could not
 * run, which the gates treat as a failure rather than a pass
 */
export function readDeadCode(directory: string): DeadCode {
  const knip = runKnip(directory);
  return {
    unusedExports:
      knip === undefined ? undefined : countKnipExports(knip, "src/"),
    // Gated the same as `src`: every script is declared as a knip
    // entry point in knip.json, so an export inside one that nothing
    // calls is residue, not an unused entry point.
    unusedScriptExports:
      knip === undefined ? undefined : countKnipExports(knip, "scripts/"),
    // Gated the same way: the `.test.ts` files under `tests` are the
    // declared entry points, so this counts residue in the harness's
    // own shared modules (`tests/helpers.ts`, `tests/lib/*.ts`, and
    // the rest), exactly the exports a half-finished consolidation
    // leaves behind.
    unusedTestExports:
      knip === undefined ? undefined : countKnipExports(knip, "tests/"),
    duplicatedPercent: runJscpd(directory),
  };
}
