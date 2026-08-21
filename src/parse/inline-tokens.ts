/**
 * CST → flat token stream conversion for inline content.
 *
 * Two export paths:
 *
 * 1. Rich inline tree: {@link flattenInlineTokens} produces the
 *    offset-sorted IToken stream of a `paragraphBody` CST node (the
 *    `paragraphBody` visitor calls it), which inline-node-builder turns
 *    into an InlineNode[] tree.
 *
 * 2. Flat text: {@link textLines} produces one synthetic IToken per
 *    source line whose `image` is the joined text. Used by callers
 *    (admonitions) that store their body as a plain string rather than
 *    an InlineNode[] tree.
 */
import type { CstNode, IToken } from "chevrotain";
import type { InlineTokenCstChildren } from "./cst-types.js";
import { EMPTY, NEXT } from "../constants.js";
import { InlineNewline } from "./tokens.js";
import { RawLine } from "./lines/tokens.js";

// The known property names on InlineTokenCstChildren, used
// to extract ITokens from each inlineToken CstNode without
// unsafe type assertions on Object.keys().
const INLINE_TOKEN_KEYS: ReadonlyArray<keyof InlineTokenCstChildren> = [
  "BoldMark",
  "ItalicMark",
  "MonoMark",
  "HighlightMark",
  "RoleAttribute",
  "AttributeReference",
  "BackslashEscape",
  "InlineMacro",
  "InlineUrl",
  "XrefShorthand",
  "InlineAnchor",
  "HardLineBreak",
  "InlineText",
  "InlineChar",
];

/**
 * Extract all ITokens from inlineToken CstNode children,
 * merge with the structural tokens, and return them sorted
 * by source offset. This produces the single interleaved
 * token stream that downstream inline processing expects.
 * @param inlineTokenNodes - CstNodes from the `inlineToken`
 *   grammar rule (each node wraps one matched alternative).
 * @param structural - the body's newline and raw-line tokens,
 *   already offset-sorted, captured outside the inlineToken nodes.
 * @returns Merged token array sorted by `startOffset`.
 */
export function flattenInlineTokens(
  inlineTokenNodes: CstNode[],
  structural: IToken[],
): IToken[] {
  // Collect inline tokens — already in source order because
  // CstNodes appear in parse order and each node contains
  // exactly one token from the OR alternatives.
  const inlineTokens: IToken[] = [];
  for (const node of inlineTokenNodes) {
    // Each CstNode's children is a record whose values are
    // IToken arrays — one per matched alternative in the
    // `inlineToken` grammar rule.
    const children = node.children as InlineTokenCstChildren;
    for (const key of INLINE_TOKEN_KEYS) {
      // eslint-disable-next-line @typescript-eslint/prefer-destructuring -- dynamic key access
      const tokenArray = children[key];
      if (tokenArray !== undefined) {
        for (const tok of tokenArray) {
          inlineTokens.push(tok);
        }
      }
    }
  }

  // Both arrays are sorted by startOffset. Merge them in
  // O(n) instead of the previous O(n log n) sort.
  return mergeSortedTokens(inlineTokens, structural);
}

/**
 * Merge two pre-sorted token arrays into one sorted array.
 * Uses a linear O(n) merge rather than concatenate-and-sort
 * O(n log n), which matters when inline content is large.
 *
 * **Precondition:** both inputs must already be ordered by
 * `startOffset`. Passing unsorted arrays produces incorrect
 * output silently — the merge has no way to detect it.
 * @param left - First sorted token array (inline content
 *   tokens extracted from CstNodes).
 * @param right - Second sorted token array (newline or
 *   raw-line tokens captured outside CstNodes).
 * @returns Single array containing all tokens from both
 *   inputs, sorted by `startOffset`.
 */
export function mergeSortedTokens(left: IToken[], right: IToken[]): IToken[] {
  // When one side is empty, return early. `left` is returned
  // as-is (no copy) because the caller already owns it and
  // the merge loop below never mutates it. `right` is spread
  // to ensure the caller receives a new array in both paths
  // (consistent ownership semantics).
  if (right.length === EMPTY) return left;
  if (left.length === EMPTY) return [...right];

  const merged: IToken[] = [];
  let leftIndex = EMPTY;
  let rightIndex = EMPTY;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex].startOffset <= right[rightIndex].startOffset) {
      merged.push(left[leftIndex]);
      leftIndex += NEXT;
    } else {
      merged.push(right[rightIndex]);
      rightIndex += NEXT;
    }
  }
  // Append remaining elements from whichever array isn't
  // exhausted.
  while (leftIndex < left.length) {
    merged.push(left[leftIndex]);
    leftIndex += NEXT;
  }
  while (rightIndex < right.length) {
    merged.push(right[rightIndex]);
    rightIndex += NEXT;
  }
  return merged;
}

/**
 * Join one source line's tokens into a synthetic token whose image is
 * the line's text and whose span runs from the first to the last.
 * @param lineTokens - the tokens of one non-empty line, in order
 * @returns the synthetic line token
 */
function joinLine(lineTokens: IToken[]): IToken {
  const [first] = lineTokens;
  // eslint-disable-next-line @typescript-eslint/prefer-destructuring -- dynamic last-element access
  const last = lineTokens[lineTokens.length - NEXT];
  return {
    ...first,
    image: lineTokens.map((t) => t.image).join(""),
    endOffset: last.endOffset,
    endLine: last.endLine,
    endColumn: last.endColumn,
  };
}

/**
 * One synthetic token per source line of a paragraph body, with the
 * line's text joined into `image`. A RawLine token is a line of its
 * own already and passes through as it is; inline tokens are grouped
 * at InlineNewline boundaries. Used by callers (admonitions) that
 * store their body as a plain string and re-emit it line by line.
 * @param tokens - a body's offset-sorted token stream
 * @returns one token per non-empty source line, in source order
 */
export function textLines(tokens: IToken[]): IToken[] {
  const lines: IToken[] = [];
  let current: IToken[] = [];
  const flush = (): void => {
    if (current.length > EMPTY) {
      lines.push(joinLine(current));
      current = [];
    }
  };
  for (const token of tokens) {
    if (token.tokenType === InlineNewline) {
      flush();
    } else if (token.tokenType === RawLine) {
      flush();
      lines.push(token);
    } else {
      current.push(token);
    }
  }
  flush();
  return lines;
}
