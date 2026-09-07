/**
 * What `src/print/` actually READS, resolved field by field against
 * the census's own enumeration of `src/ast.ts`.
 *
 * The census (`scripts/fact-inventory.ts`) sorts every AST field into
 * FACTS and EXEMPT, and its own module doc is candid that the sort is
 * a hand classification whose correctness nothing checks. Most EXEMPT
 * reasons are judgements a scan cannot settle: whether a leaf string
 * is copied unconditionally, whether a container's arms carry the
 * choice. TWO of them are not judgements at all but CLAIMS ABOUT
 * READS - "position bookkeeping, not read under src/print" and
 * "recorded but unread under src/print" - and a claim about reads is
 * exactly what a compiler can check. This module checks them.
 *
 * It was written because one such claim was FALSE. `Node.position`
 * carried "not read by the printer" while eight files under
 * `src/print/` read it, `startsOnTheNextLine` (src/print/join.ts)
 * among them, so a decision the printer makes about block separation
 * sat behind a row saying nothing makes decisions from it (issue
 * #204). The reason was written by hand and verified by hand, which
 * is the failure mode a gate exists to remove.
 *
 * THE INSTRUMENT is the TypeScript compiler, not a text search. A
 * name-matching search cannot tell `Location.line` (read as
 * `node.position.start.line`) from `DescriptionTermNode.line`, and
 * conflating those two would make the gate accuse the wrong row.
 * `getSymbolAtLocation` resolves a property access to the
 * `PropertySignature` it was declared by, and that declaration's
 * position is what the census's own walk keys its rows on, so a read
 * lands on exactly the row it belongs to. A read whose symbol has
 * SEVERAL declarations (a property shared across a union's arms, the
 * way `constrained` is shared by four span interfaces) is recorded
 * against every one of them: over-reporting a shared read is the safe
 * direction for a gate whose failure means "somebody has to look".
 *
 * WHAT COUNTS AS A READ follows `scripts/metrics/unread-fields.ts`,
 * which faced the same question: a property access or a destructuring
 * binding READS; the left side of an assignment WRITES; an object
 * literal's `{ key: value }` CONSTRUCTS and is not a read at all. A
 * destructured field is resolved through the pattern's own type,
 * because the symbol at a binding name is the local binding rather
 * than the property it came from.
 *
 * HONEST BOUNDS, the same ones that file states: a field reached
 * through `Object.entries`, a computed key, or a spread is invisible
 * here. So a claim this module says nothing about is a claim that
 * held against property accesses and destructurings, which is how
 * every read in `src/print/` is spelled today and not a proof that
 * another spelling could not appear.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { UNREAD_CLAIMS } from "./fact-inventory-classification.js";
import { astFields, factKey } from "./fact-inventory.js";

/** Where the AST types live; the census enumerates this file. */
const AST_FILE = "src/ast.ts";

/** The printer: the only directory whose reads this module resolves. */
const PRINT_DIRECTORY = "src/print";

/**
 * The compiler options the scan opens its program with.
 *
 * Deliberately NOT read from `tsconfig.json`: a planted tree
 * (`tests/scripts/fact-inventory-reads.test.ts`) has no tsconfig of
 * its own, and a scan that could only run against this repository
 * would have no red control. `bundler` resolution is what lets
 * `../ast.js` in a printer resolve to `src/ast.ts`, which is how this
 * tree spells every import.
 */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
};

/** One read of one AST field, somewhere under `src/print/`. */
export interface FieldRead {
  /** The census's key for the field, `Owner.property`. */
  readonly key: string;
  /** `file:line` of the read, repo-relative, for a human to open. */
  readonly where: string;
}

/**
 * Every declaration in `src/ast.ts`, by the offset of the property
 * name that declares it, mapped to the census's key for it.
 *
 * Built from the census's OWN enumeration rather than from a second
 * walk of the same file: a walk written here could accept a shape
 * `astFields` does not, and would then key a read to a row the census
 * never made. The offsets line up because both read the same bytes of
 * the same file.
 * @param root - the repository root, or a planted tree shaped like one
 * @returns declaration offset to census key
 */
function declaredKeys(root: string): Map<number, string> {
  return new Map(
    astFields(root).map((field) => [field.offset, factKey(field)]),
  );
}

/**
 * The census keys a resolved symbol's declarations name.
 *
 * Plural because a property shared across a union's arms resolves to
 * ONE symbol carrying several declarations, and the census keeps a
 * row per arm; attributing such a read to only the first arm would
 * leave the others looking unread.
 * @param symbol - what the checker resolved the reference to
 * @param keys - the offset-to-key map from {@link declaredKeys}
 * @param astFile - the absolute path of `src/ast.ts`
 * @returns every census key the symbol was declared under
 */
function keysOf(
  symbol: ts.Symbol | undefined,
  keys: ReadonlyMap<number, string>,
  astFile: string,
): string[] {
  const found: string[] = [];
  for (const declaration of symbol?.declarations ?? []) {
    if (declaration.getSourceFile().fileName !== astFile) {
      continue;
    }
    if (
      ts.isPropertySignature(declaration) &&
      ts.isIdentifier(declaration.name)
    ) {
      const key = keys.get(declaration.name.getStart());
      if (key !== undefined) {
        found.push(key);
      }
    }
  }
  return found;
}

/**
 * Is a property access a READ, rather than the left side of an
 * assignment?
 *
 * The one shape that is not: `node.field = value`. Everything else a
 * property access appears in - a comparison, an argument, a return,
 * the object of a further access - is somebody looking at the field.
 * @param access - the access to classify
 * @returns whether to count it
 */
function readsThroughAccess(access: ts.PropertyAccessExpression): boolean {
  const { parent } = access;
  return !(
    ts.isBinaryExpression(parent) &&
    parent.left === access &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
}

/**
 * The property a destructuring binding takes apart.
 *
 * `const { blocks } = item` binds a LOCAL named `blocks`, and the
 * symbol at that name is the binding, not the field; the field is
 * found by asking the pattern's own type for the property. The value
 * flows out of the record into somebody's hands either way, which is
 * a read - the same call `scripts/metrics/unread-fields.ts` makes for
 * the same reason.
 * @param element - the binding element
 * @param checker - the program's type checker
 * @returns the property symbol, or undefined when the pattern's type
 *   does not declare one under that name
 */
function destructuredProperty(
  element: ts.BindingElement,
  checker: ts.TypeChecker,
): ts.Symbol | undefined {
  const name = element.propertyName ?? element.name;
  if (!ts.isIdentifier(name)) {
    return undefined;
  }
  return checker.getTypeAtLocation(element.parent).getProperty(name.text);
}

/** The files and the checker one scan works over. */
interface Scan {
  /** The parsed program. */
  readonly program: ts.Program;
  /** Its checker, for resolving a reference to its declaration. */
  readonly checker: ts.TypeChecker;
  /** The printer's own files, absolute. */
  readonly printFiles: readonly string[];
  /** `src/ast.ts`, absolute. */
  readonly astFile: string;
}

/**
 * Open `src/ast.ts` and every `.ts` file under `src/print/` as one
 * program.
 *
 * Only those files: the scan asks what the PRINTER reads, and a
 * program spanning the whole repository would take several seconds to
 * answer the same question.
 * @param root - the repository root
 * @returns the program, its checker, and the files it holds
 * @throws {Error} if `src/print/` cannot be listed
 */
function openScan(root: string): Scan {
  const astFile = path.join(root, AST_FILE);
  const printDirectory = path.join(root, PRINT_DIRECTORY);
  // RECURSIVE, though `src/print/` is flat today: the census's own
  // reason strings say "under src/print", and the day a subdirectory
  // appears a flat listing would make every read in it invisible
  // while the gate went on printing "every claim held". The floor
  // cannot catch that - a subdirectory's worth of missing reads is
  // nowhere near MINIMUM_READS. Recursive entries are relative to the
  // directory, so they are joined back onto it.
  const printFiles = readdirSync(printDirectory, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith(".ts"))
    .map((name) => path.join(printDirectory, name))
    .toSorted();
  const program = ts.createProgram([astFile, ...printFiles], COMPILER_OPTIONS);
  return { program, checker: program.getTypeChecker(), printFiles, astFile };
}

/**
 * Every read of an AST field in ONE printer file.
 * @param printed - the printer file, as the program parsed it
 * @param relative - its repo-relative path, for the read sites
 * @param scan - the program, checker and `src/ast.ts` path
 * @param keys - the offset-to-key map from {@link declaredKeys}
 * @returns the reads in that file, in source order
 */
function readsInFile(
  printed: ts.SourceFile,
  relative: string,
  scan: Scan,
  keys: ReadonlyMap<number, string>,
): FieldRead[] {
  const { checker, astFile } = scan;
  const reads: FieldRead[] = [];
  const record = (symbol: ts.Symbol | undefined, at: number): void => {
    const { line } = printed.getLineAndCharacterOfPosition(at);
    for (const key of keysOf(symbol, keys, astFile)) {
      reads.push({ key, where: `${relative}:${String(line + 1)}` });
    }
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.name) &&
      readsThroughAccess(node)
    ) {
      record(checker.getSymbolAtLocation(node.name), node.name.getStart());
    }
    if (ts.isBindingElement(node)) {
      record(destructuredProperty(node, checker), node.getStart());
    }
    ts.forEachChild(node, visit);
  };
  visit(printed);
  return reads;
}

/**
 * Every read of an `src/ast.ts` field under `src/print/`, one entry
 * per read site (a field read twice in a file appears twice, so a
 * report can say how load-bearing a row is).
 * @param root - the repository root, or a planted tree shaped like one
 * @returns the reads, in file and then source order
 * @throws {Error} if `src/ast.ts` or `src/print/` cannot be read, or
 *   if a file the scan itself opened is not in the program
 */
export function printerReads(root: string): FieldRead[] {
  const scan = openScan(root);
  if (scan.program.getSourceFile(scan.astFile) === undefined) {
    // Without it in the program every read resolves to nothing and
    // the scan reports a confident empty answer, which for a gate is
    // worse than a stop.
    throw new Error(`${AST_FILE}: not in the program, so no read resolves`);
  }
  const keys = declaredKeys(root);
  const reads: FieldRead[] = [];
  for (const file of scan.printFiles) {
    const printed = scan.program.getSourceFile(file);
    if (printed === undefined) {
      // The scan put this file in the program itself, so its absence
      // is the harness broken rather than the tree changed. Skipping
      // it would be partial blindness reported as a clean run, the
      // same quiet failure the missing-AST throw above refuses, and
      // one no read floor is tight enough to notice.
      throw new Error(
        `${path.relative(root, file)}: not in the program, so its reads are invisible`,
      );
    }
    reads.push(...readsInFile(printed, path.relative(root, file), scan, keys));
  }
  return reads;
}

/**
 * Every classification row that CLAIMS the printer does not read a
 * field, where the printer reads it.
 *
 * The claims are taken from the row's own reason, held to the shared
 * spellings {@link UNREAD_CLAIMS} names: a reason is the whole of what
 * a row asserts, so a second list of "rows that mean it" would be a
 * second thing to keep in step.
 * @param root - the repository root, or a planted tree shaped like one
 * @param exempt - the census's EXEMPT map, key to reason; passed in
 *   rather than imported so a planted tree can be scanned against a
 *   planted classification
 * @returns one message per false claim; empty means every claim held
 * @throws {Error} if `src/ast.ts` or `src/print/` cannot be read
 */
export function unreadClaimFailures(
  root: string,
  exempt: ReadonlyMap<string, string>,
): string[] {
  return falseUnreadClaims(printerReads(root), exempt);
}

/**
 * {@link unreadClaimFailures} over reads somebody else already
 * resolved.
 *
 * The scan takes a second or so, and `scripts/printer-reads.ts` needs
 * the reads themselves (for its measured-nothing floor and its
 * `--list`) as well as the failures; without this split it would pay
 * for two scans of the same tree to get them.
 * @param reads - what {@link printerReads} found
 * @param exempt - the census's EXEMPT map, key to reason
 * @returns one message per false claim; empty means every claim held
 */
export function falseUnreadClaims(
  reads: readonly FieldRead[],
  exempt: ReadonlyMap<string, string>,
): string[] {
  const sites = new Map<string, string[]>();
  for (const read of reads) {
    sites.set(read.key, [...(sites.get(read.key) ?? []), read.where]);
  }
  const failures: string[] = [];
  for (const [key, reason] of exempt) {
    const where = sites.get(key);
    if (!UNREAD_CLAIMS.has(reason) || where === undefined) {
      continue;
    }
    failures.push(
      `printer reads: ${key} is classified "${reason}", and ${PRINT_DIRECTORY} reads it at ${where.join(", ")} - reclassify it or fix the code that reads it`,
    );
  }
  return failures;
}

/**
 * The phrases that make a reason an assertion about reads rather than
 * a judgement about what a read means, lower-cased for the match.
 *
 * Only assertions of NON-reading: a reason that says a field IS read
 * (and then says why the read is not a shape choice) asserts nothing
 * a scan can refute.
 */
const NON_READING_PHRASES = ["unread", "not read", "never read", "no read"];

/**
 * Every EXEMPT reason that asserts the printer does not read the
 * field in a spelling {@link UNREAD_CLAIMS} does not name.
 *
 * The hole this NARROWS, and does not close:
 * {@link unreadClaimFailures} recognizes a claim by its exact reason
 * string, so a row that made the same assertion in its own words
 * would be a claim nothing checked - which is how the census got into
 * the state issue #204 records. A bespoke reason saying "unread" is
 * either a claim, in which case it should carry the shared spelling
 * and be checked, or it is not, in which case it should not say so.
 *
 * WHAT IT CATCHES is the four spellings in
 * {@link NON_READING_PHRASES} and nothing else. A row reading
 * "nothing looks at it", "not consumed by the printer" or
 * "constructed only" denies a read in words this misses, so what a
 * green run means is that no reason denies a read in one of four
 * ways, not that no reason denies a read.
 * @param exempt - the census's EXEMPT map, key to reason
 * @returns one message per unheld assertion; empty means every reason
 *   that talks about reads is one the gate holds
 */
export function claimShapeFailures(
  exempt: ReadonlyMap<string, string>,
): string[] {
  const failures: string[] = [];
  for (const [key, reason] of exempt) {
    const asserts = NON_READING_PHRASES.some((phrase) =>
      reason.toLowerCase().includes(phrase),
    );
    if (asserts && !UNREAD_CLAIMS.has(reason)) {
      failures.push(
        `printer reads: ${key} is classified "${reason}", which says the printer does not read it in a spelling this gate cannot hold - use one of the shared reasons (UNREAD_CLAIMS in scripts/fact-inventory-classification.ts) or say something else`,
      );
    }
  }
  return failures;
}
