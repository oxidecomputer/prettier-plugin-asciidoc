#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * The reparse-ledger runner. Formats every document in the standing
 * populations, hands the output back to the reader we already own,
 * compares the two documents through the declared lens
 * (tests/conformance/reparse.ts), reports the breaches grouped by
 * mechanism, and with --write regenerates
 * tests/conformance/reparse-ledger.json.
 *
 * The measurement `src/print` does not make. Half of `src/print`
 * exists to PREDICT what the bytes it is about to write will re-read
 * as; this asks. Nothing here changes what the formatter does, and
 * nothing here is consulted at print time: it is the instrument, and
 * the ledger it writes is the baseline a later printer change diffs
 * against.
 *
 * A REPORT, not a gate. There is no exit 1: the breaching set is the
 * finding, and the gate over it is the ledger, which
 * tests/conformance/reparse.test.ts checks for set equality. Exit 2
 * is for the two ways the measurement itself is void - a population
 * that did not load, and a breach matching no declared mechanism.
 *
 * Exit codes (scripts/lib/cli.ts): 0 the sweep ran, 2 it could not.
 */
import { writeFileSync } from "node:fs";
import { format } from "prettier";
import { cannotRun, printUsage, wantsHelp } from "./lib/cli.js";
import { reparseOutcomeOf } from "../tests/conformance/reparse.js";
import {
  MINIMUM_POPULATION,
  REPARSE_FAMILIES,
  REPARSE_LEDGER_PATH,
  UNCLASSIFIED,
  reparseFamily,
  deepTierCases,
  sortedRows,
  type ReparseLedgerRow,
} from "../tests/conformance/reparse-ledger.js";

const USAGE = `usage: bun run reparse-ledger [--write]

  --write  regenerate ${REPARSE_LEDGER_PATH} from this run
  --help   this text

exit: 0 the sweep ran, 2 it could not run`;

const ARGUMENT_START = 2;
if (wantsHelp(process.argv.slice(ARGUMENT_START))) {
  printUsage(USAGE);
  process.exit();
}

const write = process.argv.includes("--write");

/** How many example rows a family's report block prints. */
const SAMPLE_SIZE = 3;

/** How much of a signature the report prints before eliding it. */
const SIGNATURE_WIDTH = 220;

const population = deepTierCases();
if (population.length < MINIMUM_POPULATION) {
  cannotRun(
    `reparse-ledger: the populations spelled ${String(population.length)} document(s) - nothing was measured`,
  );
  process.exit(process.exitCode);
}

const rows: ReparseLedgerRow[] = [];
for (const one of population) {
  // eslint-disable-next-line no-await-in-loop -- one document at a time: both formatter calls are CPU-bound on this thread, so overlapping buys no wall time and makes a slow row harder to find
  const outcome = await reparseOutcomeOf(one.source);
  for (const breach of outcome.breaches) {
    rows.push({
      id: one.id,
      pass: breach.pass,
      signature: breach.signature,
      family:
        reparseFamily({
          source: one.source,
          once: outcome.once,
          signature: breach.signature,
        }) ?? UNCLASSIFIED,
    });
  }
}

const byFamily = new Map<string, ReparseLedgerRow[]>();
for (const row of rows) {
  const found = byFamily.get(row.family) ?? [];
  found.push(row);
  byFamily.set(row.family, found);
}

console.log(
  `${String(population.length)} documents, ${String(rows.length)} reparse breach(es).\n`,
);
// Code units, not `localeCompare`: every ordered output in this
// repository sorts that way (see `compareIds`,
// tests/conformance/loader.ts), because a locale-dependent order
// makes one contributor's report a noisy diff of another's.
for (const [family, found] of [...byFamily].toSorted(([left], [right]) =>
  left < right ? -1 : Number(left > right),
)) {
  const issue = Object.hasOwn(REPARSE_FAMILIES, family)
    ? REPARSE_FAMILIES[family].issue
    : "UNDECLARED";
  console.log(`[${family} ${issue}] ${String(found.length)} row(s)`);
  for (const row of found.slice(0, SAMPLE_SIZE)) {
    console.log(`  ${row.pass} ${row.id}`);
    console.log(`    ${elide(row.signature)}`);
  }
  console.log("");
}

/**
 * A signature short enough to read in a terminal.
 * @param signature - the projection diff
 * @returns the signature, elided if long
 */
function elide(signature: string): string {
  return signature.length > SIGNATURE_WIDTH
    ? `${signature.slice(0, SIGNATURE_WIDTH)} ...`
    : signature;
}

// "The harness could not run", not "the gate failed": a breach whose
// mechanism nobody has named is not a number to write into a ledger,
// because a ledger row is a claim about a mechanism and this one
// makes none.
const unclassified = byFamily.get(UNCLASSIFIED) ?? [];
if (unclassified.length > 0) {
  cannotRun(
    `reparse-ledger: ${String(unclassified.length)} breach(es) match no declared mechanism - name the family in tests/conformance/reparse-ledger.ts and file its issue:\n  ${unclassified
      .slice(0, SAMPLE_SIZE)
      .map((row) => `${row.id} :: ${elide(row.signature)}`)
      .join("\n  ")}`,
  );
} else if (write) {
  const ledger = {
    note: `Generated by \`bun run reparse-ledger --write\`. Every document in the standing populations whose formatted output re-reads as a different document; see tests/conformance/reparse.ts for the lens and tests/conformance/reparse-ledger.ts for the family enumeration. tests/conformance/reparse.test.ts gates set equality against it. This file SHRINKS: the commit that fixes a mechanism empties its family and says so.`,
    rows: sortedRows(rows),
  };
  // Prettier-normal form so `fmt:check` passes immediately after a
  // --write, instead of failing until someone runs `bun run fmt`.
  writeFileSync(
    REPARSE_LEDGER_PATH,
    await format(JSON.stringify(ledger), { parser: "json" }),
  );
  console.log(`Wrote ${String(rows.length)} row(s) to ${REPARSE_LEDGER_PATH}.`);
}
