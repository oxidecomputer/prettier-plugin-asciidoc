#!/usr/bin/env bun
/**
 * "Same output as revision X" — the harness that makes a refactor's
 * no-behavior-change claim checkable.
 *
 * For every conformance-corpus document and every format fixture it
 * compares two things against a baseline revision: the FORMATTED
 * output, and `JSON.stringify(parse(src))` including every position.
 * Positions are in because Prettier's `--range` and cursor tracking
 * read `position.*.offset` directly, so an AST that prints the same
 * today can still break range formatting tomorrow.
 *
 * The baseline is materialized with `git archive | tar -x` into a
 * temp directory — never `git worktree`: this repository is
 * jj-managed and often has a concurrent session, and a worktree
 * mutates `.git`. Unlike `scripts/metrics.ts`, the base copy DOES
 * need `bun install --frozen-lockfile`: it runs the baseline's own
 * parser, which imports chevrotain.
 *
 * The comparison travels as hashes (a full AST dump of 1,600
 * documents is hundreds of megabytes); a mismatching case is then
 * re-run in both checkouts to print the actual difference.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const ARGUMENT_START = 2;
const FAILURE = 1;
const DEFAULT_LIMIT = 20;
const MAX_BUFFER = 268_435_456;
// `no-magic-numbers` is on outside tests; both of these are ordinary
// array and line-number bookkeeping.
const ZERO = 0;
const ONE = 1;

/**
 * The floor below which a "pass" is meaningless. 1,627 corpus cases +
 * 6 identity fixtures at `8c42f624`. A wrong cwd, a `vendor/` change
 * or a loader regression makes both sides return zero rows, and
 * without this the plan's central gate passes silently on nothing.
 */
const MINIMUM_CASES = 1633;

// The dumper is written into BOTH checkouts, so it can only use what
// the baseline already has: the corpus loader, the format fixtures,
// `formatAdoc` and `parse`. It prints one JSON line per case, then one
// timing line.
const DUMPER = String.raw`
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadCorpus } from "./tests/conformance/loader.js";
import { formatAdoc } from "./tests/helpers.js";
import { parse } from "./src/parser.js";

const only = process.argv[2] === "-" ? undefined : process.argv[2];
// The ONE allowlisted AST difference (Ruling 39): a forced-closed
// parentBlock's end position. Both checkouts blank the same field, so
// the field stops being compared and NOTHING else changes. Never add a
// second entry here without an owner ruling.
const allowParentBlockEnd = process.argv[3] === "allow-parent-block-end";
const blankParentBlockEnds = (value) => {
  if (Array.isArray(value)) {
    for (const element of value) blankParentBlockEnds(element);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  if (value.type === "parentBlock" && value.position !== undefined) {
    value.position = { start: value.position.start, end: "<allowed>" };
  }
  for (const child of Object.values(value)) blankParentBlockEnds(child);
};
const cases = loadCorpus().flatMap((group) => group.cases);
const FIXTURES = "tests/format/fixtures/identity";
for (const name of readdirSync(FIXTURES).toSorted()) {
  cases.push({
    id: "fixture:" + name,
    input: readFileSync(FIXTURES + "/" + name, "utf8"),
  });
}
const digest = (text) => createHash("sha256").update(text).digest("hex");
// Only the FORMAT calls are timed (Ruling 44's report-only row).
// formatAdoc parses AND prints, which is what the row is about; the
// second parse below exists only to dump the AST, and the digesting
// and I/O around both are the harness's own cost, not the formatter's.
// No backticks anywhere in this string: it is a template literal, and
// String.raw would keep the backslash of an escaped one.
let formatMs = 0;
for (const one of cases) {
  if (only !== undefined && one.id !== only) continue;
  let formatted;
  let ast;
  const started = performance.now();
  try {
    formatted = await formatAdoc(one.input);
  } catch (error) {
    formatted = "<<THREW>> " + String(error);
  }
  formatMs += performance.now() - started;
  try {
    const tree = parse(one.input);
    if (allowParentBlockEnd) blankParentBlockEnds(tree);
    ast = JSON.stringify(tree);
  } catch (error) {
    ast = "<<THREW>> " + String(error);
  }
  const row =
    only === undefined
      ? { id: one.id, formatted: digest(formatted), ast: digest(ast) }
      : { id: one.id, formatted, ast };
  process.stdout.write(JSON.stringify(row) + "\n");
}
process.stdout.write(
  JSON.stringify({ formatMs: Math.round(formatMs) }) + "\n",
);
`;

/**
 * One case's two digests (or, in `--only` mode, its two full texts).
 */
interface Row {
  /** Corpus case id, or `fixture:<name>`. */
  id: string;
  /** The formatted output, hashed (or verbatim in `--only` mode). */
  formatted: string;
  /** `JSON.stringify(parse(input))`, hashed (or verbatim). */
  ast: string;
}

/**
 * Narrow a parsed JSONL line to a Row. Exported for
 * tests/scripts/parity.test.ts.
 * @param value - one parsed line of the dumper's output
 * @returns whether it has the three string fields a Row needs
 */
export function isRow(value: unknown): value is Row {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record.id === "string" &&
    typeof record.formatted === "string" &&
    typeof record.ast === "string"
  );
}

/**
 * The dumper's last line: how long the format calls took.
 */
interface Timing {
  /** Milliseconds spent inside `formatAdoc`, summed over the cases. */
  formatMs: number;
}

/**
 * Narrow a parsed JSONL line to the dumper's timing line. Exported for
 * tests/scripts/parity.test.ts.
 * @param value - one parsed line of the dumper's output
 * @returns whether it is the timing line rather than a case row
 */
export function isTiming(value: unknown): value is Timing {
  if (typeof value !== "object" || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return typeof record.formatMs === "number";
}

/**
 * Materialize a revision and install its dependencies.
 * @param revision - anything `git archive` accepts
 * @returns the temp directory holding the installed checkout
 */
function materialize(revision: string): string {
  const directory = realpathSync(
    mkdtempSync(path.join(tmpdir(), "parity-base-")),
  );
  const archive = path.join(directory, "revision.tar");
  try {
    execFileSync(
      "git",
      ["archive", "--format=tar", "--output", archive, revision],
      {
        maxBuffer: MAX_BUFFER,
      },
    );
    execFileSync("tar", ["-xf", archive, "-C", directory]);
    rmSync(archive, { force: true });
    execFileSync("bun", ["install", "--frozen-lockfile"], {
      cwd: directory,
      maxBuffer: MAX_BUFFER,
      stdio: ["ignore", "ignore", "inherit"],
    });
  } catch (error) {
    // An unknown revision or a failed install must not leave a
    // half-populated checkout behind: the caller never learns the
    // path when this throws, so nothing else can clean it up. The
    // caller's own `finally` only covers a directory it was handed.
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return directory;
}

/**
 * Write the dumper into a checkout, run it, and delete it again.
 * @param root - the checkout to run in
 * @param script - where to write the dumper
 * @param allow - whether to blank forced-closed parentBlock ends
 * @param only - a single case id, or undefined for all of them
 * @returns everything it printed on stdout
 */
function runDumper(
  root: string,
  script: string,
  allow: boolean,
  only?: string,
): string {
  writeFileSync(script, DUMPER);
  try {
    return execFileSync(
      "bun",
      [script, only ?? "-", allow ? "allow-parent-block-end" : ""],
      { cwd: root, encoding: "utf8", maxBuffer: MAX_BUFFER },
    );
  } finally {
    // The dumper is written INTO the checkout it runs in, so when it
    // throws — a half-finished refactor that does not compile, the
    // normal way to meet this gate — an unguarded delete would leave
    // `parity-dump.mjs` sitting in the repository root, where jj
    // reports it as a new file.
    rmSync(script, { force: true });
  }
}

/**
 * One checkout's dump: its rows and how long formatting them took.
 */
interface Dump {
  /** The rows it printed, keyed by case id. */
  rows: Map<string, Row>;
  /** Milliseconds spent inside `formatAdoc`, summed over the cases. */
  formatMs: number;
}

/**
 * Run the dumper in one checkout.
 * @param root - the checkout to run in
 * @param allow - whether to blank forced-closed parentBlock ends
 * @param only - a single case id, or undefined for all of them
 * @returns its rows and its format wall time
 */
function dump(root: string, allow: boolean, only?: string): Dump {
  const script = path.join(root, "parity-dump.mjs");
  const stdout = runDumper(root, script, allow, only);
  const rows = new Map<string, Row>();
  let formatMs = ZERO;
  for (const line of stdout.split("\n")) {
    if (line === "") continue;
    const parsed: unknown = JSON.parse(line);
    if (isTiming(parsed)) {
      ({ formatMs } = parsed);
      continue;
    }
    if (!isRow(parsed)) throw new Error(`parity: bad dumper line: ${line}`);
    rows.set(parsed.id, parsed);
  }
  return { rows, formatMs };
}

/**
 * The first differing line of two texts, rendered for a human, or
 * undefined when they agree. Exported for
 * tests/scripts/parity.test.ts.
 * @param label - which stream differs (`formatted` or `ast`)
 * @param base - the baseline text
 * @param head - this checkout's text
 * @returns the rendered difference, or undefined
 */
export function describeDifference(
  label: string,
  base: string,
  head: string,
): string | undefined {
  const baseLines = base.split("\n");
  const headLines = head.split("\n");
  const count = Math.max(baseLines.length, headLines.length);
  for (let index = ZERO; index < count; index += ONE) {
    const { [index]: baseLine } = baseLines;
    const { [index]: headLine } = headLines;
    if (baseLine === headLine) continue;
    return `    ${label} line ${String(index + ONE)}:\n      base: ${JSON.stringify(baseLine)}\n      head: ${JSON.stringify(headLine)}`;
  }
  return undefined;
}

/**
 * Parse the command line. Exported for tests/scripts/parity.test.ts.
 * @param argv - the arguments after the script name
 * @returns the base revision, the report limit and the allowlist flag
 * @throws {Error} when an argument is unrecognised or `--base` is
 *   missing — a silently dropped `--base` would compare a checkout
 *   with itself
 */
export function parseArguments(argv: readonly string[]): {
  revision: string;
  limit: number;
  allowParentBlockEnd: boolean;
} {
  let revision: string | undefined = undefined;
  let limit = DEFAULT_LIMIT;
  let allowParentBlockEnd = false;
  // A queue rather than an index, because two of the four options
  // consume the argument after them.
  const rest = [...argv];
  while (rest.length > ZERO) {
    const argument = rest.shift() ?? "";
    if (argument.startsWith("--base=")) {
      revision = argument.slice("--base=".length);
      continue;
    }
    if (argument === "--base") {
      revision = rest.shift();
      continue;
    }
    if (argument === "--limit") {
      limit = Number(rest.shift());
      continue;
    }
    if (argument === "--allow-parent-block-end") {
      allowParentBlockEnd = true;
      continue;
    }
    throw new Error(`parity: unrecognised argument ${argument}`);
  }
  if (revision === undefined)
    throw new Error("parity: --base <rev> is required");
  return { revision, limit, allowParentBlockEnd };
}

/**
 * The case ids where the two checkouts disagree, in head order with
 * the base-only ids appended.
 * @param base - the baseline's rows
 * @param head - this checkout's rows
 * @returns the differing ids
 */
function differingCases(
  base: Map<string, Row>,
  head: Map<string, Row>,
): string[] {
  const differing: string[] = [];
  for (const [id, headRow] of head) {
    const baseRow = base.get(id);
    if (baseRow === undefined) {
      differing.push(id);
      continue;
    }
    if (
      baseRow.formatted !== headRow.formatted ||
      baseRow.ast !== headRow.ast
    ) {
      differing.push(id);
    }
  }
  for (const id of base.keys()) {
    if (!head.has(id)) differing.push(id);
  }
  return differing;
}

/**
 * Print what one differing case looks like on each side, by re-running
 * the dumper for that case alone — the full run only carries hashes.
 * @param id - the case to re-run
 * @param baseRoot - the materialized baseline checkout
 * @param allow - whether to blank forced-closed parentBlock ends
 */
function reportCase(id: string, baseRoot: string, allow: boolean): void {
  process.stdout.write(`  ${id}\n`);
  const baseOne = dump(baseRoot, allow, id).rows.get(id);
  const headOne = dump(process.cwd(), allow, id).rows.get(id);
  if (baseOne === undefined || headOne === undefined) return;
  for (const line of [
    describeDifference("formatted", baseOne.formatted, headOne.formatted),
    describeDifference("ast", baseOne.ast, headOne.ast),
  ]) {
    if (line !== undefined) process.stdout.write(`${line}\n`);
  }
}

/**
 * Compare the two dumps and print the verdict.
 * @param options - the two dumps, the base checkout and the CLI flags
 * @param options.base - the baseline's dump
 * @param options.head - this checkout's dump
 * @param options.baseRoot - the materialized baseline checkout
 * @param options.revision - the revision compared against, for the
 *   message
 * @param options.limit - how many differing cases to detail
 * @param options.allowParentBlockEnd - whether forced-closed
 *   parentBlock ends were blanked on both sides
 */
function report(options: {
  base: Dump;
  head: Dump;
  baseRoot: string;
  revision: string;
  limit: number;
  allowParentBlockEnd: boolean;
}): void {
  const {
    base: { rows: base, formatMs: baseMs },
    head: { rows: head, formatMs: headMs },
    baseRoot,
    revision,
    limit,
    allowParentBlockEnd,
  } = options;
  // Report-only (Ruling 44). Printed on every run, pass or fail, so a
  // slowdown is visible in the same output the gate is read from.
  process.stdout.write(
    `parity: formatted ${String(base.size)} inputs in ${String(baseMs)} ms (base ${revision})\n`,
  );
  process.stdout.write(
    `parity: formatted ${String(head.size)} inputs in ${String(headMs)} ms (head)\n`,
  );
  // A gate that passes on nothing is not a gate.
  if (head.size < MINIMUM_CASES || base.size < MINIMUM_CASES) {
    process.stdout.write(
      `parity: only ${String(head.size)} head / ${String(base.size)} base cases loaded, expected at least ${String(MINIMUM_CASES)} — the corpus did not load\n`,
    );
    process.exitCode = FAILURE;
  }
  const differing = differingCases(base, head);
  if (differing.length === ZERO) {
    process.stdout.write(
      `parity: ${String(head.size)} cases identical to ${revision}${allowParentBlockEnd ? " (parentBlock end allowlisted)" : ""}\n`,
    );
    return;
  }
  process.stdout.write(
    `parity: ${String(differing.length)} of ${String(head.size)} cases differ from ${revision}\n`,
  );
  for (const id of differing.slice(ZERO, limit)) {
    reportCase(id, baseRoot, allowParentBlockEnd);
  }
  process.exitCode = FAILURE;
}

/**
 * Compare this checkout against a baseline revision and set the exit
 * code. Every path through it removes the materialized base copy.
 * @param argv - the arguments after the script name
 */
function main(argv: readonly string[]): void {
  const { revision, limit, allowParentBlockEnd } = parseArguments(argv);
  const baseRoot = materialize(revision);
  try {
    report({
      base: dump(baseRoot, allowParentBlockEnd),
      head: dump(process.cwd(), allowParentBlockEnd),
      baseRoot,
      revision,
      limit,
      allowParentBlockEnd,
    });
  } finally {
    // `process.exitCode` and a normal return, never `process.exit()`:
    // exit() terminates immediately and this `finally` would not run,
    // leaving a fully installed checkout (hundreds of MB) in $TMPDIR on
    // every one of the plan's 20-odd parity runs. Same pattern as
    // scripts/metrics.ts.
    rmSync(baseRoot, { recursive: true, force: true });
  }
}

// Only when run as a program. `tests/scripts/parity.test.ts` imports
// the three helpers above, and a module that materializes a checkout
// the moment it is imported cannot be unit-tested at all.
if (import.meta.main) main(process.argv.slice(ARGUMENT_START));
