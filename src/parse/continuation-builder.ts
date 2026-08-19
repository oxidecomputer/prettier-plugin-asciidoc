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
 *
 * Before any sub-lexing, the item's raw line stream is split at
 * `+` list-continuation marker lines (issue #2): each segment
 * after a marker becomes a block attached to the item — a
 * paragraph, or a literal block when the segment starts with
 * indented lines (matching Asciidoctor, where indented content
 * after `+` is a literal block whose whitespace is significant
 * and must not be reflowed). The split runs on RAW tokens so
 * literal-block content keeps its exact indentation.
 */
import type { CstNode, IToken } from "chevrotain";
import type { BlockNode, InlineNode, ParagraphNode } from "../ast.js";
import {
  EMPTY,
  FIRST,
  FIRST_COLUMN,
  LAST_ELEMENT,
  NEXT,
  SINGLE,
} from "../constants.js";
import { IndentedLine, InlineNewline } from "./tokens.js";
import {
  collapseTrailingMarkerOnly,
  isMarkerLineText,
} from "./continuation-markers.js";
import { buildFromTokens } from "./inline-node-builder.js";
import { lexContinuationRun } from "./inline-fragment-lexer.js";
import { tokenStartLocation, tokenEndLocation } from "./positions.js";
import {
  flattenInlineTokens,
  mergeSortedTokens,
  unwrapInlineLines,
} from "./inline-tokens.js";

/**
 * The parsed content of a list item: the principal inline text
 * plus any blocks attached with `+` list continuation lines.
 */
export interface ListItemContent {
  /** Inline nodes for the item's principal text. */
  inlineChildren: InlineNode[];
  /**
   * Blocks attached to the item via `+` continuation lines, in
   * source order: paragraphs, or literal blocks for indented
   * content. Empty when the item has no continuations.
   */
  attachedBlocks: BlockNode[];
  /**
   * True when the item ends with a `+` line that has nothing
   * after it to attach. The printer re-emits the bare `+` line
   * verbatim: Asciidoctor attaches the NEXT block even across
   * a blank line, so preserving the byte keeps the rendered
   * output identical, while dropping or folding it into the
   * item text (the old behavior) changed the rendering.
   */
  danglingContinuation: boolean;
}

// A consumed continuation marker occupies two tokens in the
// stream: the `+` line itself and the newline that ends it.
const MARKER_TOKEN_SPAN = 2;

/**
 * Check whether the token at `index` is a `+` continuation
 * marker LINE: a flush-left `+` (trailing whitespace allowed —
 * Asciidoctor right-trims lines before matching, so `+ ` with
 * an invisible trailing space is still a marker) alone on its
 * line. Positional test only; whether it actually attaches
 * content is decided by the split loop.
 * @param tokens - The item's combined, offset-sorted raw token
 *   stream. All newline tokens have been re-typed to
 *   InlineNewline; IndentedLine tokens are still whole lines.
 * @param index - Index of the candidate token.
 * @returns True when the token is a `+` line.
 */
function isMarkerLine(tokens: IToken[], index: number): boolean {
  const { [index]: token } = tokens;
  if (
    !isMarkerLineText(token.image) ||
    token.startColumn !== FIRST_COLUMN ||
    token.tokenType === IndentedLine
  ) {
    return false;
  }
  // Alone on its line: a newline before it (the first line of
  // the item — no preceding newline — is the marker line's
  // text, never a continuation) and a newline or end-of-stream
  // after it.
  const previous = index > FIRST ? tokens[index - NEXT] : undefined;
  const next = index + NEXT < tokens.length ? tokens[index + NEXT] : undefined;
  return (
    previous?.tokenType === InlineNewline &&
    (next === undefined || next.tokenType === InlineNewline)
  );
}

/**
 * Check whether any non-newline token follows the `+` line at
 * `index` — i.e. whether there is content for the continuation
 * to attach.
 * @param tokens - The item's combined token stream.
 * @param index - Index of the candidate `+` token.
 * @returns True when attachable content follows.
 */
function hasAttachableContent(tokens: IToken[], index: number): boolean {
  for (
    let scan = index + MARKER_TOKEN_SPAN;
    scan < tokens.length;
    scan += NEXT
  ) {
    if (tokens[scan].tokenType !== InlineNewline) {
      return true;
    }
  }
  return false;
}

/** The result of splitting an item's stream at `+` markers. */
interface MarkerSplit {
  /**
   * At least one segment; the first is the principal text
   * (possibly empty), the rest are attached-block segments.
   */
  segments: IToken[][];
  /** True when a trailing `+` line had nothing to attach. */
  danglingContinuation: boolean;
}

/**
 * Split an item's token stream at `+` continuation markers.
 * The marker token and its surrounding newline tokens are
 * dropped; everything before the first marker is the
 * principal segment, and each span between markers is an
 * attached-block segment.
 *
 * Two Asciidoctor-fidelity rules:
 * - A `+` line DIRECTLY after a marker is content of the
 *   attached block, not a second marker (`+\n+\nAttached`
 *   attaches one paragraph whose text starts with `+`).
 *   Treating it as a marker would silently delete the `+`
 *   from the rendered document.
 * - A trailing `+` line with nothing after it attaches
 *   nothing; it is reported as a dangling continuation so
 *   the printer can re-emit it verbatim.
 * @param tokens - The item's combined, offset-sorted raw
 *   token stream (all newlines re-typed to InlineNewline).
 * @returns The segments plus the dangling-continuation flag.
 */
function splitAtContinuationMarkers(tokens: IToken[]): MarkerSplit {
  const segments: IToken[][] = [[]];
  let danglingContinuation = false;
  // Set right after a marker is consumed; the first content
  // token that follows is exempt from marker detection.
  let afterMarker = false;
  let index = FIRST;
  while (index < tokens.length) {
    const { [index]: token } = tokens;
    if (!afterMarker && isMarkerLine(tokens, index)) {
      const { [segments.length + LAST_ELEMENT]: current } = segments;
      // The newline before the marker ends the previous
      // segment either way; drop it along with the marker.
      if (current.at(LAST_ELEMENT)?.tokenType === InlineNewline) {
        current.pop();
      }
      if (hasAttachableContent(tokens, index)) {
        // Advancing by the marker's span also skips the
        // newline after the marker.
        segments.push([]);
        index += MARKER_TOKEN_SPAN;
        afterMarker = true;
      } else {
        // Trailing `+` line with nothing to attach: dangling;
        // the printer re-emits it from the flag.
        danglingContinuation = true;
        index += NEXT;
      }
      continue;
    }
    if (token.tokenType !== InlineNewline) {
      afterMarker = false;
    }
    segments[segments.length + LAST_ELEMENT].push(token);
    index += NEXT;
  }
  danglingContinuation =
    collapseTrailingMarkerOnly(segments, isMarkerOnlySegment) ||
    danglingContinuation;
  return { segments, danglingContinuation };
}

/**
 * Check whether an attached segment consists solely of a lone
 * `+` line (plus structural newline tokens) — i.e. carries no
 * real content to attach.
 * @param segment - The segment's raw tokens, or undefined for
 *   an out-of-range index.
 * @returns True when the segment is just a `+` line.
 */
function isMarkerOnlySegment(segment: IToken[] | undefined): boolean {
  if (segment === undefined) {
    return false;
  }
  const content = segment.filter((t) => t.tokenType !== InlineNewline);
  const [only] = content;
  return content.length === SINGLE && isMarkerLineText(only.image);
}

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
 * Replace the raw IndentedLine tokens in a segment with their
 * inline sub-lexed equivalents, dropping the default-mode
 * newline tokens that fall between the lines of a run (those
 * boundaries are already represented in the sub-lexed stream —
 * as re-typed InlineNewline tokens or consumed inside a
 * multi-line construct like `https://url[text` … `more]`).
 * @param segment - Raw segment tokens (inline tokens, newline
 *   tokens, and whole-line IndentedLine tokens).
 * @returns Offset-sorted inline token stream for
 *   buildFromTokens.
 */
function inlineTokensForSegment(segment: IToken[]): IToken[] {
  const indented = segment.filter((t) => t.tokenType === IndentedLine);
  if (indented.length === EMPTY) {
    return segment;
  }
  const runs = groupIntoRuns(indented);
  // Runs are in source order and lexContinuationRun returns
  // offset-sorted tokens, so the concatenation stays sorted.
  const sublexed = runs.flatMap((run) => lexContinuationRun(run));
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
  const surviving = segment.filter(
    (t) =>
      t.tokenType !== IndentedLine &&
      !(t.tokenType === InlineNewline && isInternalToRun(t.startOffset)),
  );
  return mergeSortedTokens(surviving, sublexed);
}

/**
 * Build the attached block(s) for one continuation segment.
 *
 * A segment beginning with indented lines yields a literal
 * block (form "indented") whose content keeps the exact source
 * lines — indentation is significant there, and reflowing it
 * into a paragraph (or re-indenting a tab as spaces) corrupts
 * the block and breaks idempotency. Any remaining tokens after
 * the indented run become an ordinary attached paragraph.
 * @param segment - Raw tokens between two continuation markers
 *   (or after the last marker), possibly with stray newline
 *   tokens at the edges.
 * @returns Zero, one, or two blocks for the item's `blocks`
 *   array.
 */
function buildAttachedBlocks(segment: IToken[]): BlockNode[] {
  // A continuation segment can contain no blank line, so its
  // FIRST line decides the whole segment: when it is indented,
  // Asciidoctor folds every line of the segment — flush lines
  // included, since the block's minimum indent is then 0 —
  // into one literal paragraph. A line counts as indented when
  // it starts with whitespace: either an IndentedLine token
  // (space indentation, one whole-line token) or an
  // inline-lexed line whose first token image starts with
  // whitespace (the IndentedLine pattern matches spaces only,
  // so a TAB-indented line arrives as an ordinary inline line
  // with the tab inside its first text token).
  const lines = splitIntoLines(segment);
  const firstLine = lines.at(FIRST);
  if (firstLine === undefined) {
    return [];
  }
  if (!startsWithWhitespace(firstLine)) {
    // The paragraph is the original token subsequence (real
    // newline tokens included) starting at the first line.
    const paragraph = buildAttachedParagraph(
      segment.slice(segment.indexOf(firstLine[FIRST])),
    );
    return paragraph === undefined ? [] : [paragraph];
  }
  const lineTokens = lines.flat();
  const [firstToken] = lineTokens;
  const lastToken = lineTokens.at(LAST_ELEMENT) ?? firstToken;
  return [
    {
      type: "delimitedBlock",
      variant: "literal",
      form: "indented",
      // Verbatim source lines: token images concatenate to the
      // exact line text, indentation included.
      content: lines
        .map((lineOfTokens) => lineOfTokens.map((t) => t.image).join(""))
        .join("\n"),
      position: {
        start: tokenStartLocation(firstToken),
        end: tokenEndLocation(lastToken),
      },
    },
  ];
}

/**
 * Split a segment's tokens into lines at InlineNewline
 * boundaries, dropping the newline tokens themselves and any
 * empty lines (e.g. the boundary right after the `+` marker).
 * @param segment - Raw tokens of one continuation segment.
 * @returns Arrays of tokens, one per non-empty source line.
 */
function splitIntoLines(segment: IToken[]): IToken[][] {
  const lines: IToken[][] = [[]];
  for (const token of segment) {
    if (token.tokenType === InlineNewline) {
      lines.push([]);
    } else {
      const { [lines.length + LAST_ELEMENT]: current } = lines;
      current.push(token);
    }
  }
  return lines.filter((lineOfTokens) => lineOfTokens.length > EMPTY);
}

/**
 * Check whether a line's text begins with whitespace — the
 * marker of literal (whitespace-significant) content.
 * @param lineOfTokens - The tokens of one source line.
 * @returns True when the line starts with a space or tab.
 */
function startsWithWhitespace(lineOfTokens: IToken[]): boolean {
  const [firstToken] = lineOfTokens;
  return (
    firstToken.tokenType === IndentedLine || /^[ \t]/v.test(firstToken.image)
  );
}

/**
 * Build a ParagraphNode from an attached-block token segment.
 * @param segment - Raw tokens of the paragraph portion of a
 *   continuation segment.
 * @returns The paragraph, or undefined when the segment has
 *   no content.
 */
function buildAttachedParagraph(segment: IToken[]): ParagraphNode | undefined {
  const children = buildFromTokens(inlineTokensForSegment(segment));
  if (children.length === EMPTY) {
    return undefined;
  }
  // Position from the first/last content tokens — edge
  // newline tokens are structural, not paragraph content.
  const content = segment.filter((t) => t.tokenType !== InlineNewline);
  const [firstToken] = content;
  const lastToken = content.at(LAST_ELEMENT) ?? firstToken;
  return {
    type: "paragraph",
    children,
    position: {
      start: tokenStartLocation(firstToken),
      end: tokenEndLocation(lastToken),
    },
  };
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
 *   is preserved for literal blocks and stripped during
 *   inline sub-lexing for paragraph content.
 * @param defaultModeNewlineTokens - Newline tokens
 *   captured in the default-mode MANY3 continuation
 *   loop. Kept separate from inlineModeNewlineTokens because
 *   the two lexer modes accumulate them independently;
 *   they are re-typed to InlineNewline before merging so
 *   buildFromTokens handles them uniformly.
 * @returns The item's principal inline children (trailing
 *   newlines stripped by buildFromTokens), blocks attached
 *   via `+` continuation lines, and whether a dangling
 *   trailing `+` line must be re-emitted.
 */
export function buildInlineNodesWithContinuation(
  inlineLineNodes: CstNode[],
  inlineModeNewlineTokens: IToken[],
  indentedLineTokens: IToken[],
  defaultModeNewlineTokens: IToken[],
): ListItemContent {
  // buildFromTokens dispatches on tokenType, not on which
  // lexer mode produced the token. Default-mode Newline
  // tokens serve the same line-boundary role as InlineNewline
  // tokens, so we re-type them as InlineNewline here to get
  // uniform handling: accumulate as "\n", strip trailing
  // newlines at the end of the item, and skip the structural
  // newline that immediately follows a HardLineBreak.
  // Shallow copy is safe: Chevrotain tokens are value objects
  // with no nested mutable state.
  const convertedNewlines = defaultModeNewlineTokens.map((t) => ({
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
  // in one offset-sorted pass.
  const inlineStream = flattenInlineTokens(
    unwrapInlineLines(inlineLineNodes),
    allNewlines,
  );

  // Phase 2: merge in the RAW IndentedLine tokens so the
  // marker split sees the item's full line structure with
  // indentation intact (needed to build literal blocks).
  const combined = mergeSortedTokens(inlineStream, indentedLineTokens);

  // Phase 3: split at `+` continuation markers, then sub-lex
  // each segment's indented runs. Sub-lexing happens per
  // segment — after the split — so a literal block keeps its
  // raw lines while paragraph content gets inline parsing.
  const { segments, danglingContinuation } =
    splitAtContinuationMarkers(combined);
  const [principal, ...attachedSegments] = segments;

  return {
    inlineChildren: buildFromTokens(inlineTokensForSegment(principal)),
    attachedBlocks: attachedSegments.flatMap((segment) =>
      buildAttachedBlocks(segment),
    ),
    danglingContinuation,
  };
}
