/**
 * Line classification and escape-hatch counting, done with the
 * TypeScript compiler's own scanner and AST rather than with regexes.
 *
 * Ruling 34: a metric nobody can trust is worse than no metric. Regex
 * line counting has blind spots by construction — a one-line block
 * comment followed by code, a block comment opened mid-line, `//`
 * inside a string — and a regex `as` count cannot tell `x as Foo` from
 * `import * as T`. `ts.createSourceFile` answers both questions the
 * way the compiler does, comments included (they are each token's
 * leading trivia).
 *
 * A line is CODE if any non-trivia token starts on or spans it,
 * COMMENT if its only tokens are comment trivia, and BLANK otherwise.
 * Code always wins, so a line carrying both is code.
 */
import ts from "typescript";
import { NOT_FOUND, ONE, ZERO } from "./model.js";

/** Counts for one source file. */
export interface SourceCounts {
  /** Every line, as `wc -l` counts them. */
  total: number;
  /** Lines with no token at all. */
  blank: number;
  /** Lines whose only tokens are comment trivia. */
  comment: number;
  /** Lines carrying at least one real token. */
  code: number;
  /** `eslint-disable` occurrences, which only ever live in comments. */
  disables: number;
  /** `x as Foo` and `<Foo>x` assertions, as AST nodes. */
  assertions: number;
  /** `x!` non-null assertions, as AST nodes. */
  nonNull: number;
  /** `any` type keywords, as AST nodes. */
  anyType: number;
  /** Exported names, counted one per name rather than per statement. */
  exports: number;
  /** `export * from "…"` statements, included in `exports` as one each. */
  starExports: number;
}

/**
 * What a line carries, in precedence order: code beats comment beats
 * blank.
 */
const enum LineKind {
  Blank = 0,
  Comment = 1,
  Code = 2,
}

/**
 * Offsets at which each line starts, for mapping a token position to a
 * line number without asking the compiler for a SourceFile.
 * @param text - the file's text
 * @returns one start offset per line
 */
function lineStarts(text: string): number[] {
  const starts = [ZERO];
  for (
    let at = text.indexOf("\n");
    at !== NOT_FOUND;
    at = text.indexOf("\n", at + ONE)
  ) {
    starts.push(at + ONE);
  }
  return starts;
}

/**
 * The line a byte offset falls on, by binary search over line starts.
 * @param starts - line start offsets
 * @param offset - a position in the file
 * @returns the zero-based line index
 */
function lineAt(starts: number[], offset: number): number {
  let low = ZERO;
  let high = starts.length - ONE;
  while (low < high) {
    const middle = Math.ceil((low + high) / HALF);
    if (starts[middle] <= offset) low = middle;
    else high = middle - ONE;
  }
  return low;
}

// Halving, for the binary search over line starts.
const HALF = 2;

/**
 * Every comment range in a file, from the PARSER's token stream.
 *
 * A raw `ts.createScanner` cannot be used here: standalone, it has no
 * way to tell `/` as division from `/` opening a regular expression,
 * and one wrong guess swallows the rest of the file — which silently
 * lost 14 of this repository's 25 `eslint-disable` comments when this
 * function was written that way. The parser resolves the ambiguity, so
 * comments are read as each token's leading trivia instead.
 * @param sourceFile - a parsed source file
 * @returns every comment range, in source order
 */
function commentRanges(sourceFile: ts.SourceFile): ts.CommentRange[] {
  const text = sourceFile.getFullText();
  const ranges: ts.CommentRange[] = [];
  const seen = new Set<number>();
  const collect = (found: ts.CommentRange[] | undefined): void => {
    for (const range of found ?? []) {
      if (seen.has(range.pos)) continue;
      seen.add(range.pos);
      ranges.push(range);
    }
  };
  eachToken(sourceFile, (token) => {
    // Leading trivia carries JSDoc and any comment on its own line;
    // TRAILING trivia carries the `code(); /* … */` case, which the
    // compiler attaches to the token BEFORE the comment.
    collect(ts.getLeadingCommentRanges(text, token.getFullStart()));
    collect(ts.getTrailingCommentRanges(text, token.getEnd()));
  });
  ranges.sort((left, right) => left.pos - right.pos);
  return ranges;
}

/**
 * Visit every leaf token of a parsed file, the end-of-file token
 * included — its leading trivia is where a file's last comment lives.
 * @param node - the node to walk
 * @param visit - called once per leaf token
 */
function eachToken(node: ts.Node, visit: (token: ts.Node) => void): void {
  // A node's JSDoc comment is one of its children. Walking into it
  // would mark the JSDoc's own lines as CODE; it is a comment, and it
  // is already reported as the node's leading trivia.
  if (
    node.kind >= ts.SyntaxKind.FirstJSDocNode &&
    node.kind <= ts.SyntaxKind.LastJSDocNode
  ) {
    return;
  }
  const children = node.getChildren();
  if (children.length === ZERO) {
    visit(node);
    return;
  }
  for (const child of children) eachToken(child, visit);
}

/**
 * Classify every line: CODE if any real token starts on or spans it,
 * COMMENT if its only tokens are comment trivia, BLANK otherwise.
 * @param sourceFile - a parsed source file
 * @returns one kind per line
 */
function classifyLines(sourceFile: ts.SourceFile): LineKind[] {
  const text = sourceFile.getFullText();
  const starts = lineStarts(text);
  const kinds: LineKind[] = Array.from(
    { length: starts.length },
    () => LineKind.Blank,
  );
  const mark = (from: number, to: number, kind: LineKind): void => {
    const last = lineAt(starts, Math.max(from, to - ONE));
    for (let line = lineAt(starts, from); line <= last; line += ONE) {
      if (kinds[line] < kind) kinds[line] = kind;
    }
  };
  for (const range of commentRanges(sourceFile)) {
    mark(range.pos, range.end, LineKind.Comment);
  }
  eachToken(sourceFile, (token) => {
    const from = token.getStart(sourceFile);
    const to = token.getEnd();
    if (to > from) mark(from, to, LineKind.Code);
  });
  // A trailing newline leaves a final empty line that `wc -l` does not
  // count; drop it so the total matches `wc -l` exactly.
  if (text.endsWith("\n")) kinds.pop();
  return kinds;
}

/**
 * Count `eslint-disable` comments — the escape hatch that lives in a
 * comment rather than in code.
 * @param sourceFile - a parsed source file
 * @returns how many comments mention it
 */
function countDisables(sourceFile: ts.SourceFile): number {
  const text = sourceFile.getFullText();
  let count = ZERO;
  for (const range of commentRanges(sourceFile)) {
    if (text.slice(range.pos, range.end).includes("eslint-disable")) {
      count += ONE;
    }
  }
  return count;
}

/**
 * How many names one exporting statement publishes.
 *
 * `export { a, b, c }` is three names, not one; `export const a = 1, b = 2`
 * is two; `export default …` is one; `export * from "…"` is one
 * (the count of names it re-exports is not knowable from this file).
 * @param node - a top-level statement
 * @returns the number of exported names, and whether it was a `*` re-export
 */
function exportedNames(node: ts.Node): { names: number; star: boolean } {
  if (ts.isExportDeclaration(node)) {
    const { exportClause: clause } = node;
    if (clause === undefined) return { names: ONE, star: true };
    if (ts.isNamedExports(clause)) {
      return { names: clause.elements.length, star: false };
    }
    // `export * as ns from "…"` — one name.
    return { names: ONE, star: false };
  }
  if (ts.isExportAssignment(node)) return { names: ONE, star: false };
  const modifiers = ts.canHaveModifiers(node)
    ? ts.getModifiers(node)
    : undefined;
  const exported =
    modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) === true;
  if (!exported) return { names: ZERO, star: false };
  if (ts.isVariableStatement(node)) {
    return { names: node.declarationList.declarations.length, star: false };
  }
  return { names: ONE, star: false };
}

/**
 * Is this `x as const`?
 *
 * Ruling 36: `as const` is not an escape hatch. It NARROWS a literal to
 * its own type and adds `readonly`; it can never widen a value into a
 * lie the way `x as Foo` can. Counting it would punish the safest
 * spelling of a lookup table.
 * @param node - an assertion node
 * @returns whether its asserted type is the `const` keyword
 */
function isConstAssertion(node: ts.AsExpression | ts.TypeAssertion): boolean {
  const { type } = node;
  return (
    ts.isTypeReferenceNode(type) &&
    ts.isIdentifier(type.typeName) &&
    type.typeName.text === "const"
  );
}

/**
 * Walk every node under a source file.
 * @param node - the node to walk
 * @param visit - called once per node
 */
function walkNodes(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => {
    walkNodes(child, visit);
  });
}

/**
 * Count lines and escape hatches in one TypeScript file.
 * @param fileName - the file's name, for the compiler's diagnostics
 * @param text - the file's text
 * @returns the counts
 */
export function scanSource(fileName: string, text: string): SourceCounts {
  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    // `getChildren()` and `getStart()` need the parent pointers.
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );
  const kinds = classifyLines(sourceFile);
  let blank = ZERO;
  let comment = ZERO;
  let code = ZERO;
  for (const kind of kinds) {
    if (kind === LineKind.Code) code += ONE;
    else if (kind === LineKind.Comment) comment += ONE;
    else blank += ONE;
  }

  let assertions = ZERO;
  let nonNull = ZERO;
  let anyType = ZERO;
  walkNodes(sourceFile, (node) => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      if (!isConstAssertion(node)) assertions += ONE;
    } else if (ts.isNonNullExpression(node)) {
      nonNull += ONE;
    } else if (node.kind === ts.SyntaxKind.AnyKeyword) {
      anyType += ONE;
    }
  });
  let exports = ZERO;
  let starExports = ZERO;
  for (const statement of sourceFile.statements) {
    const { names, star } = exportedNames(statement);
    exports += names;
    if (star) starExports += ONE;
  }

  return {
    total: kinds.length,
    blank,
    comment,
    code,
    disables: countDisables(sourceFile),
    assertions,
    nonNull,
    anyType,
    exports,
    starExports,
  };
}
