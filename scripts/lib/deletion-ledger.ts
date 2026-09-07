/**
 * What a change has to say before it may delete a fact from `src`.
 *
 * WHY A GATE AND NOT A REVIEW HABIT. Almost everything under
 * `src/parse` and `src/print` exists because some document rendered
 * wrong once. The code says WHAT it does; the issue it closed says
 * WHY, and that reason is not in the tree. So a deletion looks
 * exactly like a simplification right up until the document that
 * needed it comes back, and the review question ("is anything still
 * relying on this?") is the one a reader cannot answer by reading.
 *
 * The declaration is therefore derived from the DIFF, not from a
 * list of intentions: the gate reads what the change actually removed
 * from the published surface of `src` and requires an entry for each
 * removal. An entry nobody can fill in is a deletion nobody should
 * make.
 *
 * WHAT AN ENTRY HAS TO CARRY, and why each field is not optional:
 *
 * - `issue`: the closed issue whose fix the symbol was. Without it
 *   the deletion has no history at all.
 * - `witness`: that issue's reproduction, verbatim. A remembered
 *   witness is a different document from the one that failed.
 * - `bindingRow`: the row of a measured table that makes the witness
 *   a fixed point. This is what says the behaviour is still required
 *   after the symbol is gone, and where it is now required FROM.
 * - `redTest`: a test that fails when that row's fact is flipped in
 *   ONE file. A binding row nothing reddens under is a row nothing
 *   holds, and a mutant scoped to one file is what proves the test
 *   reaches the row rather than the feature.
 * - `direction`: whether the change leaves the behaviour WIDER or
 *   NARROWER than today. Both are legitimate; not knowing which is
 *   not.
 * - `hold`: any other change this one may not land without, or the
 *   word `none`. A deletion that is only safe once a second change
 *   lands is the shape that gets half-landed.
 *
 * This module is the pure half: the record, its shape, and the
 * complaints. The command line and the two checkouts live in
 * `scripts/deletion-gate.ts`.
 */
import { readFileSync } from "node:fs";

/** Where the declarations live. */
export const DELETIONS_PATH = "scripts/deletions.json";

/**
 * Which way a deletion moves the behaviour it leaves behind.
 *
 * A set rather than a union type, because the value arrives from a
 * JSON file: a union would say the field is one of two words while
 * nothing had checked, and the check is the point.
 */
const DIRECTIONS: ReadonlySet<string> = new Set(["wider", "narrower"]);

/** One declared deletion. */
export interface Deletion {
  /** The removed name, as `file:name` in the BASE checkout. */
  readonly symbol: string;
  /** The closed issue whose fix it was, as a number. */
  readonly issue: number;
  /** That issue's reproduction, verbatim. */
  readonly witness: string;
  /** The measured row that makes the witness a fixed point. */
  readonly bindingRow: string;
  /** The test that reddens under a one-file mutant of that row. */
  readonly redTest: string;
  /** The mutant: which arm of the fact is flipped, in which file. */
  readonly mutant: string;
  /**
   * `wider` or `narrower`. Typed as a string because the file is
   * written by hand and a third word has to reach the gate to be
   * refused by it.
   */
  readonly direction: string;
  /** Another change this one may not land without, or `none`. */
  readonly hold: string;
}

/** How short a field may be before it is not an answer. */
const SHORTEST_ANSWER = 8;

/**
 * Reads the declarations.
 * @param path - the declarations file, defaulting to the standing one
 * @returns the declared deletions
 */
export function loadDeletions(path: string = DELETIONS_PATH): Deletion[] {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- our own committed declaration file; every field it must carry is checked by deletionFailures
  return JSON.parse(readFileSync(path, "utf8")) as Deletion[];
}

/**
 * What is wrong with one entry, ignoring whether the symbol was
 * actually deleted.
 * @param entry - a declared deletion
 * @param fileExists - whether a repo-relative path exists, passed in
 *   so this stays a pure function over a tree it does not read
 * @returns one complaint per unusable field
 */
function entryFailures(
  entry: Deletion,
  fileExists: (path: string) => boolean,
): string[] {
  const failures: string[] = [];
  if (!Number.isInteger(entry.issue) || entry.issue <= 0) {
    failures.push(`${entry.symbol}: issue is not an issue number`);
  }
  for (const [field, value] of [
    ["witness", entry.witness],
    ["bindingRow", entry.bindingRow],
    ["mutant", entry.mutant],
  ] as const) {
    if (value.trim().length < SHORTEST_ANSWER) {
      failures.push(
        `${entry.symbol}: ${field} is empty or too short to be an answer`,
      );
    }
  }
  if (!fileExists(entry.redTest)) {
    failures.push(
      `${entry.symbol}: redTest names ${entry.redTest}, which is not a file in this checkout`,
    );
  }
  if (!DIRECTIONS.has(entry.direction)) {
    failures.push(
      `${entry.symbol}: direction is ${JSON.stringify(entry.direction)}, which is neither wider nor narrower`,
    );
  }
  if (entry.hold.trim() === "") {
    failures.push(
      `${entry.symbol}: hold is empty; write "none" to say there is no cross-change hold`,
    );
  }
  return failures;
}

/**
 * Everything wrong with a change's deletions: an undeclared removal,
 * a declaration for a symbol the change did not remove, and a
 * declaration that does not answer.
 *
 * A STALE declaration fails as loudly as a missing one, on the same
 * reasoning the parity ledger uses: a declaration nothing checks is a
 * declaration that outlives the change it described, and the next
 * reader takes it for a live one.
 * @param deleted - the `file:name` entries the base published and the
 *   head does not
 * @param declared - the declarations as they stand
 * @param fileExists - whether a repo-relative path exists in the head
 *   checkout
 * @returns one complaint per fault, empty when the change is declared
 */
export function deletionFailures(
  deleted: readonly string[],
  declared: readonly Deletion[],
  fileExists: (path: string) => boolean,
): string[] {
  const bySymbol = new Map(declared.map((entry) => [entry.symbol, entry]));
  const removed = new Set(deleted);
  const failures: string[] = [];
  for (const symbol of deleted) {
    if (!bySymbol.has(symbol)) {
      failures.push(
        `${symbol} is gone from src and nothing declares why; add an entry to ${DELETIONS_PATH} naming the issue it closed, that issue's witness, the row that keeps the witness a fixed point, the test that reddens under a one-file mutant of that row, the direction, and any hold`,
      );
    }
  }
  for (const entry of declared) {
    if (removed.has(entry.symbol)) {
      failures.push(...entryFailures(entry, fileExists));
      continue;
    }
    failures.push(
      `${entry.symbol} is declared deleted and is still published by src; a stale declaration reads as a live one`,
    );
  }
  return failures;
}
