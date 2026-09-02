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
 * does not (every baseline before c331bfbd, which dropped
 * Chevrotain, imports chevrotain).
 *
 * The comparison travels as hashes (a full AST dump of 1,600
 * documents is hundreds of megabytes); a mismatching case is then
 * re-run in both checkouts to print the actual difference.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 identical, 1 a case DIFFERS,
 * 2 the harness could not run — a bad argument, an unknown `--base`,
 * or a corpus that did not load (the {@link floorComplaint} floor).
 */
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CHILD_MAX_BUFFER, materialize } from "./lib/checkout.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import { keyCoverage } from "./parity-keys.js";
import {
  LEDGER_FAMILIES,
  collectExpectedDiffTrailers,
  foldAnchorAndAdmonitionShapes,
  foldAttributeEntryUnset,
  foldSectionAndHeadingShapes,
  foldMarkerAndReftextShapes,
  parseArguments,
  reportExpectedDiffs,
  type TrailerScan,
} from "./parity-ledger.js";
// Re-exported for the unit tests, which reach the ledger's surface
// through this module. Three statements rather than one braced list:
// `export … from` is required here (unicorn/prefer-export-from) and
// the one-name-per-line form the braced list wraps to costs four
// counted lines this file has no room for (max-lines 450). The
// brief also asked for `type FamilySets` here; nothing imports it
// from this module, and this is the file with zero headroom, so it
// is not re-exported — `scripts/parity-ledger.js`
// exports it directly for whoever needs it.
export { expectedDiffFailures, parseArguments } from "./parity-ledger.js";
export { LEDGER_FAMILIES } from "./parity-ledger.js";
export type { ExpectedDiff } from "./parity-ledger.js";

const ARGUMENT_START = 2;

/** What `--help` prints. */
const USAGE = `usage: bun run parity --base <rev> [options]

  --base <rev>              the baseline revision to compare against
  --limit <n>               how many differing cases to detail (default 20)
  --formatted-ledger        list formatted-only differences instead of
                            failing on them, as pasteable Parity-Diff
                            trailers; the AST alone gates
  --expected-diffs-trailers <rev>
                            run the ledger gate over the Parity-Diff
                            trailers in <base>..<rev>'s commit messages
  --allow-parent-block-end  blank forced-closed parentBlock ends on both sides
  --help                    this text

exit: 0 identical, 1 a case differs, 2 could not run`;
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
 * that group is gone.) A wrong cwd, a `vendor/` change or a loader
 * regression makes both sides return zero rows, and without this the
 * parity gate passes silently on nothing.
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
 * item the end of the last of `blocks` — the run BEFORE the BASE
 * generation's builder splits it into `attachedBlocks` (everything but
 * nested lists) and `children` (the nested lists).
 * {@link normalizeOneItem} puts that run back together, and this
 * reviver runs on the ALREADY-folded item (same
 * `JSON.parse` call, folded first), so the item's last canonical block
 * IS the node its end came from — no merge-by-offset reconstruction
 * here.
 * @param value - a revived `list` or `listItem` node
 * @returns the node its end came from, or undefined when it holds
 *   nothing
 */
function endSource(value: Record<string, unknown>): unknown {
  // A literal rather than an imported constant: this body is embedded
  // into the dumper, where nothing outside the embedded functions
  // exists.
  const LAST = -1;
  if (value.type === "list") {
    const { children } = value;
    return (isUnknownArray(children) ? children : []).at(LAST);
  }
  const { blocks } = value;
  return (isUnknownArray(blocks) ? blocks : []).at(LAST);
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
 * One list item, folded to the canonical form BOTH AST generations
 * spell identically: inline text, then every block the item holds in
 * source order, with the printer-spelling fields dropped — old
 * `continuation`/`pluses`/`keepTextBreak`/`danglingContinuation`, new
 * `gap`/`trailingContinuation`. The spelling is deliberately NOT
 * compared here (`pluses` is not a pure function of `gap`); the
 * render-equality and idempotence nets compare it where it is
 * observable — in the formatted bytes.
 *
 * A JSON.parse reviver body, bottom-up: nested items are already
 * canonical when their container is visited. Key order is fixed by
 * the object literal, so both sides stringify identically.
 * @param _key - the property name, unused
 * @param value - the revived value
 * @returns the value, or the canonical item that replaces it
 */
function normalizeOneItem(_key: string, value: unknown): unknown {
  if (!isRecordLike(value) || value.type !== "listItem") return value;
  const children = isUnknownArray(value.children) ? value.children : [];
  const inline = isUnknownArray(value.text)
    ? value.text
    : children.filter(
        (child) => !(isRecordLike(child) && child.type === "list"),
      );
  const nested = children.filter(
    (child) => isRecordLike(child) && child.type === "list",
  );
  const attached = (
    isUnknownArray(value.attachedBlocks) ? value.attachedBlocks : []
  ).map((entry) => (isRecordLike(entry) ? entry.block : entry));
  const wrapped = (isUnknownArray(value.blocks) ? value.blocks : []).map(
    (entry) => (isRecordLike(entry) ? entry.block : entry),
  );
  const blocks = [...nested, ...attached, ...wrapped].toSorted(
    (left, right) => startOffset(left) - startOffset(right),
  );
  return {
    type: value.type,
    depth: value.depth,
    checkbox: value.checkbox,
    calloutNumber: value.calloutNumber,
    inline,
    blocks,
    position: value.position,
  };
}

/**
 * The one normaliser both dumper sides run before hashing: fold every
 * list item to the canonical form, and (behind the existing flag)
 * blank the allowlisted parentBlock ends. Composing the two in ONE
 * reviver keeps the walk bottom-up for both. Replaces
 * `blankParentBlockEnds` as the exported surface.
 *
 * The parentBlock allowlist is the ONE enumerated AST difference
 * — a forced-closed parentBlock's end position — AND its
 * propagation into list-item and list ends, which are DEFINED as their
 * last block's end rather than read off the source, so they move with
 * it.
 *
 * That predicate is deliberately WIDER than that sentence: it blanks
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
 * a second entry here without the maintainer's agreement.
 *
 * A `JSON.parse` reviver, so the walk is the same one that produced
 * the string we hash: it visits every value, in any shape, and the
 * `undefined`s it drops are the ones `JSON.stringify` was going to
 * drop anyway. The result is a copy — the caller's tree is untouched.
 * The reviver is bottom-up, which is what lets the propagation be
 * detected: a child is already `"<allowed>"` when its container is
 * visited.
 *
 * This function, `foldAnchorAndAdmonitionShapes`, `foldSectionAndHeadingShapes`,
 * `foldMarkerAndReftextShapes`, `foldAttributeEntryUnset`,
 * `normalizeOneItem`, `blankOneEnd`,
 * `derivedEnd`, `endSource`, `startOffset`, `isUnknownArray` and
 * `isRecordLike` are
 * SELF-CONTAINED on purpose: their source is embedded into the dumper
 * below with `Function.prototype.toString()`, so the comparison and
 * its test share one implementation instead of two copies that can
 * drift. A reference to anything outside these twelve bodies would
 * compile here and crash inside the baseline checkout. All four fold
 * bodies now live in `scripts/parity-ledger.ts`;
 * `.toString()` embeds a body regardless of the module that defines
 * it, so the rule is unchanged.
 * @param tree - a parsed AST
 * @param allowParentBlockEnd - whether to blank forced-closed
 *   parentBlock ends
 * @returns a COPY, canonicalized
 */
export function normalizeTree(
  tree: unknown,
  allowParentBlockEnd: boolean,
): unknown {
  const normalized: unknown = JSON.parse(JSON.stringify(tree), (key, value) => {
    // The marker/reftext fold runs FIRST:
    // `foldAnchorAndAdmonitionShapes` rewrites a `blockAnchor` into a
    // FRESH paragraph/inlineAnchor pair, and a fresh object is never
    // revisited by the reviver — folding after it would leave that
    // pair's reftext unfolded and surface as an AST difference.
    const replayed = foldMarkerAndReftextShapes(key, value);
    const shaped = foldAnchorAndAdmonitionShapes(key, replayed);
    const flattened = foldSectionAndHeadingShapes(key, shaped);
    const entry = foldAttributeEntryUnset(key, flattened);
    const folded = normalizeOneItem(key, entry);
    return allowParentBlockEnd ? blankOneEnd(key, folded) : folded;
  });
  return normalized;
}

// The dumper is written into BOTH checkouts, so it can only use what
// the baseline already has: the corpus loader, the format fixtures,
// `formatAdoc` and `parse`, plus the twelve functions embedded
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
const verbatim = process.argv[4] === "verbatim";
${isRecordLike.toString()}
${isUnknownArray.toString()}
${startOffset.toString()}
${endSource.toString()}
${derivedEnd.toString()}
${blankOneEnd.toString()}
${normalizeOneItem.toString()}
${foldAnchorAndAdmonitionShapes.toString()}
${foldSectionAndHeadingShapes.toString()}
${foldMarkerAndReftextShapes.toString()}
${foldAttributeEntryUnset.toString()}
${normalizeTree.toString()}
const cases = loadCorpus().flatMap((group) => group.cases);
const FIXTURES = "tests/format/fixtures/identity";
for (const name of readdirSync(FIXTURES).toSorted()) {
  cases.push({
    id: "fixture:" + name,
    input: readFileSync(FIXTURES + "/" + name, "utf8"),
  });
}
const digest = (text) => createHash("sha256").update(text).digest("hex");
// Only the FORMAT calls are timed, for the report-only timing row.
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
    ast = JSON.stringify(normalizeTree(tree, allowParentBlockEnd));
  } catch (error) {
    ast = "<<THREW>> " + String(error);
  }
  const row =
    only === undefined && !verbatim
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
 * Which cases a dump covers, and in what form.
 *
 * `verbatim` exists for the blanket `Parity-Diff` trailer's
 * key-ignoring comparison (scripts/parity-keys.ts), which cannot strip
 * a key from a digest. A single-case dump is verbatim whatever this
 * says, because `reportCase` has always needed the texts.
 */
interface DumpScope {
  /** A single case id, or undefined for all of them. */
  readonly only?: string;
  /** Whether every row carries its two full texts instead of digests. */
  readonly verbatim?: boolean;
}

/**
 * Write the dumper into a checkout, run it, and delete it again.
 * @param root - the checkout to run in
 * @param allow - whether to blank forced-closed parentBlock ends
 * @param what - which cases to dump and in what form
 * @returns everything it printed on stdout
 */
function runDumper(root: string, allow: boolean, what: DumpScope): string {
  const script = path.join(root, "parity-dump.mjs");
  writeFileSync(script, DUMPER);
  try {
    return execFileSync(
      "bun",
      [
        script,
        what.only ?? "-",
        allow ? "allow-parent-block-end" : "",
        what.verbatim === true ? "verbatim" : "",
      ],
      { cwd: root, encoding: "utf8", maxBuffer: CHILD_MAX_BUFFER },
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
 * @param what - which cases to dump and in what form
 * @returns its rows and its format wall time
 */
function dump(root: string, allow: boolean, what: DumpScope = {}): Dump {
  const stdout = runDumper(root, allow, what);
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
 * The case ids where the two checkouts disagree, split into the two
 * streams the gate treats differently: `ast` is always a failure,
 * `formatted` is a failure unless `--formatted-ledger` asked for a
 * listing. An id present on only ONE side goes in `ast` — that is a
 * structural failure, never ledger material — and so does an id whose
 * AST differs, whatever its formatted output did.
 *
 * `ast` is in head order with the base-only ids appended; `formatted`
 * is in head order and never receives a base-only id.
 * Exported for tests/scripts/parity.test.ts: this is the function that
 * decides the parity gate, and every way it could wrongly
 * return empty lists is a silent pass.
 * @param base - the baseline's rows
 * @param head - this checkout's rows
 * @returns the ids differing in the AST and the ids differing only in
 *   the formatted output
 */
export function differingCases(
  base: Map<string, Row>,
  head: Map<string, Row>,
): { ast: string[]; formatted: string[] } {
  const ast: string[] = [];
  const formatted: string[] = [];
  for (const [id, headRow] of head) {
    const baseRow = base.get(id);
    // `baseRow?.ast` rather than an explicit undefined check: an id the
    // base does not have compares undefined against a string and lands
    // in `ast`, which is exactly where a missing case belongs.
    if (baseRow?.ast !== headRow.ast) {
      ast.push(id);
    } else if (baseRow.formatted !== headRow.formatted) {
      formatted.push(id);
    }
  }
  for (const id of base.keys()) {
    if (!head.has(id)) ast.push(id);
  }
  return { ast, formatted };
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
 * The gate's verdict: which differing cases FAIL the run.
 *
 * An AST difference always fails — the harness exists to catch one. A
 * formatted-only difference normally fails too, because a refactor that
 * changes the bytes is not a refactor. `--formatted-ledger` is the one
 * way to accept them: it says "I expect these bytes to move, list them
 * for the expected-diff ledger", and the run then stands or falls on
 * the AST alone. An empty result means the run passes.
 *
 * Exported for tests/scripts/parity.test.ts. {@link differingCases}
 * splits the two streams; this is the decision made FROM them, and a
 * mutation of it — returning `ast` unconditionally — would silently
 * stop the default gate failing on changed output.
 * @param streams - the two differing-id lists
 * @param streams.ast - ids whose AST differs, or that only one side has
 * @param streams.formatted - ids whose AST matched and whose formatted
 *   output did not
 * @param formattedLedger - whether formatted-only differences are a
 *   listing rather than a failure
 * @returns the ids that fail, AST differences first (see the `--limit`
 *   note at the call site)
 */
export function verdict(
  streams: { ast: string[]; formatted: string[] },
  formattedLedger: boolean,
): string[] {
  const { ast, formatted } = streams;
  return formattedLedger ? [...ast] : [...ast, ...formatted];
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
  const baseOne = dump(baseRoot, allow, { only: id }).rows.get(id);
  const headOne = dump(process.cwd(), allow, { only: id }).rows.get(id);
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
 * @param options.formattedLedger - whether formatted-only differences
 *   are listed as expected-diff ledger candidates instead of failing
 * @param options.expectedDiffs - the scanned `Parity-Diff` trailers,
 *   when `--expected-diffs-trailers` was given; drives the ledger
 *   gate instead of the default verdict
 */
function report(options: {
  base: Dump;
  head: Dump;
  baseRoot: string;
  revision: string;
  limit: number;
  allowParentBlockEnd: boolean;
  formattedLedger: boolean;
  expectedDiffs: TrailerScan | undefined;
}): void {
  const {
    base: { rows: base, formatMs: baseMs },
    head: { rows: head, formatMs: headMs },
    baseRoot,
    revision,
    limit,
    allowParentBlockEnd,
    formattedLedger,
  } = options;
  // Report-only timing. Printed on every run, pass or fail, so a
  // slowdown is visible in the same output the gate is read from.
  process.stdout.write(
    `parity: formatted ${String(base.size)} inputs in ${String(baseMs)} ms (base ${revision})\n`,
  );
  process.stdout.write(
    `parity: formatted ${String(head.size)} inputs in ${String(headMs)} ms (head)\n`,
  );
  const complaint = floorComplaint(head.size, base.size);
  if (complaint !== undefined) {
    // A 2, not a 1: a corpus that did not load says nothing about the
    // code, and a build failed for it would read as a regression.
    cannotRun(complaint.trimEnd());
    return;
  }
  const { ast, formatted } = differingCases(base, head);
  // The ledger listing is printed whether or not the AST agreed: when
  // both streams differ the run fails on the AST, and the ledger's
  // candidate list is still the thing the reader came for.
  if (formattedLedger && formatted.length > ZERO) {
    // Printed as trailers, ready to paste into this commit's message,
    // with `<family>` the one token the author still has to replace
    // (the enum is declared in scripts/parity-ledger.ts).
    process.stdout.write(
      `parity: ledger: ${String(formatted.length)} cases differ in formatted output only; declare each in this commit's message, replacing <family>:\n`,
    );
    for (const id of formatted) {
      process.stdout.write(`Parity-Diff: <family> ${id}\n`);
    }
  }
  if (options.expectedDiffs !== undefined) {
    reportExpectedDiffs({
      expectedDiffs: options.expectedDiffs.entries,
      blanket: options.expectedDiffs.blanket,
      trailerFailures: options.expectedDiffs.failures,
      ast,
      formatted,
      headIds: new Set(head.keys()),
      headSize: head.size,
      baseRoot,
      revision,
      limit,
      allowParentBlockEnd,
      familySets: LEDGER_FAMILIES,
      covers: keyCoverage(
        (root) => dump(root, allowParentBlockEnd, { verbatim: true }).rows,
        { base: baseRoot, head: process.cwd() },
      ),
      reportCase,
    });
    return;
  }
  // The detailed subset under `--limit` is now AST differences first
  // (base-only ids among them), then formatted-only ones — deliberate:
  // when there are more differences than `limit`, a structural failure
  // is the one worth reading. Before this task it was one head-order
  // list with the base-only ids last.
  const failing = verdict({ ast, formatted }, formattedLedger);
  if (failing.length === ZERO) {
    if (formatted.length === ZERO) {
      process.stdout.write(
        `parity: ${String(head.size)} cases identical to ${revision}${allowParentBlockEnd ? " (parentBlock end allowlisted)" : ""}\n`,
      );
    }
    return;
  }
  process.stdout.write(
    `parity: ${String(failing.length)} of ${String(head.size)} cases differ from ${revision}\n`,
  );
  for (const id of failing.slice(ZERO, limit)) {
    reportCase(id, baseRoot, allowParentBlockEnd);
  }
  process.exitCode = GATE_FAILED;
}

/**
 * Compare this checkout against a baseline revision and set the exit
 * code. Every path through it removes the materialized base copy.
 * @param argv - the arguments after the script name
 */
function main(argv: readonly string[]): void {
  if (wantsHelp(argv)) {
    printUsage(USAGE);
    return;
  }
  const {
    revision,
    limit,
    allowParentBlockEnd,
    formattedLedger,
    expectedDiffsTrailers,
  } = parseArguments(argv);
  // Scanned BEFORE the base is materialized: an unknown revision here
  // throws out to the `cannotRun` handler below, and paying for a full
  // install first would make a typo cost minutes.
  const expected =
    expectedDiffsTrailers === undefined
      ? undefined
      : collectExpectedDiffTrailers(revision, expectedDiffsTrailers);
  const baseRoot = materialize({
    revision,
    prefix: "parity-base-",
    install: true,
  });
  try {
    report({
      base: dump(baseRoot, allowParentBlockEnd),
      head: dump(process.cwd(), allowParentBlockEnd),
      baseRoot,
      revision,
      limit,
      allowParentBlockEnd,
      formattedLedger,
      expectedDiffs: expected,
    });
  } finally {
    // `process.exitCode` and a normal return, never `process.exit()`:
    // exit() terminates immediately and this `finally` would not run,
    // leaving a fully installed checkout (hundreds of MB) in $TMPDIR on
    // every parity run. Same pattern as
    // scripts/metrics.ts.
    rmSync(baseRoot, { recursive: true, force: true });
  }
}

// Only when run as a program. `tests/scripts/parity.test.ts` imports
// the three helpers above, and a module that materializes a checkout
// the moment it is imported cannot be unit-tested at all.
if (import.meta.main) {
  try {
    main(process.argv.slice(ARGUMENT_START));
  } catch (error) {
    // An unrecognised argument, a missing `--base`, a revision
    // `git archive` refuses, a trailer range `git log` refuses: none
    // of them compared anything, so none of them is a 1.
    cannotRun(error instanceof Error ? error.message : String(error));
  }
}
