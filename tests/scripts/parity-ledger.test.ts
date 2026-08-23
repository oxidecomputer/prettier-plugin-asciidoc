/**
 * Unit tests for `scripts/parity.ts`'s `--expected-diffs` ledger (spec
 * D9): the loader's malformed-ledger TypeErrors, the family enum, the
 * staleness/cross-check gate, and the three normalizer folds it
 * depends on.
 *
 * Split out of tests/scripts/parity.test.ts to keep that file under
 * the project's `max-lines` ceiling — this file mirrors
 * scripts/parity-ledger.ts the same way parity.test.ts mirrors
 * scripts/parity.ts's own dumper/comparison engine.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";
import type { ExpectedDiff } from "../../scripts/parity.js";
import {
  expectedDiffFailures,
  normalizeTree,
  parseArguments,
} from "../../scripts/parity.js";
import { loadExpectedDiffs } from "../../scripts/parity-ledger.js";

/**
 * Build one ledger entry for a test row.
 * @param id - the corpus case id to allow a difference for
 * @param family - the family that explains the difference
 * @returns the entry
 */
const entry = (id: string, family: string): ExpectedDiff => ({ id, family });

describe("expected-diff ledger (spec D9)", () => {
  const corpus = new Set(["a", "b", "c", "fixture:x"]);

  test("a clean run with an empty ledger has no failures", () => {
    expect(
      expectedDiffFailures([], { ast: [], formatted: [] }, corpus),
    ).toEqual([]);
  });

  test("(i) an unlisted AST difference fails", () => {
    const failures = expectedDiffFailures(
      [],
      { ast: ["a"], formatted: [] },
      corpus,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("a");
    expect(failures[0]).toContain("not in scripts/parity-expected-diffs.json");
  });

  test("(i) an unlisted formatted difference fails", () => {
    const failures = expectedDiffFailures(
      [],
      { ast: [], formatted: ["b"] },
      corpus,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("b");
  });

  test("a listed AST difference in an AST-capable family passes", () => {
    expect(
      expectedDiffFailures(
        [entry("a", "d1-table")],
        { ast: ["a"], formatted: [] },
        corpus,
      ),
    ).toEqual([]);
  });

  test("a listed formatted-only difference passes in any family", () => {
    expect(
      expectedDiffFailures(
        [entry("a", "d1-table"), entry("b", "d7-admonition-reflow")],
        { ast: [], formatted: ["a", "b"] },
        corpus,
      ),
    ).toEqual([]);
  });

  test("(ii) a listed case that does not differ is stale", () => {
    const failures = expectedDiffFailures(
      [entry("a", "d1-table")],
      { ast: [], formatted: [] },
      corpus,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("stale");
  });

  test("(iii) a listed id missing from the corpus is stale", () => {
    const failures = expectedDiffFailures(
      [entry("zz", "d1-table")],
      { ast: [], formatted: [] },
      corpus,
    );
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("zz");
  });

  test("(iv) a family outside the enum fails", () => {
    const failures = expectedDiffFailures(
      [entry("a", "d9-typo")],
      { ast: ["a"], formatted: [] },
      corpus,
    );
    expect(failures.some((line) => line.includes("d9-typo"))).toBe(true);
  });

  test("a formatted-only family may not carry an AST difference", () => {
    const failures = expectedDiffFailures(
      [entry("a", "d5-fence-annotation")],
      { ast: ["a"], formatted: [] },
      corpus,
    );
    expect(failures.some((line) => line.includes("formatted-only"))).toBe(true);
  });

  test("parseArguments accepts --expected-diffs with a path", () => {
    expect(
      parseArguments([
        "--base",
        "x",
        "--expected-diffs",
        "scripts/parity-expected-diffs.json",
      ]),
    ).toEqual({
      revision: "x",
      limit: 20,
      allowParentBlockEnd: false,
      formattedLedger: false,
      expectedDiffs: "scripts/parity-expected-diffs.json",
    });
  });

  test("--expected-diffs without a path is an error", () => {
    expect(() => parseArguments(["--base", "x", "--expected-diffs"])).toThrow(
      "--expected-diffs needs a file path",
    );
  });
});

/**
 * Write `contents` to a fresh temp ledger file.
 *
 * Returns the path plus a cleanup callback, rather than taking a body
 * callback: a wrapping callback here would put the `expect(() => ...)`
 * thunk every malformed-input test needs at four levels of nested
 * callbacks, one past `max-nested-callbacks`.
 * @param contents - the file's raw contents
 * @returns the file's path, and a cleanup callback for the caller's
 *   `finally` to remove the temp directory
 */
function ledgerFile(contents: string): { file: string; cleanup: () => void } {
  const directory = mkdtempSync(path.join(tmpdir(), "expected-diffs-test-"));
  const file = path.join(directory, "ledger.json");
  writeFileSync(file, contents);
  return {
    file,
    cleanup: () => {
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

describe("loadExpectedDiffs (spec D9 ledger strictness)", () => {
  // A malformed ledger silently excusing everything would turn the
  // plan's central gate off (the loader's own JSDoc says so) — each
  // of loadExpectedDiffs's two throw sites gets a dedicated row here
  // pinning both the error's TYPE and its exact message, the way
  // tests/conformance/loader.test.ts pins parseJsonl's malformed-line
  // throw.

  test("accepts a well-formed ledger", () => {
    const { file, cleanup } = ledgerFile(
      '[{"id":"a","family":"d1-table"},{"id":"b","family":"d7-admonition-reflow"}]\n',
    );
    try {
      expect(loadExpectedDiffs(file)).toEqual([
        { id: "a", family: "d1-table" },
        { id: "b", family: "d7-admonition-reflow" },
      ]);
    } finally {
      cleanup();
    }
  });

  test("rejects a JSON root that is not an array", () => {
    const { file, cleanup } = ledgerFile('{"id":"a","family":"d1-table"}\n');
    try {
      expect(() => loadExpectedDiffs(file)).toThrow(TypeError);
      expect(() => loadExpectedDiffs(file)).toThrowError(
        `parity: ${file} is not a JSON array`,
      );
    } finally {
      cleanup();
    }
  });

  test("rejects an entry that is not an object", () => {
    const { file, cleanup } = ledgerFile('["a"]\n');
    try {
      expect(() => loadExpectedDiffs(file)).toThrow(TypeError);
      expect(() => loadExpectedDiffs(file)).toThrowError(
        `parity: ${file} entry is not { id, family }: "a"`,
      );
    } finally {
      cleanup();
    }
  });

  test("rejects an entry missing a string id", () => {
    const { file, cleanup } = ledgerFile('[{"family":"d1-table"}]\n');
    try {
      expect(() => loadExpectedDiffs(file)).toThrow(TypeError);
      expect(() => loadExpectedDiffs(file)).toThrowError(
        `parity: ${file} entry is not { id, family }: {"family":"d1-table"}`,
      );
    } finally {
      cleanup();
    }
  });

  test("rejects an entry missing a string family", () => {
    const { file, cleanup } = ledgerFile('[{"id":"a","family":42}]\n');
    try {
      expect(() => loadExpectedDiffs(file)).toThrow(TypeError);
      expect(() => loadExpectedDiffs(file)).toThrowError(
        `parity: ${file} entry is not { id, family }: {"id":"a","family":42}`,
      );
    } finally {
      cleanup();
    }
  });
});

/**
 * The digest `normalizeTree` produces, with the allowlist flag off.
 * @param tree - a tree (real or hand-built) to fold and stringify
 * @returns the canonical JSON string
 */
const canonical = (tree: unknown): string =>
  JSON.stringify(normalizeTree(tree, false));

describe("the three shape folds (spec D9 normalizer) — string equality, never toEqual", () => {
  // Parity compares digest(JSON.stringify(normalizeTree(...))) — the
  // STRING — so key order is load-bearing, and toEqual (key-order-
  // insensitive) cannot see an order break. Every row below asserts
  // the serialized string. The old-shape literals are spelled in the
  // real builders' key order (build/metadata.ts buildBlockAnchor,
  // inline-link-builder.ts makeInlineAnchor:153-166,
  // build/paragraph.ts buildAdmonitionParagraph, and the
  // spec-D4-deleted paragraph-form.ts's styledConversion); that
  // spelling IS the assertion.
  const position = {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 5, line: 1, column: 6 },
  };

  test("a blockAnchor folds to the old encoding's exact JSON string", () => {
    const folded = canonical({
      type: "blockAnchor",
      id: "a",
      reftext: "b",
      position,
    });
    const oldEncoding = canonical({
      type: "paragraph",
      children: [{ type: "inlineAnchor", id: "a", reftext: "b", position }],
      position,
    });
    expect(folded).toBe(oldEncoding);
  });

  test("old and new admonition spellings fold to one JSON string (both forms)", () => {
    const oldParagraph = {
      type: "admonition",
      variant: "note",
      form: "paragraph",
      delimiter: undefined,
      content: "body",
      children: [],
      position,
    };
    const newParagraph = {
      type: "admonition",
      variant: "note",
      form: "paragraph",
      text: [{ type: "text", value: "body", position }],
      children: [],
      position,
    };
    expect(canonical(oldParagraph)).toBe(canonical(newParagraph));
    const oldDelimited = {
      type: "admonition",
      variant: "note",
      form: "delimited",
      delimiter: "example",
      content: undefined,
      children: [],
      position,
    };
    const newDelimited = {
      type: "admonition",
      variant: "note",
      form: "example",
      text: [],
      children: [],
      position,
    };
    expect(canonical(oldDelimited)).toBe(canonical(newDelimited));
  });

  test("annotatedBy is dropped from the serialized string", () => {
    const bare = {
      type: "delimitedBlock",
      variant: "listing",
      form: "delimited",
      content: "x",
      position,
    };
    expect(canonical({ ...bare, annotatedBy: "source,ruby" })).toBe(
      canonical(bare),
    );
  });

  test("a tree with none of the new shapes keeps its exact string", () => {
    const plain = {
      type: "paragraph",
      children: [{ type: "text", value: "x", position }],
      position,
    };
    expect(canonical(plain)).toBe(JSON.stringify(plain));
  });
});
