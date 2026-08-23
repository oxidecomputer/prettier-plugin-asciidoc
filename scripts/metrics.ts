#!/usr/bin/env bun
/**
 * The simplicity scorecard: measure this checkout, optionally against
 * another revision, and print ONE table.
 *
 *   bun run metrics                          # head only
 *   bun run metrics -- --base 0298a2ba       # base | head | delta
 *   bun run metrics -- --base=0298a2ba       # the same
 *   bun run metrics -- --json                # the raw snapshots
 *   bun run metrics -- --duplication         # also jscpd (via bunx)
 *   bun run metrics -- --root <dir>          # measure another checkout
 *
 * Why it exists: a refactor that claims to simplify has to be able to
 * show it, and no single number can. The rows are paired so that
 * gaming one moves another the wrong way — code lines next to comment
 * lines, cyclomatic next to cognitive, import edges next to exported
 * symbols. `docs/simplicity-metrics.md` has the full scorecard, the
 * anti-gaming table, and the references.
 *
 * Metrics are instrumentation, not the objective. A row that moves the
 * wrong way is a question to answer in the task report, never a target
 * to adjust.
 *
 * Gates (non-zero exit) live in `metrics/gates.ts`, which is where the
 * policy is stated and tested: an import cycle, an unresolved relative
 * import, a knip unused export under `src`, a resident agreement
 * harness, a stale interior-validation registry entry, and — with
 * `--base` — a ratchet on cognitive MAX, on the escape hatches, on
 * each named seam's width and on each defense counter. The cyclomatic
 * tail is REPORT-ONLY (Ruling 35). Everything else is reported.
 *
 * The seam, defense and harness rows are BUDGETS WE MAINTAIN, not
 * numbers a tool discovers: the seam list, the interior-validation
 * registry and the harness list are written by hand in
 * `metrics/design.ts` and reviewed. See `docs/simplicity-metrics.md`.
 *
 * This file is the command line only: argument parsing, materializing
 * the base revision, running the measurement, printing. The measuring
 * lives under `scripts/metrics/`, and the counting itself is done by
 * the TypeScript scanner, eslint, dependency-cruiser, knip and jscpd
 * rather than by anything hand-rolled here.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { tails, writeEslintConfig } from "./metrics/complexity.js";
import { gateFailures } from "./metrics/gates.js";
import { measure } from "./metrics/measure.js";
import {
  CHILD_MAX_BUFFER,
  LAYERS,
  NOT_FOUND,
  ONE,
  REPO_ROOT,
  ZERO,
  type Snapshot,
} from "./metrics/model.js";
import { shapeCensusFailures } from "./metrics/shape-census.js";

const ARGUMENT_START = 2;
const JSON_INDENT = 2;
const FAILURE = 1;

// Two decimal places, so jscpd's fractional percentage does not blow
// the column open.
const ROUNDING = 100;

const NAME_WIDTH = 34;
const VALUE_WIDTH = 12;

// base, head, delta.
const VALUE_COLUMNS = 3;

// Width of the value column in the offender list.
const TAIL_WIDTH = 4;

const FLAGS = new Set(["--json", "--duplication"]);

/**
 * Materialize a revision into a temp directory with `git archive`.
 *
 * Deliberately not `git worktree`: this repository is jj-managed and
 * often has a concurrent session, and a worktree mutates `.git`.
 * `realpath` on the result because macOS hands out `/var/...` here
 * while child processes report `/private/var/...`, and the two must
 * agree for a linted path to resolve back to a layer.
 * @param revision - anything `git archive` accepts
 * @returns the temp directory holding the checkout
 */
function materialize(revision: string): string {
  const directory = realpathSync(
    mkdtempSync(path.join(tmpdir(), "metrics-base-")),
  );
  const archive = path.join(directory, "revision.tar");
  execFileSync(
    "git",
    ["archive", "--format=tar", "--output", archive, revision],
    { cwd: REPO_ROOT, maxBuffer: CHILD_MAX_BUFFER },
  );
  execFileSync("tar", ["-xf", archive, "-C", directory]);
  rmSync(archive, { force: true });
  return directory;
}

/**
 * Flatten a snapshot into the table's rows, in print order.
 * @param snapshot - a measured revision
 * @returns `[name, value]` pairs; an undefined value prints as "n/a"
 */
function rowsOf(snapshot: Snapshot): Array<[string, number | undefined]> {
  const rows: Array<[string, number | undefined]> = [];
  const { cyclomatic: cyclomaticTail, cognitive: cognitiveTail } = tails();
  for (const layer of LAYERS) {
    rows.push(
      [`files ${layer}`, snapshot.layers[layer].files],
      [`total lines ${layer}`, snapshot.layers[layer].total],
      [`code LoC ${layer}`, snapshot.layers[layer].code],
      [`comment LoC ${layer}`, snapshot.layers[layer].comment],
    );
  }
  for (const layer of LAYERS) {
    rows.push(
      [`cyclomatic SUM ${layer}`, snapshot.cyclomatic[layer].sum],
      [`cyclomatic MAX ${layer}`, snapshot.cyclomatic[layer].max],
      [
        `cyclomatic >${String(cyclomaticTail)} ${layer}`,
        snapshot.cyclomatic[layer].over,
      ],
      [`cognitive SUM ${layer}`, snapshot.cognitive[layer].sum],
      [`cognitive MAX ${layer}`, snapshot.cognitive[layer].max],
      [
        `cognitive >${String(cognitiveTail)} ${layer}`,
        snapshot.cognitive[layer].over,
      ],
    );
  }
  rows.push(
    ["import edges", snapshot.coupling.importEdges],
    ["files in cycles", snapshot.coupling.filesInCycles],
    ["unresolved relative imports", snapshot.coupling.unresolved.length],
    ["exported symbols", snapshot.coupling.exportedSymbols],
    ["of those, `export *`", snapshot.coupling.starExports],
    ["eslint-disable", snapshot.hatches.eslintDisable],
    ["as assertions", snapshot.hatches.asAssertions],
    ["non-null assertions", snapshot.hatches.nonNull],
    ["any in type position", snapshot.hatches.anyType],
  );
  // Seam width, one row per named seam: a row printing "n/a" means the
  // measured revision does not declare that interface, which is what
  // lets it ratchet from absent.
  for (const seam of snapshot.seams) {
    rows.push([`seam ${seam.name}`, seam.members]);
  }
  rows.push(
    ["unreachable() sites", snapshot.defense.unreachableCalls],
    ["Caller contract: markers", snapshot.defense.callerContract],
    ["Total fallback: markers", snapshot.defense.totalFallback],
    ["Valid only when markers", snapshot.defense.validOnlyWhen],
    ["interior validation sites", snapshot.defense.interiorValidation],
    // "(declared)" because nothing scans `tests/`: this row is the
    // length of a hand-written list, and a row that reads as measured
    // when it is not is the one thing this scorecard must not print.
    ["agreement harnesses (declared)", snapshot.harnesses.length],
    ["knip unused exports in src", snapshot.dead.unusedExports],
    ["knip unused exports in scripts", snapshot.dead.unusedScriptExports],
    ["jscpd duplicated %", snapshot.dead.duplicatedPercent],
  );
  return rows;
}

/**
 * Format a number for the table.
 * @param value - a metric value
 * @returns the value with at most two decimal places
 */
function round(value: number): string {
  return String(Math.round(value * ROUNDING) / ROUNDING);
}

/**
 * Format one right-aligned cell.
 * @param value - the number, or undefined when a tool did not run
 * @returns padded text
 */
function cell(value: number | undefined): string {
  return (value === undefined ? "n/a" : round(value)).padStart(VALUE_WIDTH);
}

/**
 * Format the signed change between two cells.
 * @param before - the base value, if there is a base
 * @param after - the head value
 * @returns padded text, or "n/a" when the pair is incomplete
 */
function deltaCell(
  before: number | undefined,
  after: number | undefined,
): string {
  if (before === undefined || after === undefined) {
    return "n/a".padStart(VALUE_WIDTH);
  }
  const change = after - before;
  return `${change >= ZERO ? "+" : ""}${round(change)}`.padStart(VALUE_WIDTH);
}

/**
 * Print the scorecard: metric, base, head, delta.
 * @param head - the snapshot for this checkout
 * @param base - the snapshot for `--base`, when one was given
 */
function printTable(head: Snapshot, base: Snapshot | undefined): void {
  const baseRows = new Map(base === undefined ? [] : rowsOf(base));
  const header = `${"metric".padEnd(NAME_WIDTH)}${(base?.label ?? "—").padStart(VALUE_WIDTH)}${head.label.padStart(VALUE_WIDTH)}${"delta".padStart(VALUE_WIDTH)}`;
  const lines = [header, "-".repeat(NAME_WIDTH + VALUE_WIDTH * VALUE_COLUMNS)];
  for (const [name, value] of rowsOf(head)) {
    const before = baseRows.get(name);
    lines.push(
      `${name.padEnd(NAME_WIDTH)}${cell(before)}${cell(value)}${deltaCell(before, value)}`,
    );
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

/**
 * Name the functions over the cyclomatic tail, under the table.
 *
 * That row is report-only (Ruling 35), and a report-only number is
 * only useful if it says WHICH functions: a flat dispatch over a
 * discriminated union and a genuinely branchy function score the same,
 * and only a reader can tell them apart.
 * @param head - the snapshot for this checkout
 */
function printOffenders(head: Snapshot): void {
  if (head.cyclomaticOver.length === ZERO) return;
  const { cyclomatic: tail } = tails();
  const lines = head.cyclomaticOver.map(
    (offender) =>
      `  ${String(offender.value).padStart(TAIL_WIDTH)}  ${offender.what} (${offender.where})`,
  );
  process.stdout.write(
    `\nfunctions over cyclomatic ${String(tail)} (report-only — read them, do not chase the number):\n${lines.join("\n")}\n`,
  );
}

/** What the command line asked for. */
interface Options {
  /** The revision to compare against, when one was given. */
  base: string | undefined;
  /** Print the raw snapshots instead of the table. */
  json: boolean;
  /** Also measure duplication, fetching jscpd with `bunx` if need be. */
  duplication: boolean;
  /** The checkout to measure; this repository unless overridden. */
  root: string;
  /**
   * Whether `--root` pointed the measurement somewhere else. The
   * design registries describe THIS repository, so a foreign checkout
   * is measured and not judged by them (see `Snapshot.repository`).
   */
  foreignRoot: boolean;
}

// The two options that take a value, in either `--flag value` or
// `--flag=value` spelling.
const TAKES_VALUE = new Set(["--base", "--root"]);

/**
 * Split `--flag=value` into its parts; a bare flag has no value.
 * @param argument - one command-line argument
 * @returns the flag name and the inline value, if there was one
 */
function splitArgument(argument: string): [string, string | undefined] {
  const at = argument.indexOf("=");
  return at === NOT_FOUND
    ? [argument, undefined]
    : [argument.slice(ZERO, at), argument.slice(at + ONE)];
}

/**
 * Take the next argument as a flag's value.
 * @param rest - the unconsumed arguments; the value is shifted off it
 * @param flag - the flag being given a value, for the error message
 * @returns the value
 */
function nextValue(rest: string[], flag: string): string {
  const value = rest.shift();
  if (value === undefined || value === "" || value.startsWith("--")) {
    throw new Error(`${flag} needs a value`);
  }
  return value;
}

/**
 * Apply one parsed flag, returning the new options.
 * @param options - the options so far
 * @param name - the flag name
 * @param value - its value, for the flags that take one
 * @returns the options with that flag applied
 */
function applyOption(
  options: Options,
  name: string,
  value: string | undefined,
): Options {
  switch (name) {
    case "--base": {
      return { ...options, base: value };
    }
    case "--root": {
      if (value === undefined) return options;
      return { ...options, root: path.resolve(value), foreignRoot: true };
    }
    case "--json": {
      return { ...options, json: true };
    }
    case "--duplication": {
      return { ...options, duplication: true };
    }
    default: {
      throw new Error(
        `unknown argument ${name} (known: --base <rev>, --root <dir>, ${[...FLAGS].join(", ")})`,
      );
    }
  }
}

/**
 * Parse the command line, rejecting anything unrecognised rather than
 * ignoring it — a silently dropped `--base` would print a head-only
 * table that looks like a passing comparison.
 * @param argv - arguments after the interpreter and the script
 * @returns the parsed options
 */
function parseArguments(argv: string[]): Options {
  let options: Options = {
    base: undefined,
    json: false,
    duplication: false,
    root: REPO_ROOT,
    foreignRoot: false,
  };
  const rest = [...argv];
  while (rest.length > ZERO) {
    const [name, inline] = splitArgument(rest.shift() ?? "");
    const value = TAKES_VALUE.has(name)
      ? (inline ?? nextValue(rest, name))
      : undefined;
    if (value === "") throw new Error(`${name} needs a value`);
    options = applyOption(options, name, value);
  }
  return options;
}

/**
 * Parse the command line, or explain what was wrong with it.
 * @param argv - arguments after the interpreter and the script
 * @returns the options, or the message to print
 */
function parseOrExplain(argv: string[]): Options | string {
  try {
    return parseArguments(argv);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * Measure this checkout (and optionally a base revision), print the
 * scorecard, and fail on a gate or a ratchet.
 */
async function main(): Promise<void> {
  const options = parseOrExplain(process.argv.slice(ARGUMENT_START));
  if (typeof options === "string") {
    // A usage mistake deserves one line, not a stack trace.
    process.stderr.write(`${options}\n`);
    process.exitCode = FAILURE;
    return;
  }
  const workDirectory = mkdtempSync(path.join(tmpdir(), "metrics-config-"));
  const configPath = writeEslintConfig(workDirectory);
  let baseDirectory: string | undefined = undefined;
  try {
    const head = await measure({
      directory: options.root,
      label: "head",
      configPath,
      duplication: options.duplication,
      // `--root` points at somebody else's checkout, which the design
      // registries do not describe; without `--root` head IS this
      // repository. Tracked as a flag rather than compared as a path,
      // because a symlinked root would make the comparison say "not
      // us" and silently switch three hard gates off.
      repository: !options.foreignRoot,
    });
    let base: Snapshot | undefined = undefined;
    if (options.base !== undefined) {
      baseDirectory = materialize(options.base);
      base = await measure({
        directory: baseDirectory,
        label: options.base,
        configPath,
        duplication: options.duplication,
        // An archived revision predates whatever the registries say
        // today; it supplies the ratchets' left-hand column and
        // nothing else.
        repository: false,
      });
    }
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ base, head }, undefined, JSON_INDENT)}\n`,
      );
    } else {
      printTable(head, base);
      printOffenders(head);
    }
    const failures = gateFailures(head, base);
    // The shape census reads THIS repository's registry and
    // line-shapes module (live imports), so a foreign --root checkout
    // is measured and not judged by it — same stance as the other
    // hand-maintained registries (metrics/gates.ts).
    if (!options.foreignRoot) failures.push(...shapeCensusFailures());
    if (failures.length > ZERO) {
      process.stderr.write(`${failures.join("\n")}\n`);
      process.exitCode = FAILURE;
    }
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
    if (baseDirectory !== undefined) {
      rmSync(baseDirectory, { recursive: true, force: true });
    }
  }
}

await main();
