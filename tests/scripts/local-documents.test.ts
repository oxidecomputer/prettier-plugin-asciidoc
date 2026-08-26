/**
 * The local-documents RUNNER (issue #13): the walk, the verdict
 * assembly, the four checks, and the command line.
 *
 * The walk is tested against a committed fixture tree
 * (`tests/integration/fixtures/`) rather than a tree the test builds
 * for itself: an input a test writes is an input nobody reviewed, and
 * the shapes that matter here - a document in a subdirectory, a file
 * that is not a document, a directory holding only non-documents -
 * are exactly the ones a hand-written tree states plainly.
 *
 * The fixture documents are TINY and synthetic, and they are expected
 * to pass every check. The failure PATHS are driven through
 * {@link verdicts} with literal values, because a fixture that fails
 * a check today is a fixture that starts failing this test the day
 * the bug behind it is fixed - and because a formatter crash needs a
 * formatter bug to reproduce at all.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import type {
  Attempt,
  Attempts,
} from "../../scripts/local-documents-checks.js";
import {
  checkCorpus,
  checkDocument,
  findDocuments,
  verdicts,
} from "../../scripts/local-documents-checks.js";
import { parseArguments } from "../../scripts/local-documents.js";

/** The committed fixture tree, resolved from this file's own path. */
const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../integration/fixtures",
);

/**
 * An attempt that produced a value.
 * @param value - what it produced
 * @returns the attempt
 */
const ok = (value: string): Attempt => ({ ok: true, value });

/**
 * An attempt that threw.
 * @param error - the message it threw
 * @returns the attempt
 */
const threw = (error: string): Attempt => ({ ok: false, error });

/**
 * The four attempts for a document that formats cleanly, overridden
 * per row.
 * @param over - what this row does differently
 * @returns the attempts
 */
function attempts(over: Partial<Attempts> = {}): Attempts {
  return {
    format: ok("out"),
    reformat: ok("out"),
    renderInput: ok("<p>x</p>"),
    renderOutput: ok("<p>x</p>"),
    ...over,
  };
}

describe("the walk", () => {
  test("finds every .adoc document, recursively, in id order", () => {
    expect(findDocuments(FIXTURES).map((one) => one.id)).toEqual([
      "nested/nested-document.adoc",
      "well-formed.adoc",
    ]);
  });

  test("ignores files that are not documents", () => {
    // `notes.txt` sits beside the documents and
    // `only-non-documents/diagram.svg` is a subdirectory carrying
    // nothing else. Neither is a document, and a walk that fed either
    // to the formatter would be unusable on a real corpus directory.
    const ids = findDocuments(FIXTURES).map((one) => one.id);
    expect(ids).not.toContain("notes.txt");
    expect(ids.some((id) => id.startsWith("only-non-documents/"))).toBe(false);
  });

  test("reports each document's path on disk", () => {
    const [first] = findDocuments(FIXTURES);
    expect(first.file).toBe(
      path.join(FIXTURES, "nested", "nested-document.adoc"),
    );
  });

  test("a directory that does not exist throws rather than measuring nothing", () => {
    expect(() =>
      findDocuments(path.join(FIXTURES, "no-such-directory")),
    ).toThrow();
  });
});

describe("verdicts", () => {
  test("everything agreeing is a clean result", () => {
    expect(verdicts(attempts())).toEqual({
      failures: [],
      unassessed: [],
      detail: "",
    });
  });

  test("a format crash stands alone and unassesses the rest", () => {
    // Nothing downstream of a crash was learned: there is no output
    // to re-format, to settle, or to render.
    expect(verdicts(attempts({ format: threw("boom") }))).toEqual({
      failures: ["format"],
      unassessed: ["reformat", "idempotence", "render"],
      detail: "format threw: boom",
    });
  });

  test("a reformat crash fails reformat and unassesses idempotence", () => {
    const verdict = verdicts(attempts({ reformat: threw("bang") }));
    expect(verdict.failures).toEqual(["reformat"]);
    expect(verdict.unassessed).toEqual(["idempotence"]);
    expect(verdict.detail).toContain("reformat threw: bang");
  });

  test("a second pass that moved the bytes fails idempotence", () => {
    const verdict = verdicts(attempts({ reformat: ok("other") }));
    expect(verdict.failures).toEqual(["idempotence"]);
    expect(verdict.detail).toBe("the second format pass changed the output");
  });

  test("an oracle that refuses the INPUT leaves render unassessed", () => {
    // The document said nothing about our formatter, so this is not a
    // failure of ours - and not a pass either.
    const verdict = verdicts(
      attempts({ renderInput: threw("no converter"), renderOutput: undefined }),
    );
    expect(verdict.failures).toEqual([]);
    expect(verdict.unassessed).toEqual(["render"]);
    expect(verdict.detail).toContain("the oracle refused the input");
  });

  test("an oracle that refuses OUR OUTPUT fails render", () => {
    // It rendered before we touched it.
    const verdict = verdicts(attempts({ renderOutput: threw("no converter") }));
    expect(verdict.failures).toEqual(["render"]);
    expect(verdict.unassessed).toEqual([]);
    expect(verdict.detail).toContain("the oracle refused the formatted output");
  });

  test("a different rendering fails render", () => {
    const verdict = verdicts(attempts({ renderOutput: ok("<p>y</p>") }));
    expect(verdict.failures).toEqual(["render"]);
    expect(verdict.detail).toBe(
      "Asciidoctor renders the formatted output differently",
    );
  });

  test("an attempt never made is unassessed, not a pass", () => {
    expect(
      verdicts(
        attempts({
          reformat: undefined,
          renderInput: undefined,
          renderOutput: undefined,
        }),
      ),
    ).toEqual({
      failures: [],
      unassessed: ["reformat", "idempotence", "render"],
      detail: "",
    });
  });

  test("failures and details keep check order when several fail", () => {
    const verdict = verdicts(
      attempts({ reformat: ok("other"), renderOutput: ok("<p>y</p>") }),
    );
    expect(verdict.failures).toEqual(["idempotence", "render"]);
    expect(verdict.detail).toBe(
      "the second format pass changed the output; Asciidoctor renders the formatted output differently",
    );
  });
});

describe("the four checks", () => {
  test("a well-formed document passes every one of them", async () => {
    const result = await checkDocument(
      "synthetic",
      "= Title\n\nA paragraph.\n",
    );
    expect(result.failures).toEqual([]);
    expect(result.unassessed).toEqual([]);
    expect(result.detail).toBe("");
    expect(result.id).toBe("synthetic");
    expect(result.size).toBe("= Title\n\nA paragraph.\n".length);
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  });

  test("an empty document is a document, and a clean one", async () => {
    const result = await checkDocument("empty", "");
    expect(result.failures).toEqual([]);
    expect(result.size).toBe(0);
  });

  test("a document the oracle refuses leaves render unassessed", async () => {
    // The JavaScript build ships no docbook converter, which is the
    // same refusal `scripts/block-structure-ledger.ts` pins by id.
    const result = await checkDocument(
      "docbook",
      "= T\n:backend: docbook5\n\nbody\n",
    );
    expect(result.failures).toEqual([]);
    expect(result.unassessed).toEqual(["render"]);
    expect(result.detail).toContain("the oracle refused the input");
  });

  test("the fixture corpus is clean, document by document", async () => {
    const results = await checkCorpus(FIXTURES);
    expect(results.map((one) => one.id)).toEqual([
      "nested/nested-document.adoc",
      "well-formed.adoc",
    ]);
    for (const result of results) {
      expect(result.failures, result.id).toEqual([]);
      expect(result.unassessed, result.id).toEqual([]);
      expect(result.size, result.id).toBeGreaterThan(0);
    }
  });

  test("the run reports each document as it finishes", async () => {
    const seen: string[] = [];
    await checkCorpus(FIXTURES, (result) => {
      seen.push(result.id);
    });
    expect(seen).toEqual(["nested/nested-document.adoc", "well-formed.adoc"]);
  });
});

describe("the command line", () => {
  test("takes the corpus directory as a positional argument", () => {
    expect(parseArguments(["corpus"])).toEqual({
      root: "corpus",
      limit: 20,
    });
  });

  test("defaults to no directory, so the config file can supply one", () => {
    expect(parseArguments([])).toEqual({ root: undefined, limit: 20 });
  });

  test("--limit takes a number", () => {
    expect(parseArguments(["--limit", "3"])).toEqual({
      root: undefined,
      limit: 3,
    });
  });

  test.each([
    ["an unknown option", ["--verbose"], "unknown argument --verbose"],
    ["a --limit with no number", ["--limit"], "--limit needs a number"],
    [
      "a --limit that is not a number",
      ["--limit", "x"],
      "--limit needs a number",
    ],
    // A limit of zero truncated the report to no rows under a heading
    // that said it was naming the failures.
    ["a --limit of zero", ["--limit", "0"], "--limit needs a number"],
    ["a second directory", ["one", "two"], "one directory at a time"],
  ])("%s is an error, not a shrug", (_name, argv, message) => {
    expect(() => parseArguments(argv)).toThrow(message);
  });
});
