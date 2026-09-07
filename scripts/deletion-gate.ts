#!/usr/bin/env bun
/* eslint-disable no-console -- runner script, not library code */

/**
 * What a change deleted from `src`, and whether it said why.
 *
 * The list is derived from the DIFF: the published names of the base
 * revision, minus the published names of this checkout. There is no
 * list of intended deletions anywhere - the change itself is the
 * question, and `scripts/deletions.json` has to answer it for every
 * name that went.
 *
 * WHY THE ANSWER IS SIX FIELDS. Nearly everything under `src/parse`
 * and `src/print` exists because a document rendered wrong once, and
 * the tree does not carry that reason. So an entry names the closed
 * issue, quotes its witness verbatim, names the measured row that
 * keeps the witness a fixed point without the deleted symbol, names
 * the test that reddens when that row's fact is flipped in one file,
 * says whether what is left is wider or narrower than today, and
 * names any change this one may not land without.
 * `scripts/lib/deletion-ledger.ts` argues each field.
 *
 * The base revision needs a git checkout to archive out of, which a
 * jj workspace with no colocated `.git` does not have; there the gate
 * exits 2 rather than reporting an empty deletion set, because
 * "nothing was deleted" and "I could not look" are the two answers the
 * exit-code contract exists to keep apart.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 every deletion is declared, 1
 * one is not (or a declaration is stale or unusable), 2 the gate
 * could not run - a bad argument, no `--base`, an unknown revision, or
 * a base checkout whose `src` published nothing.
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { materialize, REPO_ROOT } from "./lib/checkout.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import {
  deletionFailures,
  loadDeletions,
  DELETIONS_PATH,
} from "./lib/deletion-ledger.js";
import { publishedSymbols } from "./metrics/internal-surface.js";

const USAGE = `usage: bun run deletion-gate -- --base <rev>

  --base <rev>  the revision this change is measured against
  --help        this text

exit: 0 every deletion is declared, 1 one is not, 2 it could not run`;

const ARGUMENT_START = 2;
const argv = process.argv.slice(ARGUMENT_START);
if (wantsHelp(argv)) {
  printUsage(USAGE);
  process.exit();
}

/**
 * The floor that says the base checkout is this repository. A `src`
 * that published a handful of names is a checkout that did not
 * materialize, and every one of its names would read as a deletion.
 */
const MINIMUM_PUBLISHED = 100;

/** What the command line said, or what was wrong with it. */
type CommandLine =
  | {
      /** The revision this change is measured against. */
      readonly base: string;
    }
  | {
      /** What was wrong with the command line. */
      readonly error: string;
    };

/**
 * Reads the command line.
 * @param arguments_ - the arguments after the script name
 * @returns the base revision, or a message saying what was wrong
 */
function parse(arguments_: readonly string[]): CommandLine {
  const [flag, ...rest] = arguments_;
  if (flag !== "--base") {
    const got = arguments_.length === 0 ? "no arguments" : arguments_.join(" ");
    return { error: `expected --base <rev>, got ${got}` };
  }
  // `at` rather than an index: `--base` with nothing after it is a
  // command line somebody typed, and reading it as a string would
  // crash here rather than exiting 2 with the usage.
  const revision = rest.at(0);
  if (revision === undefined || revision.startsWith("--")) {
    return { error: "--base needs a revision" };
  }
  rest.shift();
  if (rest.length > 0) {
    return { error: `unknown argument: ${rest.join(" ")}` };
  }
  return { base: revision };
}

/**
 * Puts the base revision on disk, reporting the ways that fails.
 * @param revision - the base revision
 * @returns the checkout root, or undefined once the failure is
 *   reported and the exit code set
 */
function baseCheckout(revision: string): string | undefined {
  try {
    return materialize({
      revision,
      prefix: "deletion-gate-",
      install: false,
    });
  } catch (error) {
    cannotRun(
      `could not materialize ${revision}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

/**
 * Compares the two checkouts and holds the change to its
 * declarations.
 * @param base - the materialized base checkout
 * @param revision - the base revision, for the report
 */
function gate(base: string, revision: string): void {
  const before = publishedSymbols(base);
  if (before.length < MINIMUM_PUBLISHED) {
    cannotRun(
      `the base checkout published ${String(before.length)} names, fewer than the ${String(MINIMUM_PUBLISHED)} this repository has; nothing was compared`,
    );
    return;
  }
  const after = new Set(publishedSymbols(REPO_ROOT));
  const deleted = before.filter((symbol) => !after.has(symbol));
  console.log(
    `${String(deleted.length)} name(s) gone from src since ${revision}`,
  );
  for (const symbol of deleted) {
    console.log(`  ${symbol}`);
  }
  const failures = deletionFailures(
    deleted,
    loadDeletions(path.join(REPO_ROOT, DELETIONS_PATH)),
    (file) => existsSync(path.join(REPO_ROOT, file)),
  );
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(failure);
    }
    process.exitCode = GATE_FAILED;
  }
}

const parsed = parse(argv);
if ("error" in parsed) {
  cannotRun(parsed.error);
} else {
  const base = baseCheckout(parsed.base);
  if (base !== undefined) {
    try {
      gate(base, parsed.base);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  }
}
