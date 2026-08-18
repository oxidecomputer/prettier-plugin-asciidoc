/* eslint-disable require-unicode-regexp -- Chevrotain's regexp-to-ast does not support the v flag */

/**
 * Inline sub-lexing for list-item continuation lines.
 *
 * The main lexer tokenizes any line that starts with whitespace
 * as a single IndentedLine token in default mode — necessary for
 * literal paragraphs, but wrong for list items, where an indented
 * line is ordinary paragraph text that merely continues the item.
 * Without inline tokenization, a link (or any other inline
 * construct) parses differently depending on which line of the
 * item it happens to sit on, so formatting is not a function of
 * content and the output oscillates between layouts (issue #1).
 *
 * This module re-lexes runs of continuation lines with the same
 * inline token set (and the same priority order) as the main
 * lexer's inline mode, then maps the resulting token positions
 * back to document coordinates. Consecutive lines are lexed as
 * one fragment joined with newlines — not line by line — because
 * bracketed constructs (`https://url[text...]`) can legitimately
 * span a line break, and the main lexer matches them across `\n`
 * when they start on an inline-mode line. Line-by-line lexing
 * would reintroduce the layout dependence this module removes.
 */
import { createToken, Lexer, type IToken } from "chevrotain";
import {
  EMPTY,
  FIRST_COLUMN,
  FIRST_LINE,
  LAST_ELEMENT,
  NEWLINE_LENGTH,
} from "../constants.js";
import { InlineNewline, inlineModeTokens } from "./tokens.js";

// A plain newline token for fragment lexing. The real inline
// mode's InlineNewline pops the lexer's mode stack; a fragment
// lexer has no pushed mode to pop, so we substitute a plain
// token in its slot and re-type matches to InlineNewline after
// lexing so downstream token dispatch is unchanged.
const FragmentNewline = createToken({
  name: "FragmentNewline",
  pattern: /\n/,
  line_breaks: true,
});

// Single-mode lexer over the inline token set. The array is
// derived from inlineModeTokens (not hand-copied) so the
// fragment lexer can never drift out of sync with the main
// lexer's inline mode ordering.
const fragmentTokens = inlineModeTokens.map((tokenType) =>
  tokenType === InlineNewline ? FragmentNewline : tokenType,
);
// Offset-only tracking: source line/column are reconstructed
// from the original IndentedLine tokens during mapping, so the
// fragment's own line/column bookkeeping would be discarded.
const fragmentLexer = new Lexer(fragmentTokens, {
  positionTracking: "onlyOffset",
});

// One entry per continuation line: where the line's trimmed
// content starts inside the joined fragment, and how to map
// fragment offsets back to document coordinates.
interface FragmentSegment {
  /** Fragment offset of the line's first content character. */
  fragStart: number;
  /**
   * Fragment offset of the `\n` that follows the line (equals
   * the fragment length for the final line, which has no
   * trailing newline).
   */
  fragEnd: number;
  /** The IndentedLine token this segment came from. */
  token: IToken;
  /** Leading whitespace stripped from the token's image. */
  indent: number;
}

// Document-absolute coordinates for one fragment offset.
interface MappedPosition {
  offset: number;
  line: number;
  column: number;
}

/**
 * Map a fragment offset to document-absolute coordinates using
 * the segment table. Offsets inside a line map linearly (shifted
 * by the line's stripped indent); the offset of a joining `\n`
 * maps to the document's newline character after that line.
 * @param segments - Segment table built from the run's
 *   IndentedLine tokens, ordered by fragment offset.
 * @param fragmentOffset - Offset into the joined fragment text.
 * @returns Document-absolute offset, line, and column for the
 *   fragment offset.
 */
function mapFragmentOffset(
  segments: FragmentSegment[],
  fragmentOffset: number,
): MappedPosition {
  // Linear scan is fine: continuation runs are a handful of
  // lines, and each token does at most two lookups.
  let { [segments.length + LAST_ELEMENT]: match } = segments;
  for (const segment of segments) {
    if (fragmentOffset <= segment.fragEnd) {
      match = segment;
      break;
    }
  }
  const { token, indent, fragStart, fragEnd } = match;
  // The ?? arms are unreachable in practice: lexer error
  // recovery is disabled, so real tokens are always fully
  // positioned (same convention as positions.ts).
  const line = token.startLine ?? FIRST_LINE;
  const startColumn = token.startColumn ?? FIRST_COLUMN;
  if (fragmentOffset === fragEnd) {
    // The joining `\n` itself: in the document it sits right
    // after the line's last character.
    return {
      offset: token.startOffset + token.image.length,
      line,
      column: startColumn + token.image.length,
    };
  }
  const delta = fragmentOffset - fragStart;
  return {
    offset: token.startOffset + indent + delta,
    line,
    column: startColumn + indent + delta,
  };
}

/**
 * Re-lex a run of consecutive IndentedLine continuation tokens
 * as inline content. The lines' trimmed content is joined with
 * newlines and tokenized in one pass so multi-line inline
 * constructs match exactly as they would on inline-mode lines.
 * @param run - Consecutive IndentedLine tokens (adjacent source
 *   lines, in order). Must be non-empty.
 * @returns Inline tokens with document-absolute positions.
 *   Newline tokens are re-typed to InlineNewline so the caller
 *   can merge them into the ordinary inline stream. Note that a
 *   token spanning a line break has an image without the
 *   following line's indentation, so its image length may be
 *   smaller than its source span — the printer normalizes such
 *   newlines away, so the discrepancy never reaches the output.
 */
export function lexContinuationRun(run: IToken[]): IToken[] {
  const segments: FragmentSegment[] = [];
  let fragmentLength = EMPTY;
  const pieces: string[] = [];
  for (const token of run) {
    const trimmed = token.image.trimStart();
    if (segments.length > EMPTY) {
      // Account for the joining "\n" between lines.
      fragmentLength += NEWLINE_LENGTH;
    }
    segments.push({
      fragStart: fragmentLength,
      fragEnd: fragmentLength + trimmed.length,
      token,
      indent: token.image.length - trimmed.length,
    });
    fragmentLength += trimmed.length;
    pieces.push(trimmed);
  }
  // A sentinel newline terminates the fragment. In the document,
  // the run's last line is followed by a newline (IndentedLine
  // cannot match `\n`, so a line break always separates it from
  // whatever comes next); without the sentinel, a trailing
  // ` +` on the run's last line would lex as plain text while
  // the same content on the marker line lexes as HardLineBreak —
  // reintroducing the layout dependence this module exists to
  // remove. The sole exception is a document ending exactly at
  // the run's last character with no final newline; the sentinel
  // then anticipates the newline that Prettier's output contract
  // appends anyway.
  const sentinelOffset = fragmentLength;
  const fragment = `${pieces.join("\n")}\n`;

  // The token set ends in a single-character catch-all
  // (InlineChar) plus FragmentNewline for `\n`, so every
  // character matches some token and lexing cannot error.
  const { tokens } = fragmentLexer.tokenize(fragment);

  return (
    tokens
      // Drop the sentinel newline when it survives as its own
      // token: the line boundary after the run is already
      // represented in the caller's stream (by a default-mode
      // Newline or the pop InlineNewline). When a HardLineBreak
      // consumed the sentinel instead, that token stays — the
      // break is real content.
      .filter(
        (token) =>
          !(
            token.tokenType === FragmentNewline &&
            token.startOffset === sentinelOffset
          ),
      )
      .map((token) => {
        const start = mapFragmentOffset(segments, token.startOffset);
        // The fragment lexer runs with positionTracking
        // "onlyOffset", which populates ONLY startOffset —
        // token.endOffset does not exist in that mode. Compute
        // the inclusive end from the image instead; this is
        // exact in fragment coordinates because the image is
        // sliced verbatim from the fragment text.
        const inclusiveEnd =
          token.startOffset + token.image.length + LAST_ELEMENT;
        const end = mapFragmentOffset(segments, inclusiveEnd);
        return {
          ...token,
          tokenType:
            token.tokenType === FragmentNewline
              ? InlineNewline
              : token.tokenType,
          startOffset: start.offset,
          startLine: start.line,
          startColumn: start.column,
          endOffset: end.offset,
          endLine: end.line,
          endColumn: end.column,
        };
      })
  );
}
