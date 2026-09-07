/**
 * The SYMBOL half of the repo-internal citation gate: every symbol a
 * comment names beside one of this repository's files is held to a
 * name that file really has.
 *
 * WHY. The path half (`scripts/internal-citations.ts`) holds a
 * comment's `file:line` and its quoted source; what it cannot hold is
 * the NAME written beside the path, and a name is what the prose is
 * actually about. A function that moves between two modules leaves
 * every comment naming its old one both readable and wrong. Until a
 * symbol is checkable, dropping the paths out of prose would delete
 * the only check those comments have.
 *
 * THE GRAMMAR, and it is deliberately narrow. A symbol citation is a
 * backtick-quoted, identifier-shaped run written IMMEDIATELY before a
 * repository `.ts` path: `` (`isSingleWordLine`,
 * src/parse/line-shapes.ts) ``. Adjacency and not scope, because this
 * repository's comments quote Ruby methods (`next_block`,
 * `parse_list`) and AsciiDoc spellings in backticks as freely as they
 * name their own functions, so a rule that let any path in a
 * paragraph bind any quoted run in it reports mostly those.
 *
 * WHAT COUNTS AS HAVING THE NAME: the file DECLARES it (a function,
 * class, interface, type, enum, variable, property or method) or
 * IMPORTS it. Imports count because a comment that says "the printer's
 * `Cursor` (src/print/inline.ts)" is telling a reader where to look,
 * and the file that uses the name is a place a reader finds it. A run
 * whose first segment is one of the runtime's own globals is not this
 * repository's to hold, and is skipped.
 *
 * A CITATION NAMING A FILE THE GATE HAS NO TEXT FOR IS SKIPPED, not
 * failed. "Does this file have this name" is unanswerable without the
 * file, and whether the PATH is real is the other half's question, not
 * this one's; a gate that answered it here would also fail every
 * citation a test writes into a fixture about a checkout of its own.
 */
import ts from "typescript";

/**
 * A backtick-quoted run immediately followed by a repository path.
 * The separator set is exactly what the repo's own prose writes
 * between the two, and no more: blanks and commas, the comment prefix
 * a wrap puts in the middle (the 80-column rule breaks the aside
 * across lines as often as not), the parenthesis that usually opens
 * the aside, and ONE of the four prepositions the other phrasing uses
 * ("`delimitedExtent` in src/parse/lines/delimited-reader.ts"). A word outside
 * that set ends the separator, so nothing binds across a clause.
 */
const CITED =
  /`(?<named>[^`\n]+)`(?:[\s,]|\/\/|\*)*(?:(?:in|of|from|at)\b)?(?:[\s,]|\/\/|\*)*\(?(?<file>(?:src|tests|scripts)\/[\w.\/\-]*\.ts)/gv;

/**
 * An identifier, or a dotted or `#`-qualified path of them, with an
 * optional empty call suffix. Anything else in backticks is prose, a
 * value or a foreign spelling, and is not claimed as a symbol.
 */
const SYMBOL_SHAPE = /^[A-Za-z_$][\w$]*(?:[.#][A-Za-z_$][\w$]*)*(?:\(\))?$/v;

/** Splits a qualified name into the segments each file must have. */
const SEGMENT = /[.#]/v;

/** One symbol a comment names, and the file it names it beside. */
export interface SymbolCitation {
  /** Where it is written, as `path:line`. */
  readonly at: string;
  /** The name as written, backticks stripped. */
  readonly named: string;
  /** The repository path written beside it. */
  readonly file: string;
}

/**
 * Every name a file declares or imports.
 *
 * The TypeScript compiler rather than a regex, for the reason
 * `scripts/fact-inventory.ts` gives about `src/ast.ts`: a scan over
 * raw text also finds the names written in COMMENTS, and a gate that
 * accepted a symbol because some comment mentioned it would pass the
 * exact rot it exists to catch.
 *
 * Exported for its unit tests (tests/scripts/internal-symbols.test.ts)
 * and for the gate; no other consumer.
 * @internal
 * @param file - the repo-relative path, for the parser's diagnostics
 * @param text - the file's contents
 * @returns every declared or imported name, in no particular order
 */
export function namesIn(file: string, text: string): ReadonlySet<string> {
  const names = new Set<string>();
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    const named = namedBy(node);
    if (named !== undefined) {
      names.add(named);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * The name a top-level or imported declaration introduces.
 *
 * Spelled as narrowing returns rather than a predicate chain followed
 * by one read of `.name`: the union of these kinds has no common
 * `name` property TypeScript hands over without an assertion, and the
 * measuring tools may not cheat on the thing they measure
 * (scripts/metrics/json.ts states that rule). Split from
 * {@link memberNameOf} to stay inside the complexity ceiling.
 * @param node - any node of the file's tree
 * @returns the name node it introduces, if it introduces one
 */
function declarationNameOf(node: ts.Node): ts.Node | undefined {
  if (ts.isFunctionDeclaration(node)) {
    return node.name;
  }
  if (ts.isClassDeclaration(node)) {
    return node.name;
  }
  if (ts.isInterfaceDeclaration(node)) {
    return node.name;
  }
  if (ts.isTypeAliasDeclaration(node)) {
    return node.name;
  }
  if (ts.isEnumDeclaration(node)) {
    return node.name;
  }
  if (ts.isVariableDeclaration(node)) {
    return node.name;
  }
  if (ts.isImportSpecifier(node) || ts.isImportClause(node)) {
    return node.name;
  }
  return undefined;
}

/**
 * The name a member of a shape introduces: an interface's or class's
 * properties and methods, an object literal's keys, an enum's members.
 * @param node - any node of the file's tree
 * @returns the name node it introduces, if it introduces one
 */
function memberNameOf(node: ts.Node): ts.Node | undefined {
  if (ts.isPropertySignature(node) || ts.isMethodSignature(node)) {
    return node.name;
  }
  if (ts.isPropertyDeclaration(node) || ts.isMethodDeclaration(node)) {
    return node.name;
  }
  if (ts.isPropertyAssignment(node)) {
    return node.name;
  }
  if (ts.isEnumMember(node)) {
    return node.name;
  }
  return undefined;
}

/**
 * The name one node introduces, or undefined for a node that
 * introduces none.
 *
 * A computed or string-literal member name is dropped: it is not a
 * name a comment can cite.
 * @param node - any node of the file's tree
 * @returns the name it introduces
 */
function namedBy(node: ts.Node): string | undefined {
  const named = declarationNameOf(node) ?? memberNameOf(node);
  return named !== undefined && ts.isIdentifier(named) ? named.text : undefined;
}

/**
 * Every symbol citation written in one file.
 *
 * Scanned over the file's whole text rather than over its comments
 * alone, for the reason the path scan gives: extracting comments needs
 * a lexer, and the grammar is narrow enough that code matching it
 * would be a citation written in a string.
 *
 * Exported for its unit tests (tests/scripts/internal-symbols.test.ts);
 * the gate is the only other consumer.
 * @internal
 * @param file - the repo-relative path the comments are written in
 * @param text - that file's contents
 * @returns the citations, in the order they are written
 */
export function symbolCitations(file: string, text: string): SymbolCitation[] {
  const citations: SymbolCitation[] = [];
  for (const match of text.matchAll(CITED)) {
    const groups: Record<string, string | undefined> = match.groups ?? {};
    const named = groups.named ?? "";
    const cited = groups.file ?? "";
    if (!SYMBOL_SHAPE.test(named) || isRuntimeGlobal(named)) {
      continue;
    }
    const line = text.slice(0, match.index).split("\n").length;
    citations.push({ at: `${file}:${String(line)}`, named, file: cited });
  }
  return citations;
}

/**
 * Does this name belong to the JavaScript runtime rather than to this
 * repository? `` `Promise.all` (tests/conformance/interruption.test.ts) ``
 * names the pattern a file uses, not a name that file has, and no
 * repository gate can hold it.
 * @param named - the cited name
 * @returns whether its first segment is a global
 */
function isRuntimeGlobal(named: string): boolean {
  return Object.hasOwn(globalThis, named.split(SEGMENT)[0]);
}

/**
 * Hold one symbol citation to the file it names.
 *
 * EVERY SEGMENT, so `ParagraphReader.tokenizeRun` fails on a file that
 * has the method and no such class: a qualified name that is half
 * right sends a reader to a member of something that is not there.
 *
 * Exported for its unit tests (tests/scripts/internal-symbols.test.ts);
 * no other consumer.
 * @internal
 * @param citation - the citation
 * @param names - the names its file has
 * @returns one message per failure, empty when the citation held
 */
export function checkSymbol(
  citation: SymbolCitation,
  names: ReadonlySet<string>,
): string[] {
  const segments = citation.named.replace("()", "").split(SEGMENT);
  const absent = segments.filter((segment) => !names.has(segment));
  if (absent.length === 0) {
    return [];
  }
  return [
    `${citation.at}: \`${citation.named}\` names ${citation.file}, which declares and imports no ${absent.join(" and no ")}`,
  ];
}
