#!/usr/bin/env bun
/**
 * The repo-internal citation gate: every claim this repository writes
 * about ITSELF - the symbol a mutation exception excuses code inside,
 * the path a comment names, the name a comment writes beside one - is
 * held to the tree.
 *
 * Three review rounds running turned up hand-maintained citations that
 * had rotted when an edit moved the code out from under them, in the
 * two places this repository keeps them: the exception rows of
 * `scripts/metrics/score-minimums.json`, which name a surviving mutant
 * and quote it, and the coverage-deferral comments in
 * `eslint.config.js`, which name the guard a brace would uncover and
 * quote it. Both used to write the mutant's `file:line`, and a line
 * number is not a fact about the code: every commit adding or removing
 * a line above one moved it, so nearly every landing re-anchored
 * several by hand and they were the commonest rebase conflict in the
 * tree. What an excused mutant sits in is a SYMBOL, which survives the
 * lines around it moving and survives the function moving file.
 *
 * This is the repo-INTERNAL half. `bun run citation-check` is the other
 * half and reads the other direction: citations of the Asciidoctor Ruby
 * and of the oracle build, which are sources we do not edit.
 *
 * The markdown this repository writes about itself makes the same kind
 * of claim in a different spelling: a fragment link names one of its
 * own headings. Those are slugged and resolved here too
 * (`scripts/internal-anchors.ts`), because a link that lands nowhere
 * is a rotted citation with a `#` in front of it.
 *
 * A PIN is what both files write: the symbol the excused code sits in,
 * the source text quoted from that symbol's body, and - where the body
 * carries that text more than once - which occurrence is meant. The
 * quotation is what makes an exception reviewable, so it stays; only
 * the coordinate goes. An exception row spells its pins in a `cites`
 * array, and a lint-config deferral spells them in the comment beside
 * the path, one entry line at a time.
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
import { ignoredIn, type Ignored } from "./lib/ignored.js";
import { checkFragments, documentsOf } from "./internal-anchors.js";
import {
  NO_NAMES,
  SYMBOL_SHAPE,
  bodiesIn,
  checkLink,
  checkSymbol,
  linkCitations,
  namesIn,
  symbolCitations,
  symbolIndex,
  type DeclaredBodies,
} from "./internal-symbols.js";
import { isArray, isObject, strictJson } from "./metrics/json.js";

const ARGUMENT_START = 2;

/** What `indexOf` answers when it did not find the thing. */
const NOT_FOUND = -1;

/** The exceptions file, whose rows carry symbol pins. */
export const MINIMUMS_FILE = "scripts/metrics/score-minimums.json";

/** The lint config, whose deferral comments carry symbol pins. */
export const ESLINT_FILE = "eslint.config.js";

/** The tree whose files are read line by line, for the paths they name. */
export const SOURCE_ROOT = "src";

/**
 * The trees a comment may NAME a path in. Wider than {@link SOURCE_ROOT}
 * because `src` comments name their tests and their harnesses as freely
 * as they name each other, and a renamed test file rots a `src` comment
 * exactly the way a renamed module does.
 */
export const NAMED_ROOTS = ["src", "tests", "scripts"];

/**
 * The floor below which the scan proved nothing, over the symbol
 * pins, the symbol citations and the link tags together. A run that
 * finds a handful has lost its roots rather than its citations, and
 * that is a 2.
 *
 * Set from what the tree carries: 1,494, of which 33 are pins, 114
 * are symbols beside a path and 1,347 are link tags. The number to
 * clear is what LOSING A TREE costs, and the smallest of the three
 * carries 217 of them, so a run that stopped walking any one of the
 * three lands at 1,277 or below; this floor sits in that gap. Raised
 * from 1,250, which was the same gap over a smaller surface, and from
 * 200 before that, when the tags carried no check at all.
 *
 * The doc fragments are NOT in it. There are a dozen of them where the
 * tags number four figures, so a floor they could move would be one an
 * ordinary edit to a document could trip; their own scan is pinned by
 * its unit tests instead. Their FAILURES count, like every scan's.
 *
 * Exported so the floor has a test at its boundary
 * (tests/scripts/internal-citations.test.ts); no other consumer.
 * @internal
 */
export const MINIMUM_CITATIONS = 1280;

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
   * question the path scan asks and for nothing else.
   */
  readonly files: ReadonlySet<string>;
  /**
   * Every file the symbol scan reads a citation out of, as written:
   * the `.ts` files of all three of {@link NAMED_ROOTS}, the markdown
   * of {@link DOCUMENT_ROOT} and {@link ROOT_DOCUMENTS}, and the JSON
   * ledgers, whose `note` and `reason` prose names symbols exactly the
   * way a comment does. The path scan reads comments from `src` alone;
   * the symbol scan reads all of these, because a test's comment names
   * the function it pins as freely as a module names its neighbour, a
   * document names one in a sentence, and a rename rots all of them.
   */
  readonly texts: ReadonlyMap<string, string>;
  /** Every markdown file this gate reads, as written. */
  readonly markdown: ReadonlyMap<string, string>;
  /** Every markdown file the checkout HAS, read or not. */
  readonly present: ReadonlySet<string>;
}

/** What every pin says, whichever variant it is. */
interface PinSite {
  /** Where the pin is written, as `path:line`. */
  readonly at: string;
  /** The repo-relative file whose symbol it names. */
  readonly file: string;
  /** The symbol whose body must carry the quoted run. */
  readonly symbol: string;
  /** The source text quoted from that body. */
  readonly quotes: string;
}

/** A pin whose quoted run is the only one the symbol's body carries. */
interface SolePin extends PinSite {
  /** Which variant this is. */
  readonly kind: "sole";
}

/** A pin whose quoted run is one of several, saying which. */
interface NthPin extends PinSite {
  /** Which variant this is. */
  readonly kind: "nth";
  /** The occurrence it means, counting from 1. */
  readonly ordinal: number;
}

/**
 * One symbol pin: the symbol an excused mutant or a deferred guard
 * sits in, and the source text quoted from that symbol's body.
 *
 * Two variants, because a run a body carries ONCE and a run it carries
 * several times are different claims. The first names its place by
 * being the only one there; the second cannot, so it says which. A pin
 * that quoted a repeated run and said nothing more would point at all
 * of them and at none of them, so that spelling FAILS rather than
 * silently taking the first.
 *
 * Exported so a test can build pins without writing JSON
 * (tests/scripts/internal-citations.test.ts); no other consumer.
 * @internal
 */
export type Pin = SolePin | NthPin;

/** A `cites` entry that read as a pin. */
interface PinHeld {
  /** Which variant this is. */
  readonly kind: "pin";
  /** What it read as. */
  readonly pin: Pin;
}

/** A `cites` entry that did not read as a pin, and why. */
interface PinFault {
  /** Which variant this is. */
  readonly kind: "fault";
  /** What is wrong with it, ready to print. */
  readonly fault: string;
}

/**
 * What reading one `cites` entry produced: a pin, or the reason it is
 * not one. Total, so a mistyped entry is a message rather than a check
 * that silently stopped happening.
 *
 * Exported with {@link readPin}
 * (tests/scripts/internal-citations.test.ts); no other consumer.
 * @internal
 */
export type PinRead = PinHeld | PinFault;

/** Exactly the keys a `cites` entry may carry. */
const PIN_KEYS = new Set(["symbol", "quotes", "ordinal"]);

/** The lowest occurrence a pin may name. */
const FIRST_OCCURRENCE = 1;

/**
 * Read one `cites` entry as a pin.
 *
 * Exported for its unit tests (tests/scripts/internal-citations.test.ts);
 * {@link exceptionRows} is the only other consumer.
 * @internal
 * @param at - where the row it belongs to is written
 * @param file - the file that row is about
 * @param raw - one element of the row's `cites` array
 * @returns the pin, or the reason it is not one
 */
export function readPin(at: string, file: string, raw: unknown): PinRead {
  if (!isObject(raw) || isArray(raw)) {
    return {
      kind: "fault",
      fault: `${at}: a \`cites\` entry is not an object`,
    };
  }
  const unknown = Object.keys(raw).filter((key) => !PIN_KEYS.has(key));
  if (unknown.length > 0) {
    return {
      kind: "fault",
      fault: `${at}: a \`cites\` entry carries unknown key(s) ${unknown.join(", ")}`,
    };
  }
  const { symbol, quotes, ordinal } = raw;
  if (typeof symbol !== "string" || symbol === "") {
    return {
      kind: "fault",
      fault: `${at}: a \`cites\` entry names no \`symbol\``,
    };
  }
  if (typeof quotes !== "string" || quotes === "") {
    return {
      kind: "fault",
      fault: `${at}: \`${symbol}\` quotes nothing, and a pin nothing quotes is unreviewable`,
    };
  }
  return readOrdinal({ at, file, symbol, quotes }, ordinal);
}

/**
 * Read a pin's ordinal, which is what tells the two variants apart.
 *
 * Split from {@link readPin} because the two questions are separate -
 * is this an entry at all, and which occurrence does it mean - and
 * because one function asking both stands over the complexity ceiling.
 * @param site - what the entry has already read as
 * @param ordinal - its `ordinal` field, however it is spelled
 * @returns the pin, or the reason the ordinal is not one
 */
function readOrdinal(site: PinSite, ordinal: unknown): PinRead {
  if (ordinal === undefined) {
    return { kind: "pin", pin: { kind: "sole", ...site } };
  }
  if (
    typeof ordinal !== "number" ||
    !Number.isInteger(ordinal) ||
    ordinal < FIRST_OCCURRENCE
  ) {
    return {
      kind: "fault",
      fault: `${site.at}: \`${site.symbol}\` names ordinal ${JSON.stringify(ordinal)}, which is not a whole number from ${String(FIRST_OCCURRENCE)}`,
    };
  }
  return { kind: "pin", pin: { kind: "nth", ...site, ordinal } };
}

/**
 * How many times one run of text is written in another.
 *
 * Counted WITHOUT overlaps, because the runs a pin quotes are whole
 * expressions and a run that overlapped itself would be counted twice
 * for one place in the source.
 * @param text - the text to look in
 * @param run - the run to look for
 * @returns how many times it is written there, possibly none
 */
function occurrencesOf(text: string, run: string): number {
  let found = 0;
  let at = text.indexOf(run);
  while (at !== NOT_FOUND) {
    found += 1;
    at = text.indexOf(run, at + run.length);
  }
  return found;
}

/**
 * Split a file into the lines the line-by-line scans read.
 *
 * The final newline does not open a line: counting the empty string
 * after it would add a line the file does not have, and both callers
 * number what they find, so an editor's line and this one's have to
 * agree.
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
  const skip = ignoredIn(root);
  const files = new Set(NAMED_ROOTS.flatMap((t) => walk(root, t, ".ts", skip)));
  const sources = new Map<string, readonly string[]>();
  for (const one of walk(root, SOURCE_ROOT, ".ts", skip)) {
    sources.set(one, sourceLines(bytes(one)));
  }
  const documents = documentsOf(root, skip);
  const ledgers = NAMED_ROOTS.flatMap((t) => walk(root, t, ".json", skip));
  const read = (one: string): [string, string] => [one, bytes(one)];
  const markdown = new Map(documents.scanned.map(read));
  const texts = new Map([...files, ...documents.scanned, ...ledgers].map(read));
  return {
    minimums: bytes(MINIMUMS_FILE),
    lintConfig: bytes(ESLINT_FILE),
    sources,
    files,
    texts,
    markdown,
    present: documents.present,
  };
}

/**
 * Every file of one extension under one tree that the checkout TRACKS,
 * in a stable order. A path the checkout ignores is not this
 * repository's to be held to (`ignoredIn`, scripts/lib/ignored.ts).
 * @param root - the repository root
 * @param tree - the directory to walk, relative to the root
 * @param extension - the suffix a scanned file ends in
 * @param skip - whether a path is one the checkout ignores
 * @returns repo-relative paths, sorted
 */
function walk(
  root: string,
  tree: string,
  extension: string,
  skip: Ignored,
): string[] {
  const absolute = path.join(root, tree);
  if (!existsSync(absolute)) {
    return [];
  }
  return readdirSync(absolute, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(extension))
    .map((name) => path.posix.join(tree, name.replaceAll(path.sep, "/")))
    .filter((relative) => !skip(relative))
    .toSorted();
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
  /** Symbol pins whose file was read and whose quotation was looked for. */
  pins: number;
  /** Repo paths named in a `src` file and held to existing. */
  paths: number;
  /** Symbols named beside a repo path and held to that file. */
  symbols: number;
  /** Symbols named in a link tag and held to the tree's index. */
  links: number;
  /** Markdown fragment links held to a heading of the file they name. */
  anchors: number;
  /** One line per failure, ready to print. */
  failures: string[];
  /** Every citation read, for `--list`. */
  listing: string[];
}

/** A lookup from repo path to that file's declarations. */
type Bodies = (file: string) => DeclaredBodies | undefined;

/**
 * The declarations of every file a pin names, parsed on demand and
 * once each.
 *
 * On demand because the pins name a dozen files where the tree holds
 * hundreds, and once each because a file's pins are checked together.
 * @param tree - the checkout
 * @returns the lookup, or undefined for a file the gate read no text for
 */
function bodiesOf(tree: Tree): Bodies {
  const parsed = new Map<string, DeclaredBodies>();
  return (file) => {
    const held = parsed.get(file);
    if (held !== undefined) {
      return held;
    }
    const text = tree.texts.get(file);
    const bodies = text === undefined ? undefined : bodiesIn(file, text);
    if (bodies !== undefined) {
      parsed.set(file, bodies);
    }
    return bodies;
  };
}

/**
 * Hold one pin to the symbol it names, and record what happened.
 * @param report - the run's report, added to in place
 * @param bodies - the declaration lookup
 * @param pin - the pin
 */
function holdPin(report: Report, bodies: Bodies, pin: Pin): void {
  const held = bodies(pin.file);
  if (held === undefined) {
    report.failures.push(
      `${pin.at}: names ${pin.file}, which this gate read no text for`,
    );
    return;
  }
  report.pins += 1;
  const which = pin.kind === "nth" ? ` #${String(pin.ordinal)}` : "";
  report.listing.push(
    `${pin.at}\t${pin.file}\t\`${pin.symbol}\`${which}\t${pin.quotes}`,
  );
  report.failures.push(...checkPin(pin, held));
}

/**
 * Hold one pin to the symbol it names.
 *
 * Exported for its unit tests (tests/scripts/internal-citations.test.ts),
 * which drive it against literal declaration texts; {@link holdPin} is
 * the only other consumer.
 * @internal
 * @param pin - the pin
 * @param bodies - the declarations of the file it names
 * @returns one message per failure, empty when the pin held
 */
export function checkPin(pin: Pin, bodies: DeclaredBodies): string[] {
  const written = bodies.get(pin.symbol);
  if (written === undefined) {
    return [`${pin.at}: ${pin.file} declares no \`${pin.symbol}\``];
  }
  const where = `${pin.at}: \`${pin.symbol}\` in ${pin.file}`;
  const carried = occurrencesOf(written.join("\n"), pin.quotes);
  if (carried === 0) {
    return [`${where} does not carry \`${pin.quotes}\``];
  }
  const times = `carries \`${pin.quotes}\` ${String(carried)} times`;
  if (pin.kind === "sole") {
    return carried === 1 ? [] : [`${where} ${times}: name the ordinal`];
  }
  return pin.ordinal <= carried
    ? []
    : [`${where} ${times}, so there is no ${String(pin.ordinal)}`];
}

/**
 * One exception row, as much of it as this checker reads.
 *
 * Exported so a test can build rows without writing JSON
 * (tests/scripts/internal-citations.test.ts); no other consumer.
 * @internal
 */
export interface ExceptionRow {
  /** Where the row is written, as `path:line`. */
  readonly at: string;
  /** The file the row is about, relative to the checkout root. */
  readonly file: string;
  /** The pins its `cites` array writes, in order. */
  readonly pins: readonly Pin[];
  /** One message per `cites` entry that did not read as a pin. */
  readonly faults: readonly string[];
}

/**
 * Read the exception rows out of the minimums file.
 *
 * A row that does not read as one is skipped rather than failed:
 * `bun run metrics` validates that file's shape and says so in its own
 * words, and two gates reporting the same malformed row is noise. What
 * that gate does not read is the PINS - it allows the key and stops
 * there - so a `cites` entry that does not read as one is this gate's
 * failure to report.
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
    const { file, what, cites } = raw;
    if (typeof file !== "string" || typeof what !== "string") {
      continue;
    }
    rows.push(readRow(whereWritten(text, what, file), file, cites));
  }
  return rows;
}

/**
 * Read one row's `cites` field into the pins it writes and the faults
 * it carries.
 * @param at - where the row is written
 * @param file - the file the row is about
 * @param cites - the row's `cites` field, however it is spelled
 * @returns the row
 */
function readRow(at: string, file: string, cites: unknown): ExceptionRow {
  if (cites === undefined) {
    return { at, file, pins: [], faults: [] };
  }
  if (!isArray(cites)) {
    return { at, file, pins: [], faults: [`${at}: \`cites\` is not an array`] };
  }
  const pins: Pin[] = [];
  const faults: string[] = [];
  for (const entry of cites) {
    const read = readPin(at, file, entry);
    if (read.kind === "pin") {
      pins.push(read.pin);
    } else {
      faults.push(read.fault);
    }
  }
  return { at, file, pins, faults };
}

/**
 * Where an exception row is written, for a failure message.
 *
 * The row's `what` is a JSON string on a line of its own, so the file's
 * own bytes give a line number an editor can open; the row's file name
 * is the fallback for a file some other formatter has rewrapped.
 * @param text - the minimums file's bytes
 * @param what - the row's `what` field
 * @param file - the file the row is about
 * @returns `path:line`, or the file and the row's own file name
 */
function whereWritten(text: string, what: string, file: string): string {
  const at = text.indexOf(JSON.stringify(what));
  if (at === NOT_FOUND) {
    return `${MINIMUMS_FILE} ${file}`;
  }
  return `${MINIMUMS_FILE}:${String(text.slice(0, at).split("\n").length)}`;
}

/**
 * Check the exception rows' pins.
 * @param report - the run's report, added to in place
 * @param bodies - the declaration lookup
 * @param tree - the checkout
 */
function checkMinimums(report: Report, bodies: Bodies, tree: Tree): void {
  for (const row of exceptionRows(tree.minimums)) {
    report.failures.push(...row.faults);
    for (const pin of row.pins) {
      holdPin(report, bodies, pin);
    }
  }
}

// One entry of a per-file lint exemption: the quoted repository path
// that opens the line, and whatever comment stands beside it.
const DEFERRAL =
  /^\s*"(?<file>(?:src|tests|scripts)\/[\w.\/\-]*\.ts)",(?<note>.*)$/v;

/** A backtick-quoted run of a deferral's comment. */
const QUOTED = /`(?<run>[^`\n]+)`/gv;

/**
 * The pins one line of the lint config writes.
 *
 * ONE LINE is one entry: a deferral names the file it defers on the
 * same line as the guard it is about, so nothing binds across lines and
 * a quoted run in the paragraph above cannot adopt a path.
 *
 * The comment's quoted runs split by SHAPE. An identifier-shaped run is
 * a symbol the guard sits in; anything else is source text quoted from
 * it. Both may repeat, and every symbol is held to every quotation,
 * which is what one guard written the same way in two functions needs
 * (`edgeTail` and `edgeHead` share theirs). A deferral quoting nothing
 * claims nothing and is read no further: the `max-lines` entries beside
 * these write line counts and no code.
 *
 * There is no ordinal in this spelling and none is needed. A quotation
 * its function carries twice is lengthened until it does not, which is
 * open to a comment in a way it is not to a mutant's own line.
 *
 * Exported for its unit tests (tests/scripts/internal-citations.test.ts);
 * no other consumer.
 * @internal
 * @param at - where the line is, for the message
 * @param line - the line
 * @returns the pins it writes, possibly none
 */
export function lintPins(at: string, line: string): Pin[] {
  const entry = DEFERRAL.exec(line);
  if (entry === null) {
    return [];
  }
  const named: Record<string, string | undefined> = entry.groups ?? {};
  const file = named.file ?? "";
  const symbols: string[] = [];
  const quotations: string[] = [];
  for (const match of (named.note ?? "").matchAll(QUOTED)) {
    const groups: Record<string, string | undefined> = match.groups ?? {};
    const run = groups.run ?? "";
    (SYMBOL_SHAPE.test(run) ? symbols : quotations).push(run);
  }
  return symbols.flatMap((symbol) =>
    quotations.map(
      (quotes): Pin => ({ kind: "sole", at, file, symbol, quotes }),
    ),
  );
}

/**
 * Check the lint config's deferral comments.
 * @param report - the run's report, added to in place
 * @param bodies - the declaration lookup
 * @param tree - the checkout
 */
function checkLintConfig(report: Report, bodies: Bodies, tree: Tree): void {
  for (const [offset, line] of sourceLines(tree.lintConfig).entries()) {
    const at = `${ESLINT_FILE}:${String(offset + 1)}`;
    for (const pin of lintPins(at, line)) {
      holdPin(report, bodies, pin);
    }
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
 * Hold every name the prose claims: a symbol beside a repo path to a
 * name that file has, and a link tag to one file in the whole tree.
 *
 * The names of every read file are parsed FIRST, so one parse per file
 * answers however many citations name it and builds the index both
 * halves are resolved against. A symbol citation naming a file this
 * gate has no text for is skipped: see `scripts/internal-symbols.ts`
 * for why that is not this half's question.
 * @param report - the run's report, added to in place
 * @param tree - the checkout
 */
function checkNames(report: Report, tree: Tree): void {
  const sources = [...tree.texts].map(([file, text]) => ({
    file,
    text,
    names: file.endsWith(".ts") ? namesIn(file, text) : NO_NAMES,
  }));
  const held = new Map(sources.map((one) => [one.file, one.names]));
  const index = symbolIndex(held);
  for (const { file, text, names } of sources) {
    for (const citation of symbolCitations(file, text)) {
      const cited = held.get(citation.file);
      if (cited === undefined) {
        continue;
      }
      report.symbols += 1;
      report.listing.push(
        `${citation.at}\t\`${citation.named}\`\t${citation.file}`,
      );
      report.failures.push(...checkSymbol(citation, cited));
    }
    for (const citation of linkCitations(file, text)) {
      report.links += 1;
      report.listing.push(`${citation.at}\t${citation.named}\t(link)`);
      report.failures.push(...checkLink(citation, names, index));
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
    pins: 0,
    paths: 0,
    symbols: 0,
    links: 0,
    anchors: 0,
    failures: [],
    listing: [],
  };
  const bodies = bodiesOf(tree);
  checkMinimums(report, bodies, tree);
  checkLintConfig(report, bodies, tree);
  checkRepoPaths(report, tree);
  checkNames(report, tree);
  checkFragments(tree.markdown, tree.present, report);
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
 * and not a 0, and that one failure is a 1.
 *
 * Exported for those tests (tests/scripts/internal-citations.test.ts);
 * no other consumer.
 * @internal
 * @param report - what the run measured
 * @returns what to print, and which exit code the run earned
 */
export function verdict(report: Report): Verdict {
  const held = report.pins + report.symbols + report.links;
  const total = held + report.failures.length;
  if (total < MINIMUM_CITATIONS) {
    const lost = `internal-citations: found only ${String(total)} citations, below the floor of ${String(MINIMUM_CITATIONS)}: the scan lost its roots`;
    return { kind: "cannot-run", message: lost };
  }
  const lines = [...report.failures];
  if (report.failures.length > 0) {
    lines.push(
      `internal-citations: ${String(report.failures.length)} FAILED of ${String(held)} checked`,
    );
    return { kind: "failed", lines };
  }
  lines.push(
    `internal-citations: ${String(report.pins)} symbol pins hold, ${String(report.symbols)} symbols and ${String(report.links)} link tags resolve, ${String(report.anchors)} doc fragments land on a heading, ${String(report.paths)} repo paths exist`,
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
  const unknown = argv.find((one) => one !== "--list");
  if (unknown !== undefined) {
    throw new TypeError(`internal-citations: unknown argument ${unknown}`);
  }
  return argv.includes("--list");
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
