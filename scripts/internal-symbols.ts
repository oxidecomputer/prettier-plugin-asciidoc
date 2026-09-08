/**
 * The SYMBOL half of the repo-internal citation gate: every name this
 * repository's prose claims is held to a name the repository has.
 *
 * WHY. The path half (`scripts/internal-citations.ts`) holds a
 * comment's `file:line` and its quoted source; what it cannot hold is
 * the NAME written beside the path, and a name is what the prose is
 * actually about. A function that moves between two modules leaves
 * every comment naming its old one both readable and wrong.
 *
 * TWO SPELLINGS, and the prose picks by what a reader needs. A link
 * tag claims a symbol and nothing else, which is the marker a bare
 * backticked identifier lacks: a quoted name in a comment is
 * otherwise indistinguishable from a quoted value or a Ruby method.
 * A name written beside a repository path claims a symbol AND says
 * which file to open, which is what a name several files declare
 * still needs.
 *
 * THE PATH SPELLING is deliberately narrow: a backtick-quoted,
 * identifier-shaped run written IMMEDIATELY before a repository `.ts`
 * path, as in (`optionalGroup`, src/parse/line-shapes.ts).
 * Adjacency and not scope, because this repository's comments quote
 * Ruby methods (`next_block`, `parse_list`) and AsciiDoc spellings in
 * backticks as freely as they name their own functions, so a rule
 * that let any path in a paragraph bind any quoted run in it reports
 * mostly those.
 *
 * WHAT COUNTS AS HAVING THE NAME: the file DECLARES it (a function,
 * class, interface, type, enum, variable, property, accessor or
 * method) or IMPORTS it. Imports count because a comment that says
 * "the printer's `Cursor` (src/print/inline.ts)" is telling a reader
 * where to look, and the file that uses the name is a place a reader
 * finds it. A run whose first segment is one of the runtime's own
 * globals is not this repository's to hold, and is skipped.
 *
 * THE INDEX is the union of the DECLARATIONS over `src`, `tests` and
 * `scripts`: one entry per name, holding the files that declare it.
 * Imports are not in it, because an imported name is declared
 * somewhere and where is the question the index answers. A tag
 * carries no path, so it is held against the citing file's own names
 * first, which is what TypeScript itself resolves it against, and
 * against the index only when the name is not one of those. There it
 * must name exactly ONE file: a name several files declare sends a
 * reader nowhere in particular, and that case is what a path beside
 * the name is for.
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
 * that set ends the separator, so nothing binds across a clause. The
 * path may itself be backticked, which is how the markdown writes one
 * ("`printsDrainShield` in `src/print/join.ts`"): a code span there is
 * what a comment's bare path is in a `.ts` file.
 */
const CITED =
  /`(?<named>[^`\n]+)`(?:[\s,]|\/\/|\*)*(?:(?:in|of|from|at)\b)?(?:[\s,]|\/\/|\*)*\(?`?(?<file>(?:src|tests|scripts)\/[\w.\/\-]*\.ts)/gv;

/**
 * A link tag, with the wrap a long one takes: the 80-column rule
 * breaks a tag after `{@link` as readily as it breaks an aside, and
 * the comment prefix the next line opens with is part of neither the
 * tag nor the name. The name runs to the closing brace, because this
 * repository writes no display text and TSDoc's `|` form would need
 * one.
 */
const LINKED = /\{@link(?:\s|\/\/|\*)+(?<named>[^\s\}]+)\s*\}/gv;

/**
 * The files where link-shaped text is DATA rather than a claim, whose
 * tags this scan does not read.
 *
 * Both are the gate's own tests, and both have to write a tag the tree
 * cannot resolve: one that names nothing, and one that names a name
 * several files declare. Reading them would fail the gate on its own
 * fixtures, and the alternative - hiding a fixture from the scan by
 * splitting the tag across a concatenation - would hide a real rot the
 * same way. The skip lives HERE rather than at the call site so that a
 * second caller cannot forget it. The other direction's scan keeps a
 * list of its own for the same reason (`NOT_SCANNED`,
 * scripts/citation-check.ts).
 *
 * Exported so the exemption is pinned and visible
 * (tests/scripts/internal-symbols.test.ts); no other consumer.
 * @internal
 */
export const LINKS_NOT_SCANNED = new Set([
  "tests/scripts/internal-citations.test.ts",
  "tests/scripts/internal-symbols.test.ts",
]);

/**
 * The file whose prose names symbols that are GONE, on purpose.
 *
 * The deletion ledger's rows are ABOUT what a change removed: each one
 * names the symbol it deleted and writes the prose that justified it,
 * so a row whose name still resolved would be the broken one. Neither
 * scan reads it. Every OTHER ledger's notes are read, because a note
 * naming a function that has since gone is the rot they check for.
 *
 * Exported so the exemption is pinned and visible
 * (tests/scripts/internal-symbols.test.ts); no other consumer.
 * @internal
 */
export const DELETION_LEDGER = "scripts/deletions.json";

/**
 * An identifier, or a dotted or `#`-qualified path of them, with an
 * optional empty call suffix. Anything else in backticks is prose, a
 * value or a foreign spelling, and anything else in a link tag is a
 * URL or an interpolation; neither is claimed as a symbol.
 *
 * Exported because the pin scan tells a symbol from a quotation by the
 * same shape (`lintPins`, scripts/internal-citations.ts), and two
 * spellings of "is this a name" would drift apart.
 * @internal
 */
export const SYMBOL_SHAPE =
  /^[A-Za-z_$][\w$]*(?:[.#][A-Za-z_$][\w$]*)*(?:\(\))?$/v;

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
 * One symbol a comment names in a link tag, which carries no path.
 *
 * Exported for the gate and its unit tests
 * (tests/scripts/internal-symbols.test.ts); no other consumer.
 * @internal
 */
export interface LinkCitation {
  /** Where it is written, as `path:line`. */
  readonly at: string;
  /** The name as written, braces and tag stripped. */
  readonly named: string;
}

/**
 * Which files declare each name, over every tree the gate reads.
 *
 * Exported for the gate and its unit tests
 * (tests/scripts/internal-symbols.test.ts); no other consumer.
 * @internal
 */
export type SymbolIndex = ReadonlyMap<string, ReadonlySet<string>>;

/**
 * What each name a file declares is WRITTEN as: the source text of
 * every declaration carrying that name, in source order.
 *
 * Exported for the gate and its unit tests
 * (tests/scripts/internal-symbols.test.ts); no other consumer.
 * @internal
 */
export type DeclaredBodies = ReadonlyMap<string, readonly string[]>;

/**
 * The names one file has, split by whether the file declares them.
 *
 * Two sets rather than one, because the two questions differ: a
 * citation beside a path asks whether a reader opening THAT file
 * finds the name, which an import answers, and the index asks which
 * file declares it, which an import does not.
 *
 * Exported for the gate and its unit tests
 * (tests/scripts/internal-symbols.test.ts); no other consumer.
 * @internal
 */
export interface FileNames {
  /** What the file introduces itself. */
  readonly declared: ReadonlySet<string>;
  /** What it brings in, and some other file declares. */
  readonly imported: ReadonlySet<string>;
}

/**
 * The names of a file that declares none: the markdown and the JSON
 * ledgers, whose prose cites this repository's symbols but introduces
 * none of its own.
 *
 * Exported for the gate (scripts/internal-citations.ts), which hands
 * it to every file it read that is not TypeScript; no other consumer.
 * @internal
 */
export const NO_NAMES: FileNames = {
  declared: new Set(),
  imported: new Set(),
};

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
 * @returns its declared and its imported names, in no particular order
 */
export function namesIn(file: string, text: string): FileNames {
  const declared = new Set<string>();
  const imported = new Set<string>();
  eachDeclaration(file, text, (named, imports) => {
    (imports ? imported : declared).add(named);
  });
  return { declared, imported };
}

/**
 * The source text every name a file DECLARES is written as, by name.
 *
 * An array per name, because a name a file writes twice (an overload,
 * a local shadowing a module-level one) is two texts and picking one
 * of them would be a guess. Imports carry no text of their own and
 * are not in it.
 *
 * Exported for the gate and its unit tests
 * (tests/scripts/internal-symbols.test.ts); no other consumer.
 * @internal
 * @param file - the repo-relative path, for the parser's diagnostics
 * @param text - the file's contents
 * @returns each declared name's declarations, in source order
 */
export function bodiesIn(file: string, text: string): DeclaredBodies {
  const bodies = new Map<string, string[]>();
  eachDeclaration(file, text, (named, imports, node) => {
    if (imports) {
      return;
    }
    const written = bodies.get(named);
    if (written === undefined) {
      bodies.set(named, [node.getText()]);
    } else {
      written.push(node.getText());
    }
  });
  return bodies;
}

/**
 * Walk one file's tree and hand every name it introduces to a caller.
 *
 * One walk for the two readings of a file - which names it has, and
 * what each name is written as - so the narrowing in {@link namedBy}
 * is stated once.
 * @param file - the repo-relative path, for the parser's diagnostics
 * @param text - the file's contents
 * @param take - called with each name, whether the name comes from
 *   another file, and the node introducing it
 */
function eachDeclaration(
  file: string,
  text: string,
  take: (named: string, imports: boolean, node: ts.Node) => void,
): void {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    const named = namedBy(node);
    if (named !== undefined) {
      take(named, isImported(node), node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/**
 * The index a path-less citation is resolved against: which files
 * declare each name.
 *
 * Exported for the gate and its unit tests
 * (tests/scripts/internal-symbols.test.ts); no other consumer.
 * @internal
 * @param names - every read file's names, by repo-relative path
 * @returns the files declaring each declared name
 */
export function symbolIndex(
  names: ReadonlyMap<string, FileNames>,
): SymbolIndex {
  const index = new Map<string, Set<string>>();
  for (const [file, held] of names) {
    for (const name of held.declared) {
      const declaring = index.get(name);
      if (declaring === undefined) {
        index.set(name, new Set([file]));
      } else {
        declaring.add(file);
      }
    }
  }
  return index;
}

/**
 * Does this node bring a name in rather than introduce it?
 * @param node - a node that introduces a name
 * @returns whether the name comes from another file
 */
function isImported(node: ts.Node): boolean {
  return ts.isImportSpecifier(node) || ts.isImportClause(node);
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
 * The segments of a qualified name, which one file must have all of.
 * @param named - the name as written
 * @returns its segments, in order, at least one
 */
function segmentsOf(named: string): string[] {
  return named.replace("()", "").split(SEGMENT);
}

/**
 * Does one file have this name, however it got there?
 * @param names - that file's names
 * @param segment - one segment of a cited name
 * @returns whether the file declares or imports it
 */
function hasName(names: FileNames, segment: string): boolean {
  return names.declared.has(segment) || names.imported.has(segment);
}

/**
 * The name a member of a shape introduces: an interface's or class's
 * properties, accessors and methods, an object literal's keys, an
 * enum's members.
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
  if (ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
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
 * Every symbol citation written in one file, or none where the file is
 * the deletion ledger ({@link DELETION_LEDGER}).
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
  if (file === DELETION_LEDGER) {
    return citations;
  }
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
 * Every link tag written in one file, or none where the file's tags
 * are fixtures ({@link LINKS_NOT_SCANNED}).
 *
 * Scanned over the whole text for the reason the citation scan gives,
 * and filtered by the same two rules: a tag whose target is not
 * identifier-shaped is a URL or a template hole rather than a claim,
 * and a name the runtime owns is nobody here's to hold.
 *
 * Exported for its unit tests (tests/scripts/internal-symbols.test.ts);
 * the gate is the only other consumer.
 * @internal
 * @param file - the repo-relative path the comments are written in
 * @param text - that file's contents
 * @returns the citations, in the order they are written
 */
export function linkCitations(file: string, text: string): LinkCitation[] {
  const citations: LinkCitation[] = [];
  if (LINKS_NOT_SCANNED.has(file) || file === DELETION_LEDGER) {
    return citations;
  }
  for (const match of text.matchAll(LINKED)) {
    const groups: Record<string, string | undefined> = match.groups ?? {};
    const named = groups.named ?? "";
    if (!SYMBOL_SHAPE.test(named) || isRuntimeGlobal(named)) {
      continue;
    }
    const line = text.slice(0, match.index).split("\n").length;
    citations.push({ at: `${file}:${String(line)}`, named });
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
  names: FileNames,
): string[] {
  const segments = segmentsOf(citation.named);
  const absent = segments.filter((segment) => !hasName(names, segment));
  if (absent.length === 0) {
    return [];
  }
  return [
    `${citation.at}: \`${citation.named}\` names ${citation.file}, which declares and imports no ${absent.join(" and no ")}`,
  ];
}

/**
 * Hold one link tag to the index, and to the file it is written in.
 *
 * THE CITING FILE'S OWN DECLARATIONS FIRST: a name the file declares
 * is the one a reader lands on, whatever else in the tree shares its
 * spelling. An IMPORT does not answer it, and that is the whole
 * difference from the path spelling: an imported name is declared
 * somewhere else, and where is exactly the question here, so a name
 * nothing in these trees declares - one imported from a package - is
 * not a name this repository can hold a tag to. Everything the citing
 * file does not declare is a question about the tree, and there the
 * answer has to be exactly one file. Both other answers are failures,
 * and they are different failures: no file at all is a name that has
 * moved, was never there, or was never this repository's, and several
 * files is a name whose reader needs the path this spelling cannot
 * carry.
 *
 * Exported for its unit tests (tests/scripts/internal-symbols.test.ts);
 * no other consumer.
 * @internal
 * @param citation - the citation
 * @param own - the names of the file it is written in
 * @param index - which files declare each name in the tree
 * @returns one message per failure, empty when the citation held
 */
export function checkLink(
  citation: LinkCitation,
  own: FileNames,
  index: SymbolIndex,
): string[] {
  const segments = segmentsOf(citation.named);
  if (segments.every((segment) => own.declared.has(segment))) {
    return [];
  }
  const declaring = declaringFiles(index, segments);
  if (declaring.size === 1) {
    return [];
  }
  const where = `${citation.at}: \`{@link ${citation.named}}\``;
  if (declaring.size > 1) {
    return [
      `${where} is declared in ${String(declaring.size)} files (${[...declaring].toSorted().join(", ")}), so write the name with its path beside it instead`,
    ];
  }
  const absent = segments.filter((segment) => !index.has(segment));
  if (absent.length > 0) {
    return [`${where} names no ${absent.join(" and no ")} anything declares`];
  }
  return [`${where} names no ONE file declaring ${segments.join(" and ")}`];
}

/**
 * The files that declare every segment of a qualified name.
 *
 * The intersection and not a lookup of the first segment, so a name
 * whose halves are declared in different files resolves nowhere: it
 * would otherwise send a reader to a member of something that is not
 * there, which is the failure the path spelling checks for too.
 * @param index - which files declare each name in the tree
 * @param segments - the segments of one cited name
 * @returns the files holding all of them, possibly none
 */
function declaringFiles(
  index: SymbolIndex,
  segments: readonly string[],
): ReadonlySet<string> {
  let held = new Set(index.get(segments[0]));
  for (const segment of segments.slice(1)) {
    const declaring = index.get(segment) ?? new Set<string>();
    held = new Set([...held].filter((file) => declaring.has(file)));
  }
  return held;
}
