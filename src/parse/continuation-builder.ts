/**
 * Continuation-line logic for list item inline content.
 *
 * List items can span multiple lines. Lines that begin with
 * non-whitespace content are lexed in inline mode and produce
 * inlineLine CST nodes; indented continuation lines are lexed in
 * default mode and arrive here as whole-line IndentedLine tokens.
 * Those lines are ordinary paragraph text, so they are re-lexed
 * with the inline sub-lexer (see inline-fragment-lexer.ts) —
 * otherwise the same content would parse differently depending
 * on which line it sits on, making the formatted layout depend
 * on the input layout and breaking idempotency (issue #1).
 * Both token streams must be merged by source offset so that
 * buildFromTokens sees a single unified, offset-sorted stream.
 */
import type { CstNode, IToken } from "chevrotain";
import type { InlineNode } from "../ast.js";
import { LAST_ELEMENT, NEXT } from "../constants.js";
import { InlineNewline } from "./tokens.js";
import { buildFromTokens } from "./inline-node-builder.js";
import { lexContinuationRun } from "./inline-fragment-lexer.js";
import {
  flattenInlineTokens,
  mergeSortedTokens,
  unwrapInlineLines,
} from "./inline-tokens.js";

/**
 * Group IndentedLine tokens into runs of consecutive source
 * lines. Each run is sub-lexed as one fragment so inline
 * constructs spanning a line break match across it; a gap in
 * line numbers means an inline-mode line sits between the
 * indented lines, so the runs must be lexed separately.
 * @param indentedLineTokens - IndentedLine tokens in source
 *   order (each spans exactly one line).
 * @returns Runs of adjacent-line tokens, preserving order.
 */
function groupIntoRuns(indentedLineTokens: IToken[]): IToken[][] {
  const runs: IToken[][] = [];
  for (const token of indentedLineTokens) {
    const currentRun = runs.at(LAST_ELEMENT);
    const previous = currentRun?.at(LAST_ELEMENT);
    if (
      currentRun !== undefined &&
      previous?.startLine !== undefined &&
      token.startLine === previous.startLine + NEXT
    ) {
      currentRun.push(token);
    } else {
      runs.push([token]);
    }
  }
  return runs;
}

/**
 * Build InlineNode[] from inline lines plus default_mode
 * continuation tokens (IndentedLine, Newline from MANY3).
 * @param inlineLineNodes - CST nodes produced by the
 *   inline-mode grammar rule, one per continuation line
 *   lexed in inline mode. Each node wraps the sequence of
 *   inline tokens for that line.
 * @param inlineModeNewlineTokens - InlineNewline tokens
 *   emitted by the lexer's pop-mode rule at the end of
 *   each inline-mode line. These terminate inline mode;
 *   they are separate from defaultModeNewlineTokens
 *   because the two modes capture newlines independently.
 * @param indentedLineTokens - Whole-line tokens produced
 *   in default mode for plain continuation lines. Each
 *   token's image includes its leading whitespace, which
 *   is stripped during inline sub-lexing.
 * @param defaultModeNewlineTokens - Newline tokens
 *   captured in the default-mode MANY3 continuation
 *   loop. Kept separate from inlineModeNewlineTokens because
 *   the two lexer modes accumulate them independently;
 *   they are re-typed to InlineNewline before merging so
 *   buildFromTokens handles them uniformly.
 * @returns Offset-sorted InlineNode array ready for the
 *   printer; trailing newlines have been stripped by
 *   buildFromTokens.
 */
export function buildInlineNodesWithContinuation(
  inlineLineNodes: CstNode[],
  inlineModeNewlineTokens: IToken[],
  indentedLineTokens: IToken[],
  defaultModeNewlineTokens: IToken[],
): InlineNode[] {
  // Re-lex the continuation lines as inline content. Runs of
  // adjacent lines are lexed as one fragment; the resulting
  // tokens carry document-absolute positions and include
  // re-typed InlineNewline tokens for the line boundaries the
  // sub-lexer saw (a boundary consumed inside a multi-line
  // construct, e.g. `https://url[text` … `more]`, produces no
  // newline token — the construct's own token spans it).
  const runs = groupIntoRuns(indentedLineTokens);
  // Runs are in source order and lexContinuationRun returns
  // offset-sorted tokens, so the concatenation stays sorted.
  const sublexedTokens = runs.flatMap((run) => lexContinuationRun(run));

  // Newlines BETWEEN the lines of a run are already represented
  // in the sub-lexed stream (or consumed inside a multi-line
  // token). The default-mode Newline tokens at those offsets
  // must be dropped, or buildFromTokens would see each internal
  // line boundary twice.
  const isInternalToRun = (offset: number): boolean =>
    runs.some((run) => {
      const [first] = run;
      const last = run.at(LAST_ELEMENT);
      return (
        last?.endOffset !== undefined &&
        offset > first.startOffset &&
        offset < last.endOffset
      );
    });
  const survivingNewlines = defaultModeNewlineTokens.filter(
    (t) => !isInternalToRun(t.startOffset),
  );

  // buildFromTokens dispatches on tokenType, not on which
  // lexer mode produced the token. Default-mode Newline
  // tokens serve the same line-boundary role as InlineNewline
  // tokens, so we re-type them as InlineNewline here to get
  // uniform handling: accumulate as "\n", strip trailing
  // newlines at the end of the item, and skip the structural
  // newline that immediately follows a HardLineBreak.
  // Shallow copy is safe: Chevrotain tokens are value objects
  // with no nested mutable state.
  const convertedNewlines = survivingNewlines.map((t) => ({
    ...t,
    tokenType: InlineNewline,
  }));
  const allNewlines = mergeSortedTokens(
    inlineModeNewlineTokens,
    convertedNewlines,
  );

  // Phase 1: build the inline-mode portion of the stream.
  // unwrapInlineLines extracts the per-token CstNodes from
  // each inlineLine, then flattenInlineTokens turns those
  // CstNodes into ITokens and merges them with allNewlines
  // in one offset-sorted pass. The result contains all
  // tokens that came from inline-mode lines, newlines
  // included.
  const inlineStream = flattenInlineTokens(
    unwrapInlineLines(inlineLineNodes),
    allNewlines,
  );

  // Phase 2: merge the inline-mode stream with the sub-lexed
  // continuation-line tokens.
  const combined = mergeSortedTokens(inlineStream, sublexedTokens);

  return buildFromTokens(combined);
}
