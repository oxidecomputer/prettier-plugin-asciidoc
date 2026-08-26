/**
 * The local-documents config file (issue #13): the one gitignored
 * file that says where a private corpus lives.
 *
 * Read STRICTLY, and this is what that costs and buys: a config file
 * that is not a config fails the run instead of being read short.
 * Every row is a committed fixture under `tests/integration/configs/`
 * rather than a file the test writes, so what the loader is held to
 * is a file somebody can open and read.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { readLocalDocumentsConfig } from "../../scripts/lib/local-documents-config.js";

/** The committed config fixtures, from this file's own path. */
const CONFIGS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../integration/configs",
);

/**
 * One fixture's path.
 * @param name - the fixture file name
 * @returns its path
 */
const config = (name: string): string => path.join(CONFIGS, name);

describe("readLocalDocumentsConfig", () => {
  test("reads both fields", () => {
    expect(readLocalDocumentsConfig(config("valid.json"))).toEqual({
      corpus: ".local-docs/documents",
      repository: "/home/somebody/src/documents",
    });
  });

  test("a field the file omits is undefined, not a guess", () => {
    expect(readLocalDocumentsConfig(config("corpus-only.json"))).toEqual({
      corpus: ".local-docs/documents",
      repository: undefined,
    });
  });

  test("no config file at all is not an error", () => {
    // The directory argument is the normal way to run the harness;
    // the file only saves typing it.
    expect(readLocalDocumentsConfig(config("no-such-file.json"))).toEqual({
      corpus: undefined,
      repository: undefined,
    });
  });

  test.each([
    ["a mistyped key", "unknown-key.json", "unknown key(s) corpuss"],
    ["a file that is not an object", "not-an-object.json", "not a JSON object"],
    ["a file that is not JSON", "not-json.json", "not valid JSON"],
    [
      "an empty directory name",
      "empty-corpus.json",
      "must be a non-empty string",
    ],
  ])("%s fails the run rather than being dropped", (_name, file, message) => {
    expect(() => readLocalDocumentsConfig(config(file))).toThrow(message);
  });
});
