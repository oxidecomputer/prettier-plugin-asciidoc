/**
 * Three design-quality budgets the compiler cannot compute: how wide
 * our named seams are, which interior validation we have not designed
 * away, and whether any test has started checking two of our own
 * components against each other.
 *
 * The seam list is split in two, because the old single list conflated
 * two different things. A CONTRACT is what an implementer satisfies
 * and is judged by width; VOCABULARY is the data types used in
 * interface definitions and is judged by precision. Both are reported;
 * only contracts ratchet.
 *
 * All three are BUDGETS WE MAINTAIN, not numbers a tool discovers. The
 * seam list, the interior-validation registry and the harness list are
 * each written by hand and reviewed; what the tooling does is hold them
 * to a ratchet and refuse to let them rot. `docs/simplicity-metrics.md`
 * carries the framing and the two honest caveats.
 *
 * Everything here reads the MEASURED checkout, never this one, so a
 * base revision materialized into a temp directory reports its own
 * seams and its own registry. A seam or a registry that is not there
 * reads as undefined, which is how a new counter ratchets from absent
 * instead of from zero (the same tolerance `dead-code.ts` gives a tool
 * that could not run).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isArray, isObject, strictJson } from "./json.js";
import { ONE, ZERO, type SeamWidth } from "./model.js";

/** One named cross-module interface the scorecard measures. */
interface Seam {
  /** The interface's name. */
  readonly name: string;
  /** The file it is declared in, relative to the checkout root. */
  readonly file: string;
}

/**
 * The CONTRACTS, in report order.
 *
 * A contract is what an implementer satisfies. It is judged by WIDTH:
 * each member is a fact one module had to publish about itself
 * (Parnas's leakage counted where the leak was declared, Ousterhout's
 * interface-size denominator), every conformer names it in an
 * explicit `implements`, and it must be fakeable. Only these rows
 * ratchet.
 *
 * THE LIST IS EMPTY, and that is a real state rather than a gap.
 * `ListHost` and `ParagraphHost` were the two rows; both dissolved
 * when the list and paragraph scans became pure functions over
 * (lines, index, a context VALUE) returning what they found and where
 * they end. There is no interface left for a reader to satisfy, no
 * `implements` clause anywhere in `src/`, and nothing to fake — a
 * contract with no implementer is not a narrow contract, it is not a
 * contract. Both rows are REMOVED rather than left at zero: a seam
 * that does not exist has no width to budget, and the head-absent
 * gate would fire on every run if the names stayed. The rows come
 * back when polymorphism does, which at this codebase's size means
 * when a second sensible implementation exists.
 *
 * Adding a row is a deliberate act, exactly as `api-extractor` turned
 * inward would be: an unnamed structural type shared between two
 * modules is not on this list, and the honest reading of that is that
 * the list is a lower bound.
 */
const CONTRACTS: readonly Seam[] = [];

/**
 * The VOCABULARY rows, in report order.
 *
 * Vocabulary is the concrete data used IN interface definitions.
 * Nobody implements it, so width is not the question: it is judged by
 * PRECISION — no unread published field, no valid-only-when field, one
 * derivation of each fact. A wide vocabulary is fine; an imprecise one
 * is not. The width is still REPORTED, because a number worth reading
 * is worth printing, but it does not ratchet: narrowing `ReaderContext`
 * is not automatically progress and widening it is not automatically
 * regress.
 *
 * `LineKind` and the AST are vocabulary too and carry no row: both are
 * unions, and {@link scanSeam} matches interface declarations only, so
 * a row for either would report "not declared" and fire the head-absent
 * gate. Whether the scanner should widen to unions is an open question
 * this split deliberately leaves open — under the precision reading it
 * is no longer an obvious yes.
 */
const VOCABULARY: readonly Seam[] = [
  { name: "ReaderContext", file: "src/parse/line-shapes.ts" },
];

/**
 * Resident AGREEMENT HARNESSES, by test path.
 *
 * An agreement harness is a test whose ASSERTION compares the outputs
 * of two of OUR OWN components against each other. It is the shape
 * that makes two implementations of one rule permanently affordable:
 * connascence of algorithm (Page-Jones) with a test holding it in
 * place, so neither copy can be deleted and the duplication reads as
 * covered rather than as debt.
 *
 * What is NOT a harness, and belongs in the suite:
 * - a test comparing our output against PINNED BYTES (a fixture);
 * - a test comparing it against the ORACLE (`@asciidoctor/core`) —
 *   `tests/conformance/` is a differential net against an external
 *   authority, not against ourselves;
 * - `scripts/parity.ts`, which compares this checkout against a PRIOR
 *   CHECKOUT of the same component — a regression net over time;
 * - a property test asserting an invariant of ONE component's output
 *   (idempotence, render-equality), which names no second component.
 *
 * The gate is absolute: this list must stay empty. A harness is not
 * forbidden because it fails, but because the second component is —
 * the honest fix is to delete one of the two and let the survivor be
 * checked against bytes or the oracle.
 */
const AGREEMENT_HARNESSES: readonly string[] = [];

/** Where the interior-validation registry lives, in every checkout. */
const REGISTRY_FILE = "scripts/metrics/defense-registry.json";

/**
 * One hand-audited interior-validation site: a conditional in the
 * interior whose false branch cannot happen, re-checking something the
 * boundary already established.
 *
 * DISJOINT from the marker counts by construction: a site that throws
 * through `unreachable(…)` is counted there, and one that degrades
 * behind a `Total fallback:` comment is counted there. This registry
 * is for the ones NO marker can catch — a plain `if` or `??` that
 * looks like ordinary code and is only recognisable by reading the
 * caller. That is why v1 is a list of judgements rather than a text
 * search.
 */
export interface RegistryEntry {
  /** The file it lives in, relative to the checkout root. */
  readonly file: string;
  /** The function or method the conditional sits inside. */
  readonly function: string;
  /** Why it is interior validation and not a boundary check. */
  readonly reason: string;
}

// Exactly the keys an entry may carry. An unknown key is rejected
// rather than ignored, because that is the shape a typo takes: a
// `"functon"` entry that is merely dropped takes the registry's length
// down with it, and a shrinking count passes a rise-only ratchet.
const ENTRY_KEYS = ["file", "function", "reason"];

/** What this module contributes to one revision's snapshot. */
export interface DesignFacts {
  /** Member count per named seam, in report order. */
  readonly seams: readonly SeamWidth[];
  /** Registry length, or undefined where there is no registry. */
  readonly interiorValidation: number | undefined;
  /** Entries whose site is gone, as `file: function`. */
  readonly staleEntries: readonly string[];
  /**
   * Why the registry could not be read as a registry: missing,
   * unparseable, not an array, or holding a malformed entry. At HEAD
   * every one of these is an absolute gate failure; at an archived base
   * nothing reads them, which is what keeps a historical revision with
   * no registry at `n/a` instead of failing.
   */
  readonly registryFaults: readonly string[];
  /** The declared agreement harnesses; the gate is that it is empty. */
  readonly harnesses: readonly string[];
}

/**
 * Parse a file's text the way `scan.ts` does, so seam width is read
 * off the compiler's AST rather than out of a regex.
 * @param fileName - the file's name, for the compiler's diagnostics
 * @param text - the file's text
 * @returns the parsed file
 */
function parseSource(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS,
  );
}

/**
 * Parse one file of the measured checkout.
 * @param file - absolute path, which may not exist at this revision
 * @returns the parsed file, or undefined when it is not there
 */
function sourceFileAt(file: string): ts.SourceFile | undefined {
  if (!existsSync(file)) return undefined;
  return parseSource(file, readFileSync(file, "utf8"));
}

/** What one named interface's declaration says about its width. */
export interface SeamScan {
  /**
   * Members on the single flat declaration — undefined when the text
   * declares no such interface, and also when it declares one this
   * rule refuses to measure (see `fault`), so a number here always
   * means a number a human would agree with.
   */
  readonly members: number | undefined;
  /**
   * Why the seam cannot be measured as declared, or undefined when it
   * can. A named seam must be ONE flat declaration.
   */
  readonly fault: string | undefined;
}

/**
 * Property and method signatures on one interface declaration.
 * @param declaration - the interface
 * @returns how many named members it declares
 */
function ownMembers(declaration: ts.InterfaceDeclaration): number {
  return declaration.members.filter(
    (member) => ts.isPropertySignature(member) || ts.isMethodSignature(member),
  ).length;
}

/**
 * How wide one named interface is, and whether it is measurable.
 *
 * Only the declaration's OWN property and method signatures. A nested
 * type literal's fields and the fields of a member's parameter object
 * are not vocabulary two modules share by NAME — they are reached
 * through a member that is already counted — and an index signature
 * or a call signature is not a named
 * member at all. Only top-level declarations are searched; a seam moved
 * inside a namespace reads as ABSENT, which the head-absent gate turns
 * into a failure rather than into silence.
 *
 * Two shapes are refused outright, because for them the count would
 * understate the surface and the ratchet would read the understatement
 * as progress:
 *
 * - `interface S extends B` — factoring nine members into a base and
 *   leaving `interface S extends B {}` takes the seam to 0 with a green
 *   ratchet. Resolving `extends` correctly means resolving imported
 *   bases, which is a type-checker's job, not a scanner's;
 * - two declarations of one name (TypeScript MERGES them) — counting
 *   the first silently drops the rest.
 *
 * So a named seam must be one flat declaration. That is a real
 * constraint on the code, and the honest way to hold a budget whose
 * only failure direction is invisible.
 * @param fileName - the file's name, for the compiler's diagnostics
 * @param text - the file's text
 * @param name - the interface to measure
 * @returns the member count, or the reason it cannot be counted
 */
export function scanSeam(
  fileName: string,
  text: string,
  name: string,
): SeamScan {
  const sourceFile = parseSource(fileName, text);
  const declarations = sourceFile.statements.filter(
    (statement): statement is ts.InterfaceDeclaration =>
      ts.isInterfaceDeclaration(statement) && statement.name.text === name,
  );
  if (declarations.length === ZERO) {
    return { members: undefined, fault: undefined };
  }
  if (declarations.length > ONE) {
    return {
      members: undefined,
      fault: `${name} has ${String(declarations.length)} declarations in ${fileName} (TypeScript merges them; a named seam must be one flat declaration)`,
    };
  }
  const [declaration] = declarations;
  if (declaration.heritageClauses !== undefined) {
    return {
      members: undefined,
      fault: `${name} extends another type in ${fileName} (inherited members would not be counted; a named seam must be one flat declaration)`,
    };
  }
  return { members: ownMembers(declaration), fault: undefined };
}

/**
 * One seam's width in the measured checkout.
 * @param root - the measured checkout root
 * @param seam - the seam to measure
 * @returns the scan, with both fields undefined when the file itself is
 *   not there at this revision
 */
function seamScan(root: string, seam: Seam): SeamScan {
  const file = path.join(root, seam.file);
  if (!existsSync(file)) return { members: undefined, fault: undefined };
  return scanSeam(seam.file, readFileSync(file, "utf8"), seam.name);
}

/**
 * One registry row, measured in the given checkout.
 * @param root - the measured checkout root
 * @param seam - the seam to measure
 * @param kind - whether it is a contract or vocabulary
 * @returns the row the scorecard prints and the gates read
 */
function measured(
  root: string,
  seam: Seam,
  kind: SeamWidth["kind"],
): SeamWidth {
  return { name: seam.name, file: seam.file, kind, ...seamScan(root, seam) };
}

/**
 * The name a function-shaped DECLARATION carries: a function
 * declaration, a class method, or a getter — the BlockReader spells
 * several of its members as getters, so a registry entry may name one.
 * @param node - any node
 * @returns the declared name, or undefined when the node is not one of
 *   those three or its name is computed
 */
function declarationName(node: ts.Node): string | undefined {
  const isDeclaration =
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node);
  if (!isDeclaration) return undefined;
  const { name } = node;
  return name !== undefined && ts.isIdentifier(name) ? name.text : undefined;
}

/**
 * The name a `const f = () => …` binding carries — the fourth spelling
 * a registry entry can name.
 * @param node - any node
 * @returns the bound name, or undefined when the node is not a
 *   variable bound to a function
 */
function boundFunctionName(node: ts.Node): string | undefined {
  if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) {
    return undefined;
  }
  const { initializer } = node;
  const isFunction =
    initializer !== undefined &&
    (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer));
  return isFunction ? node.name.text : undefined;
}

/**
 * Does this file still declare a function of that name?
 *
 * The staleness check the registry's gate runs. It catches the rot
 * that actually happens — the site was deleted, the file was split, or
 * the function was renamed — and it does NOT catch a guard removed
 * from inside a function that kept its name. That residue is a known
 * limit of a {file, function, reason} entry, and the reason field is
 * what a re-audit reads.
 * @param file - absolute path of the file to search
 * @param name - the function name the registry claims is there
 * @returns whether some declaration in the file has that name
 */
function declaresFunction(file: string, name: string): boolean {
  const sourceFile = sourceFileAt(file);
  if (sourceFile === undefined) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if ((declarationName(node) ?? boundFunctionName(node)) === name) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/** A registry read: the entries, or every reason it is not a registry. */
export interface RegistryRead {
  /** The entries, or undefined when the file could not be read as one. */
  readonly entries: readonly RegistryEntry[] | undefined;
  /** One message per fault; empty means the file parsed and validated. */
  readonly faults: readonly string[];
}

/**
 * Validate one element of the registry array.
 *
 * Every field must be a non-empty string and no unknown key may be
 * present. A `reason` is required and checked because it is the whole
 * value of the entry to a re-auditor: a registry of file/function pairs
 * with no argument is a list, not an audit.
 * @param raw - one parsed array element
 * @param index - its position, for the message
 * @returns the entry, or the reason it is not one
 */
function validateEntry(
  raw: unknown,
  index: number,
): { entry: RegistryEntry | undefined; fault: string | undefined } {
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
  const { file, function: what, reason } = raw;
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
  if (
    typeof file !== "string" ||
    typeof what !== "string" ||
    typeof reason !== "string"
  ) {
    // Unreachable given `missing` above; present so the returned entry
    // is typed without an assertion, which this scorecard counts.
    return { entry: undefined, fault: `${at}: malformed` };
  }
  return { entry: { file, function: what, reason }, fault: undefined };
}

/**
 * Read one checkout's interior-validation registry, STRICTLY.
 *
 * `JSON.parse` and full schema validation, deliberately not
 * `json.ts`'s `parseJson`: that one is documented for TOOL STDOUT — it
 * skips leading noise and degrades a syntax error to "no measurement",
 * which is right for knip and wrong for a reviewed file in the
 * repository. Here a syntax error, a wrong shape or a malformed entry
 * is a FAULT to report, because the alternative is the failure this
 * whole family exists to prevent: the registry silently reads short and
 * a rise-only ratchet calls the shrinkage progress.
 *
 * A MISSING file is also a fault. It is not silence-worthy either — the
 * caller distinguishes head from base by which snapshot the gates read,
 * not by softening the fault here.
 * @param root - the measured checkout root
 * @returns the entries when the file is a valid registry, and every
 *   fault otherwise
 */
export function readRegistry(root: string): RegistryRead {
  const file = path.join(root, REGISTRY_FILE);
  if (!existsSync(file)) {
    return { entries: undefined, faults: [`${REGISTRY_FILE}: not found`] };
  }
  const { value: parsed, fault: syntax } = strictJson(
    REGISTRY_FILE,
    readFileSync(file, "utf8"),
  );
  if (syntax !== undefined) return { entries: undefined, faults: [syntax] };
  if (!isArray(parsed)) {
    return {
      entries: undefined,
      faults: [`${REGISTRY_FILE}: not a JSON array`],
    };
  }
  const entries: RegistryEntry[] = [];
  const faults: string[] = [];
  for (const [index, raw] of parsed.entries()) {
    const { entry, fault } = validateEntry(raw, index);
    if (entry === undefined)
      faults.push(fault ?? `${REGISTRY_FILE}: malformed`);
    else entries.push(entry);
  }
  // A malformed entry invalidates the COUNT, not just that row: a
  // shorter registry passes the ratchet, so there is no honest number
  // to report until the file is fixed.
  return faults.length > ZERO
    ? { entries: undefined, faults }
    : { entries, faults: [] };
}

/**
 * The registry entries whose site is gone from the code.
 *
 * Exported for its own test: this is the half of the registry gate
 * that keeps the list from becoming folklore.
 * @param root - the measured checkout root
 * @param entries - the registry, as read from that checkout
 * @returns one `file: function` string per entry that no longer
 *   resolves; empty means the registry is current
 */
export function staleEntries(
  root: string,
  entries: readonly RegistryEntry[],
): string[] {
  return entries.flatMap((entry) =>
    declaresFunction(path.join(root, entry.file), entry.function)
      ? []
      : [`${entry.file}: ${entry.function}`],
  );
}

/**
 * Measure one checkout's design budgets.
 *
 * Always reports what it finds, faults included. WHETHER a fault fails
 * the run is `gates.ts`'s decision, taken from `Snapshot.repository`:
 * all three registries here are facts about THIS repository — these
 * four seam names, these five audited sites, this marker convention —
 * so an archived base and an arbitrary `--root <dir>` checkout are
 * measured but not judged by them. Keeping that decision out of here
 * means one code path produces the numbers, whichever checkout it is.
 * @param root - the measured checkout root
 * @returns the seam widths, the registry's length and health, and the
 *   declared agreement harnesses
 */
export function readDesign(root: string): DesignFacts {
  const { entries, faults } = readRegistry(root);
  return {
    seams: [
      ...CONTRACTS.map((seam) => measured(root, seam, "contract")),
      ...VOCABULARY.map((seam) => measured(root, seam, "vocabulary")),
    ],
    interiorValidation: entries?.length,
    // Nothing to be stale about until the file reads as a registry;
    // the faults are what the gate reports in that case.
    staleEntries: entries === undefined ? [] : staleEntries(root, entries),
    registryFaults: faults,
    harnesses: [...AGREEMENT_HARNESSES],
  };
}
