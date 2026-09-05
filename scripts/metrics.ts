#!/usr/bin/env bun
/**
 * The simplicity scorecard: measure this checkout, optionally against
 * another revision, and print ONE table.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the gates held, 1 a gate or a
 * ratchet FAILED, 2 the scorecard could not run — a bad argument, an
 * unknown `--base`, or a `src` too small to have been measured at all.
 *
 * Why it exists: a refactor that claims to simplify has to be able to
 * show it, and no single number can. The rows are paired so that
 * gaming one moves another the wrong way — code lines next to comment
 * lines, cyclomatic next to cognitive, import edges next to exported
 * symbols. `docs/harnesses.md` has the full scorecard, the
 * anti-gaming table, and the references.
 *
 * Metrics are instrumentation, not the objective. A row that moves the
 * wrong way is a question to answer in the task report, never a target
 * to adjust.
 *
 * Gates (non-zero exit) live in `metrics/gates.ts`, which is where the
 * policy is stated and tested: an import cycle, an unresolved relative
 * import, a knip unused export under `src` or `scripts`, a `src`
 * export with no `src` consumer that does not carry `@internal`, a
 * resident agreement
 * harness, a stale interior-validation registry entry, an edge a layer
 * rule forbids, an unregistered or stale cross-directory crossing, a
 * quarantine manifest that has left its conformance pin, a minimums file
 * that no longer describes the source tree,
 * and — with
 * `--base` — a ratchet on cognitive MAX, on the escape hatches, on
 * each named seam's width and on each defense counter. The cyclomatic
 * tail is REPORT-ONLY.
 *
 * Three sections print BELOW the table and gate on nothing: the
 * functions over the cyclomatic tail, the CENSUS PINS (`pin holds` /
 * `pin moved` — a census is an equality pin, never a budget, so
 * neither direction is a win) and the UNREAD PUBLISHED FIELD
 * candidates. Everything else is reported.
 *
 * What the scorecard does NOT check is the minimums' NUMBERS: it never
 * runs the suite. `bun run coverage` checks the coverage half and
 * `bun run mutate` the mutation half; see `scripts/metrics/score-minimums.ts`.
 *
 * The seam, defense and harness rows are BUDGETS WE MAINTAIN, not
 * numbers a tool discovers: the seam list, the interior-validation
 * registry and the harness list are written by hand in
 * `metrics/design.ts` and reviewed. See `docs/harnesses.md`.
 *
 * This file is the command line only: argument parsing, materializing
 * the base revision, running the measurement, printing. The measuring
 * lives under `scripts/metrics/`, and the counting itself is done by
 * the TypeScript scanner, eslint, dependency-cruiser, knip and jscpd
 * rather than by anything hand-rolled here.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { materialize } from "./lib/checkout.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import { tails, writeEslintConfig } from "./metrics/complexity.js";
import { gateFailures, measuredNothing } from "./metrics/gates.js";
import { measure } from "./metrics/measure.js";
import {
  LAYERS,
  NOT_FOUND,
  ONE,
  REPO_ROOT,
  ZERO,
  type Snapshot,
} from "./metrics/model.js";

/** What `--help` prints. */
const USAGE = `usage: bun run metrics [-- <options>]

  --base <rev>     compare against a revision: base | head | delta
  --root <dir>     measure another checkout instead of this one
  --json           print the raw snapshots instead of the table
  --help           this text

exit: 0 gates held, 1 a gate or ratchet failed, 2 could not run`;

const ARGUMENT_START = 2;
const JSON_INDENT = 2;

// Two decimal places, so jscpd's fractional percentage does not blow
// the column open.
const ROUNDING = 100;

const NAME_WIDTH = 34;
const VALUE_WIDTH = 12;

// base, head, delta.
const VALUE_COLUMNS = 3;

// Width of the value column in the offender list.
const TAIL_WIDTH = 4;

const FLAGS = new Set(["--json"]);

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
    ["layer-rule violations", snapshot.coupling.layerViolations.length],
    ["exported symbols", snapshot.coupling.exportedSymbols],
    ["of those, `export *`", snapshot.coupling.starExports],
    ["eslint-disable", snapshot.hatches.eslintDisable],
    ["as assertions", snapshot.hatches.asAssertions],
    ["non-null assertions", snapshot.hatches.nonNull],
    ["any in type position", snapshot.hatches.anyType],
  );
  // Seam width, one row per named seam, contracts first: a row printing
  // "n/a" means the measured revision does not declare that interface,
  // which is what lets it ratchet from absent. The row's prefix is its
  // classification — a contract is judged by width and ratchets, a
  // vocabulary row is reported and judged by precision.
  for (const seam of snapshot.seams) {
    rows.push([`${seam.kind} ${seam.name}`, seam.members]);
  }
  rows.push(
    ["unreachable() sites", snapshot.defense.unreachableCalls],
    ["Caller contract: markers", snapshot.defense.callerContract],
    ["Total fallback: markers", snapshot.defense.totalFallback],
    ["Valid only when markers", snapshot.defense.validOnlyWhen],
    ["interior validation sites", snapshot.defense.interiorValidation],
    // The registry's LENGTH, not a coupling score: it rises when the
    // tree gains a crossing somebody argued for, and that is not a
    // regression. What gates is membership, in both directions.
    ["registered crossings", snapshot.crossings.registered],
    // "(declared)" because nothing scans `tests/`: this row is the
    // length of a hand-written list, and a row that reads as measured
    // when it is not is the one thing this scorecard must not print.
    ["agreement harnesses (declared)", snapshot.harnesses.length],
    // The other half of the unused-export count. knip reads a test as
    // a consumer, so its zero says "nothing is orphaned", not
    // "everything is used by the parser". This row is the difference,
    // and the gate is that every one of them says `@internal`.
    ["src exports with no src consumer", snapshot.internal.testOnly],
    // The conformance pin, both halves on the table: the manifest's
    // length and the number written down for it. Two rows rather than
    // a delta, because the pin is the reviewed artefact — seeing them
    // side by side is how a reader tells "200 because we said 200"
    // from "200 because triage wrote 200".
    ["quarantined conformance cases", snapshot.conformance.quarantined],
    ["conformance quarantine pin", snapshot.conformance.pin],
    // The minimums file's SIZE, not its numbers: the scorecard never
    // runs the suite, so it can say how many files have a recorded
    // minimum and how many gaps are classified, and nothing about
    // whether the minimums hold. `bun run coverage` and
    // `bun run mutate` check that.
    ["files with recorded minimums", snapshot.minimums.recorded],
    ["classified minimum exceptions", snapshot.minimums.exceptions],
    ["knip unused exports in src", snapshot.dead.unusedExports],
    ["knip unused exports in scripts", snapshot.dead.unusedScriptExports],
    ["knip unused exports in tests", snapshot.dead.unusedTestExports],
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
 * That row is report-only, and a report-only number is
 * only useful if it says WHICH functions: a flat dispatch over a
 * discriminated union and a genuinely branchy function score the same,
 * and only a reader can tell them apart.
 * @param head - the snapshot for this checkout
 */
function printOffenders(head: Snapshot): void {
  if (head.cyclomaticOver.length === ZERO) {
    return;
  }
  const { cyclomatic: tail } = tails();
  const lines = head.cyclomaticOver.map(
    (offender) =>
      `  ${String(offender.value).padStart(TAIL_WIDTH)}  ${offender.what} (${offender.where})`,
  );
  process.stdout.write(
    `\nfunctions over cyclomatic ${String(tail)} (report-only — read them, do not chase the number):\n${lines.join("\n")}\n`,
  );
}

/**
 * Say so when there are no CONTRACT rows at all.
 *
 * An empty section that prints nothing reads as a section nobody
 * filled in. This one is a RESULT: the two contracts dissolved when
 * the readers became pure functions, and `src` now declares no
 * interface an implementer satisfies. The scorecard says that in
 * words, so a reader is not left to infer it from absence.
 * @param head - the snapshot for this checkout
 */
function printContractNote(head: Snapshot): void {
  if (head.seams.some((seam) => seam.kind === "contract")) {
    return;
  }
  process.stdout.write(
    "\nno CONTRACT rows: src declares no interface an implementer satisfies, so there is no width to budget (scripts/metrics/design.ts says why, and when the rows come back)\n",
  );
}

/**
 * Print the pinned censuses, neutrally.
 *
 * DIRECTIONLESS by ruling, and the phrasing carries it: a census is
 * an equality pin, not a budget, so the row says "pin holds" or "pin
 * moved" and never "up", "down", "improved" or "regressed". 33 node
 * kinds instead of 30 is fine; a bigger grid is not a win and a
 * smaller one is not a loss — what is not fine is either moving
 * without anybody noticing, which is the only thing this section is
 * for. (A moved pin also FAILS, in `metrics/shape-census.ts`; this
 * section is what a human reads on a green run.)
 * @param foreignRoot - whether `--root` pointed somewhere else, in
 *   which case the pins do not describe the measured checkout
 */
async function printCensus(foreignRoot: boolean): Promise<void> {
  if (foreignRoot) {
    return;
  }
  const { censusPins } = await import("./metrics/shape-census.js");
  const { inlineCensusPins } = await import("./inline-census.js");
  const lines = [...censusPins(), ...inlineCensusPins()].map(
    ({ what, realized, pinned }) =>
      `  ${what.padEnd(NAME_WIDTH)}${String(realized).padStart(TAIL_WIDTH)}  ${realized === pinned ? "pin holds" : `pin moved (written down: ${String(pinned)})`}`,
  );
  process.stdout.write(
    `\ncensus pins (equality pins, not budgets — neither direction is a win; the node-kind census is pinned in tests/parser/architecture.test.ts):\n${lines.join("\n")}\n`,
  );
}

/** The unread-field check's two outputs: what to print, and what fails. */
interface UnreadGate {
  /** The printable block, empty under a foreign `--root`. */
  readonly report: string;
  /** One line per unread published field; empty means the gate holds. */
  readonly failures: readonly string[];
}

/**
 * Measure the unread published fields: the report, and what it GATES.
 *
 * ARMED, 2026-08-24. It landed report-only under the maintainer's
 * ruling — "a precision check that fires on the tree it was written
 * against teaches reviewers to ignore it" — and the condition for
 * arming it was that it be observed QUIET. It has one candidate left
 * to spend, `Attrlist.raw`, and the commit that arms this deletes it,
 * so the report reads `none` and every candidate from here on is a
 * NEW one: a field published across a directory boundary and read by
 * nobody. The serialized-types exemption (`unread-fields.ts`'s
 * `SERIALIZED`) is unchanged and stays a CLASS, not a name list.
 *
 * `unscanned` stays a printed diagnostic rather than a gate. It says
 * the check did not run for a registered type, which is a 2-shaped
 * condition and not a 1-shaped one, and the only way it can happen at
 * any scale — a `src` that did not load — is already the scorecard's
 * `measuredNothing` floor, which exits 2 before this runs.
 * @param foreignRoot - whether `--root` pointed somewhere else, in
 *   which case neither the registry nor the exemption describes it
 * @returns the printable report and one gate failure per unread field
 */
async function unreadFields(foreignRoot: boolean): Promise<UnreadGate> {
  if (foreignRoot) {
    return { report: "", failures: [] };
  }
  const { unreadPublishedFields } = await import("./metrics/unread-fields.js");
  const { candidates, unscanned, examined } = unreadPublishedFields(REPO_ROOT);
  const lines = candidates.map(
    (field) => `  ${field.type}.${field.property} (${field.where})`,
  );
  const body =
    lines.length === ZERO
      ? "  none"
      : `${lines.join("\n")}\n  a published field NOTHING reads: delete it, or give it a reader, or say here why it stays`;
  const notExamined =
    unscanned.length === ZERO
      ? ""
      : `  not examined:\n    ${unscanned.join("\n    ")}\n`;
  return {
    report: `\nunread published fields, ${String(examined)} examined (a field on a registered crossing that NOTHING reads):\n${body}\n${notExamined}`,
    failures: candidates.map(
      (field) =>
        `unread published field: ${field.type}.${field.property} (${field.where}) is published across a directory boundary and read by nobody`,
    ),
  };
}

/** What the command line asked for. */
interface Options {
  /** The revision to compare against, when one was given. */
  base: string | undefined;
  /** Print the raw snapshots instead of the table. */
  json: boolean;
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
      if (value === undefined) {
        return options;
      }
      return { ...options, root: path.resolve(value), foreignRoot: true };
    }
    case "--json": {
      return { ...options, json: true };
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
    root: REPO_ROOT,
    foreignRoot: false,
  };
  const rest = [...argv];
  while (rest.length > ZERO) {
    const [name, inline] = splitArgument(rest.shift() ?? "");
    const value = TAKES_VALUE.has(name)
      ? (inline ?? nextValue(rest, name))
      : undefined;
    if (value === "") {
      throw new Error(`${name} needs a value`);
    }
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
  const argv = process.argv.slice(ARGUMENT_START);
  if (wantsHelp(argv)) {
    printUsage(USAGE);
    return;
  }
  const options = parseOrExplain(argv);
  if (typeof options === "string") {
    // A usage mistake deserves one line, not a stack trace — and it is
    // a 2, not a 1: nothing was measured, so nothing was proved.
    cannotRun(options);
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
      // `--root` points at somebody else's checkout, which the design
      // registries do not describe; without `--root` head IS this
      // repository. Tracked as a flag rather than compared as a path,
      // because a symlinked root would make the comparison say "not
      // us" and silently switch three hard gates off.
      repository: !options.foreignRoot,
    });
    const floor = measuredNothing(head);
    if (floor !== undefined) {
      cannotRun(floor);
      return;
    }
    let base: Snapshot | undefined = undefined;
    if (options.base !== undefined) {
      baseDirectory = materialize({
        revision: options.base,
        prefix: "metrics-base-",
        install: false,
      });
      base = await measure({
        directory: baseDirectory,
        label: options.base,
        configPath,
        // An archived revision predates whatever the registries say
        // today; it supplies the ratchets' left-hand column and
        // nothing else.
        repository: false,
      });
    }
    // Measured BEFORE the report/JSON fork, and gated after it: the
    // scorecard's gates do not depend on which way it was asked to
    // print, and `--json` must not be a way to skip one. Printing is
    // the caller's, so `--json` stays machine-readable.
    const unread = await unreadFields(options.foreignRoot);
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ base, head }, undefined, JSON_INDENT)}\n`,
      );
    } else {
      printTable(head, base);
      printOffenders(head);
      printContractNote(head);
      // Late import for the same reason the census GATE is imported
      // late below: `shape-census.ts` statically imports
      // `src/parse/line-shapes.js`, so an emptied `src` would make the
      // whole scorecard fail to LOAD.
      await printCensus(options.foreignRoot);
      process.stdout.write(unread.report);
    }
    const failures = [...gateFailures(head, base), ...unread.failures];
    // The shape census reads THIS repository's registry and
    // line-shapes module (live imports), so a foreign --root checkout
    // is measured and not judged by it — same stance as the other
    // hand-maintained registries (metrics/gates.ts).
    //
    // Imported HERE rather than at the top of the file, and this is
    // load-bearing: `shape-census.ts` imports `src/parse/line-shapes.js`
    // statically, so a missing or emptied `src` makes the whole
    // scorecard fail to LOAD — before `main` runs, with a module
    // resolution error and exit 1, which reads as a failing gate. The
    // late import puts that failure after the floor above, where it
    // becomes the 2 it is.
    if (!options.foreignRoot) {
      const { shapeCensusFailures } = await import("./metrics/shape-census.js");
      failures.push(...shapeCensusFailures());
      const { inlineCensusFailures } = await import("./inline-census.js");
      failures.push(...inlineCensusFailures());
    }
    if (failures.length > ZERO) {
      process.stderr.write(`${failures.join("\n")}\n`);
      process.exitCode = GATE_FAILED;
    }
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
    if (baseDirectory !== undefined) {
      rmSync(baseDirectory, { recursive: true, force: true });
    }
  }
}

try {
  await main();
} catch (error) {
  // Everything that reaches here failed to MEASURE: an unknown
  // `--base` that `git archive` refused, a tool that would not start.
  // None of it is evidence about the code, so it is a 2.
  cannotRun(error instanceof Error ? error.message : String(error));
}
