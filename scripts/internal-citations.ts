#!/usr/bin/env bun
/**
 * The repo-internal citation gate: every `<file>:<line>` this
 * repository writes about ITSELF names a file that exists, a line that
 * exists in it, and a line that still carries the code quoted beside
 * the citation.
 *
 * Three review rounds running turned up hand-maintained citations that
 * had rotted when an edit moved the code out from under them, in the
 * two places this repository keeps them: the `what` field of a
 * `scripts/metrics/score-minimums.json` exception, which names the
 * surviving mutant and quotes it, and the coverage-deferral comments in
 * `eslint.config.js`, which name the guard a brace would uncover and
 * quote it. The manual remedy was always mechanical - find the quoted
 * text, look at the cited line - so it is a check rather than a review
 * habit. A third, weaker scan holds every `src/...ts` path named in a
 * `src` file to a file that exists; those carry no line to check.
 *
 * This is the repo-INTERNAL half. `bun run citation-check` is the other
 * half and reads the other direction: citations of the Asciidoctor Ruby
 * and of the oracle build, which are sources we do not edit.
 *
 * What a citation looks like here, and it is one grammar for both
 * files: within one SCOPE - one exception's `what` string, or one line
 * of `eslint.config.js` - a `.ts` file name binds every `:<line>` and
 * `:<from>-<to>` reference after it, so `list-reader.ts:558, :572` is
 * two citations of one file and `"src/print/span-edges.ts", // :254,
 * :274` is two more. The FRAGMENTS a citation must be holding are the
 * backtick-quoted runs between it and the next `->`, because `->` is
 * how both files spell "and the mutant replaced it with", and a
 * replacement is by construction not in the source.
 *
 * The run splits into {@link readTree}, which is all the IO, and
 * {@link run}, which is all the decisions, so the gate can be driven
 * over a checkout written out in a test file rather than only over this
 * one.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 every citation held, 1 a
 * citation FAILED, 2 the checker could not run - a bad argument, a
 * missing scanned file, or a tree with too few citations in it to have
 * been scanned at all.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { cannotRun, GATE_FAILED, printUsage, wantsHelp } from "./lib/cli.js";
import { isArray, isObject, strictJson } from "./metrics/json.js";

const ARGUMENT_START = 2;

/** What `indexOf` answers when it did not find the thing. */
const NOT_FOUND = -1;

/** The exceptions file, whose `what` fields carry citations. */
export const MINIMUMS_FILE = "scripts/metrics/score-minimums.json";

/** The lint config, whose deferral comments carry citations. */
export const ESLINT_FILE = "eslint.config.js";

/** The one tree the citations name, and the one whose comments are read. */
export const SOURCE_ROOT = "src";

/**
 * The trees a comment may NAME a path in. Wider than {@link SOURCE_ROOT}
 * because `src` comments name their tests and their harnesses as freely
 * as they name each other, and a renamed test file rots a `src` comment
 * exactly the way a renamed module does.
 */
export const NAMED_ROOTS = ["src", "tests", "scripts"];

/**
 * The floor below which the scan proved nothing. The two scanned files
 * carry over fifty citations between them; a run that finds a handful
 * has lost its roots rather than its citations, and that is a 2.
 *
 * Exported so the floor has a test at its boundary
 * (tests/scripts/internal-citations.test.ts); no other consumer.
 * @internal
 */
export const MINIMUM_CITATIONS = 30;

/** How both files spell "and the mutant put this in its place". */
const REPLACED_BY = "->";

/** What `--help` prints. */
const USAGE = `usage: bun run internal-citations [options]

  --list  print every citation the scan read, then the report
  --help  this text

exit: 0 every citation held, 1 a citation failed, 2 could not run`;

/**
 * A checkout, as much of it as one run reads.
 *
 * Exported so a test can hand the gate a checkout it wrote out itself
 * (tests/scripts/internal-citations.test.ts); {@link readTree} is the
 * only other producer.
 * @internal
 */
export interface Tree {
  /** `scripts/metrics/score-minimums.json`, as written. */
  readonly minimums: string;
  /** `eslint.config.js`, as written. */
  readonly lintConfig: string;
  /** Every `src` file's lines, by repo-relative path, in path order. */
  readonly sources: ReadonlyMap<string, readonly string[]>;
  /**
   * Every `.ts` path under {@link NAMED_ROOTS}, for the existence
   * question alone. A citation still resolves against `sources`: the
   * two scanned files cite `src` and nothing else, so a wider
   * resolution set could only add wrong answers.
   */
  readonly files: ReadonlySet<string>;
}

/**
 * One repo-internal citation: where it is written, what it names, and
 * the source text it claims is there.
 *
 * Exported so the scanner can be driven from fixture text in the tests
 * (tests/scripts/internal-citations.test.ts); no other consumer.
 * @internal
 */
export interface Citation {
  /** Where it is written, as `path:line` or `path <file>`. */
  readonly at: string;
  /** The citation as written, `<name>:<from>` or `<name>:<from>-<to>`. */
  readonly spelling: string;
  /** The cited file as NAMED - a basename, or a repo-relative path. */
  readonly named: string;
  /** The first cited line, 1-based. */
  readonly from: number;
  /** The last cited line, 1-based; equal to `from` for a single line. */
  readonly to: number;
  /** The quoted source text that must be on those lines, possibly none. */
  readonly fragments: readonly string[];
}

/** What one scope's scan found. */
interface Scan {
  /** The citations, in the order they are written. */
  readonly citations: readonly Citation[];
  /** References written before any file name bound them. */
  readonly contextless: readonly string[];
}

// A `.ts` file name, or a line reference. One alternation rather than
// two passes, because the binding rule is positional: a reference takes
// the file name most recently matched before it.
const TOKEN = /(?<name>[\w.\/\-]+\.ts)|:(?<from>\d+)(?:-(?<to>\d+))?/gv;

/**
 * Read every citation in one scope of text.
 *
 * A `:line` reference takes the file name most recently written before
 * it IN THE SAME SCOPE, or, where nothing has named one yet, the file
 * the scope is already ABOUT - an exception row's own `file`. A
 * reference with neither is contextless: reported, and not a failure.
 * Nothing outside the scope binds anything, so a path five lines up in
 * `eslint.config.js` cannot silently adopt a stray number.
 *
 * Exported for its unit tests (tests/scripts/internal-citations.test.ts):
 * the binding rule and the fragment rule are the whole grammar. No
 * other consumer.
 * @internal
 * @param at - where the scope is written, for the message
 * @param scope - the text to read
 * @param about - the file the scope is about, where there is one
 * @returns the citations, and the references nothing bound
 */
export function scanScope(at: string, scope: string, about?: string): Scan {
  const citations: Citation[] = [];
  const contextless: string[] = [];
  let bound = about;
  for (const match of scope.matchAll(TOKEN)) {
    // TypeScript types a match's `groups` as every name PRESENT, which
    // an alternation makes false: exactly one side of TOKEN matched.
    const groups: Record<string, string | undefined> = match.groups ?? {};
    const { name, from, to } = groups;
    if (name !== undefined) {
      bound = name;
      continue;
    }
    if (from === undefined) {
      continue;
    }
    if (bound === undefined) {
      contextless.push(`${at}: \`:${from}\` names no file`);
      continue;
    }
    const first = Number(from);
    const last = to === undefined ? first : Number(to);
    citations.push({
      at,
      spelling:
        first === last
          ? `${bound}:${from}`
          : `${bound}:${from}-${String(last)}`,
      named: bound,
      from: first,
      to: last,
      fragments: fragmentsAfter(scope, match.index + match[0].length),
    });
  }
  return { citations, contextless };
}

/**
 * The backtick-quoted runs between a citation and the next `->`.
 *
 * The stop rule is the whole point. Both scanned files write a mutant
 * as `` `source` -> `replacement` ``, and the replacement is by
 * construction NOT in the source; a checker that took it would fail
 * every correctly-cited mutant. A citation whose first quoted run is
 * already past a `->` (`each conjunct -> \`true\``) quotes no source at
 * all, and comes back with no fragments - checkable for its line
 * number, and no further.
 *
 * Exported for its unit tests (tests/scripts/internal-citations.test.ts);
 * no other consumer.
 * @internal
 * @param scope - the text the citation is written in
 * @param from - the offset just past the citation
 * @returns the quoted runs, in order, possibly none
 */
export function fragmentsAfter(scope: string, from: number): string[] {
  const fragments: string[] = [];
  let at = from;
  let open = scope.indexOf("`", at);
  while (open !== NOT_FOUND) {
    const replaced = scope.indexOf(REPLACED_BY, at);
    if (replaced !== NOT_FOUND && replaced < open) {
      return fragments;
    }
    const close = scope.indexOf("`", open + 1);
    if (close === NOT_FOUND) {
      return fragments;
    }
    fragments.push(scope.slice(open + 1, close));
    at = close + 1;
    open = scope.indexOf("`", at);
  }
  return fragments;
}

/**
 * Split a file into the lines a citation can name.
 *
 * The final newline does not open a line: counting the empty string
 * after it would let a citation name one line past the end of the file
 * and still pass, which is the off-by-one the range check exists to
 * catch.
 *
 * Exported for its unit test (tests/scripts/internal-citations.test.ts);
 * no other consumer.
 * @internal
 * @param text - the file's contents
 * @returns the file's lines, in order
 */
export function sourceLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

/**
 * Read the checkout.
 *
 * All of the run's IO, and none of its decisions.
 * @param root - the repository root
 * @returns the two scanned files and the source tree
 * @throws {Error} if either scanned file is missing
 */
export function readTree(root: string): Tree {
  const bytes = (relative: string): string => {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute)) {
      throw new Error(`internal-citations: ${relative} is missing`);
    }
    return readFileSync(absolute, "utf8");
  };
  const files = new Set<string>();
  for (const tree of NAMED_ROOTS) {
    for (const relative of walk(root, tree)) {
      files.add(relative);
    }
  }
  const sources = new Map<string, readonly string[]>();
  for (const relative of walk(root, SOURCE_ROOT)) {
    sources.set(relative, sourceLines(bytes(relative)));
  }
  return {
    minimums: bytes(MINIMUMS_FILE),
    lintConfig: bytes(ESLINT_FILE),
    sources,
    files,
  };
}

/**
 * Every TypeScript file under one tree, in a stable order.
 * @param root - the repository root
 * @param tree - the directory to walk, relative to the root
 * @returns repo-relative paths, sorted
 */
function walk(root: string, tree: string): string[] {
  const absolute = path.join(root, tree);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts"))
    .map((name) => path.posix.join(tree, name.replaceAll(path.sep, "/")))
    .toSorted();
}

/**
 * Resolve the file a citation names to one path in the tree.
 *
 * A citation that spells a path is that path; a bare basename is looked
 * up, with the row's own file breaking the one tie this tree has
 * (`list.ts`, which is both a build and a print module).
 * @param citation - the citation
 * @param about - the file its scope is about, when there is one
 * @param tree - the checkout
 * @returns the path, or the reason there is not exactly one
 */
function resolve(
  citation: Citation,
  about: string | undefined,
  tree: Tree,
): { file: string | undefined; fault: string | undefined } {
  const { named } = citation;
  if (about !== undefined && path.basename(about) === named) {
    return { file: about, fault: undefined };
  }
  if (tree.sources.has(named)) {
    return { file: named, fault: undefined };
  }
  const found = [...tree.sources.keys()].filter(
    (file) => path.basename(file) === named,
  );
  if (found.length === 0) {
    return {
      file: undefined,
      fault: `names no file under ${SOURCE_ROOT}/, which is the only tree this gate reads`,
    };
  }
  if (found.length > 1) {
    return { file: undefined, fault: `is ambiguous: ${found.join(", ")}` };
  }
  return { file: found[0], fault: undefined };
}

/**
 * Hold one citation to the file it names.
 *
 * The quoted runs are held DISJUNCTIVELY - the cited span must carry at
 * least one of them - because a citation of several lines quotes the
 * several things that sit on them (a `return "go"` and two
 * `return "stop"`s, over nine lines), and no one line carries them all.
 * With one quoted run, which is the ordinary case, the disjunction and
 * the conjunction are the same check.
 *
 * Exported for its unit tests (tests/scripts/internal-citations.test.ts),
 * which drive it against literal file contents; no other consumer.
 * @internal
 * @param citation - the citation
 * @param file - the resolved repo-relative path of the cited file
 * @param lines - that file's lines, in order
 * @returns one message per failure, empty when the citation held
 */
export function checkCitation(
  citation: Citation,
  file: string,
  lines: readonly string[],
): string[] {
  const { at, spelling, from, to, fragments } = citation;
  const where = `${at}: \`${spelling}\``;
  if (from < 1 || to < from || to > lines.length) {
    return [
      `${where} names line ${String(to)} of ${file}, which has ${String(lines.length)} lines`,
    ];
  }
  const span = lines.slice(from - 1, to);
  const held = fragments.some((fragment) =>
    span.some((line) => line.includes(fragment)),
  );
  if (fragments.length === 0 || held) {
    return [];
  }
  const quoted = fragments.map((fragment) => `\`${fragment}\``).join(", ");
  const named = from === to ? String(from) : `${String(from)}-${String(to)}`;
  return [
    `${where} quotes ${quoted}, none of which is on ${file}:${named}, which reads \`${span[0].trim()}\``,
  ];
}

/**
 * What one run measured.
 *
 * Exported so {@link verdict} can be driven with a literal report
 * (tests/scripts/internal-citations.test.ts); {@link run} is the only
 * other producer.
 * @internal
 */
export interface Report {
  /** Citations whose file resolved and whose lines were read. */
  checked: number;
  /** Of those, the ones that also quoted source text. */
  quoted: number;
  /** Citations exempted as naming a tree that no longer exists. */
  exempt: number;
  /** Repo paths named in a `src` file and held to existing. */
  paths: number;
  /** Line references nothing in their scope named a file for. */
  contextless: string[];
  /** One line per failure, ready to print. */
  failures: string[];
  /** Every citation read, for `--list`. */
  listing: string[];
}

/** What a scope's citations are checked against. */
interface ScopeContext {
  /** The checkout. */
  readonly tree: Tree;
  /** The file the scope is about, where there is one. */
  readonly about: string | undefined;
  /** Spellings the scope declared as naming a tree that is gone. */
  readonly exempt: ReadonlySet<string>;
}

/**
 * Check every citation in one scope, and record what happened.
 * @param report - the run's report, added to in place
 * @param scan - the scope's citations
 * @param context - the checkout, the file the scope is about, and the
 *   spellings it has declared as naming a tree that no longer exists
 */
function checkScope(report: Report, scan: Scan, context: ScopeContext): void {
  const { tree, about, exempt } = context;
  report.contextless.push(...scan.contextless);
  for (const citation of scan.citations) {
    if (exempt.has(citation.spelling)) {
      report.exempt += 1;
      report.listing.push(
        `${citation.at}\t${citation.spelling}\t(former tree)`,
      );
      continue;
    }
    const { file, fault } = resolve(citation, about, tree);
    const lines = file === undefined ? undefined : tree.sources.get(file);
    if (file === undefined || lines === undefined) {
      report.failures.push(
        `${citation.at}: \`${citation.spelling}\` ${fault ?? "names no file this gate read"}`,
      );
      continue;
    }
    report.checked += 1;
    report.quoted += citation.fragments.length > 0 ? 1 : 0;
    report.listing.push(
      `${citation.at}\t${citation.spelling}\t${file}\t${citation.fragments.join(" | ")}`,
    );
    report.failures.push(...checkCitation(citation, file, lines));
  }
}

/**
 * One exception row, as much of it as this checker reads.
 *
 * Exported so a test can build rows without writing JSON
 * (tests/scripts/internal-citations.test.ts); no other consumer.
 * @internal
 */
export interface ExceptionRow {
  /** The file the row is about, relative to the checkout root. */
  readonly file: string;
  /** The mutant or region, which is where the citations are. */
  readonly what: string;
  /** The row's citations that name a tree that no longer exists. */
  readonly formerly: readonly string[];
}

/**
 * Read the exception rows out of the minimums file.
 *
 * A row that does not read as one is skipped rather than failed:
 * `bun run metrics` validates that file's shape and says so in its own
 * words, and two gates reporting the same malformed row is noise.
 *
 * Exported for its unit tests (tests/scripts/internal-citations.test.ts);
 * no other consumer.
 * @internal
 * @param text - the minimums file's bytes
 * @returns the rows this checker can read
 */
export function exceptionRows(text: string): ExceptionRow[] {
  const { value } = strictJson(MINIMUMS_FILE, text);
  if (!isObject(value)) {
    return [];
  }
  const { exceptions } = value;
  if (!isArray(exceptions)) {
    return [];
  }
  const rows: ExceptionRow[] = [];
  for (const raw of exceptions) {
    if (!isObject(raw)) {
      continue;
    }
    const { file, what, formerly } = raw;
    if (typeof file !== "string" || typeof what !== "string") {
      continue;
    }
    const listed = isArray(formerly) ? formerly : [];
    rows.push({
      file,
      what,
      formerly: listed.filter((one) => typeof one === "string"),
    });
  }
  return rows;
}

/**
 * Where an exception row is written, for a failure message.
 *
 * The row's `what` is a JSON string on a line of its own, so the file's
 * own bytes give a line number an editor can open; the row's file name
 * is the fallback for a file some other formatter has rewrapped.
 * @param text - the minimums file's bytes
 * @param row - the row
 * @returns `path:line`, or the file and the row's own file name
 */
function whereWritten(text: string, row: ExceptionRow): string {
  const at = text.indexOf(JSON.stringify(row.what));
  if (at === NOT_FOUND) {
    return `${MINIMUMS_FILE} ${row.file}`;
  }
  return `${MINIMUMS_FILE}:${String(text.slice(0, at).split("\n").length)}`;
}

/**
 * Check the exception rows' citations.
 * @param report - the run's report, added to in place
 * @param tree - the checkout
 */
function checkMinimums(report: Report, tree: Tree): void {
  for (const row of exceptionRows(tree.minimums)) {
    const at = whereWritten(tree.minimums, row);
    // `what` and NOT `reason`, though both carry citations. `what` is
    // written in the mutant grammar - a citation, then the source it
    // quotes, then `->` and the replacement - so a quoted run beside a
    // citation there IS a claim about that line. `reason` is free
    // prose, where the next quoted run is as likely to be a function
    // named three clauses later, and the only check that survives the
    // difference (does the line exist?) would have caught none of the
    // rot this gate was built for.
    const scan = scanScope(at, row.what, path.basename(row.file));
    const spellings = new Set(scan.citations.map((one) => one.spelling));
    for (const former of row.formerly) {
      if (!spellings.has(former)) {
        report.failures.push(
          `${at}: \`formerly\` names \`${former}\`, which this row's \`what\` does not cite`,
        );
      }
    }
    checkScope(report, scan, {
      tree,
      about: row.file,
      exempt: new Set(row.formerly),
    });
  }
}

/**
 * Check the lint config's deferral comments.
 *
 * One LINE is one scope: the path a deferral defers is written on the
 * same line as the `:line` that cites into it, and nothing may bind
 * across lines, or a stray number would adopt a path from a paragraph
 * above it.
 * @param report - the run's report, added to in place
 * @param tree - the checkout
 */
function checkLintConfig(report: Report, tree: Tree): void {
  const context: ScopeContext = {
    tree,
    about: undefined,
    exempt: new Set<string>(),
  };
  for (const [offset, line] of sourceLines(tree.lintConfig).entries()) {
    const at = `${ESLINT_FILE}:${String(offset + 1)}`;
    checkScope(report, scanScope(at, line), context);
  }
}

// A repo path named in a source file. All three of NAMED_ROOTS: a `src`
// comment names the test that pins it and the harness that measures it
// as freely as it names another module, and all three rot the same way.
const REPO_PATH = /(?:src|tests|scripts)\/[\w.\/\-]*\.ts/gv;

/**
 * Hold every repo path named in a `src` file to a file that exists. No
 * line, so no quoted text to check either.
 *
 * The scan is over the WHOLE file rather than over its comments alone:
 * extracting comments needs a lexer, and a path written anywhere in a
 * `src` file has to name a real file just the same, so the weaker scan
 * gives up nothing the stricter one would catch.
 * @param report - the run's report, added to in place
 * @param tree - the checkout
 */
function checkRepoPaths(report: Report, tree: Tree): void {
  for (const [relative, lines] of tree.sources) {
    for (const [offset, line] of lines.entries()) {
      for (const match of line.matchAll(REPO_PATH)) {
        report.paths += 1;
        if (!tree.files.has(match[0])) {
          report.failures.push(
            `${relative}:${String(offset + 1)}: names ${match[0]}, which does not exist`,
          );
        }
      }
    }
  }
}

/**
 * Check a whole checkout.
 *
 * All of the run's decisions, and none of its IO, so a test can run the
 * gate over a tree it wrote out itself.
 *
 * Exported for those tests (tests/scripts/internal-citations.test.ts);
 * `main` is the only other consumer.
 * @internal
 * @param tree - the checkout
 * @returns what the run measured
 */
export function run(tree: Tree): Report {
  const report: Report = {
    checked: 0,
    quoted: 0,
    exempt: 0,
    paths: 0,
    contextless: [],
    failures: [],
    listing: [],
  };
  checkMinimums(report, tree);
  checkLintConfig(report, tree);
  checkRepoPaths(report, tree);
  return report;
}

/**
 * What a run concluded, and what it has to say.
 *
 * Exported so the three arms can be asserted on directly
 * (tests/scripts/internal-citations.test.ts); `main` does nothing with
 * them but write and set a code.
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

/**
 * Turn a run into a report and an exit-code decision.
 *
 * Pure, and separate from `main`, because the things worth pinning here
 * are decisions rather than IO: that the measured-nothing floor is a 2
 * and not a 0, that one failure is a 1, and that a contextless
 * reference is neither.
 *
 * Exported for those tests (tests/scripts/internal-citations.test.ts);
 * no other consumer.
 * @internal
 * @param report - what the run measured
 * @returns what to print, and which exit code the run earned
 */
export function verdict(report: Report): Verdict {
  const total = report.checked + report.exempt + report.failures.length;
  if (total < MINIMUM_CITATIONS) {
    return {
      kind: "cannot-run",
      message: `internal-citations: found only ${String(total)} citations, below the floor of ${String(MINIMUM_CITATIONS)}: the scan lost its roots`,
    };
  }
  const lines = [...report.contextless, ...report.failures];
  if (report.failures.length > 0) {
    lines.push(
      `internal-citations: ${String(report.failures.length)} FAILED of ${String(report.checked)} checked`,
    );
    return { kind: "failed", lines };
  }
  lines.push(
    `internal-citations: ${String(report.checked)} citations hold (${String(report.quoted)} quoting source, ${String(report.exempt)} naming a former tree), ${String(report.paths)} repo paths exist`,
  );
  return { kind: "clean", lines };
}

/**
 * Run the gate.
 * @param list - whether to print every citation before the report
 * @throws {Error} if a scanned file is missing
 */
function main(list: boolean): void {
  const report = run(readTree(path.resolve(import.meta.dirname, "..")));
  if (list) {
    for (const entry of report.listing) {
      process.stdout.write(`${entry}\n`);
    }
  }
  const said = verdict(report);
  if (said.kind === "cannot-run") {
    cannotRun(said.message);
    return;
  }
  for (const line of said.lines) {
    process.stdout.write(`${line}\n`);
  }
  if (said.kind === "failed") {
    process.exitCode = GATE_FAILED;
  }
}

/**
 * Read the command line.
 *
 * An unknown argument is an error rather than a shrug: a silently
 * dropped flag would report a run nobody asked for.
 *
 * Exported for its unit test (tests/scripts/internal-citations.test.ts);
 * no other consumer.
 * @internal
 * @param argv - the arguments after the script name
 * @returns whether to print every citation
 * @throws {TypeError} on an unknown argument
 */
export function parseArguments(argv: readonly string[]): boolean {
  let list = false;
  for (const argument of argv) {
    if (argument !== "--list") {
      throw new TypeError(`internal-citations: unknown argument ${argument}`);
    }
    list = true;
  }
  return list;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(ARGUMENT_START);
    if (wantsHelp(argv)) {
      printUsage(USAGE);
    } else {
      main(parseArguments(argv));
    }
  } catch (error) {
    // A bad argument or a missing scanned file: neither checked
    // anything, so neither is a 1.
    cannotRun(error instanceof Error ? error.message : String(error));
  }
}
