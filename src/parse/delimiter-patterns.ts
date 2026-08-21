/* eslint-disable require-unicode-regexp -- Chevrotain's regexp-to-ast does not support the v flag */

/**
 * Custom Chevrotain token pattern matchers for block delimiters.
 *
 * AsciiDoc requires closing delimiters to be the same character
 * AND the same length as the opening delimiter. A `----` must not
 * close a `------` block. These custom pattern matchers look back
 * through the token array to find the matching open delimiter and
 * compare lengths.
 */
import type {
  CustomPatternMatcherFunc,
  CustomPatternMatcherReturn,
  IToken,
} from "chevrotain";
import { EMPTY, MIN_DELIMITER_LENGTH, NEXT } from "../constants.js";

/**
 * Build a custom Chevrotain token pattern that only matches a
 * closing delimiter when its length equals the corresponding
 * opening delimiter.
 * @param delimiterChar - The repeated character that forms this
 *   delimiter family (e.g. `"-"` for listing blocks, `"."` for
 *   literal blocks). Used to construct the matching regex.
 * @param openTokenName - Token type name of the corresponding
 *   open delimiter (e.g. `"ListingBlockOpen"`). The lexer walks
 *   backwards through already-matched tokens to find the most
 *   recent unmatched open and reads its length, enforcing the
 *   AsciiDoc rule that close length must equal open length.
 * @returns An object whose `exec` method Chevrotain calls on
 *   each candidate position. Returns the matched delimiter string
 *   when it is anchored at `offset` and its length matches the
 *   open delimiter; returns `null` otherwise.
 */
export function makeClosePattern(
  delimiterChar: string,
  openTokenName: string,
): { exec: CustomPatternMatcherFunc } {
  // The negative lookahead (?![^\n]) ensures the delimiter
  // must be the entire line content (followed by newline or
  // EOF). Without this, `....x` inside a `....`-delimited
  // literal block would match `....` as a close delimiter,
  // leaving `x` as stray text — breaking idempotency. Trailing
  // spaces are consumed because the reader rstrips every line
  // before the parser sees it (see ListingBlockOpen); the length
  // comparison below trims them back off.
  const regex = new RegExp(
    `\\${delimiterChar}{${MIN_DELIMITER_LENGTH},}[ \\t]*(?![^\\n])`,
  );

  return {
    exec: (
      text: string,
      offset: number,
      tokens: IToken[],
      _groups: Record<string, IToken[]>,
    ): CustomPatternMatcherReturn | null => {
      const match = regex.exec(text.slice(offset));
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null for no-match
      if (match?.index !== EMPTY) return null;

      // Walk backwards through all previously lexed tokens
      // to find the most recent open delimiter for this block
      // type. The tokens array is shared across all modes.
      // findLast suffices: non-nestable block delimiters
      // can't appear inside themselves, so the last match
      // is the close.
      const openToken = tokens.findLast(
        (token) => token.tokenType.name === openTokenName,
      );
      const openLength = openToken?.image.trimEnd().length ?? EMPTY;

      const [matched] = match;
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null for no-match
      if (matched.trimEnd().length !== openLength) return null;

      const result: CustomPatternMatcherReturn = [matched];
      return result;
    },
  };
}

/**
 * Like {@link makeClosePattern} but for nestable parent
 * blocks (e.g. example, sidebar). Tracks nesting depth so
 * inner blocks with different delimiter lengths don't
 * prematurely close outer blocks.
 * @param delimiterChar - The repeated character that forms this
 *   delimiter family (e.g. `"="` for example blocks, `"_"` for
 *   sidebar blocks). Used to construct the matching regex.
 * @param openTokenName - Token type name of the corresponding
 *   open delimiter. The lexer walks backwards skipping any
 *   already-closed inner blocks to find the unmatched open whose
 *   length must equal the candidate close.
 * @param closeTokenName - Token type name of the closing
 *   delimiter for this block type. Needed to count nesting depth
 *   while scanning backwards, so inner closes don't confuse the
 *   search for our open.
 * @returns An object whose `exec` method Chevrotain calls on
 *   each candidate position. Returns the matched delimiter string
 *   when it is anchored at `offset`, depth-aware length-matching
 *   succeeds, and the lengths are equal; returns `null` otherwise.
 */
export function makeParentClosePattern(
  delimiterChar: string,
  openTokenName: string,
  closeTokenName: string,
): { exec: CustomPatternMatcherFunc } {
  // Trailing spaces are consumed and trimmed back off for the
  // length comparison — see makeClosePattern.
  const regex = new RegExp(
    `\\${delimiterChar}{${MIN_DELIMITER_LENGTH},}[ \\t]*(?![^\\n])`,
  );

  return {
    exec: (
      text: string,
      offset: number,
      tokens: IToken[],
      _groups: Record<string, IToken[]>,
    ): CustomPatternMatcherReturn | null => {
      const match = regex.exec(text.slice(offset));
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null for no-match
      if (match?.index !== EMPTY) return null;

      // Walk backwards through all previously lexed tokens.
      // Track nesting: each close we encounter means one more
      // open we need to skip before finding our target open.
      let depth = EMPTY;
      let openLength = EMPTY;
      for (let index = tokens.length - NEXT; index >= EMPTY; index -= NEXT) {
        // eslint-disable-next-line @typescript-eslint/prefer-destructuring -- variable index
        const {
          tokenType: { name: tokenName },
          image,
        } = tokens[index];
        if (tokenName === closeTokenName) {
          depth += NEXT;
        } else if (tokenName === openTokenName) {
          if (depth === EMPTY) {
            // This open has no matching close -- it's ours.
            ({ length: openLength } = image.trimEnd());
            break;
          }
          depth -= NEXT;
        }
      }

      const [matched] = match;
      // eslint-disable-next-line unicorn/no-null -- Chevrotain requires null for no-match
      if (matched.trimEnd().length !== openLength) return null;

      const result: CustomPatternMatcherReturn = [matched];
      return result;
    },
  };
}
