/**
 * The `@internal` surface: which `src` exports exist only because a
 * TEST needs them, and whether each one says so.
 *
 * knip reports zero unused exports under `src`, and that number is
 * true but coarse: a test importing a symbol counts as a consumer, so
 * an export nothing in `src` has needed since some refactor reads
 * exactly like an export the parser depends on. The count SPLITS —
 * consumed by `src`, and consumed only from outside it — and the
 * second half is a real category with a real cost. It is surface a
 * reader has to account for, and it is where a half-finished deletion
 * comes to rest.
 *
 * The rule, and it is a taxonomy rather than a budget: an export with
 * no `src` consumer must carry the bare `@internal` JSDoc tag, and the
 * same block must NAME the unit that consumes it, as a path that
 * exists. An untagged one fails the scorecard. There is no ratchet
 * here — a wide `@internal` surface is not automatically worse than a
 * narrow one; what is worse is not knowing which exports are which.
 *
 * Both directions are checked, for the reason every registry here is:
 * a tag that has gone stale reads as an audit. An `@internal` on an
 * export `src` DOES consume is a lie about the module's shape, and
 * fails too.
 *
 * `src/index.ts` is exempt in both directions. It is the package
 * entry, its exports are the published API by definition, and nothing
 * inside `src` is supposed to import it.
 *
 * HONEST BOUND: consumption is read off IMPORT STATEMENTS, matched by
 * name against relative specifiers resolved back to a file. That is
 * what the tree actually uses — there is no dynamic import and no
 * `export *` under `src` — but it is a scanner, not a type checker,
 * and a symbol reached some other way would read as unconsumed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { ONE, ZERO } from "./model.js";

/** The tag an export with no `src` consumer must carry. */
const INTERNAL_TAG = "@internal";

/** The package entry, exempt in both directions. */
const PACKAGE_ENTRY = "src/index.ts";

/**
 * A path the `@internal` prose may name as the consuming unit. A
 * NAMED, EXISTING file: "used by a test" is not information, and a
 * name that has rotted is worse than none.
 */
const CONSUMER_PATH = /(?:tests|scripts)(?:\/[\w.\-]+)+\.ts/gv;

/** What this module contributes to one revision's snapshot. */
export interface InternalFacts {
  /** Exports under `src` that no other `src` file imports. */
  readonly testOnly: number;
  /** Those of them not tagged, as `file:name`, with the reason. */
  readonly untagged: readonly string[];
  /** Tags on exports `src` does consume, as `file:name`. */
  readonly staleTags: readonly string[];
}

/** One exported name, and the JSDoc block attached to its statement. */
interface Exported {
  /** The exported name. */
  readonly name: string;
  /** The statement's JSDoc text, or "" when it carries none. */
  readonly jsdoc: string;
}

/**
 * Every `.ts` file below a directory of the measured checkout.
 * @param root - the checkout root
 * @param directory - the directory to walk, root-relative
 * @returns root-relative posix paths, unsorted
 */
function walk(root: string, directory: string): string[] {
  const full = path.join(root, directory);
  if (!existsSync(full)) return [];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const here = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) return walk(root, here);
    return entry.name.endsWith(".ts") ? [here] : [];
  });
}

/**
 * The JSDoc block immediately above a statement.
 * @param text - the file's full text
 * @param node - a top-level statement
 * @returns the block's text, or "" when the statement carries none
 */
function jsdocOf(text: string, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(text, node.pos) ?? [];
  const blocks = ranges
    .map((range) => text.slice(range.pos, range.end))
    .filter((comment) => comment.startsWith("/**"));
  return blocks.at(-ONE) ?? "";
}

/**
 * The name a declaration statement declares.
 * @param node - a top-level statement
 * @returns the declared name, or undefined when it declares none
 */
function declaredName(node: ts.Statement): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text;
  }
  return undefined;
}

/**
 * Does this statement carry the `export` modifier?
 * @param node - a top-level statement
 * @returns whether it is exported
 */
function isExported(node: ts.Statement): boolean {
  const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : [];
  return (
    modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) === true
  );
}

/**
 * The names one top-level statement exports.
 * @param text - the file's full text
 * @param node - a top-level statement
 * @returns one entry per exported name; empty when it exports nothing
 */
function exportsOf(text: string, node: ts.Statement): Exported[] {
  const jsdoc = jsdocOf(text, node);
  if (ts.isExportDeclaration(node)) {
    const { exportClause: clause } = node;
    if (clause === undefined || !ts.isNamedExports(clause)) return [];
    return clause.elements.map((element) => ({
      name: element.name.text,
      jsdoc,
    }));
  }
  if (!isExported(node)) return [];
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name)
        ? [{ name: declaration.name.text, jsdoc }]
        : [],
    );
  }
  const named = declaredName(node);
  return named === undefined ? [] : [{ name: named, jsdoc }];
}

/**
 * The names one statement imports, keyed by the file they come from.
 *
 * `./x.js` is `./x.ts` on disk — TypeScript's own resolution rule, the
 * one `dependency-cruiser` is told to apply in `graph.ts`.
 * @param file - the importing file, root-relative
 * @param node - a top-level statement
 * @returns `file|name` keys for every relative import it names
 */
function importsOf(file: string, node: ts.Statement): string[] {
  if (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) return [];
  const { moduleSpecifier: specifier } = node;
  if (specifier === undefined || !ts.isStringLiteral(specifier)) return [];
  if (!specifier.text.startsWith(".")) return [];
  const target = path.posix.join(
    path.posix.dirname(file),
    specifier.text.replace(/\.js$/v, ".ts"),
  );
  const clause = ts.isImportDeclaration(node)
    ? node.importClause
    : node.exportClause;
  return namedFrom(target, clause);
}

/**
 * The `file|name` keys one import or re-export clause names.
 * @param target - the file the clause reads from, root-relative
 * @param clause - the import clause or the export clause
 * @returns one key per named binding; `target|*` when the whole module
 *   is reached at once
 */
function namedFrom(
  target: string,
  clause: ts.ImportClause | ts.NamedExportBindings | undefined,
): string[] {
  if (clause === undefined) return [];
  const bindings = ts.isImportClause(clause) ? clause.namedBindings : clause;
  if (bindings !== undefined && ts.isNamedImports(bindings)) {
    return bindings.elements.map(
      (element) => `${target}|${(element.propertyName ?? element.name).text}`,
    );
  }
  if (bindings !== undefined && ts.isNamedExports(bindings)) {
    return bindings.elements.map(
      (element) => `${target}|${(element.propertyName ?? element.name).text}`,
    );
  }
  // A namespace import or a default import reaches the whole module at
  // once; neither can be attributed to one export, so both mark the
  // module as consumed wholesale.
  return [`${target}|*`];
}

/** One measured checkout's exports and internal consumption. */
interface Surface {
  /** Exported names per file, root-relative. */
  readonly exports: Map<string, Exported[]>;
  /** `file|name` for every name one `src` file imports from another. */
  readonly consumed: Set<string>;
  /** Files reached by a namespace or default import from inside `src`. */
  readonly wholesale: Set<string>;
}

/**
 * Read every `src` file's exports and internal imports.
 * @param root - the measured checkout root
 * @returns what each file publishes, and what `src` consumes
 */
function readSurface(root: string): Surface {
  const exports = new Map<string, Exported[]>();
  const consumed = new Set<string>();
  const wholesale = new Set<string>();
  for (const file of walk(root, "src")) {
    const text = readFileSync(path.join(root, file), "utf8");
    const parsed = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ false,
      ts.ScriptKind.TS,
    );
    const published: Exported[] = [];
    for (const statement of parsed.statements) {
      published.push(...exportsOf(text, statement));
      for (const key of importsOf(file, statement)) {
        if (key.endsWith("|*")) wholesale.add(key.slice(ZERO, -"|*".length));
        else consumed.add(key);
      }
    }
    exports.set(file, published);
  }
  return { exports, consumed, wholesale };
}

/**
 * Whether an `@internal` block names a consuming unit that exists.
 * @param root - the measured checkout root
 * @param jsdoc - the JSDoc block's text
 * @returns whether it names at least one existing file
 */
function namesLiveConsumer(root: string, jsdoc: string): boolean {
  return [...jsdoc.matchAll(CONSUMER_PATH)].some(([named]) =>
    existsSync(path.join(root, named)),
  );
}

/**
 * Split one checkout's `src` exports by who consumes them, and check
 * the tag in both directions.
 * @param root - the measured checkout root
 * @returns the counts and the faults
 */
export function readInternalSurface(root: string): InternalFacts {
  const { exports, consumed, wholesale } = readSurface(root);
  let testOnly = ZERO;
  const untagged: string[] = [];
  const staleTags: string[] = [];
  for (const [file, published] of exports) {
    if (file === PACKAGE_ENTRY || wholesale.has(file)) continue;
    for (const { name, jsdoc } of published) {
      const tagged = jsdoc.includes(INTERNAL_TAG);
      if (consumed.has(`${file}|${name}`)) {
        if (tagged) {
          staleTags.push(
            `${file}:${name} is tagged ${INTERNAL_TAG} but src imports it — the tag says the export exists for a test, and it does not`,
          );
        }
        continue;
      }
      testOnly += ONE;
      if (!tagged) {
        untagged.push(
          `${file}:${name} has no src consumer and no ${INTERNAL_TAG} tag — tag it and name the unit that consumes it, or unexport it`,
        );
      } else if (!namesLiveConsumer(root, jsdoc)) {
        untagged.push(
          `${file}:${name} is tagged ${INTERNAL_TAG} but its block names no existing tests/ or scripts/ file — say which unit consumes it`,
        );
      }
    }
  }
  return { testOnly, untagged, staleTags };
}
