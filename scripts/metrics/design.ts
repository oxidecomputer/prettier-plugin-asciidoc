/**
 * The design-quality budget the compiler cannot compute: how wide our
 * named seams are.
 *
 * The seam list is split in two, because the old single list conflated
 * two different things. A CONTRACT is what an implementer satisfies
 * and is judged by width; VOCABULARY is the data types used in
 * interface definitions and is judged by precision. Both are reported;
 * only contracts ratchet.
 *
 * The list itself is a BUDGET WE MAINTAIN, not a set of names a tool
 * discovers: it is written by hand and reviewed, and what the tooling
 * does is measure each row off the compiler's AST, hold it to a
 * ratchet, and refuse to let the list rot. `docs/harnesses.md` carries
 * the framing and the two honest caveats.
 *
 * Everything here reads the MEASURED checkout, never this one, so a
 * base revision materialized into a temp directory reports its own
 * seams. A seam that is not there reads as undefined, which is how a
 * new counter ratchets from absent instead of from zero (the same
 * tolerance `dead-code.ts` gives a tool that could not run).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
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
 * `implements` clause anywhere in `src/`, and nothing to fake - a
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
 * PRECISION - no unread published field, no valid-only-when field, one
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
 * this split deliberately leaves open - under the precision reading it
 * is no longer an obvious yes.
 */
const VOCABULARY: readonly Seam[] = [
  { name: "ReaderContext", file: "src/parse/line-shapes.ts" },
];

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

/** What one named interface's declaration says about its width. */
export interface SeamScan {
  /**
   * Members on the single flat declaration - undefined when the text
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
 * are not vocabulary two modules share by NAME - they are reached
 * through a member that is already counted - and an index signature
 * or a call signature is not a named
 * member at all. Only top-level declarations are searched; a seam moved
 * inside a namespace reads as ABSENT, which the head-absent gate turns
 * into a failure rather than into silence.
 *
 * Two shapes are refused outright, because for them the count would
 * understate the surface and the ratchet would read the understatement
 * as progress:
 *
 * - `interface S extends B` - factoring nine members into a base and
 *   leaving `interface S extends B {}` takes the seam to 0 with a green
 *   ratchet. Resolving `extends` correctly means resolving imported
 *   bases, which is a type-checker's job, not a scanner's;
 * - two declarations of one name (TypeScript MERGES them) - counting
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
  if (!existsSync(file)) {
    return { members: undefined, fault: undefined };
  }
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
 * Measure one checkout's named seams.
 *
 * Always reports what it finds, faults included. WHETHER a fault fails
 * the run is `gates.ts`'s decision, taken from `Snapshot.repository`:
 * the list here is a fact about THIS repository - these seam names, in
 * these files - so an archived base and an arbitrary `--root <dir>`
 * checkout are measured but not judged by it. Keeping that decision
 * out of here means one code path produces the numbers, whichever
 * checkout it is.
 * @param root - the measured checkout root
 * @returns the seam widths, contracts first
 */
export function readSeams(root: string): SeamWidth[] {
  return [
    ...CONTRACTS.map((seam) => measured(root, seam, "contract")),
    ...VOCABULARY.map((seam) => measured(root, seam, "vocabulary")),
  ];
}
