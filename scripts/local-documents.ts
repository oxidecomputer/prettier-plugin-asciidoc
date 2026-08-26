#!/usr/bin/env bun
/**
 * The local-documents harness (issue #13): run the formatter over a
 * directory of real AsciiDoc documents and report what it did to
 * them.
 *
 * The vendored corpus is thousands of small cases extracted from
 * Asciidoctor's own tests, and the sweep products are generated. Both
 * are blind to the same thing: a document somebody actually wrote,
 * hundreds of lines long, with a table inside a list inside an
 * include. This harness points the four differential checks
 * (`local-documents-checks.ts`) at such a corpus.
 *
 * The corpus is NOT in this repository and never will be - it is
 * whatever documents the person running it has. Point the command at
 * a directory, or record one in the gitignored
 * `scripts/local-documents.config.json`. `bun run collect-local-docs`
 * builds such a directory out of a branch-per-document git
 * repository.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 every document passed every
 * check it could be assessed on, 1 a document FAILED a check, 2 the
 * harness could not run - no directory named, an unreadable one, or a
 * directory with no documents in it at all.
 */
import { checkCorpus } from "./local-documents-checks.js";
import { classify, reportLines } from "./local-documents-report.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import {
  CONFIG_FILE,
  readLocalDocumentsConfig,
} from "./lib/local-documents-config.js";

const ARGUMENT_START = 2;
const DEFAULT_LIMIT = 20;
const DECIMAL = 10;

/** How often the run says it is still going, in documents. */
const PROGRESS_EVERY = 25;

/** What `--help` prints. */
const USAGE = `usage: bun run local-docs [dir] [options]

  [dir]         the corpus directory to walk; every .adoc file under
                it, recursively, is one document. Defaults to the
                "corpus" field of ${CONFIG_FILE} (gitignored: the
                corpus is private and its location is per-machine)
  --limit <n>   how many failing documents to name, 1 or more
                (default 20)
  --help        this text

exit: 0 every document passed, 1 a document failed a check, 2 could
not run`;

/** The command line, parsed. */
interface Options {
  /** The corpus directory, when the command line named one. */
  root: string | undefined;
  /** How many failing documents to name. */
  limit: number;
}

/**
 * Parse the command line. An unrecognized OPTION is an error, and so
 * is a second positional argument: a dropped one would send the run
 * at the configured corpus while its author watched for a report on
 * the directory they typed.
 * @param argv - the arguments after the script name
 * @returns the options
 * @throws {TypeError} on an unknown argument, a missing value, or a
 *   second directory
 */
export function parseArguments(argv: readonly string[]): Options {
  const options: Options = { root: undefined, limit: DEFAULT_LIMIT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--limit") {
      // At least 1: `--limit 0` parsed happily and printed
      // "0 of N failing documents:" with no rows under it, which is a
      // report that has been truncated to nothing while claiming to
      // name the failures.
      const spelling = argv[index + 1] ?? "";
      if (!/^[1-9]\d*$/v.test(spelling)) {
        throw new TypeError("local-docs: --limit needs a number of 1 or more");
      }
      options.limit = Number.parseInt(spelling, DECIMAL);
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new TypeError(`local-docs: unknown argument ${argument}`);
    } else if (options.root === undefined) {
      options.root = argument;
    } else {
      throw new TypeError(
        `local-docs: one directory at a time (already given ${options.root})`,
      );
    }
  }
  return options;
}

/**
 * Which directory this run walks: the command line wins, the config
 * file is the fallback, and neither is a failure to report rather
 * than a default to guess at.
 * @param options - the parsed command line
 * @returns the directory, or the complaint that there is none
 */
function corpusRoot(options: Options): {
  root: string | undefined;
  complaint: string | undefined;
} {
  if (options.root !== undefined) {
    return { root: options.root, complaint: undefined };
  }
  const { corpus } = readLocalDocumentsConfig();
  if (corpus !== undefined) return { root: corpus, complaint: undefined };
  return {
    root: undefined,
    complaint: `local-docs: no corpus directory - pass one, or put {"corpus": "<dir>"} in ${CONFIG_FILE}`,
  };
}

/**
 * Walk a corpus, check every document, print the report.
 * @param options - the parsed command line
 */
async function main(options: Options): Promise<void> {
  const { root, complaint } = corpusRoot(options);
  if (root === undefined) {
    cannotRun(complaint ?? "local-docs: no corpus directory");
    return;
  }
  process.stdout.write(`local-docs: corpus ${root}\n`);
  let checked = 0;
  const results = await checkCorpus(root, () => {
    checked += 1;
    if (checked % PROGRESS_EVERY === 0) {
      process.stderr.write(`local-docs: ${String(checked)} documents...\n`);
    }
  });
  // The measured-nothing floor. A corpus directory that walked to
  // nothing reports a perfect run: no documents means no crashes, no
  // idempotence wobbles and no render divergences, all vacuously
  // true. That is exit 2, not exit 0.
  if (results.length === 0) {
    cannotRun(`local-docs: no .adoc documents under ${root}`);
    return;
  }
  // Classified once: the exit code and the report must be read off
  // the same numbers.
  const summary = classify(results);
  for (const line of reportLines(summary, options.limit)) {
    process.stdout.write(`${line}\n`);
  }
  if (summary.failing > 0) process.exitCode = GATE_FAILED;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(ARGUMENT_START);
    if (wantsHelp(argv)) printUsage(USAGE);
    else await main(parseArguments(argv));
  } catch (error) {
    // A bad argument, an unreadable directory, a config file that is
    // not a config: none of them checked a document, so none of them
    // is a 1.
    cannotRun(error instanceof Error ? error.message : String(error));
  }
}
