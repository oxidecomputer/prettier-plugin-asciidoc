#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * The reading-ledger runner (issue #58). Sweeps the list-shape
 * product at `DEEP_DEPTH` for REFLOW RE-CLASSIFICATION violations -
 * documents whose formatted output re-reads differently from their
 * source, see tests/lib/reading.ts - reports them grouped by
 * mechanism family, and with --write regenerates
 * tests/format/reading-ledger.json.
 *
 * The ledger is what the list-shape sweep entry gates against, twice
 * over: its violating set against the rows this product spells, and
 * that restriction against the whole file. Refreshing it is therefore
 * how a mechanism fix gets PINNED - the fixing commit shrinks the
 * ledger and says which family it emptied.
 *
 * It also runs the TRACE-FIDELITY self-check on every swept document
 * (`untracedLines`): the projection's last-wins-per-offset trace
 * assumes every line the reader acts on leaves a verdict, and silent
 * under-tracing would make the net quietly weaker rather than red.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the sweep ran, 2 it could not
 * run - a product too small to be the sweep's, an untraced line, or a
 * violation whose signature matches no declared mechanism. There is no
 * 1: the violating set is the REPORT, not a gate; the gate over it is
 * the ledger, which the sweep entry checks.
 */
import { cannotRun, printUsage, wantsHelp } from "./lib/cli.js";
import { writeLedgerFile } from "./lib/ledger-file.js";
import {
  DEEP_DEPTH,
  readingFailures,
  sweepDocuments,
} from "../tests/format/list-shape-sweep.js";
import { untracedLines } from "../tests/lib/reading.js";
import {
  READING_FAMILIES,
  READING_LEDGER_PATH,
  UNCLASSIFIED,
  type ReadingLedgerRow,
} from "../tests/lib/reading-ledger.js";

const USAGE = `usage: bun run reading-ledger [--write]

  --write  regenerate ${READING_LEDGER_PATH} from this sweep
  --help   this text

exit: 0 the sweep ran, 2 it could not run`;

const ARGUMENT_START = 2;
if (wantsHelp(process.argv.slice(ARGUMENT_START))) {
  printUsage(USAGE);
  process.exit();
}

const write = process.argv.includes("--write");

/**
 * The measured-nothing floor. A product that did not spell is a sweep
 * that swept nothing, and with `--write` it would rewrite the ledger
 * to empty - every pin the sweep entry's two gates hold, deleted by a
 * green run.
 */
const MINIMUM_DOCUMENTS = 1000;

/** How many example documents a family's report block prints. */
const SAMPLE_SIZE = 3;

const documents = sweepDocuments(DEEP_DEPTH);
if (documents.length < MINIMUM_DOCUMENTS) {
  cannotRun(
    `reading-ledger: the depth-${String(DEEP_DEPTH)} product spelled ${String(documents.length)} document(s) - nothing was swept`,
  );
  process.exit(process.exitCode);
}

// The trace-fidelity self-check, over the same product: every
// non-blank line outside a delimited extent and a literal body must
// carry a verdict, be marker-shaped or be a lone `+`. See
// `untracedLines` for the bound this runs under.
const untraced: string[] = [];
for (const document_ of documents) {
  const missed = untracedLines(document_);
  if (missed.length > 0) {
    untraced.push(`${JSON.stringify(document_)} :: ${JSON.stringify(missed)}`);
  }
}

const rows = await readingFailures();
const byFamily = new Map<string, ReadingLedgerRow[]>();
for (const row of rows) {
  const found = byFamily.get(row.family) ?? [];
  found.push(row);
  byFamily.set(row.family, found);
}

console.log(
  `${String(documents.length)} documents, ${String(rows.length)} reading violation(s).\n`,
);
for (const [family, found] of [...byFamily].toSorted(([left], [right]) =>
  left.localeCompare(right),
)) {
  const issue = Object.hasOwn(READING_FAMILIES, family)
    ? READING_FAMILIES[family].issue
    : "UNDECLARED";
  console.log(`[${family} ${issue}] ${String(found.length)} row(s)`);
  const signatures = new Map<string, number>();
  for (const row of found) {
    signatures.set(row.signature, (signatures.get(row.signature) ?? 0) + 1);
  }
  for (const [signature, count] of signatures) {
    console.log(`  ${String(count)}x ${signature}`);
  }
  for (const row of found.slice(0, SAMPLE_SIZE)) {
    console.log(`  ${row.pass} ${JSON.stringify(row.document)}`);
  }
  console.log("");
}

// Both of these are "the harness could not run", not "the gate
// failed": an untraced line means the projection measured LESS than
// it thinks it did, and an unclassified signature means a mechanism
// nobody has named is in the inventory. Either way the number below
// is not one to write into a ledger.
const unclassified = byFamily.get(UNCLASSIFIED) ?? [];
if (untraced.length > 0) {
  cannotRun(
    `reading-ledger: ${String(untraced.length)} document(s) have lines the trace did not account for - the reader classifies less than the projection assumes:\n  ${untraced.slice(0, SAMPLE_SIZE).join("\n  ")}`,
  );
} else if (unclassified.length > 0) {
  cannotRun(
    `reading-ledger: ${String(unclassified.length)} violation(s) match no declared mechanism - name the family in tests/lib/reading-ledger.ts and file its issue:\n  ${unclassified
      .slice(0, SAMPLE_SIZE)
      .map((row) => `${row.signature} :: ${JSON.stringify(row.document)}`)
      .join("\n  ")}`,
  );
} else if (write) {
  const ledger = {
    note: `Generated by \`bun run reading-ledger --write\`. Every sweep document whose formatted output re-reads differently from its source (issue #58); see tests/lib/reading-ledger.ts for the family enumeration and docs/harnesses.md for the workflow. Measured over the depth-${String(DEEP_DEPTH)} list-shape product; the sweep entry gates set equality against the rows that product spells, and set equality of that restriction against this whole file. This file SHRINKS: the commit that fixes a mechanism empties its family and says so.`,
    rows,
  };
  await writeLedgerFile(READING_LEDGER_PATH, ledger);
  console.log(`Wrote ${String(rows.length)} row(s) to ${READING_LEDGER_PATH}.`);
}
