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
import {
  DEFENSE_MARKERS,
  NOT_FOUND,
  ONE,
  UNREACHABLE_CALLEE,
  ZERO,
  type MarkerKey,
} from "./model.js";

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
  /** `unreachable(…)` calls, as AST call expressions. */
  unreachableCalls: number;
  /** Defense-marker OCCURRENCES in comment trivia, one per mention. */
  markers: Record<MarkerKey, number>;
  /**
   * Markers that read as a marker only once the comment's line breaks
   * are collapsed — i.e. wrapped, and therefore uncounted. One
   * `line: marker` string each. See {@link nearMissesIn}.
   */
  markerNearMisses: string[];
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
 * How many times one string occurs in another, non-overlapping.
 *
 * OCCURRENCES, not comments-that-mention (which is what
 * {@link countDisables} counts): two `Valid only when` fields
 * documented in one JSDoc block are two defended fields, and a
 * scorecard that reported one would understate the burden by exactly
 * the amount that grouping the comments saved.
 * @param text - the text to search
 * @param marker - the substring to count
 * @returns how many times it occurs
 */
function occurrencesIn(text: string, marker: string): number {
  let count = ZERO;
  for (
    let at = text.indexOf(marker);
    at !== NOT_FOUND;
    at = text.indexOf(marker, at + marker.length)
  ) {
    count += ONE;
  }
  return count;
}

/**
 * Count each defense marker across a file's comments.
 *
 * Written out one field at a time rather than looped over
 * `Object.keys`: keys come back as `string`, and narrowing them to
 * `MarkerKey` would need the `as` assertion this scorecard counts.
 * @param sourceFile - a parsed source file
 * @returns occurrences per marker
 */
function countMarkers(sourceFile: ts.SourceFile): Record<MarkerKey, number> {
  const text = sourceFile.getFullText();
  const comments = commentRanges(sourceFile).map((range) =>
    text.slice(range.pos, range.end),
  );
  const occurrences = (marker: string): number => {
    let count = ZERO;
    for (const comment of comments) count += occurrencesIn(comment, marker);
    return count;
  };
  return {
    callerContract: occurrences(DEFENSE_MARKERS.callerContract),
    totalFallback: occurrences(DEFENSE_MARKERS.totalFallback),
    validOnlyWhen: occurrences(DEFENSE_MARKERS.validOnlyWhen),
  };
}

// A comment's line break plus whatever the continuation line opens
// with — leading whitespace and either a JSDoc asterisk or a second
// `//`. This is what turns one sentence into two lines.
const COMMENT_WRAP = /\n[ \t]*(?:\*|\/\/)?[ \t]*/gv;

// Nothing but whitespace, with exactly one newline: what sits between
// two `//` lines of ONE logical comment, and not between two comments
// a blank line apart.
const ADJACENT = /^[ \t]*\n[ \t]*$/v;

// `at()`'s last-element index.
const LAST_RANGE = -1;

/**
 * Markers that a line wrap has made invisible to {@link countMarkers}.
 *
 * The counting hazard this closes is one-directional and therefore
 * silent: the ratchet fires on RISE, so a marker that STOPS being
 * counted reads as progress. Prettier does not reflow comments, but a
 * human rewrapping one at 80 columns can split `Valid only when` across
 * two lines, and the defense then vanishes from the inventory with a
 * green build.
 *
 * Detection is a comparison, not a second pattern: count the marker in
 * the comment as written, then again with every line break collapsed to
 * a single space. A marker that only appears in the collapsed text is
 * wrapped. On this repository's `src` the two counts agree everywhere,
 * so the check has no false positives to tolerate — and it needs no
 * upkeep when a marker is added to {@link DEFENSE_MARKERS}.
 * @param comment - one logical comment's text, delimiters included
 * @param marker - the marker to look for
 * @returns whether the comment holds a wrapped, uncounted marker
 */
function hasWrappedMarker(comment: string, marker: string): boolean {
  const collapsed = comment.replaceAll(COMMENT_WRAP, " ");
  return occurrencesIn(collapsed, marker) > occurrencesIn(comment, marker);
}

/**
 * One logical comment: the line it starts on, and its whole text.
 *
 * A run of `//` lines is ONE comment to a reader and N ranges to the
 * compiler, and a wrap turns `// Total fallback: why` into `// Total`
 * plus `// fallback: why` — two ranges, neither holding the marker.
 * Grouping them is not a refinement: without it the detector cannot see
 * a wrap in a `//` comment at all, which is where 8 of this
 * repository's 11 `Total fallback:` markers live.
 */
interface LogicalComment {
  /** One-based line the group starts on. */
  readonly line: number;
  /** Every range's text, rejoined by the newlines that separated them. */
  readonly text: string;
}

/**
 * Group a file's comment ranges into logical comments: consecutive
 * single-line comments separated by nothing but one newline become one.
 * @param sourceFile - a parsed source file
 * @param starts - line start offsets for that file
 * @returns one entry per logical comment, in source order
 */
function logicalComments(
  sourceFile: ts.SourceFile,
  starts: number[],
): LogicalComment[] {
  const text = sourceFile.getFullText();
  const groups: LogicalComment[] = [];
  let previousEnd = ZERO;
  let previousWasLine = false;
  for (const range of commentRanges(sourceFile)) {
    const body = text.slice(range.pos, range.end);
    const isLine = range.kind === ts.SyntaxKind.SingleLineCommentTrivia;
    const last = groups.at(LAST_RANGE);
    if (
      isLine &&
      previousWasLine &&
      last !== undefined &&
      ADJACENT.test(text.slice(previousEnd, range.pos))
    ) {
      groups[groups.length - ONE] = {
        line: last.line,
        text: `${last.text}\n${body}`,
      };
    } else {
      groups.push({ line: lineAt(starts, range.pos) + ONE, text: body });
    }
    const { end } = range;
    previousEnd = end;
    previousWasLine = isLine;
  }
  return groups;
}

/**
 * Every wrapped marker in a file, as `line: marker`.
 *
 * The line is the logical comment's FIRST line, which is where a reader
 * has to start looking; the wrap itself is one or two lines below it.
 * @param sourceFile - a parsed source file
 * @param starts - line start offsets for that file
 * @returns one string per wrapped marker, in source order
 */
function nearMissesIn(sourceFile: ts.SourceFile, starts: number[]): string[] {
  const found: string[] = [];
  for (const { line, text } of logicalComments(sourceFile, starts)) {
    for (const marker of Object.values(DEFENSE_MARKERS)) {
      if (hasWrappedMarker(text, marker)) {
        found.push(`${String(line)}: ${marker}`);
      }
    }
  }
  return found;
}

/**
 * Is this a call to `unreachable`?
 *
 * Matched as a CALL EXPRESSION whose callee is that identifier, which
 * is what separates a thrown guard from the one comment under `src`
 * that merely names the function while explaining why a nearby site is
 * a silent strip instead (Ruling 34).
 * @param node - any node
 * @returns whether it is such a call
 */
function isUnreachableCall(node: ts.Node): boolean {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === UNREACHABLE_CALLEE
  );
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
  let unreachableCalls = ZERO;
  walkNodes(sourceFile, (node) => {
    if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
      if (!isConstAssertion(node)) assertions += ONE;
    } else if (ts.isNonNullExpression(node)) {
      nonNull += ONE;
    } else if (node.kind === ts.SyntaxKind.AnyKeyword) {
      anyType += ONE;
    } else if (isUnreachableCall(node)) {
      unreachableCalls += ONE;
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
    unreachableCalls,
    markers: countMarkers(sourceFile),
    markerNearMisses: nearMissesIn(sourceFile, lineStarts(text)),
  };
}
