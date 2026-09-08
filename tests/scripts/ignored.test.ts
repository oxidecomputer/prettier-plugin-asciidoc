/**
 * Unit tests for `scripts/lib/ignored.ts`: which patterns are read,
 * what each shape matches, and what is deliberately not claimed.
 *
 * The rows are over ignore text written here, because the rule is a
 * decision and not a directory; the one row that reads a file reads
 * THIS repository's own `.gitignore`, which is where the gate's own
 * question is settled.
 */
import path from "node:path";
import { describe, expect, test } from "vitest";
import { ignoreRules, ignoredIn } from "../../scripts/lib/ignored.js";

/** The repository root, from this test file's own location. */
const ROOT = path.resolve(import.meta.dirname, "../..");

describe("the patterns an ignore file writes", () => {
  test("a directory pattern with a path is anchored to the root", () => {
    const ignored = ignoreRules("docs/notes/\n");
    expect(ignored("docs/notes/a.md")).toBe(true);
    expect(ignored("docs/notes")).toBe(true);
    expect(ignored("docs/a.md")).toBe(false);
    expect(ignored("other/docs/notes/a.md")).toBe(false);
  });

  test("a leading separator anchors and is no part of the path", () => {
    // No repo-relative path opens with a separator, so a pattern that
    // kept its leading one could never match, not even the root file
    // it names.
    const ignored = ignoreRules("/foo.txt\n");
    expect(ignored("foo.txt")).toBe(true);
    expect(ignored("a/foo.txt")).toBe(false);
  });

  test("a bare name matches a segment at any depth", () => {
    // Which is git's rule for a pattern with no separator in it, and
    // what `node_modules/` relies on.
    const ignored = ignoreRules("node_modules/\n");
    expect(ignored("node_modules/x/y.ts")).toBe(true);
    expect(ignored("src/node_modules/y.ts")).toBe(true);
    expect(ignored("src/reader.ts")).toBe(false);
  });

  test("a file pattern names one file, not a prefix of others", () => {
    const ignored = ignoreRules("scripts/local.config.json\n");
    expect(ignored("scripts/local.config.json")).toBe(true);
    expect(ignored("scripts/local.config.json.bak")).toBe(false);
  });

  test("a comment and a blank line are not patterns", () => {
    const ignored = ignoreRules("# docs/notes/\n\n   \n");
    expect(ignored("docs/notes/a.md")).toBe(false);
  });

  test("a glob is read as no rule, which is the loud direction", () => {
    // An unreadable pattern makes the walk see MORE than git would, so
    // it can report a file it should have skipped and can never skip
    // one it should have read.
    const ignored = ignoreRules("docs/*.tmp\n!keep\n");
    expect(ignored("docs/a.tmp")).toBe(false);
    expect(ignored("keep")).toBe(false);
  });

  test("a checkout with no ignore file ignores nothing", () => {
    expect(ignoredIn(path.join(ROOT, "tests"))("anything")).toBe(false);
  });
});

describe("this repository's own ignore file", () => {
  const ignored = ignoredIn(ROOT);

  test("an untracked note under docs is not this repository's to answer for", () => {
    // Red before the change: the citation gate walked `docs`
    // recursively, read a directory of untracked working documents,
    // and reported the deleted names they name.
    expect(ignored("docs/superpowers/plans/a.md")).toBe(true);
    expect(ignored("docs/harnesses.md")).toBe(false);
  });

  test("the machine-local JSON under scripts is ignored too", () => {
    // The note scan reads every JSON under `scripts` and `tests`, and
    // this one is per-machine.
    expect(ignored("scripts/local-documents.config.json")).toBe(true);
    expect(ignored("scripts/metrics/score-minimums.json")).toBe(false);
  });

  test("the trees the gate reads are not ignored", () => {
    expect(ignored("scripts/internal-citations.ts")).toBe(false);
    expect(ignored("src/print/reflow.ts")).toBe(false);
    expect(ignored("node_modules/typescript/lib/typescript.js")).toBe(true);
  });
});
