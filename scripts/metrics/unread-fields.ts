/**
 * The UNREAD PUBLISHED FIELD report: a field on a type that crosses a
 * directory boundary, which NOTHING ever reads.
 *
 * This is the precision half of the vocabulary rule made mechanical.
 * The crossings registry already asks "is this crossing one we meant
 * to have?"; a vocabulary type is judged by PRECISION rather than by
 * width, and the sharpest precision fault is a field that is
 * published, carried across the boundary, and then read by nobody —
 * Parnas leakage with no benefit. Two live instances motivated it:
 * `ListHost.source`, read by nobody, and `LineKind`'s `raw` arm
 * carrying `form`, published, discarded, and then RE-DERIVED by the
 * builder that needed it. Both are fixed, and so is the third this
 * report found for itself, `Attrlist.raw`; this is the net that would
 * have caught all three.
 *
 * ARMED as a gate on 2026-08-24, on the condition the maintainer's
 * ruling set: it landed report-only, "armed as a gate only once it has
 * been observed QUIET", because a precision check that fires on the
 * tree it was written against teaches reviewers to ignore it. It had
 * one candidate left, `Attrlist.raw`; the commit that arms it deletes
 * that field, so the report reads `none` and every candidate from here
 * on is a NEW one. `bun run metrics` now exits 1 and names it.
 * Planted positive and negative controls live in
 * `tests/scripts/metrics-unread-fields.test.ts` — a gate whose only
 * evidence is its own tree saying "none" is a gate that could equally
 * be broken.
 *
 * ONE EXEMPT CLASS, and it is a class rather than a list of names:
 * SERIALIZED types. Every field of the AST is read by
 * `JSON.stringify` in the parity dumper, by Prettier's own traversal,
 * and by the `--range`/cursor machinery that reads `position.*.offset`
 * directly. None of those reads is a property access this scan can
 * see, so an AST field would be reported as unread by construction —
 * a false positive with no possible fix. The AST is also the tree's
 * declared universal vocabulary and so carries no crossings row at
 * all (`crossings.ts`), which means the exemption is belt and braces:
 * it exists so that a serialized type ADDED to the registry stays
 * exempt for the stated reason rather than by accident.
 *
 * WHAT COUNTS AS A READ is deliberately narrow: a property access, a
 * destructuring, an indexed access with a literal key — anything the
 * language service does NOT call a write access. A property
 * assignment in an object literal is a CONSTRUCTION, not a read, and
 * counting it would defeat the whole check: `ListHost.source` was
 * constructed in one file and read in none, and a scan that called the
 * construction a reference would have called it fine.
 *
 * WHERE the read is does not matter, and that is a deliberate
 * narrowing of the rule as first stated ("read outside the declaring
 * file"). A record that one module FILLS and its own declarer TAKES
 * APART is the design here, not leakage — `BlockExtent` is exactly
 * that, filled by the extent scan and read by the builders next to its
 * declaration — and scoring it as unread produced six rows nobody
 * could act on. What is left is the fault the rule is actually about:
 * a field published, carried, and read by NOBODY.
 *
 * HONEST BOUNDS. It resolves property SYMBOLS through the type
 * checker, so it does not confuse `node.source` on two unrelated
 * types — but a field reached through `Object.entries`, a computed
 * key, or a spread into another object is invisible to it, and a
 * field read only by a TEST is reported as read (the reference exists;
 * whether a test-only reader is a real consumer is a judgement the
 * report leaves to a human, and it says which file the reader is in).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { isArray, isObject, strictJson } from "./json.js";
import { ONE, ZERO } from "./model.js";

/** Where the crossings registry lives; the source of the type list. */
const REGISTRY_FILE = "scripts/metrics/crossings-registry.json";

/** The project the reference scan reads. */
const TSCONFIG_FILE = "tsconfig.json";

/**
 * Declaring files whose types are SERIALIZED, and so exempt as a
 * class. See the module comment: every field of the AST is read by
 * `JSON.stringify` and by Prettier's traversal, and no such read is a
 * property access this scan can see.
 */
const SERIALIZED = new Map<string, string>([
  [
    "src/ast.ts",
    "the AST is serialized whole — the parity dumper's JSON.stringify, Prettier's traversal and the --range/cursor machinery read every field without a property access this scan can see",
  ],
]);

/** One field nothing outside its declaring file reads. */
interface UnreadField {
  /** The declaring file, relative to the repository root. */
  readonly file: string;
  /** The type that publishes it. */
  readonly type: string;
  /** The field's name. */
  readonly property: string;
  /** `file:line` of the declaration, for a human to open. */
  readonly where: string;
}

/** What the report has to say. */
export interface UnreadReport {
  /** The candidates, in declaration order. */
  readonly candidates: readonly UnreadField[];
  /** Types the registry names that this scan could not read. */
  readonly unscanned: readonly string[];
  /** How many fields were examined, so a zero can be told from a no-op. */
  readonly examined: number;
}

/** One type the registry publishes across a directory boundary. */
interface PublishedType {
  /** The declaring file, relative to the repository root. */
  readonly file: string;
  /** The symbol's name. */
  readonly name: string;
}

/**
 * The distinct types the crossings registry names.
 *
 * Every row is read, not only the ones classified `vocabulary`: the
 * classification says how a crossing is JUDGED, and a contract with an
 * unread member is the same leak.
 * @param root - the repository root
 * @returns one entry per distinct declaring file and symbol
 */
function registeredTypes(root: string): PublishedType[] {
  const file = path.join(root, REGISTRY_FILE);
  if (!existsSync(file)) return [];
  const { value } = strictJson(REGISTRY_FILE, readFileSync(file, "utf8"));
  if (!isArray(value)) return [];
  const seen = new Set<string>();
  const types: PublishedType[] = [];
  for (const row of value) {
    if (!isObject(row)) continue;
    const { file: declaring, symbol } = row;
    if (typeof declaring !== "string" || typeof symbol !== "string") continue;
    const key = `${declaring}#${symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    types.push({ file: declaring, name: symbol });
  }
  return types;
}

/**
 * The property signatures one named type declares, if it is a type at
 * all: an interface, or a type alias for a single type literal.
 *
 * A union alias declares no properties of its own and is not a
 * mistake to report — the registry names functions and unions too, and
 * a scan that reported them as unscannable would drown the report in
 * rows nobody can act on. It is simply not a type with fields.
 * @param source - the declaring file, as the program parsed it
 * @param name - the symbol the registry names
 * @returns the property signatures, empty when the symbol is not a
 *   record-shaped type declaration
 */
function propertiesOf(
  source: ts.SourceFile,
  name: string,
): ts.PropertySignature[] {
  const members: Array<ts.NodeArray<ts.TypeElement>> = [];
  for (const statement of source.statements) {
    if (
      ts.isInterfaceDeclaration(statement) &&
      statement.name.text === name &&
      statement.heritageClauses === undefined
    ) {
      members.push(statement.members);
    }
    if (
      ts.isTypeAliasDeclaration(statement) &&
      statement.name.text === name &&
      ts.isTypeLiteralNode(statement.type)
    ) {
      members.push(statement.type.members);
    }
  }
  return members
    .flat()
    .filter(
      (member): member is ts.PropertySignature =>
        ts.isPropertySignature(member) && ts.isIdentifier(member.name),
    );
}

/**
 * The deepest node covering a position — the identifier a reference
 * entry points at.
 * @param source - the file the reference is in
 * @param position - the reference's start offset
 * @returns the innermost node containing it, if any
 */
function tokenAt(source: ts.SourceFile, position: number): ts.Node | undefined {
  let found: ts.Node | undefined = undefined;
  const visit = (node: ts.Node): void => {
    if (node.getStart() <= position && position < node.getEnd()) {
      found = node;
      ts.forEachChild(node, visit);
    }
  };
  visit(source);
  return found;
}

/**
 * Is one reference a READ of the field, rather than the name it is
 * given at construction?
 *
 * The language service RESOLVES the reference — which is why it is
 * the instrument here, and a hand-rolled symbol scan is not: it gets
 * destructuring, aliasing and shorthand right. What it does not do is
 * answer this question. Its `isWriteAccess` calls
 * `const { contentEnd } = extent` a WRITE, because a binding is being
 * declared; for this check that is a read — the value flows out of the
 * record and into somebody's hands. So the resolution comes from the
 * service and the classification is made here, on the AST at the
 * reference's own position:
 *
 * - a binding element (`const { source } = value`) READS;
 * - `value.source` and `value["source"]` READ, unless they are the
 *   left side of an assignment;
 * - an object literal's `{ source: x }` or `{ source }` CONSTRUCTS,
 *   and counting it would defeat the whole check — `ListHost.source`
 *   was constructed in one file and read in none;
 * - the declaration itself is not a reference at all. Current
 *   TypeScript does not flag it (`ReferenceEntry.isDefinition` is
 *   gone), so it is excluded by POSITION. Missing that is not a small
 *   error: it made every field on every type look read, and the report
 *   printed a confident "none" for a tree with a field seeded into it
 *   to be unread.
 * @param program - the parsed project, for the referring file
 * @param entry - one reference the language service found
 * @param declaration - where the property is declared
 * @returns whether to count it as a read
 */
function isRead(
  program: ts.Program,
  entry: ts.ReferenceEntry,
  declaration: ts.DocumentSpan,
): boolean {
  if (
    entry.fileName === declaration.fileName &&
    entry.textSpan.start === declaration.textSpan.start
  ) {
    return false;
  }
  const source = program.getSourceFile(entry.fileName);
  if (source === undefined) return false;
  const node = tokenAt(source, entry.textSpan.start);
  // A reference with no PARENT is one that is not in the syntax tree
  // at all: a `{@link Type.field}` inside a JSDoc comment, which the
  // language service reports like any other reference. Naming a field
  // in prose is not reading it, so it belongs on the same side as
  // every other non-read shape - and the guard is what keeps the
  // scorecard from crashing on `node.parent` the first time somebody
  // links a field from a doc comment.
  if (node?.parent === undefined) return false;
  return readsThroughParent(node.parent);
}

/**
 * Classify one reference by the node it sits under.
 * @param parent - the reference identifier's parent
 * @returns whether that shape is a read of the property
 */
function readsThroughParent(parent: ts.Node): boolean {
  if (ts.isBindingElement(parent)) return true;
  if (
    ts.isPropertyAccessExpression(parent) ||
    ts.isElementAccessExpression(parent)
  ) {
    // The left side of `x.f = v` is a write; every other appearance of
    // the access is somebody looking at the field.
    const { parent: outer } = parent;
    return !(
      ts.isBinaryExpression(outer) &&
      outer.left === parent &&
      outer.operatorToken.kind === ts.SyntaxKind.EqualsToken
    );
  }
  // Everything else — an object literal's key, another declaration —
  // is a construction or a declaration, not a read.
  return false;
}

/** The project, opened as a language service. */
interface Project {
  /** The parsed program, for reading declarations. */
  readonly program: ts.Program;
  /** The service, for resolving references the way an editor does. */
  readonly service: ts.LanguageService;
}

/**
 * Open the repository's TypeScript project as a LANGUAGE SERVICE.
 *
 * The service rather than a bare program-and-checker, and this is the
 * whole reason the check is worth having: resolving a property
 * reference by hand gets DESTRUCTURING wrong. In
 * `const { open } = extent`, `getSymbolAtLocation` on `open` returns
 * the local binding, not the property, so a hand-rolled scan reports
 * every destructured field as unread — measured here on 2026-08-24 at
 * 9 candidates, 9 of them false. `getReferencesAtPosition` is the same
 * machinery "find all references" runs in an editor and gets all four
 * spellings right.
 *
 * The host is the minimum one: the files never change under it, so the
 * version is a constant and there is no watcher.
 * @param root - the repository root
 * @returns the program and the service, or undefined when the project
 *   cannot be read
 */
function openProject(root: string): Project | undefined {
  const configPath = path.join(root, TSCONFIG_FILE);
  if (!existsSync(configPath)) return undefined;
  // `readConfigFile` types its payload `any`; widening it to
  // `unknown` here is the opposite of an escape hatch — it takes the
  // `any` away before it can spread, and the parser below is the only
  // thing that has ever been allowed to interpret it.
  const config: unknown = ts.readConfigFile(configPath, (file) =>
    readFileSync(file, "utf8"),
  ).config;
  const parsed = ts.parseJsonConfigFileContent(config, ts.sys, root);
  if (parsed.fileNames.length === ZERO) return undefined;
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) =>
      existsSync(fileName)
        ? ts.ScriptSnapshot.fromString(readFileSync(fileName, "utf8"))
        : undefined,
    getCurrentDirectory: () => root,
    getCompilationSettings: () => parsed.options,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    // Wrapped rather than handed over as method references: eslint's
    // `unbound-method` is right that a detached method is a hazard,
    // and `ts.sys`'s are trivially re-bindable here.
    fileExists: (file) => ts.sys.fileExists(file),
    readFile: (file, encoding) => ts.sys.readFile(file, encoding),
    readDirectory: (...arguments_) => ts.sys.readDirectory(...arguments_),
    directoryExists: (directory) => ts.sys.directoryExists(directory),
    getDirectories: (directory) => ts.sys.getDirectories(directory),
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const program = service.getProgram();
  return program === undefined ? undefined : { program, service };
}

/**
 * Every published field nothing outside its declaring file reads.
 * @param root - the repository root; THIS repository, since the
 *   registry and the exemption class describe it
 * @returns the candidates, the types that could not be scanned, and
 *   how many fields were examined
 */
export function unreadPublishedFields(root: string): UnreadReport {
  const types = registeredTypes(root);
  const project = openProject(root);
  if (project === undefined) {
    return {
      candidates: [],
      unscanned: [
        `${TSCONFIG_FILE}: the project did not parse, so no field was examined`,
      ],
      examined: ZERO,
    };
  }
  const { program, service } = project;
  const unscanned: string[] = [];
  const candidates: UnreadField[] = [];
  let examined = ZERO;
  for (const type of types) {
    if (SERIALIZED.has(type.file)) continue;
    const source = program.getSourceFile(path.join(root, type.file));
    if (source === undefined) {
      unscanned.push(
        `${type.file}: not in ${TSCONFIG_FILE}'s project, so ${type.name} could not be examined`,
      );
      continue;
    }
    for (const member of propertiesOf(source, type.name)) {
      examined += ONE;
      const at = member.name.getStart();
      const references =
        service.getReferencesAtPosition(source.fileName, at) ?? [];
      const declaration: ts.DocumentSpan = {
        fileName: source.fileName,
        textSpan: { start: at, length: member.name.getWidth() },
      };
      if (references.some((entry) => isRead(program, entry, declaration))) {
        continue;
      }
      const { line } = source.getLineAndCharacterOfPosition(at);
      candidates.push({
        file: type.file,
        type: type.name,
        property: member.name.getText(source),
        where: `${type.file}:${String(line + ONE)}`,
      });
    }
  }
  return { candidates, unscanned, examined };
}
