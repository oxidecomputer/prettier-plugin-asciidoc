// Token position helpers for converting Chevrotain's IToken
// positions into the Location type used by our AST.
//
// Extracted from ast-builder.ts because multiple modules need
// these helpers — having them in a shared module avoids
// duplication.
import type { IToken } from "chevrotain";
import type { Location } from "../ast.js";
import { FIRST, FIRST_COLUMN, FIRST_LINE, LAST_ELEMENT } from "../constants.js";
// Chevrotain's endOffset and endColumn are both inclusive (pointing
// at the last character). Our AST uses exclusive end positions
// throughout: offset follows Prettier's locEnd convention, and
// column is kept consistent with offset so callers don't need to
// track two different conventions.
const ONE_PAST_END = 1;

/**
 * Assemble a Location from raw coordinates. Centralising
 * construction here insulates callers from the field names and
 * makes it easy to grep for every place a Location is created.
 * @param offset - Zero-based character offset from the very start
 *   of the document source (not a substring offset).
 * @param line - One-based line number.
 * @param column - One-based column number.
 * @returns A Location value ready to embed directly in an AST node.
 */
export function makeLocation(
  offset: number,
  line: number,
  column: number,
): Location {
  return { offset, line, column };
}

/**
 * Build a Location for the start of a Chevrotain token.
 * Chevrotain makes startLine and startColumn nullable to support
 * error-recovery scenarios where a synthetic token may have no
 * valid position. Recovery is enabled (see grammar.ts), but every
 * token the parser sees is cut from real source by the BlockReader
 * or the inline lexer and is fully positioned, and the corpus gate
 * in tests/parser/reader.test.ts asserts zero parser errors — so the
 * fallback defaults (line 1, column 1) are reachable only if the
 * reader ever emitted a stream the grammar could not parse.
 * @param token - Any token produced by our lexer.
 * @returns Location at the token's first character, using
 *   document-absolute coordinates.
 */
export function tokenStartLocation(token: IToken): Location {
  return makeLocation(
    token.startOffset,
    token.startLine ?? FIRST_LINE,
    token.startColumn ?? FIRST_COLUMN,
  );
}

/**
 * Build a Location for the exclusive end of a Chevrotain token.
 * Both endOffset and endColumn are inclusive in Chevrotain (they
 * point at the last character). We add 1 to each: the offset
 * adjustment satisfies Prettier's locEnd convention; the column
 * adjustment keeps it consistent so callers always work with
 * exclusive end positions regardless of which field they use.
 * @param token - Any token produced by our lexer.
 * @returns Location one past the token's last character, using
 *   document-absolute coordinates.
 */
export function tokenEndLocation(token: IToken): Location {
  return makeLocation(
    (token.endOffset ?? FIRST) + ONE_PAST_END,
    // endLine needs no adjustment: the exclusive end is on
    // the same line, one column past endColumn.
    token.endLine ?? FIRST_LINE,
    (token.endColumn ?? FIRST_COLUMN) + ONE_PAST_END,
  );
}

/**
 * Compute the document's end position from source text.
 * Can't use the last token because trailing whitespace and the final
 * newline are consumed while reading but never emitted as a token.
 * @param text - The complete document source (not a substring).
 * @returns Location at the exclusive end of the source:
 *   offset = text.length, line = number of lines,
 *   column = one past the last character on the final line.
 */
export function computeEnd(text: string): Location {
  const lines = text.split("\n");
  const lastLine = lines.at(LAST_ELEMENT) ?? "";
  return makeLocation(
    text.length,
    lines.length,
    lastLine.length + ONE_PAST_END,
  );
}
