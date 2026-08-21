/**
 * Builds the reader's `IToken[]` pieces: whole-line tokens,
 * zero-length boundary tokens, and inline tokens for a run of
 * paragraph text lexed by the existing inline lexer and REBASED to
 * document coordinates.
 *
 * Rebasing is exact because a fragment is a verbatim source substring
 * that starts either at a line start or mid-line after a marker or an
 * admonition label — so only its FIRST line's columns shift, and every
 * later line of the fragment is a whole document line whose columns are
 * already document columns.
 */
import { createTokenInstance, type IToken, type TokenType } from "chevrotain";
import {
  FIRST,
  FIRST_COLUMN,
  FIRST_LINE,
  LAST_ELEMENT,
} from "../../constants.js";
import { HardLineBreak, InlineText, inlineLexer } from "../tokens.js";
import type { SourceLine } from "./split.js";

/**
 * A whole-line (or part-of-line) token carrying the RAW source slice.
 * @param type - the token type to build
 * @param line - the source line the token comes from
 * @param from - raw start column index, 0-based (default: the line start)
 * @param to - raw end column index, exclusive (default: the line end)
 * @returns a token whose image is exactly `line.raw.slice(from, to)`
 */
export function lineToken(
  type: TokenType,
  line: SourceLine,
  from = FIRST,
  to = line.raw.length,
): IToken {
  const image = line.raw.slice(from, to);
  const start = line.offset + from;
  return createTokenInstance(
    type,
    image,
    start,
    // Chevrotain's endOffset is INCLUSIVE, so a zero-length token
    // (a blank verbatim line) ends one before it starts.
    start + image.length + LAST_ELEMENT,
    line.line,
    line.line,
    from + FIRST_COLUMN,
    from + image.length,
  );
}

/**
 * A zero-length boundary token, sitting where the boundary falls.
 * @param type - the token type to build
 * @param offset - document offset of the boundary
 * @param line - 1-based line of the boundary
 * @param column - 1-based column of the boundary
 * @returns a token with an empty image and an inclusive end one before
 *   its start
 */
export function boundaryToken(
  type: TokenType,
  offset: number,
  line: number,
  column: number,
): IToken {
  return createTokenInstance(
    type,
    "",
    offset,
    offset + LAST_ELEMENT,
    line,
    line,
    column,
    column + LAST_ELEMENT,
  );
}

/** A run of paragraph text to lex as inline content. */
export interface InlineFragment {
  /** Document offset of the fragment's first character. */
  readonly start: number;
  /**
   * Document offset just past its last character: the offset of the
   * run's trailing newline, or the document length.
   */
  readonly end: number;
  /** 1-based line of `start`. */
  readonly line: number;
  /** 1-based column of `start`; 1 when the fragment starts a line. */
  readonly column: number;
}

// The `??` arms below are unreachable in practice: the fragment lexer
// runs with full position tracking, so every token is fully positioned
// (the same convention as src/parse/positions.ts).
/**
 * Move one token's position from fragment coordinates to document ones.
 * @param token - one token from the fragment lexer
 * @param fragment - where the fragment sits in the document
 * @returns the token's document-absolute position fields
 */
function rebase(
  token: IToken,
  fragment: InlineFragment,
): Pick<
  IToken,
  | "startOffset"
  | "endOffset"
  | "startLine"
  | "endLine"
  | "startColumn"
  | "endColumn"
> {
  const startLine = token.startLine ?? FIRST_LINE;
  const endLine = token.endLine ?? FIRST_LINE;
  const startColumn = token.startColumn ?? FIRST_COLUMN;
  const endColumn = token.endColumn ?? FIRST_COLUMN;
  // Only the fragment's FIRST line is offset from a document line
  // start; every later line of the fragment IS a document line, so its
  // columns are already document columns.
  const shift = fragment.column - FIRST_COLUMN;
  return {
    startOffset: fragment.start + token.startOffset,
    endOffset: fragment.start + (token.endOffset ?? token.startOffset),
    startLine: fragment.line + startLine - FIRST_LINE,
    endLine: fragment.line + endLine - FIRST_LINE,
    startColumn: startLine === FIRST_LINE ? startColumn + shift : startColumn,
    endColumn: endLine === FIRST_LINE ? endColumn + shift : endColumn,
  };
}

/** What the reader decided about a fragment before it is lexed. */
export interface FragmentOptions {
  /**
   * 1-based document line whose ` +` is LITERAL text, not a hard line
   * break — the reader's literal-plus rule (paragraph-reader.ts): the
   * inline lexer cannot see the list marker line or the paragraph's
   * common indent, so the reader tells it.
   */
  readonly literalPlusLine?: number;
}

/**
 * Lex a fragment of paragraph text as inline content and rebase every
 * token to document coordinates.
 *
 * The document's newline AT `fragment.end` is included in the lexed
 * text when it is really there, so a trailing ` +` lexes as a hard
 * break exactly as it would mid-document and every token's image is
 * still a verbatim source slice. At EOF without a final newline nothing
 * is appended: the main lexer sees none there either, so ` +` is plain
 * text — inventing a newline would give a token an image the source
 * does not contain and break the position invariant.
 * @param source - the whole document
 * @param fragment - where the run sits in the document
 * @param options - what the reader decided about the fragment
 * @returns inline tokens with document-absolute positions
 */
export function lexInlineFragment(
  source: string,
  fragment: InlineFragment,
  options: FragmentOptions = {},
): IToken[] {
  const { start, end } = fragment;
  const newline = source[end] === "\n" ? "\n" : "";
  const { tokens } = inlineLexer.tokenize(
    `${source.slice(start, end)}${newline}`,
  );
  return tokens.map((token) => {
    const placed = { ...token, ...rebase(token, fragment) };
    return placed.tokenType === HardLineBreak &&
      placed.startLine === options.literalPlusLine
      ? {
          ...placed,
          tokenType: InlineText,
          tokenTypeIdx: InlineText.tokenTypeIdx ?? placed.tokenTypeIdx,
        }
      : placed;
  });
}
