/**
 * Dead code (knip) and duplication (jscpd).
 *
 * Ruling 36: knip is a devDependency and runs on EVERY invocation,
 * because the unused-exports gate is a HARD gate and a gate that is
 * silent by default is not a gate. If knip cannot run at all, that is
 * a failure to report, not a row to skip.
 *
 * jscpd stays optional and report-only, behind `--duplication`: it is
 * a one-off `bunx` fetch, it needs the network the first time, and
 * nothing gates on it.
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
 * Resolve a tool to a command line, preferring the installed binary.
 * @param tool - npm binary name
 * @param allowDownload - fall back to `bunx`, which may fetch it
 * @returns the command and its leading arguments, or undefined when
 * the tool is neither installed nor allowed to be fetched
 */
function toolCommand(
  tool: string,
  allowDownload: boolean,
): [string, string[]] | undefined {
  const local = path.join(REPO_ROOT, "node_modules/.bin", tool);
  if (existsSync(local)) return [local, []];
  return allowDownload ? ["bunx", [tool]] : undefined;
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
  const command = toolCommand("knip", false);
  if (command === undefined) return undefined;
  const [binary, lead] = command;
  const arguments_ = [...lead, "--no-progress", "--reporter", "json"];
  try {
    return execFileSync(binary, arguments_, {
      cwd: directory,
      encoding: "utf8",
      maxBuffer: CHILD_MAX_BUFFER,
      // Its stderr is not ours to print: knip complains about a
      // missing `vitest/config` in a base copy that has no
      // `node_modules`, and still produces the report we want.
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
  if (!isObject(parsed)) return undefined;
  const { issues } = parsed;
  if (!isArray(issues)) return undefined;
  let count = ZERO;
  for (const raw of issues) {
    if (!isObject(raw)) continue;
    const { file } = raw;
    if (typeof file !== "string" || !file.startsWith(prefix)) continue;
    for (const bucket of KNIP_SYMBOL_BUCKETS) {
      const { [bucket]: found } = raw;
      if (isArray(found)) count += found.length;
    }
  }
  return count;
}

/**
 * Duplicated-line percentage over `src`, via jscpd.
 * @param directory - checkout root to analyse
 * @param allowDownload - allow a `bunx` fetch
 * @returns the percentage, or undefined when jscpd did not run
 */
function runJscpd(
  directory: string,
  allowDownload: boolean,
): number | undefined {
  const command = toolCommand("jscpd", allowDownload);
  if (command === undefined) return undefined;
  const [binary, lead] = command;
  const reportDirectory = mkdtempSync(path.join(tmpdir(), "metrics-jscpd-"));
  try {
    execFileSync(
      binary,
      [
        ...lead,
        "src",
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
  if (!isObject(parsed)) return undefined;
  const { statistics } = parsed;
  if (!isObject(statistics)) return undefined;
  const { total } = statistics;
  if (!isObject(total)) return undefined;
  const { percentage } = total;
  return typeof percentage === "number" ? percentage : undefined;
}

/**
 * Measure dead code always, and duplication on request.
 * @param directory - checkout root to analyse
 * @param duplication - also run jscpd, fetching it with `bunx` if need be
 * @returns the counts; `undefined` for knip means it could not run,
 * which the gates treat as a failure rather than a pass
 */
export function readDeadCode(
  directory: string,
  duplication: boolean,
): DeadCode {
  const knip = runKnip(directory);
  return {
    unusedExports:
      knip === undefined ? undefined : countKnipExports(knip, "src/"),
    // Reported next to `src` so the scorecard's own tooling is held to
    // the standard it enforces, but never gated: a script IS an entry
    // point, so knip's file-level findings there are expected.
    unusedScriptExports:
      knip === undefined ? undefined : countKnipExports(knip, "scripts/"),
    duplicatedPercent: duplication
      ? runJscpd(directory, duplication)
      : undefined,
  };
}
