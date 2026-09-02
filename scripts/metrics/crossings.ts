/**
 * The crossings registry: every symbol that crosses a DIRECTORY
 * boundary under `src`, named in a reviewed file with a reason and a
 * classification.
 *
 * Rule 2 of the boundary discipline is that every crossing is either
 * VOCABULARY or a CONTRACT, and that unnamed contract-like crossings
 * are forbidden. A tool that merely COUNTS crossings cannot tell "we
 * removed a coupling" from "we hid one behind a re-export", which is
 * why each row carries a `reason` and a `kind`: adding a crossing
 * forces the question *is this one we meant to have?* at the moment
 * somebody adds it, in the diff, where it can be argued.
 *
 * The gate is ABSOLUTE and runs at HEAD in both directions, the same
 * shape as the interior-validation registry: a crossing the registry
 * does not name fails, and a registry row whose crossing is gone is
 * stale and fails. One direction alone would be worthless — a
 * membership list that can rot reads as an audit of code that no
 * longer exists.
 *
 * GRANULARITY is per SYMBOL, not per file pair. A file pair says two
 * modules touch; the symbol says WHAT they had to agree on, which is
 * the thing being classified. Coarsening to file pairs would shrink
 * the file and discard the point.
 *
 * Three declaring files are exempt as DECLARED UNIVERSAL VOCABULARY
 * (see {@link UNIVERSAL}): the AST, the shared constants, and the
 * can't-happen helper. They are the shared language of the whole tree
 * — every module is expected to speak them — and listing their ~80
 * crossings row by row would bury the crossings that are actually a
 * decision.
 *
 * Every row is VOCABULARY and none is a contract, which is the
 * expected answer at this size: the tree declares no contract at all
 * any more — the two it had were consumed inside their own directory
 * and then dissolved into pure functions. `contract` stays a legal
 * classification because the day a seam is consumed across a
 * directory it must be named as one, `implements`-ed, and fakeable.
 *
 * CANONICAL ORDER. The rows are kept sorted by {@link keyOf}, and
 * {@link outOfOrder} makes that a fault rather than a convention: a
 * registry whose rows may sit anywhere turns a 3-row addition into a
 * 203-line diff, which is how one got through unreviewed.
 *
 * HONEST BOUND: this reads IMPORT STATEMENTS, so it sees what one
 * module names of another, not what it DOES with it. A registered
 * crossing whose meaning changed underneath its reason is invisible
 * here; the reason field is what a re-audit reads.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isArray, isObject } from "./json.js";
import { ONE, ZERO } from "./model.js";

/** Where the crossings registry lives, in every checkout. */
const REGISTRY_FILE = "scripts/metrics/crossings-registry.json";

/**
 * Declaring files whose crossings need no row: the tree's declared
 * universal vocabulary. `ast.ts` is the shape everything downstream of
 * the reader produces or consumes, `constants.ts` is the shared
 * numbers. Exempting them is a JUDGEMENT, written down here rather
 * than implied by a threshold.
 */
const UNIVERSAL = new Set(["src/ast.ts", "src/constants.ts"]);

/** The symbol name a namespace or star re-export crosses under. */
const STAR = "*";

/** The symbol name a default import crosses under. */
const DEFAULT_IMPORT = "default";

/**
 * One crossing: a symbol DECLARED in one directory and named by a file
 * in another.
 */
export interface Crossing {
  /** The file that declares it, relative to the checkout root. */
  readonly file: string;
  /** The imported name, as the declaring file spells it. */
  readonly symbol: string;
  /** The file that imports it, relative to the checkout root. */
  readonly importer: string;
}

// Not exported: only `CrossingsRead` names it, and an export nothing
// imports is exactly what the scorecard's knip row counts.
/** One reviewed registry row: a crossing, classified, with a reason. */
interface CrossingEntry extends Crossing {
  /**
   * Which kind of crossing it is: VOCABULARY is data used in
   * interface definitions, judged by precision; a CONTRACT is what an
   * implementer satisfies, judged by width and required to be
   * `implements`-ed by every conformer.
   */
  readonly kind: "vocabulary" | "contract";
  /** Why this crossing is one we meant to have. */
  readonly reason: string;
}

// Exactly the keys a row may carry. An unknown key is REJECTED rather
// than ignored, because that is the shape a typo takes: a `"symbal"`
// row that is merely dropped takes the registry's length down with it.
const ENTRY_KEYS = ["file", "symbol", "importer", "kind", "reason"];

// The two classifications a row may carry. Anything else is a fault:
// "unnamed contract-like crossings are forbidden" only means something
// if the naming is a closed set.
const ENTRY_KINDS = ["vocabulary", "contract"];

/** What this module contributes to one revision's snapshot. */
export interface CrossingFacts {
  /** Registry length, or undefined where there is no registry. */
  readonly registered: number | undefined;
  /** Crossings no row names, as `file symbol -> importer`. */
  readonly unregistered: readonly string[];
  /** Rows whose crossing is gone, as `file symbol -> importer`. */
  readonly stale: readonly string[];
  /** Why the registry could not be read as one; empty means it was. */
  readonly faults: readonly string[];
}

/**
 * One crossing's identity, for set membership.
 * @param crossing - the triple
 * @returns a key equal for the same triple, and printable in a failure
 */
function keyOf(crossing: Crossing): string {
  return `${crossing.file} ${crossing.symbol} -> ${crossing.importer}`;
}

/**
 * Every `.ts` file under a directory of the measured checkout, in
 * posix spelling relative to its root.
 * @param root - the measured checkout root
 * @param directory - the directory to walk, root-relative
 * @returns every TypeScript file below it
 */
function walk(root: string, directory: string): string[] {
  return readdirSync(path.join(root, directory)).flatMap((name) => {
    const file = path.posix.join(directory, name);
    if (statSync(path.join(root, file)).isDirectory()) {
      return walk(root, file);
    }
    return file.endsWith(".ts") ? [file] : [];
  });
}

/**
 * The names one import or `export … from` statement brings across.
 *
 * A bare `import "./x.js"` brings no NAME across and is not a
 * crossing: nothing is agreed on. A namespace import and a star
 * re-export cross under {@link STAR}, because what they name is
 * "everything that file exports" — which is exactly the shape a
 * registry must be able to see.
 * @param statement - a top-level statement
 * @returns the declared names it imports, empty when it imports none
 */
function importedNames(statement: ts.Statement): string[] {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause === undefined) {
      return [];
    }
    const names = clause.name === undefined ? [] : [DEFAULT_IMPORT];
    const { namedBindings } = clause;
    if (namedBindings === undefined) {
      return names;
    }
    if (ts.isNamespaceImport(namedBindings)) {
      return [...names, STAR];
    }
    return [
      ...names,
      ...namedBindings.elements.map(
        (element) => (element.propertyName ?? element.name).text,
      ),
    ];
  }
  if (!ts.isExportDeclaration(statement)) {
    return [];
  }
  const clause = statement.exportClause;
  if (clause === undefined) {
    return [STAR];
  }
  if (!ts.isNamedExports(clause)) {
    return [];
  }
  return clause.elements.map(
    (element) => (element.propertyName ?? element.name).text,
  );
}

/**
 * The module specifier one statement imports from, when it has one.
 * @param statement - a top-level statement
 * @returns the specifier text, or undefined when the statement is not
 *   an import or a re-export
 */
function specifierOf(statement: ts.Statement): string | undefined {
  const specifier = ts.isImportDeclaration(statement)
    ? statement.moduleSpecifier
    : ts.isExportDeclaration(statement)
      ? statement.moduleSpecifier
      : undefined;
  return specifier !== undefined && ts.isStringLiteral(specifier)
    ? specifier.text
    : undefined;
}

/**
 * Where a relative specifier resolves, in this repository's spelling:
 * `./foo.js` on disk is `./foo.ts`.
 * @param root - the measured checkout root
 * @param importer - the importing file, root-relative
 * @param specifier - the specifier as written
 * @returns the target file root-relative, or undefined when the
 *   specifier is not relative or resolves to nothing (which the
 *   import-graph gate reports, not this one)
 */
function resolveSpecifier(
  root: string,
  importer: string,
  specifier: string,
): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const target = path.posix.normalize(
    path.posix.join(
      path.posix.dirname(importer),
      specifier.replace(/\.js$/v, ".ts"),
    ),
  );
  return existsSync(path.join(root, target)) ? target : undefined;
}

/**
 * Every cross-directory crossing in one file.
 * @param root - the measured checkout root
 * @param importer - the file to read, root-relative
 * @returns its crossings, universal vocabulary excluded
 */
function crossingsIn(root: string, importer: string): Crossing[] {
  const sourceFile = ts.createSourceFile(
    importer,
    readFileSync(path.join(root, importer), "utf8"),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );
  const here = path.posix.dirname(importer);
  return sourceFile.statements.flatMap((statement) => {
    const specifier = specifierOf(statement);
    if (specifier === undefined) {
      return [];
    }
    const file = resolveSpecifier(root, importer, specifier);
    if (file === undefined) {
      return [];
    }
    if (path.posix.dirname(file) === here) {
      return [];
    }
    if (UNIVERSAL.has(file)) {
      return [];
    }
    return importedNames(statement).map((symbol) => ({
      file,
      symbol,
      importer,
    }));
  });
}

/**
 * Every cross-directory crossing under `src`, once each.
 *
 * Exported for its own test: this half of the gate is what decides
 * whether the registry describes the tree, so it has to be checkable
 * against a planted tree rather than only against ours.
 * @param root - the measured checkout root
 * @returns the crossings, sorted so a failure list reads stably
 */
export function crossings(root: string): Crossing[] {
  const seen = new Map<string, Crossing>();
  for (const importer of walk(root, "src")) {
    for (const crossing of crossingsIn(root, importer)) {
      seen.set(keyOf(crossing), crossing);
    }
  }
  return [...seen.values()].toSorted((left, right) =>
    keyOf(left).localeCompare(keyOf(right)),
  );
}

/**
 * Validate one element of the registry array.
 *
 * Every field must be a non-empty string, `kind` must be one of the
 * two classifications, and no unknown key may be present. The `reason`
 * is required and checked because it is the whole value of the row to
 * a re-auditor: a list of triples with no argument is a list, not a
 * registry.
 * @param raw - one parsed array element
 * @param index - its position, for the message
 * @returns the row, or the reason it is not one
 */
function validateEntry(
  raw: unknown,
  index: number,
): { entry: CrossingEntry | undefined; fault: string | undefined } {
  const at = `${REGISTRY_FILE}[${String(index)}]`;
  if (!isObject(raw)) {
    return { entry: undefined, fault: `${at}: not an object` };
  }
  const unknown = Object.keys(raw).filter((key) => !ENTRY_KEYS.includes(key));
  if (unknown.length > ZERO) {
    return {
      entry: undefined,
      fault: `${at}: unknown key(s) ${unknown.join(", ")}`,
    };
  }
  const missing = ENTRY_KEYS.filter((key) => {
    const { [key]: value } = raw;
    return typeof value !== "string" || value === "";
  });
  if (missing.length > ZERO) {
    return {
      entry: undefined,
      fault: `${at}: missing or non-string ${missing.join(", ")}`,
    };
  }
  return typedEntry(raw, at);
}

/**
 * Re-read a validated row's fields as strings.
 *
 * Split out of {@link validateEntry} so the returned row is typed
 * without an assertion, which this scorecard counts as an escape
 * hatch.
 * @param raw - an object whose five keys are known non-empty strings
 * @param at - where it sits, for the message
 * @returns the row, or the reason its `kind` is not a classification
 */
function typedEntry(
  raw: Record<string, unknown>,
  at: string,
): { entry: CrossingEntry | undefined; fault: string | undefined } {
  const { file, symbol, importer, kind, reason } = raw;
  if (
    typeof file !== "string" ||
    typeof symbol !== "string" ||
    typeof importer !== "string" ||
    typeof reason !== "string"
  ) {
    // Unreachable given validateEntry's `missing` check; present so
    // the row is typed without an assertion.
    return { entry: undefined, fault: `${at}: malformed` };
  }
  if (kind !== "vocabulary" && kind !== "contract") {
    return {
      entry: undefined,
      fault: `${at}: kind must be one of ${ENTRY_KINDS.join(", ")}`,
    };
  }
  return {
    entry: { file, symbol, importer, kind, reason },
    fault: undefined,
  };
}

/** A registry read: the rows, or every reason it is not a registry. */
export interface CrossingsRead {
  /** The rows, or undefined when the file could not be read as one. */
  readonly entries: readonly CrossingEntry[] | undefined;
  /** One message per fault; empty means the file parsed and validated. */
  readonly faults: readonly string[];
}

/**
 * Read one checkout's crossings registry, STRICTLY.
 *
 * A syntax error, a wrong shape or a malformed row is a FAULT to
 * report, never a row to skip: a registry that silently reads short
 * would report FEWER unregistered crossings and more stale rows, and
 * the first of those reads as progress.
 *
 * Exported for its own test.
 * @param root - the measured checkout root
 * @returns the rows when the file is a valid registry, every fault
 *   otherwise
 */
export function readCrossingsRegistry(root: string): CrossingsRead {
  const file = path.join(root, REGISTRY_FILE);
  if (!existsSync(file)) {
    return { entries: undefined, faults: [`${REGISTRY_FILE}: not found`] };
  }
  const { value: parsed, fault } = strictJson(readFileSync(file, "utf8"));
  if (fault !== undefined) {
    return { entries: undefined, faults: [fault] };
  }
  if (!isArray(parsed)) {
    return {
      entries: undefined,
      faults: [`${REGISTRY_FILE}: not a JSON array`],
    };
  }
  return validated(parsed);
}

/**
 * `JSON.parse` with the syntax error reported rather than swallowed —
 * the same treatment `design.ts` gives the interior-validation
 * registry, and deliberately not `json.ts`'s tool-stdout parser, which
 * degrades a syntax error to "no measurement".
 * @param text - the file's bytes
 * @returns the parsed value, or the syntax error to report
 */
function strictJson(text: string): {
  value: unknown;
  fault: string | undefined;
} {
  try {
    return { value: JSON.parse(text), fault: undefined };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      value: undefined,
      fault: `${REGISTRY_FILE}: not valid JSON (${detail})`,
    };
  }
}

/**
 * Validate every element of a parsed registry array.
 *
 * A malformed row invalidates the whole read, not just that row: a
 * shorter registry changes both gate answers, so there is no honest
 * number to report until the file is fixed.
 * @param parsed - the parsed array
 * @returns the rows, or every fault
 */
function validated(parsed: readonly unknown[]): CrossingsRead {
  const entries: CrossingEntry[] = [];
  const faults: string[] = [];
  for (const [index, raw] of parsed.entries()) {
    const { entry, fault } = validateEntry(raw, index);
    if (entry === undefined) {
      faults.push(fault ?? `${REGISTRY_FILE}: malformed`);
    } else {
      entries.push(entry);
    }
  }
  return faults.length > ZERO
    ? { entries: undefined, faults }
    : { entries, faults: outOfOrder(entries) };
}

/**
 * Is the registry in its canonical order — {@link keyOf} ascending, by
 * CODE POINT?
 *
 * An order rule rather than a taste: a registry whose rows may sit
 * anywhere produces diffs like the one a review measured on this
 * file — 203 changed lines for 3 added rows and 0 removed — and a
 * registry diff nobody can read by eye is a registry whose `reason`
 * field has stopped doing its job. With the order fixed, adding a
 * crossing is a five-line diff at the row it belongs to.
 *
 * Code point rather than `localeCompare` (which {@link crossings} uses
 * for its DIAGNOSTIC list, where only stability matters): locale
 * collation folds case, so `VerbatimRole` and `buildDelimited…` sort
 * differently under the two, and the order a person gets by sorting
 * the file is the one worth enforcing.
 *
 * Reported as a FAULT beside the validated rows, not instead of them:
 * a misordered registry still describes the tree, and blinding the
 * membership check over a sort order would trade a real gate for a
 * cosmetic one.
 * @param entries - the validated rows, in file order
 * @returns one fault naming the first row out of place, or none
 */
function outOfOrder(entries: readonly CrossingEntry[]): string[] {
  for (const [index, entry] of entries.entries()) {
    if (index === ZERO) {
      continue;
    }
    const previous = keyOf(entries[index - ONE]);
    const here = keyOf(entry);
    if (previous < here) {
      continue;
    }
    return [
      `${REGISTRY_FILE}[${String(index)}]: out of canonical order — ${here} must not follow ${previous}`,
    ];
  }
  return [];
}

/**
 * Measure one checkout's crossings against its registry.
 *
 * Always reports what it finds, faults included. WHETHER a fault fails
 * the run is `gates.ts`'s decision, taken from `Snapshot.repository`:
 * this registry is a fact about THIS repository, so an archived base
 * and an arbitrary `--root <dir>` checkout are measured and not judged
 * by it.
 * @param root - the measured checkout root
 * @returns the registry's length and health, and both directions of
 *   the membership check
 */
export function readCrossings(root: string): CrossingFacts {
  const { entries, faults } = readCrossingsRegistry(root);
  if (entries === undefined) {
    return { registered: undefined, unregistered: [], stale: [], faults };
  }
  const actual = new Set(crossings(root).map((crossing) => keyOf(crossing)));
  const registered = new Set(entries.map((entry) => keyOf(entry)));
  return {
    registered: entries.length,
    unregistered: [...actual].filter((key) => !registered.has(key)).toSorted(),
    stale: [...registered].filter((key) => !actual.has(key)).toSorted(),
    faults,
  };
}
