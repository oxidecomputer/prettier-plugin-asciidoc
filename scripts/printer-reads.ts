#!/usr/bin/env bun
/**
 * The printer-read gate: no field the fact census says the printer
 * does not read is read under `src/print/`.
 *
 * WHY IT EXISTS, in the terms the round-trip property is stated in.
 * The census (`scripts/fact-inventory.ts`) sorts every AST field into
 * FACTS and EXEMPT, and idempotence holds only if the printer
 * respects that sort: a printing decision made from a field the
 * census says nothing preserves is a decision whose input the round
 * trip is free to perturb, so pass 2 can print something else. The
 * live instance was `Node.position` (issue #204), EXEMPT under
 * "not read by the printer" while eight printer files read it, and
 * the hand method that wrote that row is the one this gate replaces.
 *
 * WHAT IT DOES NOT CHECK, and this is the boundary worth being exact
 * about. Only two of the census's seven EXEMPT reasons ASSERT that no
 * read happens; the other five judge what a read MEANS - a
 * discriminant selects a printer, a leaf string is copied out, a
 * container's arms carry the choice - and every one of those fields
 * is legitimately read. Measured with {@link printerReads} itself
 * over the shipped classification: 129 of the 156 EXEMPT rows are
 * read under `src/print/`, and a gate that failed on all of them
 * would be a gate reviewers learn to ignore. Most of that count is
 * union fan-out, since a property shared across a union's arms is
 * recorded against every arm; 34 of the 129 are read at a source line
 * that resolved to exactly one row. Both numbers are PINNED in
 * `tests/scripts/fact-inventory-reads.test.ts`, so re-deriving them
 * is running that test rather than trusting this paragraph - the
 * first version of it was measured against a resolver that stopped at
 * the first declaration and said 68 of 159, which is the shape of
 * hand-measured claim issue #204 exists to record.
 *
 * So this gate holds exactly the rows that make a checkable claim,
 * and {@link claimShapeFailures} NARROWS, without closing, the way a
 * new row could make the same claim in words this gate does not
 * recognize: it matches four spellings ("unread", "not read", "never
 * read", "no read"), and a reason saying "nothing looks at it" or
 * "constructed only" would still pass it.
 *
 * The reverse direction - a FACT nothing reads - is deliberately NOT
 * checked here. `scripts/metrics/unread-fields.ts` states why a
 * reference scan cannot answer it for the AST: every field is read by
 * the parity dumper's `JSON.stringify` and by Prettier's traversal,
 * neither of which is a property access, so "nothing reads it" is not
 * a claim this instrument can make about a serialized type.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 every claim held; 1 a claim is
 * FALSE, or a reason asserts one in a spelling the gate cannot hold;
 * 2 the gate could not run - a bad argument, an unreadable tree, a
 * scan that resolved too few reads to have run at all, or a
 * classification with no claim in it to check.
 */
import path from "node:path";
import { EXEMPT, UNREAD_CLAIMS } from "./fact-inventory-classification.js";
import {
  claimShapeFailures,
  falseUnreadClaims,
  printerReads,
} from "./fact-inventory-reads.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";

const ARGUMENT_START = 2;

const USAGE = `usage: bun scripts/printer-reads.ts [--list]

Fails when src/print reads a field the fact census classifies EXEMPT
under a reason that asserts the printer does not read it.

  --list   print every resolved read (key, then file:line) before the
           verdict, for working out where a failing row is read from
  --help   print this and exit 0`;

/**
 * The floor below which the scan proved nothing.
 *
 * The printer resolves over a thousand reads of AST fields; a run
 * that resolves a handful has lost its program (an unreadable
 * `src/ast.ts`, an import the compiler could not follow), not its
 * reads, and reporting "every claim held" from such a run is the
 * quiet failure the exit-code contract exists to prevent.
 *
 * Exported so the floor has a test at its boundary
 * (tests/scripts/printer-reads.test.ts); no other consumer.
 * @internal
 */
export const MINIMUM_READS = 200;

/** Every claim held: what the run counted, in one line. */
interface Clean {
  /** Discriminant. */
  readonly kind: "clean";
  /** The counts, for a reader who wants to see it looked at something. */
  readonly line: string;
}

/** A claim did not hold. */
interface Failed {
  /** Discriminant. */
  readonly kind: "failed";
  /** One line per failure, then the tally. */
  readonly lines: readonly string[];
}

/** Nothing was proved either way. */
interface CannotRun {
  /** Discriminant. */
  readonly kind: "cannot-run";
  /** What stopped it, without a newline. */
  readonly message: string;
}

/** What the gate has to say, once it has looked. */
export type Verdict = Clean | Failed | CannotRun;

/**
 * Read the tree and say what it found.
 *
 * Split from {@link main} so the verdict is a value a test can assert
 * on, rather than an exit code plus some text on a stream.
 * @param root - the repository root
 * @param exempt - the census's EXEMPT map, key to reason
 * @returns the verdict
 * @throws {Error} if `src/ast.ts` or `src/print/` cannot be read
 */
export function verdict(
  root: string,
  exempt: ReadonlyMap<string, string>,
): Verdict {
  const reads = printerReads(root);
  if (reads.length < MINIMUM_READS) {
    return {
      kind: "cannot-run",
      message: `printer reads: resolved ${String(reads.length)} reads under src/print, fewer than the ${String(MINIMUM_READS)} this tree has; the scan lost its program rather than its reads`,
    };
  }
  const claims = [...exempt.values()].filter((reason) =>
    UNREAD_CLAIMS.has(reason),
  ).length;
  if (claims === 0) {
    return {
      kind: "cannot-run",
      message:
        "printer reads: no EXEMPT row asserts that the printer does not read it, so this gate checked nothing",
    };
  }
  return finish(reads.length, claims, [
    ...falseUnreadClaims(reads, exempt),
    ...claimShapeFailures(exempt),
  ]);
}

/**
 * Turn the counts and the failures into the verdict.
 * @param reads - how many reads the scan resolved
 * @param claims - how many rows made a claim to check
 * @param failures - what the checks reported
 * @returns the verdict
 */
function finish(
  reads: number,
  claims: number,
  failures: readonly string[],
): Verdict {
  if (failures.length > 0) {
    return {
      kind: "failed",
      lines: [
        ...failures,
        `printer-reads: ${String(failures.length)} FAILED of ${String(claims)} claims checked`,
      ],
    };
  }
  return {
    kind: "clean",
    line: `printer-reads: ${String(claims)} unread claims hold against ${String(reads)} resolved reads`,
  };
}

/**
 * Run the gate.
 * @param list - whether to print every resolved read first
 */
function main(list: boolean): void {
  const root = path.resolve(import.meta.dirname, "..");
  if (list) {
    for (const read of printerReads(root)) {
      process.stdout.write(`${read.key}\t${read.where}\n`);
    }
  }
  const said = verdict(root, EXEMPT);
  if (said.kind === "cannot-run") {
    cannotRun(said.message);
    return;
  }
  const lines = said.kind === "failed" ? said.lines : [said.line];
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
  if (said.kind === "failed") {
    process.exitCode = GATE_FAILED;
  }
}

/**
 * The command line, or a throw naming what was not recognized.
 *
 * A silently dropped argument is how a run that checked something
 * narrower than it was asked for looks like a passing one, so
 * anything but `--list` stops the gate rather than being ignored.
 *
 * Exported so the refusal has a test
 * (tests/scripts/printer-reads.test.ts); no other consumer.
 * @internal
 * @param argv - the arguments after the script name
 * @returns whether `--list` was asked for
 * @throws {Error} on any other argument
 */
export function parseArguments(argv: readonly string[]): boolean {
  const unknown = argv.filter((argument) => argument !== "--list");
  if (unknown.length > 0) {
    throw new Error(`printer-reads: unrecognized argument ${unknown[0]}`);
  }
  return argv.includes("--list");
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(ARGUMENT_START);
    if (wantsHelp(argv)) {
      printUsage(USAGE);
    } else {
      main(parseArguments(argv));
    }
  } catch (error) {
    // A bad argument or an unreadable tree: neither checked anything,
    // so neither is a 1.
    cannotRun(error instanceof Error ? error.message : String(error));
  }
}
