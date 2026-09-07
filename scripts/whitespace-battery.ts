#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * The whitespace battery: what a formatter is allowed to do to a
 * whitespace run, measured rather than reasoned about.
 *
 * Every position in three populations is rendered four ways (one
 * space, two spaces, a tab, a newline) through BOTH programs that
 * claim to be Asciidoctor, under the exact fold the conformance
 * harness uses, and the four results are partitioned into
 * equivalence classes. A position whose four renders are one class
 * is free: the printer may spell that run however it likes. Any
 * other partition is a fact the printer has to carry, and the ledger
 * is where those facts are written down.
 *
 * WHY BOTH PROGRAMS. The registries cite Asciidoctor's Ruby; every
 * harness renders through `@asciidoctor/core`, which is a rewrite of
 * that Ruby rather than a transpile of it. Where they agree the
 * result binds. Where they disagree the ledger records the place, and
 * the row is about the instrument rather than about AsciiDoc.
 *
 * WHY THREE POPULATIONS. The template roster measures constructs a
 * person chose, so it can only find what somebody thought to write
 * down. The tracker witnesses measure the documents this project
 * already knows it gets wrong. The registry grid measures shapes
 * nobody wrote by hand at all. A binding row that shows up in all
 * three is a fact about AsciiDoc; one that shows up only in the
 * roster is a fact about the roster.
 *
 * BATCHED, not per push: the reference is a developer prerequisite
 * rather than a CI dependency, the way mutation testing is.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the run agreed with the
 * ledger, 1 it did not, 2 it could not run - a bad argument, a
 * missing Ruby gem, a program at a version the ledger was not
 * measured against, or a population that measured nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { oracleVersion } from "./block-structure-ledger.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import {
  referenceRenders,
  referenceVersion,
  type ReferenceCase,
} from "./lib/reference-runner.js";
import {
  entryOf,
  ledgerDifferences,
  loadLedger,
  rowOf,
  LEDGER_PATH,
  type Ledger,
  type Measured,
  type PopulationLedger,
  type PositionRow,
} from "./lib/whitespace-ledger.js";
import { partitionOf } from "./lib/whitespace-perturbation.js";
import {
  harvestWitnesses,
  POPULATIONS,
  population,
  WITNESSES_PATH,
  type IssueBody,
  type PopulationName,
} from "./lib/whitespace-populations.js";
import { renderedHtml } from "../tests/helpers.js";

const USAGE = `usage: bun run whitespace-battery [--population <name>] [--write]
       bun run whitespace-battery --harvest-witnesses <issues.json>

  --population <name>         measure one of: ${POPULATIONS.join(", ")} (default: all)
  --write                     rewrite ${LEDGER_PATH} from this run
  --harvest-witnesses <file>  re-cut ${WITNESSES_PATH} from a tracker dump
                              (gh issue list --state open --label tier-1
                               --json number,body > <file>)
  --help                      this text

exit: 0 the run agreed with the ledger, 1 it did not, 2 it could not run`;

const ARGUMENT_START = 2;
const argv = process.argv.slice(ARGUMENT_START);
if (wantsHelp(argv)) {
  printUsage(USAGE);
  process.exit();
}

/** How many differing rows the report prints before eliding. */
const REPORTED_DIFFERENCES = 20;

/** What the command line asked for, or what was wrong with it. */
type Command =
  | {
      /** Measure populations and compare, or rewrite the ledger. */
      readonly kind: "measure";
      /** The populations to measure. */
      readonly names: PopulationName[];
      /** Whether to rewrite the ledger from this run. */
      readonly write: boolean;
    }
  | {
      /** Re-cut the witness fixture and measure nothing. */
      readonly kind: "harvest";
      /** The tracker dump to cut it from. */
      readonly file: string;
    }
  | {
      /** The command line was not one this script knows. */
      readonly kind: "error";
      /** What was wrong with it. */
      readonly message: string;
    };

/**
 * Reads the command line, refusing anything it does not know: a
 * silently dropped `--population` would pin one population's rows
 * over a ledger that holds three.
 * @param arguments_ - the arguments after the script name
 * @returns what to do, or what was wrong with the command line
 */
function parse(arguments_: readonly string[]): Command {
  let names: PopulationName[] = [...POPULATIONS];
  let write = false;
  let harvestFrom = "";
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--write") {
      write = true;
      continue;
    }
    if (argument === "--harvest-witnesses") {
      index += 1;
      const file = arguments_.at(index);
      if (file === undefined || file.startsWith("--")) {
        return {
          kind: "error",
          message: "--harvest-witnesses needs a file of issue bodies",
        };
      }
      harvestFrom = file;
      continue;
    }
    if (argument === "--population") {
      index += 1;
      const value = arguments_.at(index);
      const known = POPULATIONS.find((name) => name === value);
      if (known === undefined) {
        return {
          kind: "error",
          message: `unknown population: ${String(value)}`,
        };
      }
      names = [known];
      continue;
    }
    return { kind: "error", message: `unknown argument: ${argument}` };
  }
  if (harvestFrom === "") {
    return { kind: "measure", names, write };
  }
  return { kind: "harvest", file: harvestFrom };
}

/**
 * Renders one population through both programs.
 *
 * The oracle renders in this process and the reference renders in
 * one Ruby process for the whole population; the two see the same
 * bytes because both read the same generated case list, with no
 * transcription in between.
 * @param name - the population to measure
 * @returns the measured positions and the scan's skip counts, or a
 *   message saying why nothing could be measured
 */
async function measure(
  name: PopulationName,
): Promise<{ rows: PositionRow[]; entry: PopulationLedger } | string> {
  const { positions, totals } = population(name);
  if (positions.length === 0) {
    return `${name}: measured no positions`;
  }
  const cases: ReferenceCase[] = positions.flatMap((slot) => [...slot.cases]);
  const reference = referenceRenders(cases, "lens");
  if (reference === undefined) {
    return "the reference (Asciidoctor Ruby gem) did not run";
  }
  const oracle = new Map<string, string>();
  for (const slot of positions) {
    if (slot.position.referenceOnly) {
      continue;
    }
    for (const one of slot.cases) {
      // eslint-disable-next-line no-await-in-loop -- sequential on purpose: the render is CPU-bound on this thread, so overlapping buys no wall time
      oracle.set(one.id, await renderedHtml(one.src));
    }
  }
  const measured: Measured[] = positions.map((slot) => ({
    id: slot.position.id,
    group: slot.position.group,
    reference: slot.cases.map((one) => reference.get(one.id) ?? ""),
    oracle: slot.position.referenceOnly
      ? undefined
      : slot.cases.map((one) => oracle.get(one.id) ?? ""),
  }));
  const rows = measured.map((one) => rowOf(one, partitionOf));
  return { rows, entry: entryOf(name, rows, totals) };
}

/**
 * Prints one population's headline, so a run says what it saw even
 * when it agrees with the ledger.
 * @param name - the population's name
 * @param entry - what this run measured
 */
function report(name: PopulationName, entry: PopulationLedger): void {
  const { counts } = entry;
  console.log(
    `${name}: ${String(counts.positions)} positions, ${String(counts.cases)} cases, ` +
      `${String(counts.free)} free (${String(counts.freeButInstrumentBound)} of them bound in the instrument), ` +
      `length ${String(counts.lengthBound)}, ` +
      `tab ${String(counts.tabBound)}, newline ${String(counts.newlineBound)}, ` +
      `programs differ ${String(counts.programsDiffer)}`,
  );
}

/**
 * Why this machine cannot measure anything the ledger could be
 * compared against.
 *
 * Both programs are pinned by version, because a bumped gem or a
 * bumped package moves rows: a comparison against a ledger measured
 * by other programs proves nothing either way, which is exactly the
 * condition exit 2 exists for.
 * @param ledger - the pinned ledger, whose header names both versions
 * @returns the complaint, or undefined when both versions match
 */
function versionComplaint(ledger: Ledger): string | undefined {
  const installed = referenceVersion();
  if (installed === undefined) {
    return "the reference (Asciidoctor Ruby gem) is not installed; set ASCIIDOCTOR_LIB or install it";
  }
  if (installed !== ledger.reference) {
    return `the ledger was measured against reference ${ledger.reference}, this machine has ${installed}`;
  }
  if (oracleVersion() !== ledger.oracle) {
    return `the ledger was measured against oracle ${ledger.oracle}, this checkout has ${oracleVersion()}`;
  }
  return undefined;
}

/**
 * Compares a run against the pinned ledger and sets the exit code.
 *
 * Only the populations this run measured are compared, so
 * `--population` narrows the gate rather than failing on the two it
 * was told not to measure.
 * @param fresh - what this run measured
 * @param ledger - the pinned ledger
 * @param names - the populations this run measured
 */
function compare(
  fresh: Readonly<Record<string, PopulationLedger>>,
  ledger: Ledger,
  names: readonly PopulationName[],
): void {
  const pinned = Object.fromEntries(
    names.map((name) => [name, ledger.populations[name]]),
  );
  const differences = ledgerDifferences(fresh, pinned);
  if (differences.length === 0) {
    console.log(`agrees with ${LEDGER_PATH}`);
    return;
  }
  for (const line of differences.slice(0, REPORTED_DIFFERENCES)) {
    console.error(line);
  }
  if (differences.length > REPORTED_DIFFERENCES) {
    console.error(
      `... and ${String(differences.length - REPORTED_DIFFERENCES)} more`,
    );
  }
  console.error(
    `${String(differences.length)} differences from ${LEDGER_PATH}; rerun with --write once each one is understood`,
  );
  process.exitCode = GATE_FAILED;
}

/**
 * Measures every named population, stopping at the first one that
 * could not be measured.
 * @param names - the populations to measure, in order
 * @returns the entries keyed by population name, or a message saying
 *   why the run measured nothing
 */
async function measureAll(
  names: readonly PopulationName[],
): Promise<Record<string, PopulationLedger> | string> {
  const fresh: Record<string, PopulationLedger> = {};
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop -- one population at a time: each holds tens of thousands of renders and its own Ruby process
    const result = await measure(name);
    if (typeof result === "string") {
      return result;
    }
    fresh[name] = result.entry;
    report(name, result.entry);
  }
  return fresh;
}

/**
 * Rewrites the ledger with the populations this run measured,
 * leaving the ones it did not measure as they stand.
 * @param ledger - the ledger as it was read
 * @param fresh - what this run measured
 */
function write(
  ledger: Ledger,
  fresh: Readonly<Record<string, PopulationLedger>>,
): void {
  const populations = { ...ledger.populations, ...fresh };
  writeFileSync(
    LEDGER_PATH,
    `${JSON.stringify({ ...ledger, populations }, undefined, 2)}\n`,
  );
  console.log(`wrote ${LEDGER_PATH}`);
}

/**
 * Re-cuts the witness fixture from a tracker dump.
 *
 * The population is a snapshot on purpose: a gate that read the
 * tracker would measure a different population every day. This is the
 * cut, in the tree, so the snapshot can be taken again when the
 * issues it came from move.
 * @param file - a `gh issue list --json number,body` dump
 */
function harvest(file: string): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a tracker dump this run was pointed at; a file that is not one fails the emptiness check below
  const issues = JSON.parse(readFileSync(file, "utf8")) as IssueBody[];
  const witnesses = harvestWitnesses(issues);
  if (witnesses.length === 0) {
    cannotRun(
      `${file} yielded no witness documents; it is not a tracker dump of issue bodies`,
    );
    return;
  }
  writeFileSync(WITNESSES_PATH, `${JSON.stringify(witnesses, undefined, 2)}\n`);
  const issueCount = new Set(witnesses.map((one) => one.issue)).size;
  console.log(
    `wrote ${WITNESSES_PATH}: ${String(witnesses.length)} documents from ${String(issueCount)} issues`,
  );
}

const parsed = parse(argv);
switch (parsed.kind) {
  case "error": {
    cannotRun(parsed.message);
    break;
  }
  case "harvest": {
    harvest(parsed.file);
    break;
  }
  case "measure": {
    const ledger = loadLedger();
    const complaint = versionComplaint(ledger);
    if (complaint === undefined) {
      const measured = await measureAll(parsed.names);
      if (typeof measured === "string") {
        cannotRun(measured);
      } else if (parsed.write) {
        write(ledger, measured);
      } else {
        compare(measured, ledger, parsed.names);
      }
    } else {
      cannotRun(complaint);
    }
    break;
  }
}
