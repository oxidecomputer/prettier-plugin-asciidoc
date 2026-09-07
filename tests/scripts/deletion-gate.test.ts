/**
 * The deletion gate's decisions, over synthetic deletion sets, plus
 * its exit-code contract.
 *
 * The decisions are a pure function of three things (what the diff
 * removed, what the declarations say, and whether a named test file
 * exists), which is why they are here and not behind a `--base`: a
 * suite that could only exercise this by materializing two revisions
 * would exercise it never.
 */
import { describe, expect, test } from "vitest";
import {
  deletionFailures,
  DELETIONS_PATH,
  loadDeletions,
  type Deletion,
} from "../../scripts/lib/deletion-ledger.js";
import { CANNOT_RUN, runCli } from "./cli-runner.js";

const SCRIPT = "scripts/deletion-gate.ts";

/** A complete declaration, which every row below varies one field of. */
const COMPLETE: Deletion = {
  symbol: "src/parse/lines/reader.ts:heldMetadataRun",
  issue: 119,
  witness: "// a comment carrying a term separator ::\nterm:: description\n",
  bindingRow: "join.ts holds a comment line where the author wrote it",
  redTest: "tests/scripts/deletion-gate.test.ts",
  mutant: "flip the comment arm of the join rule in src/print/join.ts",
  direction: "narrower",
  hold: "none",
};

/**
 * Stands in for the file check, saying every path exists, so a row
 * that means to vary another field is not also varying this one.
 * @returns true, always
 */
function everyFileExists(): boolean {
  return true;
}

describe("what a change has to say before it deletes a fact", () => {
  test("an undeclared deletion fails, and the message says what to write", () => {
    const failures = deletionFailures(
      ["src/print/join.ts:joinsOntoTermLine"],
      [],
      everyFileExists,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("nothing declares why");
    expect(failures[0]).toContain(DELETIONS_PATH);
  });

  test("a complete declaration for a real deletion passes", () => {
    expect(
      deletionFailures([COMPLETE.symbol], [COMPLETE], everyFileExists),
    ).toEqual([]);
  });

  test("a declaration for a symbol that is still published fails", () => {
    // A stale declaration is as bad as a missing one: it outlives the
    // change it described and the next reader takes it for a live
    // record of why something is gone.
    const failures = deletionFailures([], [COMPLETE], everyFileExists);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("still published");
  });

  test("a witness too short to be a witness fails", () => {
    const failures = deletionFailures(
      [COMPLETE.symbol],
      [{ ...COMPLETE, witness: "  " }],
      everyFileExists,
    );
    expect(failures).toEqual([
      `${COMPLETE.symbol}: witness is empty or too short to be an answer`,
    ]);
  });

  test("a red test that is not a file fails", () => {
    const failures = deletionFailures(
      [COMPLETE.symbol],
      [COMPLETE],
      () => false,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("not a file in this checkout");
  });

  test("an empty hold fails, because `none` is the way to say there is none", () => {
    const failures = deletionFailures(
      [COMPLETE.symbol],
      [{ ...COMPLETE, hold: "" }],
      everyFileExists,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('write "none"');
  });

  test("a direction that is neither wider nor narrower fails", () => {
    // The field is typed, and a JSON file is not typed: before this
    // check a declaration spelling "sideways" passed the gate and
    // said nothing about the change.
    // The field is a string because the file is written by hand, so
    // a third word reaches the gate rather than being excluded by a
    // type nothing enforces on JSON.
    const failures = deletionFailures(
      [COMPLETE.symbol],
      [{ ...COMPLETE, direction: "sideways" }],
      everyFileExists,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("neither wider nor narrower");
  });

  test("an issue that is not an issue number fails", () => {
    const failures = deletionFailures(
      [COMPLETE.symbol],
      [{ ...COMPLETE, issue: 0 }],
      everyFileExists,
    );
    expect(failures).toEqual([
      `${COMPLETE.symbol}: issue is not an issue number`,
    ]);
  });

  test("the committed declarations parse and name this revision's deletions", () => {
    // The file is scoped to the change CI measures, which is the
    // revision it checks out against that revision's parent: the gate
    // derives the deleted set from base-to-head, so an entry whose
    // deletion is already IN the base declares a symbol the diff no
    // longer removes, and the stale check fails it as loudly as a
    // missing one. This revision removes one published name, so the
    // file carries exactly its row and the pin names it; the next
    // revision empties the file again.
    expect(loadDeletions().map((entry) => entry.symbol)).toEqual([
      "src/line-verdict.ts:BlockOpening",
    ]);
  });
});

describe("the deletion gate's exit-code contract", () => {
  test("no base revision is a harness failure, not an empty deletion set", () => {
    expect(runCli(SCRIPT, [])).toBe(CANNOT_RUN);
  });

  test("--base with nothing after it is a harness failure, not a crash", () => {
    // It crashed with a TypeError, exit 1, which reads as "the gate
    // failed" - the one answer it must never give when it did not
    // run.
    expect(runCli(SCRIPT, ["--base"])).toBe(CANNOT_RUN);
  });

  test("an argument after the revision is a harness failure", () => {
    expect(runCli(SCRIPT, ["--base", "HEAD", "--everything"])).toBe(CANNOT_RUN);
  });

  test("asking for help passes", () => {
    expect(runCli(SCRIPT, ["--help"])).toBe(0);
  });
});
