/**
 * `scripts/parity.ts`'s command-line parsing and its `--expected-diffs`
 * ledger (spec D9): `parseArguments`, the closed family enumeration,
 * the staleness/cross-check gate, and the detail-printing it drives.
 *
 * Split out of `scripts/parity.ts` to keep that file under the
 * project's `max-lines` ceiling. Nothing here belongs to the DUMPER's
 * embedded, SELF-CONTAINED function cluster (see `normalizeTree`'s
 * JSDoc in parity.ts) — this module only parses arguments and
 * post-processes the two dumps' digests, so it is free to live on its
 * own. `reportExpectedDiffs` takes `reportCase` as a parameter rather
 * than importing it, so this module never imports FROM `parity.ts`:
 * `parity.ts` imports from here, never the reverse, which keeps the
 * pair acyclic (the metrics gate holds import cycles at 0).
 */
import { readFileSync } from "node:fs";

// `no-magic-numbers` is on outside tests; both of these are ordinary
// exit-code and array bookkeeping, duplicated from parity.ts rather
// than imported for the same acyclic-imports reason as `reportCase`.
const ZERO = 0;
const FAILURE = 1;
const DEFAULT_LIMIT = 20;

/**
 * The options that take no value. Kept as a Set so `parseArguments`
 * spends one branch on all of them (see the comment at its use site).
 */
const BOOLEAN_FLAGS = new Set([
  "--allow-parent-block-end",
  "--formatted-ledger",
]);

/**
 * Narrow an unknown value to a plain object with string keys.
 *
 * A small duplicate of parity.ts's own `isRecordLike` rather than an
 * import of it: that copy is one of the DUMPER's embedded,
 * SELF-CONTAINED functions, and importing it here would pull this
 * module into the embedding story for no reason. `instanceof Object`
 * excludes `null` and every primitive, same as the original.
 * @param value - anything parsed from the ledger file
 * @returns whether its properties can be read by name
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value instanceof Object;
}

/**
 * The plan-α expected-diff families — ONE closed enumeration, shared
 * by every ledger surface (spec D9). The first four may carry AST
 * differences (post-normalizer) and usually formatted ones; the last
 * two are formatted-only: the normalizer folds their tree changes, so
 * an AST difference under them is a bug, never ledger material.
 */
const FAMILIES = new Set([
  "d1-table",
  "d2-40-bytes",
  "d4-39-spelling",
  "d4-41-extent",
  "d5-fence-annotation",
  "d7-admonition-reflow",
]);

/** The families whose cases may differ in formatted output ONLY. */
const FORMATTED_ONLY_FAMILIES = new Set([
  "d5-fence-annotation",
  "d7-admonition-reflow",
]);

/** One expected-diff ledger entry: a case allowed to differ, and why. */
export interface ExpectedDiff {
  /** Corpus case id, or `fixture:<name>`. */
  id: string;
  /** The family that explains the difference (see FAMILIES). */
  family: string;
}

/**
 * Read and validate the expected-diff ledger file. The shape rule is
 * strict on purpose: a malformed ledger silently excusing everything
 * would turn the plan's central gate off.
 * @param file - path to the JSON array of `{ id, family }`
 * @returns the entries
 * @throws {TypeError} when the file is not an array of string pairs
 */
export function loadExpectedDiffs(file: string): ExpectedDiff[] {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed)) {
    throw new TypeError(`parity: ${file} is not a JSON array`);
  }
  return parsed.map((value: unknown) => {
    if (
      !isPlainRecord(value) ||
      typeof value.id !== "string" ||
      typeof value.family !== "string"
    ) {
      throw new TypeError(
        `parity: ${file} entry is not { id, family }: ${JSON.stringify(value)}`,
      );
    }
    const { id, family } = value;
    return { id, family };
  });
}

/**
 * One ledger entry's own failure, if any (spec D9 failure modes
 * ii–iv and the formatted-only cross-check). Split out from
 * {@link expectedDiffFailures} to stay under the complexity ceiling;
 * each entry produces AT MOST one failure — the inline version this
 * replaces used `continue` after the first match — so returning a
 * single value keeps the caller's ordering identical.
 * @param entry - the ledger entry to check
 * @param streams - the two differing-id sets from differingCases
 * @param streams.ast - ids whose AST differs (or one side lacks)
 * @param streams.formatted - ids differing in formatted output only
 * @param corpusIds - every id this checkout's dump produced
 * @returns the failure message, or undefined when the entry is clean
 */
function ledgerEntryFailure(
  entry: ExpectedDiff,
  streams: { ast: ReadonlySet<string>; formatted: ReadonlySet<string> },
  corpusIds: ReadonlySet<string>,
): string | undefined {
  const { id, family } = entry;
  const { ast, formatted } = streams;
  if (!FAMILIES.has(family)) {
    return `expected-diffs: unknown family ${JSON.stringify(family)} on ${id} — the enum is ${[...FAMILIES].join(" | ")}`;
  }
  if (!corpusIds.has(id)) {
    return `expected-diffs: ${id} is not in the corpus (vanished id, stale entry — delete it)`;
  }
  if (!ast.has(id) && !formatted.has(id)) {
    return `expected-diffs: ${id} no longer differs from the baseline (stale entry — delete it)`;
  }
  if (ast.has(id) && FORMATTED_ONLY_FAMILIES.has(family)) {
    return `expected-diffs: ${id} differs in the AST but ${family} is a formatted-only family`;
  }
  return undefined;
}

/**
 * The expected-diff gate: which findings fail a run under
 * `--expected-diffs` (spec D9 failure modes i–iv plus the
 * ledger/allowlist cross-check). Every returned line is a failure;
 * an empty result is a pass.
 * @param entries - the ledger entries
 * @param streams - the two differing-id lists from differingCases
 * @param streams.ast - ids whose AST differs (or one side lacks)
 * @param streams.formatted - ids differing in formatted output only
 * @param corpusIds - every id this checkout's dump produced
 * @returns one message per failure
 */
export function expectedDiffFailures(
  entries: readonly ExpectedDiff[],
  streams: { ast: readonly string[]; formatted: readonly string[] },
  corpusIds: ReadonlySet<string>,
): string[] {
  const failures: string[] = [];
  const byId = new Map(entries.map((entry) => [entry.id, entry.family]));
  const ast = new Set(streams.ast);
  const formatted = new Set(streams.formatted);
  for (const entry of entries) {
    const failure = ledgerEntryFailure(entry, { ast, formatted }, corpusIds);
    if (failure !== undefined) failures.push(failure);
  }
  for (const id of streams.ast) {
    if (!byId.has(id)) {
      failures.push(
        `parity: ${id} differs in the AST and is not in scripts/parity-expected-diffs.json`,
      );
    }
  }
  for (const id of streams.formatted) {
    if (!byId.has(id)) {
      failures.push(
        `parity: ${id} differs in formatted output and is not in scripts/parity-expected-diffs.json`,
      );
    }
  }
  return failures;
}

/**
 * The `--expected-diffs` report path: print the ledger's verdict and
 * detail exactly the ids a human must read. Split out of `report` in
 * parity.ts to stay under the complexity ceiling.
 * @param options - everything the gate and its detail pass need
 * @param options.expectedDiffs - the loaded ledger
 * @param options.ast - ids whose AST differs
 * @param options.formatted - ids differing in formatted output only
 * @param options.headIds - every id this checkout's dump produced
 * @param options.headSize - how many cases this checkout's dump
 *   produced, for the "cases match" message
 * @param options.baseRoot - the materialized baseline checkout
 * @param options.revision - the revision compared against, for the
 *   message
 * @param options.limit - how many differing cases to detail
 * @param options.allowParentBlockEnd - whether forced-closed
 *   parentBlock ends were blanked on both sides
 * @param options.reportCase - prints one case's per-side difference;
 *   injected rather than imported so this module never imports FROM
 *   parity.ts (see the module-level comment)
 */
export function reportExpectedDiffs(options: {
  expectedDiffs: readonly ExpectedDiff[];
  ast: readonly string[];
  formatted: readonly string[];
  headIds: ReadonlySet<string>;
  headSize: number;
  baseRoot: string;
  revision: string;
  limit: number;
  allowParentBlockEnd: boolean;
  reportCase: (id: string, baseRoot: string, allow: boolean) => void;
}): void {
  const {
    expectedDiffs,
    ast,
    formatted,
    headIds,
    headSize,
    baseRoot,
    revision,
    limit,
    allowParentBlockEnd,
    reportCase,
  } = options;
  const failures = expectedDiffFailures(
    expectedDiffs,
    { ast, formatted },
    headIds,
  );
  for (const line of failures) process.stdout.write(`${line}\n`);
  // Detail exactly the ids whose DIFF a human must read: unlisted
  // differing cases, and listed ones whose AST moved under a
  // formatted-only family. Exact id matching, never a substring
  // search over the failure text — a short id could select the
  // wrong case for reportCase.
  const families = new Map(
    expectedDiffs.map((entry) => [entry.id, entry.family]),
  );
  const astIds = new Set(ast);
  const needsDetail = (id: string): boolean => {
    const family = families.get(id);
    if (family === undefined) return true;
    return astIds.has(id) && FORMATTED_ONLY_FAMILIES.has(family);
  };
  const detailIds = [...new Set([...ast, ...formatted])].filter(needsDetail);
  for (const id of detailIds.slice(ZERO, limit)) {
    reportCase(id, baseRoot, allowParentBlockEnd);
  }
  if (failures.length > ZERO) {
    process.exitCode = FAILURE;
    return;
  }
  process.stdout.write(
    `parity: ${String(headSize)} cases match ${revision} (${String(ast.length + formatted.length)} expected diffs, all ledgered)\n`,
  );
}

/**
 * Validate and parse `--limit`'s argument. Split out of
 * {@link parseArguments} to stay under the complexity ceiling once
 * `--expected-diffs` added a branch there.
 * @param raw - the token after `--limit`, or undefined when it was
 *   the last argument
 * @returns the parsed limit
 * @throws {Error} when `raw` is missing or not a non-negative integer
 */
function parseLimit(raw: string | undefined): number {
  // `Number("fast")` is NaN, and `slice(0, NaN)` is empty: the run
  // would still exit 1 but print not one differing case, which
  // reads exactly like a harness that found nothing to say.
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < ZERO) {
    throw new Error(
      `parity: --limit needs a non-negative integer, got ${String(raw)}`,
    );
  }
  return limit;
}

/**
 * Parse the command line. Exported for tests/scripts/parity.test.ts.
 * @param argv - the arguments after the script name
 * @returns the base revision, the report limit, the allowlist flag,
 *   whether formatted-only differences are a ledger listing rather
 *   than a failure, and the expected-diff ledger path, if given
 * @throws {Error} when an argument is unrecognised or `--base` is
 *   missing — a silently dropped `--base` would compare a checkout
 *   with itself
 */
export function parseArguments(argv: readonly string[]): {
  revision: string;
  limit: number;
  allowParentBlockEnd: boolean;
  formattedLedger: boolean;
  expectedDiffs: string | undefined;
} {
  let revision: string | undefined = undefined;
  let limit = DEFAULT_LIMIT;
  let expectedDiffs: string | undefined = undefined;
  const flags = new Set<string>();
  // A queue rather than an index, because two of the five options
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
      limit = parseLimit(rest.shift());
      continue;
    }
    if (argument === "--expected-diffs") {
      const raw = rest.shift();
      if (raw === undefined) {
        throw new Error("parity: --expected-diffs needs a file path");
      }
      expectedDiffs = raw;
      continue;
    }
    // The two value-less options share one arm: a branch each puts this
    // function over the complexity ceiling, and a Set of accepted
    // spellings is where the third flag will go too.
    if (BOOLEAN_FLAGS.has(argument)) {
      flags.add(argument);
      continue;
    }
    throw new Error(`parity: unrecognised argument ${argument}`);
  }
  if (revision === undefined)
    throw new Error("parity: --base <rev> is required");
  return {
    revision,
    limit,
    allowParentBlockEnd: flags.has("--allow-parent-block-end"),
    formattedLedger: flags.has("--formatted-ledger"),
    expectedDiffs,
  };
}
