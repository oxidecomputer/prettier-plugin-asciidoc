/**
 * `scripts/parity.ts`'s command-line parsing and its `--expected-diffs`
 * ledger (spec D9): `parseArguments`, the closed family enumeration,
 * the staleness/cross-check gate, and the detail-printing it drives.
 *
 * Split out of `scripts/parity.ts` to keep that file under the
 * project's `max-lines` ceiling — which is also why the two SHAPE
 * FOLDS at the bottom of this file live here (plan ruling PR-6):
 * `foldPlanAlphaShapes` and `foldPlanBetaShapes` belong to the
 * DUMPER's embedded, SELF-CONTAINED function cluster (see
 * `normalizeTree`'s JSDoc in parity.ts) and carry that cluster's
 * rules with them — no reference to anything outside their own
 * bodies, because `.toString()` embeds them into a baseline checkout
 * that has never seen this module. Everything ABOVE them only parses
 * arguments and post-processes the two dumps' digests.
 * `reportExpectedDiffs` takes `reportCase` as a parameter rather
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
 * The family sets one plan's ledger gate runs under (spec D7.2): the
 * closed enumeration, and the subset whose cases may differ in
 * formatted output only. A PARAMETER of the gate — the production
 * call site (scripts/parity.ts) passes {@link GAMMA_FAMILIES}; the
 * unit tests pass synthetic sets, so a plan's enum swap is a one-line
 * data change with no test edits.
 */
export interface FamilySets {
  /** Every family a ledger entry may cite. */
  readonly families: ReadonlySet<string>;
  /** The subset whose cases may differ in formatted output ONLY. */
  readonly formattedOnly: ReadonlySet<string>;
}

/**
 * The family ids, one declaration each — grid rows in
 * scripts/shape-registry-list-run.ts and ledger entries in
 * scripts/parity-expected-diffs.json cite these, so a rename cannot
 * orphan a spelling. The two g1 ids name the invented-`+` deletion
 * and the pseudo-run-fold corruption fix; the two g3 ids name the
 * marker families (spellings replayed, nesting fidelity restored).
 */
export const AUTHOR_PLUS_FAMILY = "g1-author-plus";
export const PSEUDO_RUN_FOLD_FAMILY = "g1-pseudo-run-fold";
export const MARKER_SPELLING_FAMILY = "g3-marker-spelling";
export const NESTING_FIDELITY_FAMILY = "g3-nesting-fidelity";

/**
 * The closed family enum. SURFACE HONESTY, not an armed
 * gate: a family id can only legally be a corpus id or an
 * identity-fixture id. The formatted-only subset is exactly the two
 * g1 families — they change BYTES only, while both g3 families ride
 * the D3 tree fold (`marker` added, `depth` dropped), so a g3 entry
 * whose AST differs is legal and a g1 entry whose AST differs fails
 * the cross-check.
 */
export const GAMMA_FAMILIES: FamilySets = {
  families: new Set([
    AUTHOR_PLUS_FAMILY,
    PSEUDO_RUN_FOLD_FAMILY,
    MARKER_SPELLING_FAMILY,
    NESTING_FIDELITY_FAMILY,
  ]),
  formattedOnly: new Set([AUTHOR_PLUS_FAMILY, PSEUDO_RUN_FOLD_FAMILY]),
};

/** One expected-diff ledger entry: a case allowed to differ, and why. */
export interface ExpectedDiff {
  /** Corpus case id, or `fixture:<name>`. */
  id: string;
  /** The family that explains the difference (see {@link FamilySets}). */
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
 * @param familySets - the plan's closed family enumeration
 * @returns the failure message, or undefined when the entry is clean
 */
function ledgerEntryFailure(
  entry: ExpectedDiff,
  streams: { ast: ReadonlySet<string>; formatted: ReadonlySet<string> },
  corpusIds: ReadonlySet<string>,
  familySets: FamilySets,
): string | undefined {
  const { id, family } = entry;
  const { ast, formatted } = streams;
  if (!familySets.families.has(family)) {
    return `expected-diffs: unknown family ${JSON.stringify(family)} on ${id} — the enum is ${[...familySets.families].join(" | ")}`;
  }
  if (!corpusIds.has(id)) {
    return `expected-diffs: ${id} is not in the corpus (vanished id, stale entry — delete it)`;
  }
  if (!ast.has(id) && !formatted.has(id)) {
    return `expected-diffs: ${id} no longer differs from the baseline (stale entry — delete it)`;
  }
  if (ast.has(id) && familySets.formattedOnly.has(family)) {
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
 * @param familySets - the plan's closed family enumeration
 * @returns one message per failure
 */
export function expectedDiffFailures(
  entries: readonly ExpectedDiff[],
  streams: { ast: readonly string[]; formatted: readonly string[] },
  corpusIds: ReadonlySet<string>,
  familySets: FamilySets,
): string[] {
  const failures: string[] = [];
  const byId = new Map(entries.map((entry) => [entry.id, entry.family]));
  const ast = new Set(streams.ast);
  const formatted = new Set(streams.formatted);
  for (const entry of entries) {
    const failure = ledgerEntryFailure(
      entry,
      { ast, formatted },
      corpusIds,
      familySets,
    );
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
 * @param options.familySets - the plan's closed family enumeration
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
  familySets: FamilySets;
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
    familySets,
    reportCase,
  } = options;
  const failures = expectedDiffFailures(
    expectedDiffs,
    { ast, formatted },
    headIds,
    familySets,
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
    return astIds.has(id) && familySets.formattedOnly.has(family);
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

// ── the DUMPER's embedded shape folds (plan ruling PR-6) ─────────────

/**
 * Narrow an unknown value to an object whose properties can be read
 * by name.
 *
 * A local duplicate of the ledger's own {@link isPlainRecord}, under
 * the name the DUMPER's embedded cluster uses: the two folds below
 * are embedded into a baseline checkout by `.toString()`, and the
 * dumper defines `isRecordLike` and `isUnknownArray` for them there.
 * The names must match, and the bodies must not reach outside
 * themselves.
 * @param value - anything at all
 * @returns whether its properties can be read by name
 */
function isRecordLike(value: unknown): value is Record<string, unknown> {
  return value instanceof Object;
}

/**
 * Narrow an unknown value to an array whose elements are unknown.
 *
 * The same local duplicate story as {@link isRecordLike}: the name is
 * the one the DUMPER's embedded copy defines.
 * @param value - anything at all
 * @returns whether it is an array
 */
function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

/**
 * Fold the plan-α shape changes so SHAPE-preserving refactors compare
 * (spec D9): a `blockAnchor` node folds to the old anchor-paragraph
 * encoding; an admonition folds `form`/`delimiter` to the old
 * spelling and blanks the body on BOTH sides (`content` → `""`,
 * `text` → `[]` — body BYTES stay policed by the formatted
 * comparison, the fixtures and the render-equality suite); the
 * `annotatedBy` key is dropped (its pin is invariant (xi), not
 * parity). Tolerates BOTH tree shapes — old and new — because the
 * dumper embeds this body into the BASELINE checkout too.
 *
 * KEY ORDER IS LOAD-BEARING: parity digests the JSON STRING, so every
 * arm constructs a fresh object with one explicit key order — never a
 * spread, which would keep each input shape's own insertion order and
 * make the two sides hash differently. The synthesized orders match
 * the old builders' literals (buildBlockAnchor, makeInlineAnchor);
 * the string-equality rows in tests/scripts/parity.test.ts pin them.
 * @param key - the reviver key
 * @param value - the revived value
 * @returns the folded value
 */
export function foldPlanAlphaShapes(key: string, value: unknown): unknown {
  if (key === "annotatedBy") return undefined;
  if (!isRecordLike(value)) return value;
  if (value.type === "blockAnchor") {
    const { id, reftext, position } = value;
    return {
      type: "paragraph",
      children: [{ type: "inlineAnchor", id, reftext, position }],
      position,
    };
  }
  if (value.type !== "admonition") return value;
  const { type, variant, form, children, position } = value;
  const paragraph = form === "paragraph";
  return {
    type,
    variant,
    form: paragraph ? "paragraph" : "delimited",
    delimiter: paragraph
      ? undefined
      : (value.delimiter ?? (form === "delimited" ? undefined : form)),
    content: "",
    children,
    text: [],
    position,
  };
}

/**
 * Fold the plan-β shape change (spec D10(e)): a `section` container
 * splices to `[heading, ...children]` IN ITS PARENT ARRAY — the
 * revive is bottom-up, so an inner section is already spliced when
 * the outer array is visited; `documentTitle` retypes to a level-0
 * `heading`; `discreteHeading`'s old `heading` key reads as `title`.
 * ONE canonical key order — `type, level, title, position` — is
 * emitted for BOTH tree shapes, because parity digests the JSON
 * STRING (pinned by the string-equality rows in
 * tests/scripts/parity-ledger.test.ts). AST-only by covenant: the
 * formatted comparison runs with ZERO allowances through the flatten.
 * @param key - the reviver key
 * @param value - the revived value
 * @returns the folded value
 */
export function foldPlanBetaShapes(key: string, value: unknown): unknown {
  if (isUnknownArray(value)) {
    // Written as one flatMap rather than a push loop so the splice
    // arm's branching sits in the callback, where the complexity
    // ceiling counts it separately — the body must stay ONE function
    // for `.toString()`, so an extracted helper is not available.
    return value.flatMap((child) => {
      if (!isRecordLike(child) || child.type !== "section") return [child];
      const { level, heading, position, children } = child;
      const node = { type: "heading", level, title: heading, position };
      return isUnknownArray(children) ? [node, ...children] : [node];
    });
  }
  if (!isRecordLike(value)) return value;
  if (value.type === "documentTitle") {
    const { title, position } = value;
    return { type: "heading", level: 0, title, position };
  }
  if (value.type === "heading") {
    const { level, title, position } = value;
    return { type: "heading", level, title, position };
  }
  if (value.type === "discreteHeading") {
    const { level, heading, title, position } = value;
    return {
      type: "discreteHeading",
      level,
      title: title ?? heading,
      position,
    };
  }
  return value;
}

/**
 * Fold the landed shape changes, both arms in place: the verbatim
 * reftext capture is invisible to corpus AST comparison — both sides
 * fold `reftext` to its trimStart() on inlineAnchor and blockAnchor
 * nodes — and a marker-bearing list folds back to the old shape,
 * dropping `marker` and re-deriving each item's `depth` from it. ONE
 * canonical key order per arm, because parity digests the JSON STRING
 * (pinned by the string-equality rows in
 * tests/scripts/parity-ledger.test.ts). Tolerates BOTH tree shapes —
 * the dumper embeds this body into the baseline checkout too.
 * @param key - the reviver key
 * @param value - the revived value
 * @returns the folded value
 */
export function foldPlanGammaShapes(key: string, value: unknown): unknown {
  if (!isRecordLike(value)) return value;
  if (value.type === "inlineAnchor" || value.type === "blockAnchor") {
    const { type, id, reftext, position } = value;
    return {
      type,
      id,
      reftext: typeof reftext === "string" ? reftext.trimStart() : reftext,
      position,
    };
  }
  if (value.type === "list" && typeof value.marker === "string") {
    // Fold BOTH sides to the OLD shape: drop `marker`, re-derive each
    // item's `depth` from it (`-` and the callout sentinel are depth
    // 1; a run's length is its depth). Items are already canonical
    // here — the reviver is bottom-up, so normalizeOneItem rewrote
    // each item before its list is visited — and the re-spelled
    // literal repeats that key order exactly.
    const OUTERMOST = 1;
    const { type, variant, marker, children, position } = value;
    const depth = marker === "-" || marker === "<>" ? OUTERMOST : marker.length;
    const items = (isUnknownArray(children) ? children : []).map((item) =>
      isRecordLike(item)
        ? {
            type: item.type,
            depth,
            checkbox: item.checkbox,
            calloutNumber: item.calloutNumber,
            inline: item.inline,
            blocks: item.blocks,
            position: item.position,
          }
        : item,
    );
    return { type, variant, children: items, position };
  }
  return value;
}
