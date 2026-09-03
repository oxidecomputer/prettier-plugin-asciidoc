/**
 * The ledger's DECLARATION half: the `Parity-Diff:` commit-message
 * trailer scan, and the `git log` wrapper that feeds it a range.
 *
 * Split out of `scripts/parity-ledger.ts` to keep that file under the
 * project's `max-lines` ceiling, mirroring the test tree's existing
 * split (`tests/scripts/parity-trailers.test.ts`). Everything here
 * PARSES or COLLECTS a declaration; the gate that turns a scan result
 * into a pass or a failure (`expectedDiffFailures`,
 * `reportExpectedDiffs`) stays in `parity-ledger.ts`, which is why
 * this module imports {@link ExpectedDiff} from there rather than the
 * reverse, so the pair stays acyclic (the metrics gate holds import
 * cycles at 0).
 */
import { execFileSync } from "node:child_process";
import { CHILD_MAX_BUFFER, REPO_ROOT } from "./lib/checkout.js";
import type { ExpectedDiff } from "./parity-ledger.js";

/**
 * The trailer key a commit message declares an expected diff under.
 * Anything starting with it is MEANT to be a declaration, so a line
 * that starts with it and does not parse is a failure rather than
 * prose - a typo in a family or a missing id would otherwise excuse
 * nothing and say nothing.
 */
const TRAILER_KEY = "Parity-Diff:";

/**
 * One well-formed trailer: the key, a single-token family, then an
 * OPTIONAL id, which runs to the end of the line because corpus ids
 * contain spaces (`lists_test.rb#consecutive list continuation lines
 * are folded#0`).
 *
 * With the id, the trailer excuses that one case whatever it did.
 * WITHOUT it - the BARE form - the trailer excuses every case whose
 * bytes are identical and whose AST differs only in the keys the
 * family owns ({@link FamilySets.blanketKeys}, `parity-ledger.ts`);
 * that is the form a schema change takes, where a per-id list would
 * be a thousand lines carrying one fact.
 *
 * The line is trimmed before it is matched (which is what strips a
 * CRLF message's `\r`), so a declared id can never carry leading or
 * trailing whitespace: an id whose canonical corpus spelling ends in
 * exotic whitespace could not be declared at all - it would fail as
 * not in the corpus. No vendored id is shaped that way today; a
 * re-vendor is what would change that.
 */
const TRAILER_LINE = /^Parity-Diff:\s*(?<family>\S+)\s+(?<id>\S.*)$/v;

/**
 * The BARE form of {@link TRAILER_LINE}: the key and a family, and
 * nothing after it. A separate pattern rather than an optional group,
 * because a group that may not match reads back as `string` from
 * `match.groups` and the two forms would then be told apart by a
 * condition the types say cannot happen.
 */
const BARE_TRAILER_LINE = /^Parity-Diff:\s*(?<family>\S+)$/v;

/** What a scan of a range's commit messages found. */
export interface TrailerScan {
  /** One entry per declared id, deduped, in first-seen order. */
  readonly entries: ExpectedDiff[];
  /**
   * The families declared with a BARE trailer, deduped, in first-seen
   * order.
   *
   * A family may be declared both ways in one range, and the two DO
   * interact: a per-id line for an id the bare trailer covers declares
   * nothing and is reported as a failure naming both
   * (`blanketCoverage`, scripts/parity-keys.ts, carries the argument).
   * Per-id lines for ids the blanket cannot prove are untouched, which
   * is the combination an author actually wants - one bare line for
   * the schema key, one per-id line for each case that moved for some
   * other reason.
   */
  readonly blanket: string[];
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
  if (declared === family || conflicts.has(id)) {
    return undefined;
  }
  conflicts.add(id);
  return `expected-diffs: ${id} is declared as both ${declared} and ${family} - one trailer is wrong`;
}

/**
 * The family a BARE trailer declares, or undefined when the line is
 * not one. Split out of {@link parseExpectedDiffTrailers} so that
 * function's loop keeps one branch per FORM rather than one per
 * pattern, which is what its complexity budget buys.
 * @param line - one trimmed message line, already known to start with
 *   the trailer key
 * @returns the family, or undefined when the line carries an id (or
 *   nothing at all)
 */
function bareFamily(line: string): string | undefined {
  const match = BARE_TRAILER_LINE.exec(line);
  // `groups` is present whenever the pattern has named groups, and
  // this one is non-optional, so it is a string here.
  return match === null ? undefined : (match.groups?.family ?? "");
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
  const blanket = new Set<string>();
  const failures: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith(TRAILER_KEY)) {
      continue;
    }
    const bare = bareFamily(line);
    if (bare !== undefined) {
      blanket.add(bare);
      continue;
    }
    const match = TRAILER_LINE.exec(line);
    if (match === null) {
      failures.push(
        `expected-diffs: malformed trailer ${JSON.stringify(line)} - the syntax is "Parity-Diff: <family> <id>", or "Parity-Diff: <family>" for a family that declares the AST keys it owns`,
      );
      continue;
    }
    // `groups` is present whenever the pattern has named groups, and
    // both of these are non-optional, so both are strings here.
    const { family = "", id = "" } = match.groups ?? {};
    const failure = recordTrailer({ id, family }, families, conflicts);
    if (failure !== undefined) {
      failures.push(failure);
    }
  }
  const entries = [...families].map(([id, family]) => ({ id, family }));
  return { entries, blanket: [...blanket], failures };
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
