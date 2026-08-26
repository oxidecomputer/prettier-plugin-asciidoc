#!/usr/bin/env bun
/**
 * The citation gate: every source citation in this repository's
 * comments names a file that exists, a line that exists in it, and a
 * line that is about what the comment says it is about.
 *
 * Comments here cite two authorities. The Ruby (`parser.rb`, `rx.rb`,
 * `reader.rb`, `substitutors.rb`, `attribute_list.rb`,
 * `asciidoctor.rb`, Asciidoctor 2.0.26) is the design spec, vendored
 * at `vendor/asciidoctor-ruby/` so this check needs no network. The
 * oracle (`@asciidoctor/core`'s `build/node/index.cjs` and the
 * `src/*.js` it is bundled from) is the behavioral authority the tests
 * measure against, and it is read from `node_modules`; with no install
 * present the oracle half is SKIPPED and said so, never failed.
 *
 * A bare `l.1439` is resolved against the ONE recognized file its
 * comment names; a comment that names none, or two, leaves its bare
 * references unresolved, and those are counted and reported rather
 * than guessed at or dropped.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 every citation held, 1 a
 * citation FAILED: an unreadable spelling, a line past the end of the
 * cited file, or a comment whose names appear nowhere near what it
 * points at; 2 the checker could not run: a bad argument, missing
 * vendored sources, or a tree with too few citations to have been
 * scanned at all.
 *
 * Why it exists: a citation is the only part of a comment that a
 * reader cannot check by reading. Line numbers move under a pin bump
 * and names get invented; three wrong citations turned up in one week
 * of adversarial review, each of which would have cost the next reader
 * an hour. The grammar and the two checks live in `scripts/citations.ts`.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import {
  IDENTIFIER_WINDOW,
  ORACLE_DIRECTORY,
  ORACLE_FILES,
  RUBY_DIRECTORY,
  RUBY_FILES,
  checkCitation,
  findCitations,
  type Citation,
} from "./citations.js";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";

const ARGUMENT_START = 2;

/**
 * The floor below which the scan proved nothing. The tree carries well
 * over two hundred citations; a run that finds a handful has lost its
 * roots, not its citations, and that is a 2 rather than a green tick.
 *
 * Exported so the floor has a test at its boundary
 * (tests/scripts/citation-check.test.ts); no other consumer.
 * @internal
 */
export const MINIMUM_CITATIONS = 100;

/**
 * The directories whose comments are scanned, from the repo root.
 * `scripts` is in it because `scripts/parity-ledger.ts` alone carries
 * eight citations of the same kind; `docs` is not, because its
 * references to the Ruby name no lines.
 *
 * Exported so the scan set is pinned rather than assumed
 * (tests/scripts/citation-check.test.ts); no other consumer.
 * @internal
 */
export const SCANNED = ["src", "tests", "scripts"];

/**
 * The checker's own sources, which are NOT scanned.
 *
 * These four are the one place in the repository where citation-shaped
 * text is DATA rather than a claim: the grammar's comments quote the
 * spellings it refuses (`l.1404–1592`, `parser.rb:1404, 1592`) and the
 * tests' table rows are made of them. Reading them would fail the gate
 * on its own documentation, and worse, would let a made-up line number
 * in a test fixture masquerade as real rot.
 *
 * Exported so the exemption is pinned and visible
 * (tests/scripts/citation-check.test.ts); no other consumer.
 * @internal
 */
export const NOT_SCANNED = new Set([
  "scripts/citations.ts",
  "scripts/citation-check.ts",
  "tests/scripts/citations.test.ts",
  "tests/scripts/citation-check.test.ts",
]);

/** What `--help` prints. */
const USAGE = `usage: bun run citation-check [options]

  --window <n>  how many lines either side of a cited range an
                identifier may sit and still anchor it (default ${String(IDENTIFIER_WINDOW)})
  --list        print every citation the grammar read and every bare
                reference it could not place, then the report
  --help        this text

exit: 0 every citation held, 1 a citation failed, 2 could not run`;

/** The command line, parsed. */
interface Options {
  /** The identifier window, in lines. */
  window: number;
  /** Whether to print every citation before the report. */
  list: boolean;
}

/**
 * Parse the command line. An unknown argument is an error rather than
 * a shrug: a silently dropped `--window` would report a run nobody
 * asked for.
 * @param argv - the arguments after the script name
 * @returns the options
 * @throws {TypeError} on an unknown argument or a missing value
 */
export function parseArguments(argv: readonly string[]): Options {
  const options: Options = { window: IDENTIFIER_WINDOW, list: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--list": {
        options.list = true;
        break;
      }
      case "--window": {
        const spelling = argv[index + 1] ?? "";
        if (!/^\d+$/v.test(spelling)) {
          throw new TypeError("citation-check: --window needs a number");
        }
        options.window = Number(spelling);
        index += 1;
        break;
      }
      default: {
        throw new TypeError(`citation-check: unknown argument ${argument}`);
      }
    }
  }
  return options;
}

/**
 * Every TypeScript file under a directory, in a stable order.
 *
 * Exported for its unit test (tests/scripts/citation-check.test.ts): a
 * scan that silently stopped finding files would report a clean run
 * over nothing. No other consumer.
 * @internal
 * @param root - the repository root
 * @param directory - the directory to walk, relative to the root
 * @returns paths relative to the root, sorted
 */
export function sources(root: string, directory: string): string[] {
  const absolute = path.join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => path.join(directory, name).replaceAll(path.sep, "/"))
    .filter((relative) => !NOT_SCANNED.has(relative))
    .toSorted();
}

/** The cited files, read once, as lines. */
type CitedSources = Map<string, readonly string[]>;

/**
 * Read every cited file the checkout has.
 *
 * The Ruby is required: it is vendored, so its absence means the
 * checkout is broken rather than that the check is inapplicable. The
 * oracle is optional: `node_modules` is not always present (a fresh
 * clone, a docs-only CI job), and a gate that turns red on a missing
 * install teaches people to ignore it.
 * @param root - the repository root
 * @returns the cited files' lines, keyed by basename
 * @throws {Error} if a vendored Ruby source is missing
 */
function readCited(root: string): CitedSources {
  const cited: CitedSources = new Map();
  for (const name of RUBY_FILES) {
    const where = path.join(root, RUBY_DIRECTORY, name);
    if (!existsSync(where)) {
      throw new Error(
        `citation-check: ${RUBY_DIRECTORY}/${name} is missing; run bun run vendor to re-fetch the vendored sources`,
      );
    }
    cited.set(name, sourceLines(readFileSync(where, "utf8")));
  }
  for (const [name, inside] of ORACLE_FILES) {
    const where = path.join(root, ORACLE_DIRECTORY, inside);
    if (existsSync(where)) {
      cited.set(name, sourceLines(readFileSync(where, "utf8")));
    }
  }
  return cited;
}

/**
 * Split a cited file into the lines a citation can name.
 *
 * The final newline does not open a line: counting the empty string
 * after it would let a citation name one line past the end of the file
 * and still pass, which is the off-by-one the range check exists to
 * catch.
 *
 * Exported for its unit test (tests/scripts/citation-check.test.ts):
 * the rule is one character of behavior and the whole range check
 * rests on it. No other consumer.
 * @internal
 * @param text - the file's contents
 * @returns the file's lines, in order
 */
export function sourceLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/**
 * What one run measured.
 *
 * Exported so {@link verdict} can be unit-tested against a literal
 * report rather than against the tree
 * (tests/scripts/citation-check.test.ts); no other consumer.
 * @internal
 */
export interface Report {
  /** Citations whose cited file was present and checkable. */
  checked: Citation[];
  /** Citations skipped because the oracle build was not installed. */
  skipped: number;
  /** Citations whose comment named nothing to anchor them. */
  unanchored: number;
  /** Bare line references no file name in their comment explains. */
  contextless: string[];
  /** One line per failure, ready to print. */
  failures: string[];
  /** Per-file citation counts, for the census line. */
  perFile: Map<string, number>;
}

/**
 * Scan the tree and check everything it cites.
 * @param root - the repository root
 * @param cited - the cited files' lines, keyed by basename
 * @param window - the identifier window, in lines
 * @returns what the run measured
 */
function run(root: string, cited: CitedSources, window: number): Report {
  const report: Report = {
    checked: [],
    skipped: 0,
    unanchored: 0,
    contextless: [],
    failures: [],
    perFile: new Map(),
  };
  for (const directory of SCANNED) {
    for (const relative of sources(root, directory)) {
      const text = readFileSync(path.join(root, relative), "utf8");
      const scan = findCitations(relative, text);
      for (const bad of scan.unparsed) {
        report.failures.push(
          `${bad.source}:${String(bad.line)}: unreadable citation \`${bad.spelling}\``,
        );
      }
      for (const bare of scan.contextless) {
        report.contextless.push(
          `${bare.source}:${String(bare.line)}\t\`${bare.spelling}\``,
        );
      }
      for (const citation of scan.citations) {
        report.perFile.set(
          citation.file,
          (report.perFile.get(citation.file) ?? 0) + 1,
        );
        const lines = cited.get(citation.file);
        if (lines === undefined) {
          report.skipped += 1;
          continue;
        }
        report.checked.push(citation);
        const verdict = checkCitation(citation, lines, window);
        if (!verdict.anchored) report.unanchored += 1;
        for (const failure of verdict.failures) {
          report.failures.push(
            `${citation.source}:${String(citation.line)}: ${failure}`,
          );
        }
      }
    }
  }
  return report;
}

/**
 * What a run concluded, and what it has to say.
 *
 * Exported so {@link verdict}'s three arms can be asserted on directly
 * (tests/scripts/citation-check.test.ts); `main` does nothing with them
 * but write and set a code.
 * @internal
 */
export type Verdict =
  | {
      /** Every citation held. */
      kind: "clean";
      /** Lines to write on stdout. */
      lines: string[];
    }
  | {
      /** At least one citation failed. */
      kind: "failed";
      /** Lines to write on stdout, failures included. */
      lines: string[];
    }
  | {
      /** Nothing was proved either way. */
      kind: "cannot-run";
      /** One line saying what stopped it. */
      message: string;
    };

/** How many files the contextless summary names before eliding. */
const FILES_SHOWN = 4;

/**
 * Summarize `path:line\ttext` report lines as counts per citing file.
 * @param entries - the report lines
 * @returns a comma-separated `path n` list, busiest first
 */
function byFile(entries: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const file = entry.slice(0, entry.lastIndexOf(":", entry.indexOf("\t")));
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].toSorted((left, right) =>
    right[1] === left[1] ? left[0].localeCompare(right[0]) : right[1] - left[1],
  );
  const shown = ranked
    .slice(0, FILES_SHOWN)
    .map(([file, count]) => `${file} ${String(count)}`)
    .join(", ");
  const rest = ranked.length - FILES_SHOWN;
  return rest > 0 ? `${shown}, and ${String(rest)} more files` : shown;
}

/**
 * Turn a run into a census, a report and an exit-code decision.
 *
 * Pure, and separate from `main`, because the three things worth
 * pinning here are decisions rather than IO: that the measured-nothing
 * floor is a 2 and not a 0, that a single failure is a 1, and that
 * contextless references are printed without being either.
 *
 * Exported for the unit tests around those three decisions
 * (tests/scripts/citation-check.test.ts); no other consumer.
 * @internal
 * @param report - what the run measured
 * @param window - the identifier window the run used
 * @returns what to print, and which exit code the run earned
 */
export function verdict(report: Report, window: number): Verdict {
  const total = report.checked.length + report.skipped + report.failures.length;
  if (total < MINIMUM_CITATIONS) {
    return {
      kind: "cannot-run",
      message: `citation-check: found only ${String(total)} citations, below the floor of ${String(MINIMUM_CITATIONS)}: the scan lost its roots`,
    };
  }
  const census = [...report.perFile.entries()]
    .toSorted((left, right) =>
      // Busiest file first; ties by name, so the line is stable.
      right[1] === left[1]
        ? left[0].localeCompare(right[0])
        : right[1] - left[1],
    )
    .map(([file, count]) => `${file} ${String(count)}`)
    .join(", ");
  const lines = [`citations: ${census}`];
  if (report.skipped > 0) {
    lines.push(
      `SKIPPED ${String(report.skipped)} oracle citations: ${ORACLE_DIRECTORY} is not installed`,
    );
  }
  // Contextless references are counted by FILE rather than listed one
  // by one: there are eighty-odd of them, they are not failures, and a
  // gate whose clean run scrolls a screen of not-failures is a gate
  // people stop reading. `--list` prints every one.
  if (report.contextless.length > 0) {
    lines.push(
      `bare line references naming no file: ${byFile(report.contextless)}`,
    );
  }
  lines.push(...report.failures);
  if (report.failures.length > 0) {
    lines.push(
      `citation-check: ${String(report.failures.length)} FAILED of ${String(report.checked.length)} checked`,
    );
    return { kind: "failed", lines };
  }
  lines.push(
    `citation-check: ${String(report.checked.length)} citations hold (${String(report.unanchored)} unanchored, ${String(report.contextless.length)} naming no file, window ${String(window)})`,
  );
  return { kind: "clean", lines };
}

/**
 * Run the gate.
 * @param options - the parsed command line
 * @throws {Error} if the vendored sources are missing
 */
function main(options: Options): void {
  const root = path.resolve(import.meta.dirname, "..");
  const cited = readCited(root);
  const report = run(root, cited, options.window);
  if (options.list) {
    for (const citation of report.checked) {
      // The file separately from the spelling: a bare `l.1483` resolved
      // through its comment's context reads as nothing at all without
      // the file the checker decided it was about.
      process.stdout.write(
        `${citation.source}:${String(citation.line)}\t${citation.file}\t${citation.spelling}\n`,
      );
    }
    for (const bare of report.contextless) {
      process.stdout.write(`${bare}\t(no file)\n`);
    }
  }
  const said = verdict(report, options.window);
  if (said.kind === "cannot-run") {
    cannotRun(said.message);
    return;
  }
  for (const line of said.lines) process.stdout.write(`${line}\n`);
  if (said.kind === "failed") process.exitCode = GATE_FAILED;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(ARGUMENT_START);
    if (wantsHelp(argv)) printUsage(USAGE);
    else main(parseArguments(argv));
  } catch (error) {
    // A bad argument or a missing vendored source: neither checked
    // anything, so neither is a 1.
    cannotRun(error instanceof Error ? error.message : String(error));
  }
}
