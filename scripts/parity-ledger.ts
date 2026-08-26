/**
 * `scripts/parity.ts`'s command-line parsing and its expected-diff
 * ledger, which lives in COMMIT MESSAGES: `parseArguments`, the closed
 * family enumeration, the `Parity-Diff:` trailer scan, the
 * staleness/cross-check gate, and the detail-printing it drives.
 *
 * Split out of `scripts/parity.ts` to keep that file under the
 * project's `max-lines` ceiling — which is also why the two SHAPE
 * FOLDS at the bottom of this file live here: they belong to the
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
import { execFileSync } from "node:child_process";
import { CHILD_MAX_BUFFER, REPO_ROOT } from "./lib/checkout.js";
import { GATE_FAILED } from "./lib/cli.js";

// `no-magic-numbers` is on outside tests; these are ordinary array
// bookkeeping, duplicated from parity.ts rather than imported for the
// same acyclic-imports reason as `reportCase`. The exit code is the
// exception: it comes from the one place that states the contract.
const ZERO = 0;
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
 * The family sets the ledger gate runs under: the closed
 * enumeration, and the subset whose cases may differ in formatted
 * output only. A PARAMETER of the gate — the production call site
 * (scripts/parity.ts) passes {@link LEDGER_FAMILIES}; the
 * unit tests pass synthetic sets, so swapping the enum is a one-line
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
 * scripts/shape-registry-list-run.ts and the `Parity-Diff:` trailers
 * in commit messages cite these, so a rename cannot orphan a
 * spelling. Two name the printer's byte-only changes — the
 * invented-`+` deletion and the pseudo-run-fold corruption fix — two
 * name the marker families (author spellings replayed, nesting
 * fidelity restored), and one names the retirement of the `+` that
 * attached nothing.
 */
export const AUTHOR_PLUS_FAMILY = "author-plus";
export const PSEUDO_RUN_FOLD_FAMILY = "pseudo-run-fold";
export const MARKER_SPELLING_FAMILY = "marker-spelling";
export const NESTING_FIDELITY_FAMILY = "nesting-fidelity";
/**
 * A `+` that attached nothing is popped, renders nothing and is no
 * longer written — where the reader can prove the pop is Ruby's own.
 * Formatted-only: the field the item carries is dropped from BOTH
 * sides by parity's `normalizeOneItem`, so the record's own shape is
 * invisible here whether it exists or not.
 */
export const NO_OP_CONTINUATION_FAMILY = "no-op-continuation";
/**
 * The third and later `+` of an adjacent run is read and dropped, as
 * `parse_list_item`'s own gate always said. NOT formatted-only, and
 * one id: `lists_test.rb#consecutive list continuation lines are
 * folded#0`, whose tree moves by exactly two things — the `paragraph`
 * child holding a single `rawLine` `"+"` at offsets 67-68 goes, and
 * the item's `position.end` follows it back onto the end of the last
 * remaining content line. Its own family so the byte-only ids above
 * keep the AST cross-check armed. NOT exported: no grid row cites it,
 * and knip holds dead exports at 0.
 */
const NO_OP_CONTINUATION_TREE_FAMILY = "no-op-continuation-tree";
/**
 * One unset spelling (`:name!:` respelled `:!name:`, one fact per
 * `store_attribute`, parser.rb l.2131-41) and lowercase entry names
 * (`sanitize_attribute_name`, l.2770-71). Formatted-only: the
 * `unset` field's own shape change rides
 * {@link foldAttributeEntryUnset}, and the name's case never left the
 * printer. NOT exported, unlike the four above it: no grid row cites
 * it — attribute entries are outside every shape grid — and knip
 * holds dead exports at 0.
 */
const ATTRIBUTE_ENTRY_SPELLING_FAMILY = "attribute-entry-spelling";
/**
 * One spacing for every bracket interior Asciidoctor hands to
 * `AttributeList` — no blank around a comma, none at the edges
 * (attribute_list.rb l.30-34, l.199-201). Formatted-only: the
 * interior is an opaque slice in the AST and the rule runs at print
 * time, so no tree moves. Not exported: no grid row cites it.
 */
const ATTRLIST_SPACING_FAMILY = "attrlist-spacing";
/**
 * A shorthand xref's leading blank, trimmed (`link_text.lstrip`,
 * substitutors.rb l.746). Formatted-only: a print-time derivation
 * over a field the AST already carried. Not exported: no grid row
 * cites it.
 *
 * NAMED FOR ITS MEMBER. It was `inline-mark-spelling`, after the
 * constrained-mark respell that landed in the same commit — and that
 * half moved NOTHING: 25 unconstrained spans in 5 corpus documents,
 * in = out = 25, every one refused for a stated reason. A family id is
 * what a future reader greps for, and that one pointed away from the
 * only id in it. If a mark respell ever moves a corpus id it gets a
 * family of its own, with its own argument.
 */
const XREF_TEXT_TRIM_FAMILY = "xref-text-trim";
/**
 * A blank RUN inside a list item's gap collapses to one blank, up to
 * the gap's first `+` (a run after one erases it, parser.rb l.1576).
 * Formatted-only: the recorded gap is unchanged and the collapse
 * happens in `gapParts`. Not exported: no grid row cites it.
 */
const GAP_COLLAPSE_FAMILY = "gap-collapse";
/**
 * The erased tail behind a frozen `+` paragraph is printed back (one
 * blank and a `+` — the shield that absorbs the re-read's single
 * tagged pop, parser.rb l.1576/l.1580-82), and a list whose tail
 * keeps a `+` armed through metadata is separated from the next block
 * by TWO blanks (one attaches, l.1483). Formatted-only: the item
 * fields carrying the two facts (`detachedTail`, `activeTail`) are
 * dropped by the item canonicalization the way `trailingContinuation`
 * is, so only bytes move. Not exported: no grid row cites it.
 */
const PLUS_RUN_TAIL_KEPT_FAMILY = "plus-run-tail-kept";
/**
 * A `+` run's parse follows the JS oracle's tagged Strings: an inner
 * item scan hard-stops at the erased Placeholder (parser.js l.2168),
 * the sibling probe eats it, and a frozen `+` opened after a skipped
 * blank heads a FOLDED paragraph that runs through marker lines
 * (l.1065, l.3018-47). NOT formatted-only — the trees move (a nested
 * list splits around the `+` paragraph, marker lines become its raw
 * lines) while the bytes hold. Not exported: no grid row cites it.
 */
const PLUS_RUN_PARAGRAPH_FAMILY = "plus-run-paragraph";
/**
 * A leading U+FEFF strips off the document head before line splitting,
 * as `Helpers.prepare_source_string` always did (helpers.rb, and
 * helpers.js in the pinned JS oracle; reader.rb only calls it) - so a
 * first line the BOM used to hide behind (a doctitle, an attribute
 * entry) now reads as itself. NOT formatted-only: the bytes hold (the
 * mark is put back on the formatted head) while the tree moves - the
 * fixture's paragraph becomes the level-0 heading it always was to
 * Asciidoctor.
 * Not exported: no grid row cites it.
 */
const BOM_DOCUMENT_HEAD_FAMILY = "bom-document-head";

/**
 * The closed family enum. SURFACE HONESTY, not an armed
 * gate: a family id can only legally be a corpus id or an
 * identity-fixture id. The formatted-only subset is exactly
 * author-plus, pseudo-run-fold, no-op-continuation,
 * attribute-entry-spelling, attrlist-spacing, xref-text-trim,
 * gap-collapse and plus-run-tail-kept — they change BYTES only, while
 * both marker families ride the list tree fold (`marker` added,
 * `depth` dropped), no-op-continuation-tree drops a block the reader
 * used to build, plus-run-paragraph reshapes a `+` run's item
 * blocks, and bom-document-head re-reads the line a leading BOM hid,
 * so an entry of those five whose AST differs is legal and an
 * entry of any other family whose AST differs fails the cross-check.
 */
export const LEDGER_FAMILIES: FamilySets = {
  families: new Set([
    AUTHOR_PLUS_FAMILY,
    PSEUDO_RUN_FOLD_FAMILY,
    MARKER_SPELLING_FAMILY,
    NESTING_FIDELITY_FAMILY,
    NO_OP_CONTINUATION_FAMILY,
    NO_OP_CONTINUATION_TREE_FAMILY,
    ATTRIBUTE_ENTRY_SPELLING_FAMILY,
    ATTRLIST_SPACING_FAMILY,
    XREF_TEXT_TRIM_FAMILY,
    GAP_COLLAPSE_FAMILY,
    PLUS_RUN_TAIL_KEPT_FAMILY,
    PLUS_RUN_PARAGRAPH_FAMILY,
    BOM_DOCUMENT_HEAD_FAMILY,
  ]),
  formattedOnly: new Set([
    AUTHOR_PLUS_FAMILY,
    PSEUDO_RUN_FOLD_FAMILY,
    NO_OP_CONTINUATION_FAMILY,
    ATTRIBUTE_ENTRY_SPELLING_FAMILY,
    ATTRLIST_SPACING_FAMILY,
    XREF_TEXT_TRIM_FAMILY,
    GAP_COLLAPSE_FAMILY,
    PLUS_RUN_TAIL_KEPT_FAMILY,
  ]),
};

/** One expected-diff ledger entry: a case allowed to differ, and why. */
export interface ExpectedDiff {
  /** Corpus case id, or `fixture:<name>`. */
  id: string;
  /** The family that explains the difference (see {@link FamilySets}). */
  family: string;
}

/**
 * The trailer key a commit message declares an expected diff under.
 * Anything starting with it is MEANT to be a declaration, so a line
 * that starts with it and does not parse is a failure rather than
 * prose - a typo in a family or a missing id would otherwise excuse
 * nothing and say nothing.
 */
const TRAILER_KEY = "Parity-Diff:";

/**
 * One well-formed trailer: the key, a single-token family, then the
 * id, which runs to the end of the line because corpus ids contain
 * spaces (`lists_test.rb#consecutive list continuation lines are
 * folded#0`).
 *
 * The line is trimmed before it is matched (which is what strips a
 * CRLF message's `\r`), so a declared id can never carry leading or
 * trailing whitespace: an id whose canonical corpus spelling ends in
 * exotic whitespace could not be declared at all - it would fail as
 * not in the corpus. No vendored id is shaped that way today; a
 * re-vendor is what would change that.
 */
const TRAILER_LINE = /^Parity-Diff:\s*(?<family>\S+)\s+(?<id>\S.*)$/v;

/** What a scan of a range's commit messages found. */
export interface TrailerScan {
  /** One entry per declared id, deduped, in first-seen order. */
  readonly entries: ExpectedDiff[];
  /** One message per unparseable or contradictory declaration. */
  readonly failures: string[];
}

/**
 * Record one parsed declaration against the ids seen so far. Split
 * out of {@link parseExpectedDiffTrailers} to keep that function's
 * loop body under the complexity ceiling.
 *
 * The same id under the same family is silent however often it
 * repeats, and a contradicting family is reported ONCE per id: a
 * rebase that duplicated a pair of trailers would otherwise print the
 * same line once per repeat, which is the exact case the dedupe rule
 * exists to be quiet about.
 * @param entry - the declaration just parsed
 * @param families - id to first-seen family, mutated here
 * @param conflicts - the ids already reported as contradicted,
 *   mutated here
 * @returns the failure message, or undefined when there is none
 */
function recordTrailer(
  entry: ExpectedDiff,
  families: Map<string, string>,
  conflicts: Set<string>,
): string | undefined {
  const { id, family } = entry;
  const declared = families.get(id);
  if (declared === undefined) {
    families.set(id, family);
    return undefined;
  }
  if (declared === family || conflicts.has(id)) return undefined;
  conflicts.add(id);
  return `expected-diffs: ${id} is declared as both ${declared} and ${family} - one trailer is wrong`;
}

/**
 * Scan commit-message text for `Parity-Diff:` trailers.
 *
 * Pure, so the gate's whole declaration story is testable without a
 * repository; {@link collectExpectedDiffTrailers} is the thin shell
 * wrapper that feeds it `git log`'s output.
 *
 * The same id declared twice with the SAME family dedupes silently -
 * a rebase or a re-describe that repeats a trailer is not a mistake -
 * while the same id under two DIFFERENT families is a failure: one of
 * the two is wrong and the scan cannot know which.
 * @param text - every commit message in the range, concatenated
 * @returns the declared entries, and the declarations that failed
 */
export function parseExpectedDiffTrailers(text: string): TrailerScan {
  const families = new Map<string, string>();
  const conflicts = new Set<string>();
  const failures: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith(TRAILER_KEY)) continue;
    const match = TRAILER_LINE.exec(line);
    if (match === null) {
      failures.push(
        `expected-diffs: malformed trailer ${JSON.stringify(line)} - the syntax is "Parity-Diff: <family> <id>"`,
      );
      continue;
    }
    // `groups` is present whenever the pattern has named groups, and
    // both of these are non-optional, so both are strings here.
    const { family = "", id = "" } = match.groups ?? {};
    const failure = recordTrailer({ id, family }, families, conflicts);
    if (failure !== undefined) failures.push(failure);
  }
  const entries = [...families].map(([id, family]) => ({ id, family }));
  return { entries, failures };
}

/**
 * Run one git command in the repository root and return its stdout.
 * @param arguments_ - the command line after `git`
 * @returns what git wrote to stdout
 * @throws {Error} when git exits non-zero - an unknown revision, say
 */
function git(arguments_: readonly string[]): string {
  return execFileSync("git", [...arguments_], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: CHILD_MAX_BUFFER,
  });
}

/**
 * The declarations carried by every commit in `<base>..<head>`.
 *
 * That range is the same span the gate compares, so a trailer expires
 * on its own: once the declaring commit is behind the base, its
 * message is no longer read and its diff is no longer there to excuse.
 * An EMPTY range is refused rather than scanned. `git log a..a` exits
 * 0 with no output, so an empty range reads exactly like a clean run
 * with no declarations - and the way to get one here is to pass git's
 * `HEAD` locally: under jj, `HEAD` is the working copy's PARENT, so
 * `--base @- --expected-diffs-trailers HEAD` names one commit twice
 * and every declared id is then reported as undeclared. Measuring
 * nothing is the cannot-run case, so this throws like an unknown
 * revision does and the caller exits 2. CI cannot reach it: a push
 * range is `HEAD^..HEAD` and a pull-request range contains the
 * request's own commits.
 * @param base - the baseline revision, the gate's `--base`
 * @param head - the revision being gated
 * @returns the declared entries, and the declarations that failed
 * @throws {Error} when `git log` refuses the range, or the range is
 *   empty - neither proves anything either way, so the caller exits 2
 */
export function collectExpectedDiffTrailers(
  base: string,
  head: string,
): TrailerScan {
  if (git(["rev-list", "--count", `${base}..${head}`]).trim() === "0") {
    throw new Error(
      `parity: the trailer range ${base}..${head} contains no commits - under jj, git HEAD is the working copy's PARENT; pass the working-copy commit id from \`jj log -r @ --no-graph -T commit_id\``,
    );
  }
  return parseExpectedDiffTrailers(
    git(["log", "--format=%B", `${base}..${head}`]),
  );
}

/**
 * One ledger entry's own failure, if any: an unknown family, an id
 * that has vanished from the corpus, an id that no longer differs,
 * and the formatted-only cross-check. Split out from
 * {@link expectedDiffFailures} to stay under the complexity ceiling;
 * each entry produces AT MOST one failure — the inline version this
 * replaces used `continue` after the first match — so returning a
 * single value keeps the caller's ordering identical.
 * @param entry - the ledger entry to check
 * @param streams - the two differing-id sets from differingCases
 * @param streams.ast - ids whose AST differs (or one side lacks)
 * @param streams.formatted - ids differing in formatted output only
 * @param corpusIds - every id this checkout's dump produced
 * @param familySets - the closed family enumeration
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
    return `expected-diffs: unknown family ${JSON.stringify(family)} on ${id} - the enum is ${[...familySets.families].join(" | ")}`;
  }
  if (!corpusIds.has(id)) {
    return `expected-diffs: ${id} is not in the corpus (vanished id, stale entry - delete it)`;
  }
  if (!ast.has(id) && !formatted.has(id)) {
    return `expected-diffs: ${id} no longer differs from the baseline (stale entry - delete it)`;
  }
  if (ast.has(id) && familySets.formattedOnly.has(family)) {
    return `expected-diffs: ${id} differs in the AST but ${family} is a formatted-only family`;
  }
  return undefined;
}

/**
 * The expected-diff gate: which findings fail a run under
 * `--expected-diffs-trailers` — every failure an entry can carry (see
 * {@link ledgerEntryFailure}) plus the other direction, an id that
 * differs with NO entry excusing it. Every returned line is a
 * failure; an empty result is a pass.
 * @param entries - the declared ledger entries
 * @param streams - the two differing-id lists from differingCases
 * @param streams.ast - ids whose AST differs (or one side lacks)
 * @param streams.formatted - ids differing in formatted output only
 * @param corpusIds - every id this checkout's dump produced
 * @param familySets - the closed family enumeration
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
        `parity: ${id} differs in the AST and is not declared by a Parity-Diff trailer`,
      );
    }
  }
  for (const id of streams.formatted) {
    if (!byId.has(id)) {
      failures.push(
        `parity: ${id} differs in formatted output and is not declared by a Parity-Diff trailer`,
      );
    }
  }
  return failures;
}

/**
 * The `--expected-diffs-trailers` report path: print the ledger's
 * verdict and detail exactly the ids a human must read. Split out of
 * `report` in parity.ts to stay under the complexity ceiling.
 * @param options - everything the gate and its detail pass need
 * @param options.expectedDiffs - the entries the trailers declared
 * @param options.trailerFailures - the declarations that did not
 *   parse, or that contradicted each other; they fail the run the
 *   same way an undeclared diff does, and are printed first because a
 *   trailer that did not parse is why an id below looks undeclared
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
 * @param options.familySets - the closed family enumeration
 * @param options.reportCase - prints one case's per-side difference;
 *   injected rather than imported so this module never imports FROM
 *   parity.ts (see the module-level comment)
 */
export function reportExpectedDiffs(options: {
  expectedDiffs: readonly ExpectedDiff[];
  trailerFailures: readonly string[];
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
    trailerFailures,
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
  const failures = [
    ...trailerFailures,
    ...expectedDiffFailures(
      expectedDiffs,
      { ast, formatted },
      headIds,
      familySets,
    ),
  ];
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
    process.exitCode = GATE_FAILED;
    return;
  }
  process.stdout.write(
    `parity: ${String(headSize)} cases match ${revision} (${String(ast.length + formatted.length)} expected diffs, all ledgered)\n`,
  );
}

/**
 * Validate and parse `--limit`'s argument. Split out of
 * {@link parseArguments} to stay under the complexity ceiling once
 * `--expected-diffs-trailers` added a branch there.
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
 *   than a failure, and the head revision whose `Parity-Diff`
 *   trailers arm the ledger gate, if given
 * @throws {Error} when an argument is unrecognised or `--base` is
 *   missing — a silently dropped `--base` would compare a checkout
 *   with itself
 */
export function parseArguments(argv: readonly string[]): {
  revision: string;
  limit: number;
  allowParentBlockEnd: boolean;
  formattedLedger: boolean;
  expectedDiffsTrailers: string | undefined;
} {
  let revision: string | undefined = undefined;
  let limit = DEFAULT_LIMIT;
  let expectedDiffsTrailers: string | undefined = undefined;
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
    if (argument === "--expected-diffs-trailers") {
      const raw = rest.shift();
      if (raw === undefined) {
        throw new Error("parity: --expected-diffs-trailers needs a revision");
      }
      expectedDiffsTrailers = raw;
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
    expectedDiffsTrailers,
  };
}

// ── the DUMPER's embedded shape folds ────────────────────────────────

/**
 * Narrow an unknown value to an object whose properties can be read
 * by name.
 *
 * The narrowing every fold below opens with, spelled under the name
 * the DUMPER's embedded cluster uses: those folds are embedded into a
 * baseline checkout by `.toString()`, and the dumper defines
 * `isRecordLike` and `isUnknownArray` for them there. The names must
 * match, and the bodies must not reach outside themselves.
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
 * Fold the anchor and admonition shape changes so SHAPE-preserving
 * refactors compare: a `blockAnchor` node folds back to the old
 * anchor-paragraph encoding; an admonition folds `form`/`delimiter`
 * to the old
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
export function foldAnchorAndAdmonitionShapes(
  key: string,
  value: unknown,
): unknown {
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
 * Fold the section and heading shape changes: a `section` container
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
export function foldSectionAndHeadingShapes(
  key: string,
  value: unknown,
): unknown {
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
 * Fold the marker and reftext shape changes, both arms in place: the
 * verbatim
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
export function foldMarkerAndReftextShapes(
  key: string,
  value: unknown,
): unknown {
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

/**
 * Fold the attribute-entry unset shape change: `unset` was
 * `false | "prefix" | "suffix"` — which `!` spelling the author used —
 * and is now the boolean fact both spellings mean. BOTH sides fold to
 * the boolean, so the retirement of the spelling is invisible to AST
 * comparison and the BYTES stay policed by the formatted comparison
 * (the `attribute-entry-spelling` ledger family).
 *
 * ONE canonical key order — `type, name, value, unset, position`, the
 * builder's literal — because parity digests the JSON STRING; a
 * `value` of undefined drops the key on both sides, as it always did.
 * Tolerates both tree shapes: the dumper embeds this body into the
 * baseline checkout too.
 * @param key - the reviver key
 * @param value - the revived value
 * @returns the folded value
 */
export function foldAttributeEntryUnset(key: string, value: unknown): unknown {
  if (!isRecordLike(value) || value.type !== "attributeEntry") return value;
  const { type, name, unset, position } = value;
  return { type, name, value: value.value, unset: unset !== false, position };
}
