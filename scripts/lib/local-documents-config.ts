/**
 * The local-documents harness's machine-local configuration.
 *
 * The corpus this harness runs over is a directory of real documents
 * on somebody's laptop: private, unpublishable, and in a different
 * place for every person who has one. Nothing about it can be
 * committed, so the two commands that need to know where it is
 * (`bun run local-docs` and `bun run collect-local-docs`) read a
 * gitignored file for their defaults:
 *
 * ```json
 * {
 *   "corpus": ".local-docs/documents",
 *   "repository": "/home/you/src/some-branch-per-document-repo"
 * }
 * ```
 *
 * Both fields are optional and both are overridable on the command
 * line; the file's only job is to save typing an absolute path on
 * every run. A file that exists and is NOT a config is a fault to
 * report rather than a shrug: a typo'd key that is silently dropped
 * would send the run at the wrong directory, and every command here
 * turns that into "the harness could not run".
 *
 * ONE FIELD PER JOB. `corpus` is the directory `local-docs` WALKS -
 * frequently somebody's own document directory, not a collected copy
 * of one - and `repository` is what `collect-local-docs` READS.
 * Neither is the collector's OUTPUT directory, deliberately: the
 * collector deletes the files it wrote last time, and a field that
 * doubled as both would point that delete at a directory the operator
 * gave for an entirely different reason. `--out` and
 * {@link DEFAULT_CORPUS} are the only ways to say where it writes.
 */
import { existsSync, readFileSync } from "node:fs";

/** Where the config file lives, in every checkout. */
export const CONFIG_FILE = "scripts/local-documents.config.json";

/** Exactly the keys a config file may carry. */
const CONFIG_KEYS = ["corpus", "repository"];

/** The defaults a checkout carries: where a collected corpus lands. */
export const DEFAULT_CORPUS = ".local-docs/documents";

/** One checkout's local-documents configuration. */
export interface LocalDocumentsConfig {
  /** The corpus directory to walk, when the file names one. */
  readonly corpus: string | undefined;
  /** The git repository to collect from, when the file names one. */
  readonly repository: string | undefined;
}

/**
 * Read the config file, STRICTLY.
 *
 * A missing file is not an error - the harness works fine with a
 * directory on the command line - but a file that is not a config is,
 * for the reason in the module header.
 * @param file - where to read it from; the default is the one place
 *   the two commands look, and tests pass their own path
 * @returns the two fields, each undefined when the file does not name
 *   it
 * @throws {TypeError} when the file exists and is not a config: bad
 *   JSON, not an object, an unknown key, or a non-string value
 */
export function readLocalDocumentsConfig(
  file = CONFIG_FILE,
): LocalDocumentsConfig {
  if (!existsSync(file)) return { corpus: undefined, repository: undefined };
  const parsed = parsedJson(file);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError(`${file}: not a JSON object`);
  }
  const raw: Record<string, unknown> = { ...parsed };
  const unknown = Object.keys(raw).filter((key) => !CONFIG_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new TypeError(
      `${file}: unknown key(s) ${unknown.join(", ")} - known keys are ${CONFIG_KEYS.join(", ")}`,
    );
  }
  return {
    corpus: field(raw, "corpus", file),
    repository: field(raw, "repository", file),
  };
}

/**
 * `JSON.parse` with the syntax error reported as what it is: a config
 * file that cannot be read at all, named by path so the reader knows
 * which file to open.
 * @param file - where to read it from
 * @returns the parsed value
 * @throws {TypeError} when the file is not valid JSON
 */
function parsedJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new TypeError(`${file}: not valid JSON (${detail})`, {
      cause: error,
    });
  }
}

/**
 * Read one field of a parsed config, insisting it is a non-empty
 * string when it is present at all. An empty string is rejected
 * rather than treated as absent, because `""` as a directory is the
 * checkout root and a run over the whole repository is nobody's
 * intent.
 * @param raw - the parsed object
 * @param key - the field to read
 * @param file - where it came from, for the message
 * @returns the value, or undefined when the file does not name it
 * @throws {TypeError} when the value is present and not a non-empty
 *   string
 */
function field(
  raw: Record<string, unknown>,
  key: string,
  file: string,
): string | undefined {
  const { [key]: value } = raw;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") {
    throw new TypeError(`${file}: ${key} must be a non-empty string`);
  }
  return value;
}
