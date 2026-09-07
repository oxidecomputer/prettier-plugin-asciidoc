#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * The instrument against the reference: every vendored corpus
 * document rendered through Asciidoctor's Ruby gem and through
 * `@asciidoctor/core`, normalized the way two converters have to be,
 * and every difference pinned by case id and family.
 *
 * WHY IT IS A HARNESS AND NOT A NOTE. The registries in `src/parse`
 * cite the Ruby; every conformance assertion renders through the
 * JavaScript. Those are the same claim only if the two programs read
 * documents alike, and the JavaScript is a rewrite of the Ruby rather
 * than a transpile of it (its own README says so). Four divergences
 * were already recorded in prose before this ran. This measures the
 * rest.
 *
 * WHAT THE LEDGER IS FOR. Rows in the `reading` family are the ones
 * that matter: the two programs read the document differently, and
 * one of them is wrong. The other families are converter spellings,
 * and they are in the ledger so that a new one cannot hide among
 * them. `instrumentFidelity` holds the rows somebody has since read
 * out of both sources, with the verdict and the two source lines.
 *
 * BATCHED, not per push: the Ruby gem is a developer prerequisite,
 * not a CI dependency.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 the run agreed with the
 * ledger, 1 it did not, 2 it could not run - a bad argument, a
 * missing gem, a program at a version the ledger was not measured
 * against, or a corpus that did not load.
 */
import { writeFileSync } from "node:fs";
import { oracleVersion } from "./block-structure-ledger.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import {
  familyOf,
  isReadingFamily,
  verdictOf,
  loadReferenceDiffLedger,
  normalizeForComparison,
  MINIMUM_DOCUMENTS,
  NOT_A_READING,
  REFERENCE_DIFF_LEDGER_PATH,
  REFUSED,
  type DiffRow,
  type ReferenceDiffLedger,
} from "./lib/reference-diff.js";
import {
  referenceRenders,
  referenceVersion,
  type ReferenceCase,
} from "./lib/reference-runner.js";
import { loadCorpus } from "../tests/conformance/loader.js";
import { oracleHtml } from "../tests/helpers.js";

const USAGE = `usage: bun run reference-diff [--write]

  --write  rewrite ${REFERENCE_DIFF_LEDGER_PATH} from this run
  --help   this text

exit: 0 the run agreed with the ledger, 1 it did not, 2 it could not run`;

const ARGUMENT_START = 2;
const argv = process.argv.slice(ARGUMENT_START);
if (wantsHelp(argv)) {
  printUsage(USAGE);
  process.exit();
}

/** How many differing ids the report prints before eliding. */
const REPORTED_ROWS = 20;

/**
 * The oracle's HTML for one document, or the refusal constant.
 *
 * A refusal is a result here, not a crash: a harness that stops at
 * the first document one program will not convert measures nothing
 * about the rest of the corpus.
 * @param source - the document
 * @returns the rendered HTML, or {@link REFUSED}
 */
async function oracleOrRefusal(source: string): Promise<string> {
  try {
    return await oracleHtml(source);
  } catch {
    return REFUSED;
  }
}

/**
 * Renders the whole corpus through both programs and reports the
 * differences.
 * @param referenceVersionString - the gem's version, neutralized in
 *   its own output so the version pin does not become a row
 * @param oracleVersionString - the same for the instrument
 * @returns the differing rows and the document count, or a message
 *   saying why the run measured nothing
 */
async function run(
  referenceVersionString: string,
  oracleVersionString: string,
): Promise<{ rows: DiffRow[]; documents: number } | string> {
  const cases: ReferenceCase[] = loadCorpus().flatMap((group) =>
    group.cases.map((one) => ({ id: one.id, src: one.input, attrs: {} })),
  );
  if (cases.length < MINIMUM_DOCUMENTS) {
    return `the corpus loaded ${String(cases.length)} documents, fewer than the ${String(MINIMUM_DOCUMENTS)} this harness needs to have run at all`;
  }
  const reference = referenceRenders(cases, "render");
  if (reference === undefined) {
    return "the reference (Asciidoctor Ruby gem) did not run";
  }
  const rows: DiffRow[] = [];
  for (const one of cases) {
    const referenceHtml = reference.get(one.id) ?? "";
    const left = referenceHtml.startsWith("RENDER_ERROR:")
      ? REFUSED
      : normalizeForComparison(referenceHtml, referenceVersionString);
    // eslint-disable-next-line no-await-in-loop -- sequential on purpose: the render is CPU-bound on this thread, so overlapping buys no wall time
    const rendered = await oracleOrRefusal(one.src);
    const right =
      rendered === REFUSED
        ? REFUSED
        : normalizeForComparison(rendered, oracleVersionString);
    if (left !== right) {
      rows.push({
        id: one.id,
        family: familyOf(left, right).name,
        verdict: NOT_A_READING,
        why: "",
      });
    }
  }
  return { rows, documents: cases.length };
}

/**
 * One measured row with the verdict the ledger already carries for
 * it.
 *
 * A verdict is a reading of two sources, not a measurement, so it
 * survives a `--write` the way the fidelity rows do. It is carried
 * forward only while the row's FAMILY is unchanged: a row that moved
 * between families is a different claim and has to be judged again.
 * @param row - a row this run measured
 * @param ledger - the ledger as it stands
 * @returns the row with its pinned verdict, or unjudged
 */
function judged(row: DiffRow, ledger: ReferenceDiffLedger): DiffRow {
  if (!isReadingFamily(row.family)) {
    return { ...row, verdict: NOT_A_READING, why: "" };
  }
  const pinned = ledger.rows.find((one) => one.id === row.id);
  if (pinned?.family !== row.family) {
    return { ...row, verdict: "unjudged", why: "" };
  }
  return { ...row, verdict: verdictOf(pinned.verdict), why: pinned.why };
}

/**
 * The ledger entry a run produces, carrying forward the fidelity
 * rows, which are read out of two sources rather than measured.
 * @param ledger - the ledger as it stands
 * @param measured - this run's differing rows, before judgement
 * @param documents - how many documents ran
 * @returns the ledger this run would write
 */
function ledgerOf(
  ledger: ReferenceDiffLedger,
  measured: readonly DiffRow[],
  documents: number,
): ReferenceDiffLedger {
  const rows = measured.map((row) => judged(row, ledger));
  const byFamily: Record<string, number> = {};
  for (const row of rows) {
    byFamily[row.family] = (byFamily[row.family] ?? 0) + 1;
  }
  return {
    reference: ledger.reference,
    oracle: ledger.oracle,
    versionSkew: ledger.versionSkew,
    counts: {
      documents,
      identical: documents - rows.length,
      differing: rows.length,
      byFamily,
    },
    rows: rows.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    instrumentFidelity: ledger.instrumentFidelity,
  };
}

/**
 * The rows that appeared, vanished, or changed family since the
 * ledger was written, and the counts if they moved.
 * @param fresh - what this run would write
 * @param pinned - the ledger as it stands
 * @returns one line per difference, empty when they agree
 */
function movedRows(
  fresh: ReferenceDiffLedger,
  pinned: ReferenceDiffLedger,
): string[] {
  const before = new Map(pinned.rows.map((row) => [row.id, row.family]));
  const after = new Map(fresh.rows.map((row) => [row.id, row.family]));
  const lines: string[] = [];
  for (const [id, family] of after) {
    const was = before.get(id);
    if (was === undefined) {
      lines.push(`new difference: ${id} (${family})`);
    } else if (was !== family) {
      lines.push(`family moved: ${id} ${was} -> ${family}`);
    }
  }
  for (const [id, family] of before) {
    if (!after.has(id)) {
      lines.push(`gone: ${id} (${family})`);
    }
  }
  if (JSON.stringify(fresh.counts) !== JSON.stringify(pinned.counts)) {
    lines.push(
      `counts ${JSON.stringify(pinned.counts)} -> ${JSON.stringify(fresh.counts)}`,
    );
  }
  return lines;
}

/**
 * Compares a run against the pinned ledger, reports what moved and
 * what nobody has judged, and sets the exit code.
 * @param fresh - what this run would write
 * @param pinned - the ledger as it stands
 */
function compare(
  fresh: ReferenceDiffLedger,
  pinned: ReferenceDiffLedger,
): void {
  const lines = movedRows(fresh, pinned);
  for (const row of fresh.rows) {
    if (row.verdict === "unjudged") {
      lines.push(
        `unjudged reading difference: ${row.id}; read both programs' sources, then write the verdict and the reason into ${REFERENCE_DIFF_LEDGER_PATH}`,
      );
    }
  }
  if (lines.length === 0) {
    console.log(
      `agrees with ${REFERENCE_DIFF_LEDGER_PATH}; every reading difference is judged`,
    );
    return;
  }
  for (const line of lines.slice(0, REPORTED_ROWS)) {
    console.error(line);
  }
  if (lines.length > REPORTED_ROWS) {
    console.error(`... and ${String(lines.length - REPORTED_ROWS)} more`);
  }
  console.error(
    `${String(lines.length)} differences from ${REFERENCE_DIFF_LEDGER_PATH}; rerun with --write once each one is understood`,
  );
  process.exitCode = GATE_FAILED;
}

const write = argv.includes("--write");
const unknown = argv.find((argument) => argument !== "--write");
if (unknown === undefined) {
  const ledger = loadReferenceDiffLedger();
  const installed = referenceVersion();
  const oracle = oracleVersion();
  if (installed === undefined) {
    cannotRun(
      "the reference (Asciidoctor Ruby gem) is not installed; set ASCIIDOCTOR_LIB or install it",
    );
  } else if (installed !== ledger.reference || oracle !== ledger.oracle) {
    cannotRun(
      `the ledger was measured against ${ledger.reference} and ${ledger.oracle}; this machine has ${installed} and ${oracle}`,
    );
  } else {
    // The oracle's version is reported as "<package> <version>";
    // what appears in a render is the bare version, so that is what
    // is neutralized.
    const oracleBareVersion = oracle.slice(oracle.lastIndexOf(" ") + 1);
    const result = await run(installed, oracleBareVersion);
    if (typeof result === "string") {
      cannotRun(result);
    } else {
      const fresh = ledgerOf(ledger, result.rows, result.documents);
      console.log(
        `${String(fresh.counts.documents)} documents, ${String(fresh.counts.differing)} differ: ${Object.entries(
          fresh.counts.byFamily,
        )
          .map(([name, count]) => `${name} ${String(count)}`)
          .join(", ")}`,
      );
      const unjudged = fresh.rows.filter(
        (row) => row.verdict === "unjudged",
      ).length;
      if (unjudged > 0) {
        console.log(`${String(unjudged)} reading difference(s) unjudged`);
      }
      if (write) {
        writeFileSync(
          REFERENCE_DIFF_LEDGER_PATH,
          `${JSON.stringify(fresh, undefined, 2)}\n`,
        );
        console.log(`wrote ${REFERENCE_DIFF_LEDGER_PATH}`);
      } else {
        compare(fresh, ledger);
      }
    }
  }
} else {
  cannotRun(`unknown argument: ${unknown}`);
}
