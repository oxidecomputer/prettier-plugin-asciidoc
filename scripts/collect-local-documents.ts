#!/usr/bin/env bun
/**
 * Flatten a branch-per-document git repository into a directory of
 * documents the local-documents harness can walk.
 *
 * THE LAYOUT this was written for (Oxide's RFD repository is the
 * motivating example): published documents live on one base branch at
 * `<tree>/<number>/<file>`, and a document still under discussion
 * lives on a branch NAMED for its number, carrying its own copy of
 * that one path. So the corpus is the base branch's documents, with
 * each numbered branch's own copy overriding the base's for that
 * number - which is what {@link documentPlan} computes. The subtree
 * and file name are FIXED (see the usage text); `--base` is the only
 * layout knob.
 *
 * NOTHING HERE MUTATES THE SOURCE REPOSITORY. Every git command is a
 * read: `for-each-ref`, `ls-tree`, `rev-parse`, `show`. No checkout,
 * no fetch, no worktree - the repository being read is somebody's
 * working repository with their own working copy in it, and a harness
 * that disturbed it would be a harness nobody runs twice.
 *
 * Every ref is spelled `refs/heads/<name>` and never as a short name.
 * Git resolves a short name through `refs/tags/` FIRST, so a tag
 * sharing a branch's name silently shadows the branch: the branch's
 * document would vanish from the corpus (or, worse, the tag's copy
 * would be collected and reported as the branch's) while the run
 * still said it succeeded.
 *
 * The output directory is gitignored and the run refuses one that is
 * not (see {@link untrackedComplaint}), because the documents are
 * private and the whole harness rests on none of them reaching the
 * committed tree.
 *
 * Exit codes (`scripts/lib/cli.ts`): 0 written, 2 it could not run -
 * no repository named, an unreadable one, a base branch that does not
 * exist, an output directory that is not ignored, or a base with no
 * documents under it. There is no 1: nothing here is a gate.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { CHILD_MAX_BUFFER } from "./lib/checkout.js";
import { cannotRun, printUsage, wantsHelp } from "./lib/cli.js";
import {
  CONFIG_FILE,
  DEFAULT_CORPUS,
  readLocalDocumentsConfig,
} from "./lib/local-documents-config.js";

const ARGUMENT_START = 2;

/** The subtree the documents live in, in the motivating layout. */
const DOCUMENT_DIRECTORY = "rfd";

/** The file each numbered directory holds its document in. */
const DOCUMENT_FILE = "README.adoc";

/** The extension every collected document is written with. */
const DOCUMENT_EXTENSION = ".adoc";

/** The branch the published documents live on, by default. */
const DEFAULT_BASE = "master";

/** How many path components a document path has: dir, number, file. */
const DOCUMENT_PATH_PARTS = 3;

/** The names a previous run of this script can have written. */
const COLLECTED_NAME = /^\d+\.adoc$/v;

/** What `--help` prints. */
const USAGE = `usage: bun run collect-local-docs [options]

  --repo <dir>  the branch-per-document git repository to read;
                defaults to the "repository" field of ${CONFIG_FILE}
  --out <dir>   where to write the flattened documents (default
                ${DEFAULT_CORPUS}); it must be gitignored, or --force
  --base <ref>  the BRANCH the published documents live on (default
                ${DEFAULT_BASE}); resolved as refs/heads/<ref>
  --force       write to an output directory that is not gitignored
  --help        this text

The layout is FIXED: ${DOCUMENT_DIRECTORY}/<number>/${DOCUMENT_FILE} on the base
branch, plus each LOCAL branch whose name is all digits, whose own
copy of its own number overrides the base's. Only refs/heads is
scanned, so a fresh clone with no local branches contributes the base
branch's documents and nothing else. Writes <number>${DOCUMENT_EXTENSION} into
the output directory, replacing the <number>${DOCUMENT_EXTENSION} files a
previous run wrote and touching nothing else there. Every git command
is read-only.

exit: 0 written, 2 could not run`;

/** The command line, parsed. */
interface Options {
  /** The repository to read, when the command line named one. */
  repository: string | undefined;
  /** The output directory, when the command line named one. */
  out: string | undefined;
  /** The branch the published documents live on, short-named. */
  base: string;
  /** Whether to accept an output directory that is not ignored. */
  force: boolean;
}

/**
 * Parse the command line. An unrecognized argument is an error, not a
 * shrug: a silently dropped `--out` would write a private corpus into
 * whatever the default happens to be.
 * @param argv - the arguments after the script name
 * @returns the options
 * @throws {TypeError} on an unknown argument or a missing value
 */
export function parseArguments(argv: readonly string[]): Options {
  const options: Options = {
    repository: undefined,
    out: undefined,
    base: DEFAULT_BASE,
    force: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = (): string => {
      // A missing value and the NEXT FLAG are the same mistake:
      // `--out --base trunk` would otherwise write the corpus to a
      // directory called `--base`.
      const spelling = argv[index + 1] ?? "";
      if (spelling === "" || spelling.startsWith("-")) {
        throw new TypeError(`collect-local-docs: ${argument} needs a value`);
      }
      index += 1;
      return spelling;
    };
    switch (argument) {
      case "--repo": {
        options.repository = value();
        break;
      }
      case "--out": {
        options.out = value();
        break;
      }
      case "--base": {
        options.base = value();
        break;
      }
      case "--force": {
        options.force = true;
        break;
      }
      default: {
        throw new TypeError(`collect-local-docs: unknown argument ${argument}`);
      }
    }
  }
  return options;
}

/** One document to collect: which ref holds it, and where. */
export interface DocumentSource {
  /** The document's number, spelled as its directory spells it. */
  readonly number: string;
  /** The FULLY QUALIFIED git ref holding the copy to write. */
  readonly ref: string;
  /** The path within that ref's tree. */
  readonly path: string;
}

/**
 * A branch's fully qualified ref.
 *
 * Every ref this script hands to git goes through here. See the
 * module header: a short name is resolved through `refs/tags/` first,
 * and the shadowing is silent.
 * @param branch - a local branch's short name
 * @returns the ref under `refs/heads/`
 */
export function qualifiedBranch(branch: string): string {
  return `refs/heads/${branch}`;
}

/**
 * The number a tree path names, when it names a document at all.
 *
 * Structural rather than a regex over the whole path, so the layout
 * is stated once: exactly three components, the expected directory,
 * an all-digits number, and the expected file name.
 *
 * KNOWN COST: the three-component rule drops more than images and
 * diagram sources. A document filed one level deeper - a dated
 * revision under its number, an appendix beside it - is real prose
 * this leaves on the floor (measured against the motivating
 * repository: a handful of such files). Collecting them needs a
 * second naming rule for the corpus, since their ids would no longer
 * be a number; that trade has not been made.
 * @param file - a path within a tree, posix-spelled
 * @returns the number, or undefined when the path is not a document
 */
export function documentNumber(file: string): string | undefined {
  const parts = file.split("/");
  if (parts.length !== DOCUMENT_PATH_PARTS) {
    return undefined;
  }
  const [directory, number, name] = parts;
  if (directory !== DOCUMENT_DIRECTORY || name !== DOCUMENT_FILE) {
    return undefined;
  }
  return /^\d+$/v.test(number) ? number : undefined;
}

/**
 * The branches that name a document by number.
 *
 * A repository like this one has a branch per in-discussion document
 * and any number of other branches; the all-digits name is what says
 * "this branch IS a document". `master`, `main` and somebody's
 * `fix-typo` are not documents and are skipped.
 *
 * A `heads/<digits>` name is a FAULT, not a branch to skip. That is
 * what `for-each-ref --format=%(refname:short)` returns when a TAG
 * shares the branch's name: `refname:short` disambiguates, the name
 * comes back partly qualified, and a filter looking for digits then
 * drops the branch - the in-discussion document disappears from the
 * corpus and the run still reports success, which is the exact
 * failure {@link qualifiedBranch} exists to prevent. The enumeration
 * uses `%(refname:lstrip=2)`, which strips `refs/heads/` and nothing
 * else; this throw is what makes a regression to `:short` loud.
 * @param branches - every local branch's bare name
 * @returns the numbered ones, in the order they were given
 * @throws {TypeError} when a name arrives partly qualified
 */
export function numberedBranches(branches: readonly string[]): string[] {
  const ambiguous = branches.filter((branch) => /^heads\/\d+$/v.test(branch));
  if (ambiguous.length > 0) {
    throw new TypeError(
      `collect-local-docs: branch ${ambiguous[0]} came back partly qualified - the enumeration must use %(refname:lstrip=2), not %(refname:short), which disambiguates when a tag shares a branch's name`,
    );
  }
  return branches.filter((branch) => /^\d+$/v.test(branch));
}

/**
 * Which copy of each document to collect.
 *
 * The base branch supplies every published document. A numbered
 * branch overrides the base for ITS OWN number only: its copies of
 * every other document are just whatever the base held when the
 * branch was cut, and collecting those would fill the corpus with
 * stale duplicates.
 * @param base - the base BRANCH's short name
 * @param basePaths - every path under the subtree on the base branch
 * @param branchPaths - each numbered branch's paths under the
 *   subtree, keyed by branch name
 * @returns one source per document number, sorted by number, each
 *   naming a fully qualified ref
 */
export function documentPlan(
  base: string,
  basePaths: readonly string[],
  branchPaths: ReadonlyMap<string, readonly string[]>,
): DocumentSource[] {
  const sources = new Map<string, DocumentSource>();
  for (const file of basePaths) {
    const number = documentNumber(file);
    if (number === undefined) {
      continue;
    }
    sources.set(number, { number, ref: qualifiedBranch(base), path: file });
  }
  for (const [branch, paths] of branchPaths) {
    const own = paths.find((file) => documentNumber(file) === branch);
    if (own === undefined) {
      continue;
    }
    sources.set(branch, {
      number: branch,
      ref: qualifiedBranch(branch),
      path: own,
    });
  }
  // Code point, not `localeCompare`: collation is locale-dependent,
  // and the order a corpus is written in should not be either.
  return [...sources.values()].toSorted((left, right) => {
    if (left.number < right.number) {
      return -1;
    }
    if (left.number > right.number) {
      return 1;
    }
    return 0;
  });
}

/**
 * Run one READ-ONLY git command in the source repository.
 *
 * `-C <repo>` rather than a `cd`, and `execFileSync` rather than a
 * shell, so nothing in a path or a ref name can become a second
 * command.
 * @param repository - the repository to read
 * @param arguments_ - the git arguments, command first
 * @returns the command's stdout as text
 * @throws {Error} when git fails; the caller turns that into "the
 *   harness could not run"
 */
function gitText(repository: string, arguments_: readonly string[]): string {
  return execFileSync("git", ["-C", repository, ...arguments_], {
    encoding: "utf8",
    maxBuffer: CHILD_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * The same, returning BYTES.
 *
 * A document is copied byte for byte rather than decoded and
 * re-encoded: a file that is not valid UTF-8 would otherwise land in
 * the corpus full of replacement characters, and since both sides of
 * every check would see the same mangled text, no check would fire.
 * Silent corpus corruption is the one failure this harness cannot
 * report on itself.
 * @param repository - the repository to read
 * @param arguments_ - the git arguments, command first
 * @returns the command's stdout as bytes
 */
function gitBytes(repository: string, arguments_: readonly string[]): Buffer {
  return execFileSync("git", ["-C", repository, ...arguments_], {
    encoding: "buffer",
    maxBuffer: CHILD_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/**
 * The non-empty lines of a git command's output.
 * @param repository - the repository to read
 * @param arguments_ - the git arguments, command first
 * @returns the lines
 */
function gitLines(repository: string, arguments_: readonly string[]): string[] {
  return gitText(repository, arguments_)
    .split("\n")
    .filter((line) => line !== "");
}

/**
 * Does the repository have this branch?
 *
 * Asked before anything else reads it, so a mistyped `--base` is one
 * clear sentence rather than an empty listing that reads as "this
 * repository has no documents".
 * @param repository - the repository to read
 * @param base - the base branch's short name
 * @returns whether `refs/heads/<base>` resolves
 */
function hasBranch(repository: string, base: string): boolean {
  try {
    gitText(repository, [
      "rev-parse",
      "--verify",
      "--quiet",
      qualifiedBranch(base),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask the repository what it holds, and turn that into a plan.
 * @param repository - the repository to read
 * @param base - the base branch's short name
 * @returns one source per document number
 */
function planFrom(repository: string, base: string): DocumentSource[] {
  const basePaths = gitLines(repository, [
    "ls-tree",
    "-r",
    "--name-only",
    qualifiedBranch(base),
    "--",
    DOCUMENT_DIRECTORY,
  ]);
  // `lstrip=2` strips `refs/heads/` and nothing else. NOT
  // `%(refname:short)`: that spelling disambiguates, so a tag sharing
  // a branch's name makes the branch come back as `heads/<name>` -
  // see {@link numberedBranches}, which refuses that spelling rather
  // than letting the document fall out of the corpus quietly.
  const branches = numberedBranches(
    gitLines(repository, [
      "for-each-ref",
      "--format=%(refname:lstrip=2)",
      "refs/heads/",
    ]),
  );
  // One `ls-tree` per branch, asking only about that branch's own
  // path: a full listing per branch would be thousands of paths to
  // find one, and a repository like this has a branch per document.
  const branchPaths = new Map<string, readonly string[]>(
    branches.map((branch) => [
      branch,
      gitLines(repository, [
        "ls-tree",
        "--name-only",
        qualifiedBranch(branch),
        "--",
        path.posix.join(DOCUMENT_DIRECTORY, branch, DOCUMENT_FILE),
      ]),
    ]),
  );
  return documentPlan(base, basePaths, branchPaths);
}

/**
 * Delete the documents a PREVIOUS RUN of this script wrote, and
 * nothing else.
 *
 * Exported for its own test, because this is the one destructive
 * thing the script does and the blast radius is somebody's private
 * documents. The name pattern is the collector's OWN output shape
 * (`<digits>.adoc`); a hand-written `my-notes.adoc` in the same
 * directory is not ours to remove, and neither is anything without
 * the extension. Without the sweep, a document withdrawn upstream
 * would sit in the corpus forever.
 * @param out - the output directory, which must exist
 * @returns the names it removed, for a caller that wants to say so
 */
export function clearCollected(out: string): string[] {
  const removed = readdirSync(out).filter((name) => COLLECTED_NAME.test(name));
  for (const name of removed) {
    rmSync(path.join(out, name));
  }
  return removed;
}

/**
 * Is this directory one the collector may write private documents
 * into - the default corpus, or a path git says it ignores?
 * @param out - the output directory, as given
 * @returns whether writing there keeps the documents out of a tree
 */
function untracked(out: string): boolean {
  const target = path.resolve(out);
  const fallback = path.resolve(DEFAULT_CORPUS);
  if (target === fallback || target.startsWith(`${fallback}${path.sep}`)) {
    return true;
  }
  // `check-ignore` is read-only and answers by exit code: 0 ignored,
  // 1 not, anything else (not a repository, no such path) is an error
  // and reads as NOT ignored - the safe direction. It runs in the
  // nearest existing ancestor, because the output directory itself
  // may not exist yet.
  try {
    execFileSync(
      "git",
      ["-C", nearestExisting(target), "check-ignore", "--quiet", "--", target],
      {
        maxBuffer: CHILD_MAX_BUFFER,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The nearest existing ancestor of a path, itself included.
 * @param target - an absolute path that may not exist yet
 * @returns the deepest existing directory on its way up
 */
function nearestExisting(target: string): string {
  let here = target;
  while (!existsSync(here)) {
    const up = path.dirname(here);
    if (up === here) {
      return here;
    }
    here = up;
  }
  return here;
}

/**
 * The complaint about an output directory that is neither the default
 * nor ignored, or undefined when there is none.
 *
 * The privacy rule this harness rests on is that nothing derived from
 * a real document reaches the committed tree, and until this check
 * existed the rule was enforced by nothing but the operator's choice
 * of directory: `--out tests/integration/fixtures` would have filled
 * a committed fixture tree with private documents.
 * @param out - the output directory, as given
 * @param force - whether `--force` said to write there anyway
 * @returns the complaint, or undefined when writing there is fine
 */
function untrackedComplaint(out: string, force: boolean): string | undefined {
  if (force || untracked(out)) {
    return undefined;
  }
  return `collect-local-docs: ${out} is not gitignored - the documents are private and must not reach a tracked tree; use ${DEFAULT_CORPUS}, add the directory to .gitignore, or pass --force`;
}

/**
 * Write the planned documents, replacing what a previous run left.
 * @param repository - the repository to read
 * @param out - the output directory
 * @param plan - what to write
 */
function collect(
  repository: string,
  out: string,
  plan: readonly DocumentSource[],
): void {
  mkdirSync(out, { recursive: true });
  clearCollected(out);
  for (const source of plan) {
    const bytes = gitBytes(repository, [
      "show",
      `${source.ref}:${source.path}`,
    ]);
    writeFileSync(
      path.join(out, `${source.number}${DOCUMENT_EXTENSION}`),
      bytes,
    );
  }
}

/**
 * Read the repository, write the corpus, say what it wrote.
 * @param options - the parsed command line
 */
function main(options: Options): void {
  const config = readLocalDocumentsConfig();
  const repository = options.repository ?? config.repository;
  if (repository === undefined) {
    cannotRun(
      `collect-local-docs: no repository - pass --repo, or put {"repository": "<dir>"} in ${CONFIG_FILE}`,
    );
    return;
  }
  if (!existsSync(repository)) {
    cannotRun(`collect-local-docs: ${repository} does not exist`);
    return;
  }
  // The output directory is NOT the config's `corpus`: that field is
  // the directory `bun run local-docs` WALKS, which is somebody's own
  // documents as often as it is a collected corpus, and the collector
  // deletes files. One knob per job.
  const out = options.out ?? DEFAULT_CORPUS;
  const untrackedFault = untrackedComplaint(out, options.force);
  if (untrackedFault !== undefined) {
    cannotRun(untrackedFault);
    return;
  }
  if (!hasBranch(repository, options.base)) {
    cannotRun(
      `collect-local-docs: ${repository} has no branch ${options.base} (looked for ${qualifiedBranch(options.base)})`,
    );
    return;
  }
  const plan = planFrom(repository, options.base);
  // The measured-nothing floor: a base branch with no documents under
  // it means the layout is not the one this script reads, and writing
  // an empty corpus would leave the harness reporting a perfect run
  // over nothing.
  if (plan.length === 0) {
    cannotRun(
      `collect-local-docs: no ${DOCUMENT_DIRECTORY}/<number>/${DOCUMENT_FILE} under ${qualifiedBranch(options.base)} in ${repository}`,
    );
    return;
  }
  const base = qualifiedBranch(options.base);
  const overrides = plan.filter((source) => source.ref !== base).length;
  collect(repository, out, plan);
  process.stdout.write(
    `collect-local-docs: wrote ${String(plan.length)} documents to ${out} (${String(plan.length - overrides)} from ${options.base}, ${String(overrides)} from numbered branches)\n`,
  );
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
    // A bad argument, a repository that is not one, a ref that does
    // not exist: none of them collected anything.
    cannotRun(error instanceof Error ? error.message : String(error));
  }
}
