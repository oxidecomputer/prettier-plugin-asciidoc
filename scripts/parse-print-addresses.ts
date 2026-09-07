#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * How many places the printer reaches into the parser, counted from
 * the two files that already know: the layer rule that allows them
 * and the crossings registry that records them.
 *
 * WHY COUNT IT. `src/print` may not read `src/parse`'s interior, but
 * it must agree with it about spellings it has to reproduce, so a
 * short list of deliberate ADDRESSES is allowed: today
 * `line-shapes.ts` for what a re-parsed line means, `attrlist.ts` for
 * where one attribute inside a bracket line ends,
 * `inline/quote-boundaries.ts` for what may stand beside a
 * constrained mark, and `inline/rules.ts` for how far a bare
 * address's match carries. Four. Each one is a place where the two
 * halves have to be kept in agreement by hand, so the number is the
 * cost of the arrangement, and a change that adds a fifth should have
 * to say so out loud.
 *
 * WHY IT IS TWO SOURCES AND NOT ONE. The layer rule
 * (`scripts/metrics/graph.ts`) says which addresses are ALLOWED; the
 * crossings registry (`scripts/metrics/crossings-registry.json`) says
 * which are USED, with the symbol and the reason. Either can rot on
 * its own: an address stays allowed after its last import goes, or a
 * crossing is registered at a path the rule would refuse. This holds
 * the two to each other, which is a question neither file can ask
 * about itself.
 *
 * WHAT IT COUNTS is those two DECLARATIONS, not the imports
 * themselves. A printer file that imports a fifth parse module while
 * touching neither file passes here and fails the graph gate in
 * `bun run metrics`, which reads the real import edges; the two gates
 * answer different halves of the question and both are run.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the count is what it is pinned
 * at and the two sources agree, 1 they do not, 2 the harness could
 * not run - a bad argument, or a source it could not read the
 * addresses out of at all.
 */
import { readFileSync } from "node:fs";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import { isArray, isObject } from "./metrics/json.js";

const USAGE = `usage: bun run parse-print-addresses

  --help  this text

exit: 0 the addresses are what they are pinned at, 1 they are not, 2 it could not run`;

const ARGUMENT_START = 2;
const argv = process.argv.slice(ARGUMENT_START);
if (wantsHelp(argv)) {
  printUsage(USAGE);
  process.exit();
}

/** The file whose layer rule says which addresses are allowed. */
const GRAPH_FILE = "scripts/metrics/graph.ts";

/** The file that records every registered cross-directory import. */
const REGISTRY_FILE = "scripts/metrics/crossings-registry.json";

/**
 * How many addresses stand today.
 *
 * The number is pinned rather than reported because it is a budget
 * somebody argued for. The direction of travel is DOWN: the reader
 * recording at parse time what the printer now re-derives would take
 * `inline/quote-boundaries.ts` and `inline/rules.ts` off this list and
 * leave one shared module both halves read, which is three plus a
 * shared home rather than four reaches into the parser. Moving the
 * pin is the moment to say which of those two happened.
 */
const PINNED_ADDRESSES = 4;

/**
 * The addresses the layer rule allows, read out of its own pattern so
 * this harness cannot hold a second list that disagrees with the gate.
 * @param source - the text of the graph module
 * @returns the allowed parse-side paths, or undefined when the
 *   pattern is not where this expects it
 */
function allowedAddresses(source: string): string[] | undefined {
  const rule = /src\/parse\/\((?<names>[^\)]+)\)\\\.ts\$/v.exec(source);
  const names = rule?.groups?.names;
  if (names === undefined) {
    return undefined;
  }
  return names.split("|").map((name) => `src/parse/${name}.ts`);
}

/** One registered import from `src/print` into `src/parse`. */
interface Crossing {
  /** The parse-side module: the address. */
  readonly file: string;
  /** The symbol the printer reads. */
  readonly symbol: string;
  /** The print-side module doing the reading. */
  readonly importer: string;
}

/**
 * The registered print-to-parse crossings.
 * @param text - the registry file's text
 * @returns the crossings, or undefined when the registry did not
 *   parse as the list of objects it is supposed to be
 */
function registeredCrossings(text: string): Crossing[] | undefined {
  const parsed: unknown = JSON.parse(text);
  if (!isArray(parsed)) {
    return undefined;
  }
  const rows: Crossing[] = [];
  for (const row of parsed) {
    if (!isObject(row)) {
      return undefined;
    }
    const { file, symbol, importer } = row;
    if (
      typeof file !== "string" ||
      typeof symbol !== "string" ||
      typeof importer !== "string"
    ) {
      return undefined;
    }
    if (file.startsWith("src/parse/") && importer.startsWith("src/print/")) {
      rows.push({ file, symbol, importer });
    }
  }
  return rows;
}

if (argv.length > 0) {
  cannotRun(`unknown argument: ${argv.join(" ")}`);
} else {
  const allowed = allowedAddresses(readFileSync(GRAPH_FILE, "utf8"));
  const crossings = registeredCrossings(readFileSync(REGISTRY_FILE, "utf8"));
  if (allowed === undefined) {
    cannotRun(
      `${GRAPH_FILE} carries no print-to-parse address pattern, so this harness read no addresses at all`,
    );
  } else if (crossings === undefined) {
    cannotRun(`${REGISTRY_FILE} did not parse as a list of crossings`);
  } else {
    const used = new Map<string, Crossing[]>();
    for (const crossing of crossings) {
      used.set(crossing.file, [...(used.get(crossing.file) ?? []), crossing]);
    }
    for (const address of allowed.toSorted()) {
      const rows = used.get(address) ?? [];
      const symbols = [...new Set(rows.map((row) => row.symbol))].toSorted();
      console.log(
        `${address}: ${String(symbols.length)} symbol(s), ${String(rows.length)} import(s) - ${symbols.join(", ")}`,
      );
    }
    const failures: string[] = [];
    for (const address of allowed) {
      if (!used.has(address)) {
        failures.push(
          `${address} is an allowed address that nothing in src/print imports; the rule outlives its reason`,
        );
      }
    }
    for (const address of used.keys()) {
      if (!allowed.includes(address)) {
        failures.push(
          `${address} is a registered crossing at an address the layer rule refuses`,
        );
      }
    }
    if (allowed.length !== PINNED_ADDRESSES) {
      failures.push(
        `the printer reaches into the parser at ${String(allowed.length)} addresses, pinned at ${String(PINNED_ADDRESSES)}`,
      );
    }
    console.log(
      `parse-print addresses: ${String(allowed.length)} (pinned ${String(PINNED_ADDRESSES)}), ${String(crossings.length)} registered imports`,
    );
    if (failures.length > 0) {
      for (const failure of failures) {
        console.error(failure);
      }
      process.exitCode = GATE_FAILED;
    }
  }
}
