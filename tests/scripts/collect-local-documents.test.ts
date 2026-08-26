/**
 * The collection script's decisions (issue #13): which paths are
 * documents, which branches name one, which copy of each document to
 * take, which REF each copy is asked for by, and which files a rerun
 * may delete.
 *
 * The first four are pure functions over listings, so they are tested
 * against listings this file writes - no git repository, no network,
 * and no dependence on what somebody's checkout happens to hold
 * today. The git plumbing around them is four read-only commands
 * (`for-each-ref`, `ls-tree`, `rev-parse`, `show`) whose output these
 * functions are the only interpretation of.
 *
 * The fifth, {@link clearCollected}, is the one destructive thing the
 * script does, so it is tested against a scratch directory rather
 * than by inspection. That directory is throwaway state, not a
 * committed input: the corpus fixtures under `tests/integration/` are
 * where inputs live.
 */
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import {
  clearCollected,
  documentNumber,
  documentPlan,
  qualifiedBranch,
  numberedBranches,
  parseArguments,
} from "../../scripts/collect-local-documents.js";

describe("documentNumber", () => {
  test.each([
    ["a document path", "rfd/9901/README.adoc", "9901"],
    ["a one-digit number", "rfd/1/README.adoc", "1"],
    ["an image beside a document", "rfd/9901/diagram.svg", undefined],
    ["the subtree itself", "rfd/9901", undefined],
    ["a document one level deeper", "rfd/9901/appendix/README.adoc", undefined],
    ["another directory entirely", "prototypes/9901/README.adoc", undefined],
    ["a number that is not one", "rfd/draft/README.adoc", undefined],
    ["a differently named file", "rfd/9901/index.adoc", undefined],
  ])("%s", (_name, file, expected) => {
    expect(documentNumber(file)).toBe(expected);
  });
});

describe("numberedBranches", () => {
  test("keeps the branches whose name is a number, in order", () => {
    expect(
      numberedBranches(["9901", "master", "9903", "fix-typo", "main", "1"]),
    ).toEqual(["9901", "9903", "1"]);
  });

  test("a repository with no numbered branch yields none", () => {
    expect(numberedBranches(["master"])).toEqual([]);
  });

  test("a partly qualified name is a FAULT, not a branch to skip", () => {
    // `%(refname:short)` returns `heads/9903` when a tag shares the
    // branch's name - it disambiguates - and a filter looking for
    // digits then drops it: the in-discussion document falls out of
    // the corpus and the run still reports success. The enumeration
    // asks for `%(refname:lstrip=2)`, and this row is what makes a
    // regression to `:short` fail loudly instead of shrinking the
    // corpus quietly.
    expect(() => numberedBranches(["master", "heads/9903"])).toThrow(
      "came back partly qualified",
    );
  });

  test("an ordinary slashed branch name is skipped, not a fault", () => {
    // Only the `heads/<digits>` spelling is that disambiguation; a
    // repository full of `feature/...` branches is just a repository.
    expect(numberedBranches(["feature/9903", "9901"])).toEqual(["9901"]);
  });
});

describe("qualifiedBranch", () => {
  // Git resolves a SHORT name through refs/tags first, so a tag
  // sharing a branch's name shadows the branch - silently, and with
  // the run still reporting success over a corpus that quietly lost a
  // document. Every ref this script hands to git is qualified.
  test("qualifies a branch name", () => {
    expect(qualifiedBranch("9903")).toBe("refs/heads/9903");
  });
});

describe("documentPlan", () => {
  test("every document on the base branch is collected from it", () => {
    expect(
      documentPlan(
        "master",
        ["rfd/9902/README.adoc", "rfd/9901/README.adoc"],
        new Map(),
      ),
    ).toEqual([
      {
        number: "9901",
        ref: "refs/heads/master",
        path: "rfd/9901/README.adoc",
      },
      {
        number: "9902",
        ref: "refs/heads/master",
        path: "rfd/9902/README.adoc",
      },
    ]);
  });

  test("every ref in a plan is fully qualified", () => {
    const plan = documentPlan(
      "master",
      ["rfd/9901/README.adoc"],
      new Map([["9903", ["rfd/9903/README.adoc"]]]),
    );
    expect(plan.map((source) => source.ref)).toEqual([
      "refs/heads/master",
      "refs/heads/9903",
    ]);
  });

  test("paths that are not documents are dropped", () => {
    expect(
      documentPlan(
        "master",
        [
          "rfd/9901/README.adoc",
          "rfd/9901/diagram.svg",
          "rfd/9901/appendix/README.adoc",
        ],
        new Map(),
      ).map((source) => source.number),
    ).toEqual(["9901"]);
  });

  test("a numbered branch's own copy overrides the base's", () => {
    expect(
      documentPlan(
        "master",
        ["rfd/9901/README.adoc"],
        new Map([["9901", ["rfd/9901/README.adoc"]]]),
      ),
    ).toEqual([
      { number: "9901", ref: "refs/heads/9901", path: "rfd/9901/README.adoc" },
    ]);
  });

  test("a branch whose document the base does not carry is added", () => {
    // The motivating case: a document still under discussion has
    // never been merged, so the base branch has never heard of it.
    expect(
      documentPlan(
        "master",
        ["rfd/9901/README.adoc"],
        new Map([["9903", ["rfd/9903/README.adoc"]]]),
      ).map((source) => [source.number, source.ref]),
    ).toEqual([
      ["9901", "refs/heads/master"],
      ["9903", "refs/heads/9903"],
    ]);
  });

  test("a branch's copies of OTHER documents are ignored", () => {
    // A branch carries the whole tree, so it has a copy of every
    // other document as of the day it was cut. Collecting those would
    // fill the corpus with stale duplicates of the base's own.
    expect(
      documentPlan(
        "master",
        ["rfd/9901/README.adoc"],
        new Map([["9903", ["rfd/9901/README.adoc"]]]),
      ),
    ).toEqual([
      {
        number: "9901",
        ref: "refs/heads/master",
        path: "rfd/9901/README.adoc",
      },
    ]);
  });

  test("a branch with no document at all contributes nothing", () => {
    expect(
      documentPlan("master", ["rfd/9901/README.adoc"], new Map([["9903", []]])),
    ).toHaveLength(1);
  });

  test("an empty base tree plans nothing, which is the harness's floor", () => {
    expect(documentPlan("master", [], new Map())).toEqual([]);
  });
});

describe("clearCollected", () => {
  const scratch = mkdtempSync(path.join(tmpdir(), "local-documents-"));
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  test("removes what a previous run wrote and nothing else", () => {
    // The output directory is a directory somebody named, and the
    // documents around it are private and unpublishable - the worst
    // possible class of file to delete. Only the collector's own
    // output shape, <digits>.adoc, is ours to remove.
    for (const name of [
      "9901.adoc",
      "9902.adoc",
      "my-notes.adoc",
      "9901.adoc.bak",
      "draft-9901.adoc",
      "keep.txt",
    ]) {
      writeFileSync(path.join(scratch, name), "x");
    }
    expect(clearCollected(scratch).toSorted()).toEqual([
      "9901.adoc",
      "9902.adoc",
    ]);
    expect(readdirSync(scratch).toSorted()).toEqual([
      "9901.adoc.bak",
      "draft-9901.adoc",
      "keep.txt",
      "my-notes.adoc",
    ]);
  });

  test("an output directory with nothing of ours in it is left alone", () => {
    expect(clearCollected(scratch)).toEqual([]);
    expect(readdirSync(scratch)).toHaveLength(4);
  });
});

describe("the command line", () => {
  test("defaults leave the repository to the config file", () => {
    expect(parseArguments([])).toEqual({
      repository: undefined,
      out: undefined,
      base: "master",
      force: false,
    });
  });

  test("takes a repository, an output directory and a base branch", () => {
    expect(
      parseArguments(["--repo", "/r", "--out", "/o", "--base", "trunk"]),
    ).toEqual({
      repository: "/r",
      out: "/o",
      base: "trunk",
      force: false,
    });
  });

  test("--force is a flag, not a value", () => {
    expect(parseArguments(["--force"]).force).toBe(true);
  });

  test.each([
    ["an unknown option", ["--branch", "x"], "unknown argument --branch"],
    ["a value-less --repo", ["--repo"], "--repo needs a value"],
    [
      "a --out swallowing the next flag",
      ["--out", "--base"],
      "--out needs a value",
    ],
    ["a bare directory", ["/r"], "unknown argument /r"],
  ])("%s is an error, not a shrug", (_name, argv, message) => {
    expect(() => parseArguments(argv)).toThrow(message);
  });
});
