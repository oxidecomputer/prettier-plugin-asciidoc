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
 * parser, and a baseline may have runtime dependencies this revision
 * does not (every baseline before plan 3 imports chevrotain).
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
 * The floor below which a "pass" is meaningless: every corpus case
 * plus every identity fixture, **1,614 + 6 = 1,620** today. Re-derive
 * both halves before changing it —
 * `loadCorpus().flatMap((group) => group.cases).length` and
 * `ls tests/format/fixtures/identity | wc -l` — and change it only
 * when one of them really moved; tests/scripts/parity.test.ts fails
 * when the real corpus no longer clears it. (It was 1,633 while the
 * vendored TCK's 13 `*-input.adoc` documents were a corpus group;
 * Ruling 43 deleted them.) A wrong cwd, a `vendor/` change or a loader
 * regression makes both sides return zero rows, and without this the
 * plan's central gate passes silently on nothing.
 */
const MINIMUM_CASES = 1620;

/**
 * Narrow an unknown value to a plain object with string keys.
 *
 * `instanceof Object` rather than `!== null`: `unicorn/no-null` bans
 * the literal outside tests, and this spelling excludes `null` and
 * every primitive just the same.
 * @param value - anything reachable from a parsed AST
 * @returns whether its properties can be read by name
 */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value instanceof Object;
}

/**
 * Narrow an unknown value to an array whose elements are unknown.
 *
 * A guard rather than a bare `Array.isArray`, which narrows to
 * `any[]` and trips `no-unsafe-assignment` the moment the result is
 * stored.
 * @param value - anything reachable from a parsed AST
 * @returns whether it can be indexed and iterated
 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Where a node begins, as an offset, or negative infinity for
 * anything that is not a positioned node — so an absent candidate
 * always loses the "which one is later" comparison below.
 * @param value - a revived node, or anything at all
 * @returns its `position.start.offset`
 */
function startOffset(value: unknown): number {
  if (!isRecordLike(value)) {
    return Number.NEGATIVE_INFINITY;
  }
  const { position } = value;
  if (!isRecordLike(position)) {
    return Number.NEGATIVE_INFINITY;
  }
  const { start } = position;
  if (!isRecordLike(start) || typeof start.offset !== "number") {
    return Number.NEGATIVE_INFINITY;
  }
  const { offset } = start;
  return offset;
}

/**
 * The node a list item's or a list's end was COPIED from.
 *
 * `src/parse/build/list.ts` gives a list its last item's end, and an
 * item the end of the last of `blocks` — the run BEFORE the builder
 * splits it into `attachedBlocks` (everything but nested lists) and
 * `children` (the nested lists). The AST only has the two halves, so
 * the last of `blocks` is whichever half's last member starts LATER
 * in the source. Mirroring that, rather than taking either half that
 * happens to be blanked, is what keeps this from blanking an end that
 * never moved.
 * @param value - a revived `list` or `listItem` node
 * @returns the node its end came from, or undefined when it holds
 *   nothing
 */
function endSource(value: Record<string, unknown>): unknown {
  // A literal rather than an imported constant: this body is embedded
  // into the dumper, where nothing outside the embedded functions
  // exists.
  const LAST = -1;
  const { children } = value;
  const held = isUnknownArray(children) ? children : [];
  if (value.type === "list") {
    return held.at(LAST);
  }
  const { attachedBlocks } = value;
  const entries = isUnknownArray(attachedBlocks) ? attachedBlocks : [];
  const lastEntry = entries.at(LAST);
  const attached = isRecordLike(lastEntry) ? lastEntry.block : undefined;
  const nested = held.findLast(
    (child) => isRecordLike(child) && child.type === "list",
  );
  return startOffset(attached) >= startOffset(nested) ? attached : nested;
}

/**
 * The end a node's own end was DERIVED from, for the two kinds whose
 * end is not read off the source but copied from a block they hold
 * (see {@link endSource}). Every other node kind positions itself
 * from its own line or from the source, so it has none.
 *
 * Split out from {@link blankOneEnd} only because
 * `unicorn/consistent-function-scoping` wants it here; it is embedded
 * into the dumper with the others.
 * @param value - a revived node
 * @returns the end it took as its own, or undefined when its end is
 *   its own
 */
function derivedEnd(value: Record<string, unknown>): unknown {
  if (value.type !== "list" && value.type !== "listItem") {
    return undefined;
  }
  const source = endSource(value);
  if (!isRecordLike(source)) {
    return undefined;
  }
  const { position } = source;
  if (!isRecordLike(position)) {
    return undefined;
  }
  const { end } = position;
  return end;
}

/**
 * The `JSON.parse` reviver that blanks one node's end: a parentBlock's
 * own end, and the end of a list item or list that INHERITED it. The
 * revive is bottom-up, so by the time a container is visited the block
 * its end came from already reads `"<allowed>"` if it was blanked.
 *
 * Split out only because `unicorn/consistent-function-scoping` wants
 * it here; it is embedded into the dumper with the others.
 * @param _key - the property name, unused
 * @param value - the revived value
 * @returns the value, or a copy with a blanked `position.end`
 */
function blankOneEnd(_key: string, value: unknown): unknown {
  if (!isRecordLike(value) || !isRecordLike(value.position)) {
    return value;
  }
  if (value.type !== "parentBlock" && derivedEnd(value) !== "<allowed>") {
    return value;
  }
  return {
    ...value,
    position: { start: value.position.start, end: "<allowed>" },
  };
}

/**
 * A copy of an AST with the allowlisted `position.end`s blanked.
 *
 * The allowlist is the ONE enumerated AST difference (Ruling 39) — a
 * forced-closed parentBlock's end position — AND its propagation into
 * list-item and list ends, which are DEFINED as their last block's end
 * rather than read off the source, so they move with it (Ruling 54).
 *
 * The predicate is deliberately WIDER than that sentence: it blanks
 * EVERY `parentBlock` end, terminated ones included. It has to be — the
 * dumper sees only the AST, and a parentBlock's node does not record
 * whether it met its own terminator, so "forced-closed" is not a
 * question this walk can ask. Soundness comes from the pair of runs
 * instead: the no-flag run compares every end and reports an exact
 * count of 64 differing documents, all of them forced-closed blocks, so
 * no TERMINATED parentBlock's end moved. The flag only stops those 64
 * from masking anything else.
 *
 * Both checkouts blank the same fields, so those fields stop being
 * compared and NOTHING else changes: a list item whose last block is
 * not a blanked parentBlock keeps its end under comparison. Never add
 * a second entry here without an owner ruling.
 *
 * A `JSON.parse` reviver, so the walk is the same one that produced
 * the string we hash: it visits every value, in any shape, and the
 * `undefined`s it drops are the ones `JSON.stringify` was going to
 * drop anyway. The result is a copy — the caller's tree is untouched.
 * The reviver is bottom-up, which is what lets the propagation be
 * detected: a child is already `"<allowed>"` when its container is
 * visited.
 *
 * This function, `blankOneEnd`, `derivedEnd`, `endSource`,
 * `startOffset`, `isUnknownArray` and `isRecordLike` are
 * SELF-CONTAINED on purpose: their source is embedded into the dumper
 * below with `Function.prototype.toString()`, so the comparison and
 * its test share one implementation instead of two copies that can
 * drift. A reference to anything outside these six bodies would
 * compile here and crash inside the baseline checkout.
 * @param tree - a parsed AST
 * @returns a COPY, with the allowlisted ends replaced
 */
export function blankParentBlockEnds(tree: unknown): unknown {
  const blanked: unknown = JSON.parse(JSON.stringify(tree), blankOneEnd);
  return blanked;
}

// The dumper is written into BOTH checkouts, so it can only use what
// the baseline already has: the corpus loader, the format fixtures,
// `formatAdoc` and `parse`, plus the six functions embedded
// verbatim below. It prints one JSON line per case, then one timing
// line.
const DUMPER = String.raw`
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadCorpus } from "./tests/conformance/loader.js";
import { formatAdoc } from "./tests/helpers.js";
import { parse } from "./src/parser.js";

const only = process.argv[2] === "-" ? undefined : process.argv[2];
const allowParentBlockEnd = process.argv[3] === "allow-parent-block-end";
${isRecordLike.toString()}
${isUnknownArray.toString()}
${startOffset.toString()}
${endSource.toString()}
${derivedEnd.toString()}
${blankOneEnd.toString()}
${blankParentBlockEnds.toString()}
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
    ast = JSON.stringify(
      allowParentBlockEnd ? blankParentBlockEnds(tree) : tree,
    );
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
 * Exported for tests/scripts/parity.test.ts, so its rows are the same
 * shape the dumper really prints rather than a copy of it.
 */
export interface Row {
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
      // `Number("fast")` is NaN, and `slice(0, NaN)` is empty: the run
      // would still exit 1 but print not one differing case, which
      // reads exactly like a harness that found nothing to say.
      const raw = rest.shift();
      limit = Number(raw);
      if (!Number.isInteger(limit) || limit < ZERO) {
        throw new Error(
          `parity: --limit needs a non-negative integer, got ${String(raw)}`,
        );
      }
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
 * the base-only ids appended. Exported for
 * tests/scripts/parity.test.ts: this is the function that decides the
 * plan's central gate, and every way it could wrongly return an empty
 * list is a silent pass.
 * @param base - the baseline's rows
 * @param head - this checkout's rows
 * @returns the differing ids
 */
export function differingCases(
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
 * The complaint to print when either checkout produced fewer rows than
 * the corpus has cases — a gate that passes on nothing is not a gate.
 * Exported for tests/scripts/parity.test.ts, the other silent-pass
 * path.
 * @param headSize - rows this checkout produced
 * @param baseSize - rows the baseline produced
 * @returns the message to print, or undefined when both cleared the
 *   floor
 */
export function floorComplaint(
  headSize: number,
  baseSize: number,
): string | undefined {
  if (headSize >= MINIMUM_CASES && baseSize >= MINIMUM_CASES) return undefined;
  return `parity: only ${String(headSize)} head / ${String(baseSize)} base cases loaded, expected at least ${String(MINIMUM_CASES)} — the corpus did not load\n`;
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
  const complaint = floorComplaint(head.size, base.size);
  if (complaint !== undefined) {
    process.stdout.write(complaint);
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
