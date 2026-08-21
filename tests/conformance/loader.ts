/**
 * Loads the differential-conformance corpus (issue #7) from its two
 * sources: the vendored Asciidoctor extraction and a local drop
 * directory for real documents.
 * Synchronous on purpose — it runs once at test-collection time.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CorpusCase } from "../../scripts/heredoc-extractor.js";

// Type re-exported so the harness and triage script share one shape
// with the extractor without importing vendor-time code paths.
export type { CorpusCase } from "../../scripts/heredoc-extractor.js";

/** A named slice of the corpus, used as a vitest describe block. */
export interface CorpusGroup {
  /** JSONL basename (e.g. `lists_test`), or `local`. */
  name: string;
  /** Cases sorted by ID for deterministic test ordering. */
  cases: CorpusCase[];
}

// Paths are relative to the repo root; vitest runs with the repo root
// as cwd, matching how tests/helpers.ts resolves things.
const CORPUS_DIR = "vendor/asciidoctor-corpus";
const LOCAL_DIR = "tests/conformance/corpus";

/**
 * Validates that an object has the shape of a CorpusCase.
 * @param object - object to validate
 * @returns true if object is a CorpusCase, false otherwise
 */
function isCorpusCase(object: unknown): object is CorpusCase {
  return (
    typeof object === "object" &&
    object !== null &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- type guard pattern
    typeof (object as Record<string, unknown>).id === "string" &&
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- type guard pattern
    typeof (object as Record<string, unknown>).input === "string"
  );
}

/**
 * Compares strings by UTF-16 code units, not locale. The quarantine
 * manifest and test ordering must be identical on every contributor's
 * machine; `localeCompare` depends on the host ICU locale, so a
 * different `LANG` regenerating the manifest would reorder keys and
 * produce noisy diffs.
 * @param a - left-hand string
 * @param b - right-hand string
 * @returns negative, zero, or positive per the usual sort contract
 */
export function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Parses one JSONL corpus file, validating each line's shape so a
 * corrupted vendor file fails loudly at collection time instead of
 * producing confusing per-case failures. Exported only for its own
 * unit test — production callers go through `loadCorpus`.
 * @param filePath - repo-relative path to the .jsonl file
 * @returns the parsed cases in file order
 */
export function parseJsonl(filePath: string): CorpusCase[] {
  const lines = readFileSync(filePath, "utf8").split("\n");
  const cases: CorpusCase[] = [];
  for (const [index, line] of lines.entries()) {
    if (line === "") continue;
    const parsed: unknown = JSON.parse(line);
    if (!isCorpusCase(parsed)) {
      throw new Error(
        `${filePath}:${String(index + 1)}: expected {id, input} strings`,
      );
    }
    cases.push(parsed);
  }
  return cases;
}

/**
 * Safely reads directory entries, returning empty list if directory is
 * missing. Rethrows other I/O errors (permission denied, actual disk
 * errors) so typos and genuine failures fail loudly.
 * @param directory - repo-relative directory to walk
 * @returns file entries, or empty if directory missing
 */
export function _readDirectorySafe(directory: string): string[] {
  try {
    return readdirSync(directory, { recursive: true, encoding: "utf8" });
  } catch (error) {
    // Gracefully handle missing directory; rethrow other errors
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Recursively collects files under a directory whose names match a
 * suffix, returning repo-relative POSIX-style paths so they double as
 * stable case IDs.
 * @param directory - repo-relative directory to walk
 * @param suffix - filename suffix filter (e.g. `.adoc`)
 * @returns sorted repo-relative paths; empty if the directory is
 *   missing
 */
function collectFiles(directory: string, suffix: string): string[] {
  return _readDirectorySafe(directory)
    .filter((name) => name.endsWith(suffix))
    .map((name) => path.posix.join(directory, name.split(path.sep).join("/")))
    .toSorted();
}

/**
 * Loads file paths and their contents into corpus cases with stable IDs.
 * @param filePaths - repo-relative file paths to load
 * @returns cases with file paths as IDs
 */
function fileCases(filePaths: string[]): CorpusCase[] {
  return filePaths.map((p) => ({ id: p, input: readFileSync(p, "utf8") }));
}

/**
 * Loads the full conformance corpus. Every `.jsonl` in the vendored
 * corpus becomes a group; any `.adoc` dropped into
 * `tests/conformance/corpus/` joins as the `local` group.
 * @returns groups sorted by name, each with cases sorted by ID
 */
export function loadCorpus(): CorpusGroup[] {
  const jsonlGroups = collectFiles(CORPUS_DIR, ".jsonl").map((jsonlPath) => ({
    name: path.basename(jsonlPath, ".jsonl"),
    cases: parseJsonl(jsonlPath).toSorted((a, b) => compareIds(a.id, b.id)),
  }));

  return [
    ...jsonlGroups,
    {
      name: "local",
      cases: fileCases(collectFiles(LOCAL_DIR, ".adoc")),
    },
  ].toSorted((a, b) => compareIds(a.name, b.name));
}
