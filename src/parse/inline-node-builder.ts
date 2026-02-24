/**
 * Flat token stream → InlineNode[] builder.
 *
 * Takes the merged, sorted token stream from inline-tokens.ts
 * and pairs formatting marks into nested spans. Dispatches
 * atomic tokens (links, macros) through a map-based dispatch
 * table.
 */
import type { CstNode, IToken, TokenType } from "chevrotain";
import type {
  InlineNode,
  InlineMacroNode,
  TextNode,
  BoldNode,
  ItalicNode,
  MonospaceNode,
  HighlightNode,
  AttributeReferenceNode,
} from "../ast.js";
import { tokenStartLocation, tokenEndLocation } from "./positions.js";
import { DELIM_WIDTH, EMPTY, FIRST, NEXT, NOT_FOUND } from "../constants.js";
import { unreachable } from "../unreachable.js";
import {
  AttributeReference,
  BoldMark,
  HardLineBreak,
  HighlightMark,
  InlineAnchor,
  InlineMacro,
  InlineNewline,
  InlineUrl,
  ItalicMark,
  MonoMark,
  RoleAttribute,
  XrefShorthand,
} from "./tokens.js";
import {
  makeLinkFromUrl,
  makeXrefFromShorthand,
  makeInlineAnchor,
  makeHardLineBreak,
} from "./inline-link-builder.js";
import { flattenInlineTokens, unwrapInlineLines } from "./inline-tokens.js";

// Map from mark token type to AST node type. Uses token type
// identity (not string name) for type-safe dispatch.
const MARK_TO_TYPE = new Map<
  TokenType,
  "bold" | "italic" | "monospace" | "highlight"
>([
  [BoldMark, "bold"],
  [ItalicMark, "italic"],
  [MonoMark, "monospace"],
  [HighlightMark, "highlight"],
]);

// Set of mark token types for fast membership testing.
const MARK_TOKEN_TYPES = new Set(MARK_TO_TYPE.keys());

/**
 * Scan forward for a matching close mark of the same token
 * type and image length (constrained vs. unconstrained).
 *
 * AsciiDoc formatting marks come in pairs (e.g. `*bold*`).
 * This greedy forward scan finds the nearest close mark that
 * matches the open mark's type and constraint level, enabling
 * the builder to extract the inner content for recursion.
 * @param tokens - The flat token stream being processed.
 * @param openIndex - Position of the open mark to match.
 * @returns Index of the matching close mark, or NOT_FOUND
 *   (-1) if none is found.
 */
function findCloseMark(tokens: IToken[], openIndex: number): number {
  // eslint-disable-next-line @typescript-eslint/prefer-destructuring -- indexed array access
  const openToken = tokens[openIndex];
  const {
    tokenType: openType,
    image: { length: markLength },
  } = openToken;

  for (
    let scanIndex = openIndex + NEXT;
    scanIndex < tokens.length;
    scanIndex += NEXT
  ) {
    // eslint-disable-next-line @typescript-eslint/prefer-destructuring -- indexed array access
    const candidate = tokens[scanIndex];
    // Identity comparison — same token type object and same
    // image length (single vs double mark).
    if (
      candidate.tokenType === openType &&
      candidate.image.length === markLength
    ) {
      return scanIndex;
    }
  }
  return NOT_FOUND;
}

/**
 * Build a TextNode from accumulated pending text.
 *
 * Adjacent non-structural tokens are coalesced into a single
 * text run. The position spans from the first contributing
 * token to the last, preserving source locations for the
 * printer's whitespace decisions.
 * @param value - The concatenated text content.
 * @param first - First token that contributed to this text.
 * @param last - Last token that contributed to this text.
 * @returns A TextNode with the coalesced value and spanning
 *   position.
 */
function makeTextNode(value: string, first: IToken, last: IToken): TextNode {
  return {
    type: "text",
    value,
    position: {
      start: tokenStartLocation(first),
      end: tokenEndLocation(last),
    },
  };
}

// Parameters for makeFormattingNode.
interface FormattingNodeOptions {
  markTokenType: TokenType;
  constrained: boolean;
  children: InlineNode[];
  openMark: IToken;
  closeMark: IToken;
}

/**
 * Create a formatting AST node (bold, italic, monospace, or
 * highlight without a role).
 *
 * A single factory for all four formatting types avoids
 * duplicating the shared position/constrained/children
 * logic. The switch on the resolved type name ensures each
 * variant gets the correct discriminant for the AST union.
 * @param options - Mark type, constraint level, children,
 *   and the open/close mark tokens for position tracking.
 * @returns The typed formatting node for the AST.
 */
function makeFormattingNode(
  options: FormattingNodeOptions,
): BoldNode | ItalicNode | MonospaceNode | HighlightNode {
  const { markTokenType, constrained, children, openMark, closeMark } = options;
  const type = MARK_TO_TYPE.get(markTokenType);
  const position = {
    start: tokenStartLocation(openMark),
    end: tokenEndLocation(closeMark),
  };
  const base = { constrained, children, position };
  switch (type) {
    case "bold": {
      return { type, ...base };
    }
    case "italic": {
      return { type, ...base };
    }
    case "monospace": {
      return { type, ...base };
    }
    case "highlight": {
      return { type, role: undefined, ...base };
    }
    case undefined: {
      return unreachable(`Unknown mark token: ${markTokenType.name}`);
    }
  }
}

/**
 * Build an AttributeReferenceNode from a `{name}` token.
 *
 * Attribute references are resolved at render time by
 * Asciidoctor, so the AST preserves them verbatim. The
 * curly braces are stripped to extract just the attribute
 * name for the AST node.
 * @param token - The `{name}` token from the lexer.
 * @returns An AttributeReferenceNode with the extracted
 *   attribute name and source position.
 */
function makeAttributeReference(token: IToken): AttributeReferenceNode {
  return {
    type: "attributeReference",
    name: token.image.slice(DELIM_WIDTH, -DELIM_WIDTH),
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

/**
 * State passed to {@link handleRoleAttribute} so it can
 * scan ahead for a highlight mark pair and emit the
 * appropriate inline node. Groups the token stream,
 * current position, and the text/node accumulation
 * callbacks that the main loop owns.
 */
interface RoleAttributeContext {
  /** The full flat token stream being processed. */
  tokens: IToken[];
  /** Current position in the token stream. */
  index: number;
  /** The RoleAttribute token at the current position. */
  token: IToken;
  /** Flush any accumulated plain text as a TextNode. */
  flushText: () => void;
  /** Append text to the pending plain-text accumulator. */
  accumulate: (token: IToken, text: string) => void;
  /** Output list of inline nodes built so far. */
  nodes: InlineNode[];
}

/**
 * Handle a RoleAttribute token (`[.role]`).
 *
 * In AsciiDoc, a role attribute immediately before a
 * highlight mark (`#...#`) creates a custom-styled span.
 * If the next token is a highlight mark with a matching
 * close, this emits a HighlightNode with the role. If no
 * pairing is found, the role token falls through as plain
 * text — it may be an unresolved or misplaced attribute.
 * @param context - The current token stream state and
 *   accumulator callbacks.
 * @returns The next token index to resume processing from.
 */
function handleRoleAttribute(context: RoleAttributeContext): number {
  const { tokens, index, token, flushText, accumulate, nodes } = context;
  const { image: roleImage } = token;
  const roleText = roleImage.slice(DELIM_WIDTH, -DELIM_WIDTH);
  const nextIndex = index + NEXT;

  if (
    nextIndex < tokens.length &&
    tokens[nextIndex].tokenType === HighlightMark
  ) {
    const closeIndex = findCloseMark(tokens, nextIndex);
    if (closeIndex !== NOT_FOUND) {
      flushText();
      // eslint-disable-next-line @typescript-eslint/prefer-destructuring -- indexed array access
      const openMark = tokens[nextIndex];
      // eslint-disable-next-line @typescript-eslint/prefer-destructuring -- indexed array access
      const closeMark = tokens[closeIndex];
      const innerTokens = tokens.slice(nextIndex + NEXT, closeIndex);
      const children = buildFromTokens(innerTokens);
      const constrained = openMark.image.length === DELIM_WIDTH;
      const highlightNode: HighlightNode = {
        type: "highlight",
        constrained,
        role: roleText,
        children,
        position: {
          start: tokenStartLocation(token),
          end: tokenEndLocation(closeMark),
        },
      };
      nodes.push(highlightNode);
      return closeIndex + NEXT;
    }
  }

  // No matching highlight — treat as text.
  accumulate(token, token.image);
  return index + NEXT;
}

/**
 * Try to pair a formatting mark with its close.
 *
 * Extracts the tokens between the open and close marks,
 * recursively builds their InlineNode children, and wraps
 * them in the appropriate formatting node. Returns
 * undefined when no matching close mark exists, signaling
 * the caller to fall through to plain text accumulation.
 * @param tokens - The flat token stream being processed.
 * @param index - Position of the open formatting mark.
 * @param token - The open mark token itself.
 * @returns The built node and next index, or undefined if
 *   no matching close mark was found.
 */
function handleFormattingMark(
  tokens: IToken[],
  index: number,
  token: IToken,
): { node: InlineNode; nextIndex: number } | undefined {
  // Find a close mark that is not immediately adjacent to the
  // open mark. An adjacent close would create an empty
  // formatting span (e.g. `____` tokenized as `__` + `__`)
  // which has no content and crashes the printer. Skipping
  // adjacent matches lets the tokens between them become
  // content, matching Asciidoctor's behavior where `_____`
  // is italic wrapping a literal `_`.
  let closeIndex = findCloseMark(tokens, index);
  while (closeIndex !== NOT_FOUND) {
    const innerTokens = tokens.slice(index + NEXT, closeIndex);
    if (innerTokens.length > EMPTY) break;
    closeIndex = findCloseMark(tokens, closeIndex);
  }
  if (closeIndex === NOT_FOUND) return undefined;

  const innerTokens = tokens.slice(index + NEXT, closeIndex);
  const children = buildFromTokens(innerTokens);
  const constrained = token.image.length === DELIM_WIDTH;
  // eslint-disable-next-line @typescript-eslint/prefer-destructuring -- indexed array access
  const closeMark = tokens[closeIndex];
  return {
    node: makeFormattingNode({
      markTokenType: token.tokenType,
      constrained,
      children,
      openMark: token,
      closeMark,
    }),
    nextIndex: closeIndex + NEXT,
  };
}

/**
 * Dispatch paired formatting marks (bold, italic, etc.).
 *
 * Acts as a gate: only tokens whose type is in the
 * MARK_TOKEN_TYPES set are forwarded to
 * handleFormattingMark. All other token types pass through
 * as undefined, letting the main loop try the next
 * dispatch category (atomic tokens, then plain text).
 * @param tokens - The flat token stream being processed.
 * @param index - Current position in the token stream.
 * @param token - The token at the current position.
 * @param tokenType - The token's Chevrotain type (passed
 *   separately to avoid redundant property access in the
 *   hot loop).
 * @returns The built node and next index, or undefined if
 *   the token is not a formatting mark or has no close.
 */
function dispatchPairedToken(
  tokens: IToken[],
  index: number,
  token: IToken,
  tokenType: TokenType,
): { node: InlineNode; nextIndex: number } | undefined {
  if (MARK_TOKEN_TYPES.has(tokenType)) {
    return handleFormattingMark(tokens, index, token);
  }
  return undefined;
}

/**
 * Build an InlineMacroNode from a unified `InlineMacro` token.
 *
 * Splits the token image at the first `:` (name) and first `[`
 * (target vs attrlist boundary). All `name:target[attrlist]`
 * inline macros share this same structure, so one builder
 * replaces the previous ten per-macro factories.
 * @param token - The InlineMacro token from the lexer.
 * @returns An InlineMacroNode with name, target, and attrlist.
 */
function makeInlineMacro(token: IToken): InlineMacroNode {
  const colonIndex = token.image.indexOf(":");
  const bracketIndex = token.image.indexOf("[");
  return {
    type: "inlineMacro",
    name: token.image.slice(EMPTY, colonIndex),
    target: token.image.slice(colonIndex + NEXT, bracketIndex),
    attrlist: token.image.slice(bracketIndex + NEXT, -NEXT),
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

// Map from token type to factory function for atomic
// (single-token) inline nodes. Uses token type identity
// for type-safe dispatch, avoiding a long if/else chain.
type AtomicFactory = (token: IToken) => InlineNode;
const ATOMIC_DISPATCH = new Map<TokenType, AtomicFactory>([
  [AttributeReference, makeAttributeReference],
  [InlineMacro, makeInlineMacro],
  [InlineUrl, makeLinkFromUrl],
  [XrefShorthand, makeXrefFromShorthand],
  [InlineAnchor, makeInlineAnchor],
  [HardLineBreak, makeHardLineBreak],
]);

/**
 * Dispatch an atomic (single-token) inline node through
 * the ATOMIC_DISPATCH map.
 *
 * Atomic tokens represent self-contained constructs like
 * links, xrefs, macros, and attribute references. Each
 * maps to a dedicated factory function. Returns undefined
 * for unrecognized token types, signaling the caller to
 * fall through to plain text accumulation.
 * @param token - The token to dispatch.
 * @returns The built InlineNode, or undefined if the
 *   token type has no registered factory.
 */
function handleAtomicToken(token: IToken): InlineNode | undefined {
  const factory = ATOMIC_DISPATCH.get(token.tokenType);
  return factory === undefined ? undefined : factory(token);
}

/**
 * After a hard line break (`+`), skip the structural
 * InlineNewline that follows.
 *
 * A hard line break token is always followed by a newline
 * in the source, but the HardLineBreakNode already
 * represents that break. Without this skip, the newline
 * would be double-counted as both a break and a `\n` text
 * node.
 * @param node - The node just built (checked for type).
 * @param tokens - The token stream being processed.
 * @param index - Current position after the hard break.
 * @returns The index to resume from — advanced by one if
 *   a newline was skipped, unchanged otherwise.
 */
function skipNewlineAfterHardBreak(
  node: InlineNode,
  tokens: IToken[],
  index: number,
): number {
  const isHardBreakFollowedByNewline =
    node.type === "hardLineBreak" &&
    index < tokens.length &&
    tokens[index].tokenType === InlineNewline;
  return isHardBreakFollowedByNewline ? index + NEXT : index;
}

/**
 * Walk the flat, sorted token stream and build
 * InlineNode[].
 *
 * Formatting marks are paired greedily: each open mark
 * scans forward for the nearest matching close of the same
 * type and length, then the content between them is
 * recursively built. Tokens that don't match any
 * structural category are coalesced into text runs.
 *
 * The function delegates to handler functions that each
 * own one token category (role highlights, formatting
 * marks, atomic macros/links, plain text).
 * @param allTokens - Flat, offset-sorted token stream
 *   from the inline lexer.
 * @returns The built array of InlineNode AST nodes.
 */
export function buildFromTokens(allTokens: IToken[]): InlineNode[] {
  // Strip trailing InlineNewline — it's a structural
  // separator (paragraph boundary), not inline content.
  // Only between-line newlines should become \n text.
  const { length: tokenCount } = allTokens;
  let end = tokenCount;
  while (end > EMPTY && allTokens[end - NEXT].tokenType === InlineNewline) {
    end -= NEXT;
  }
  const tokens = end < tokenCount ? allTokens.slice(FIRST, end) : allTokens;

  const nodes: InlineNode[] = [];
  let pendingText = "";
  let pendingStart: IToken | undefined = undefined;
  let pendingEnd: IToken | undefined = undefined;
  let index = EMPTY;

  /** Flush accumulated plain text into a TextNode. */
  function flushText(): void {
    if (
      pendingText.length > EMPTY &&
      pendingStart !== undefined &&
      pendingEnd !== undefined
    ) {
      nodes.push(makeTextNode(pendingText, pendingStart, pendingEnd));
      pendingText = "";
      pendingStart = undefined;
      pendingEnd = undefined;
    }
  }

  /**
   * Accumulate a token's text into the pending run.
   *
   * `text` may differ from `token.image` for newlines,
   * which are normalized to `\n` regardless of source image.
   * @param token - Source token (used for position
   *   tracking).
   * @param text - The text to append.
   */
  function accumulate(token: IToken, text: string): void {
    pendingStart ??= token;
    pendingEnd = token;
    pendingText += text;
  }

  while (index < tokens.length) {
    // eslint-disable-next-line @typescript-eslint/prefer-destructuring -- indexed array access
    const token = tokens[index];
    const { tokenType } = token;

    // Dispatch to category-specific handlers.
    if (tokenType === RoleAttribute) {
      index = handleRoleAttribute({
        tokens,
        index,
        token,
        flushText,
        accumulate,
        nodes,
      });
      continue;
    }

    // Paired tokens: constrained passthrough (+...+) and
    // formatting marks (*...*  _..._ `...` #...#). Dispatch
    // to the appropriate handler; fall through as plain text
    // if no matching close mark is found.
    const pairedResult = dispatchPairedToken(tokens, index, token, tokenType);
    if (pairedResult !== undefined) {
      flushText();
      const { node, nextIndex } = pairedResult;
      nodes.push(node);
      index = nextIndex;
      continue;
    }

    // Atomic single-token nodes: attribute references,
    // links, xrefs, inline anchors, macros.
    const atomicNode = handleAtomicToken(token);
    if (atomicNode !== undefined) {
      flushText();
      nodes.push(atomicNode);
      index += NEXT;
      // After a hard line break, skip the structural
      // InlineNewline that follows — the HardLineBreakNode
      // already represents the line break.
      index = skipNewlineAfterHardBreak(atomicNode, tokens, index);
      continue;
    }

    // InlineNewline → \n, everything else → literal image.
    accumulate(token, tokenType === InlineNewline ? "\n" : token.image);
    index += NEXT;
  }

  flushText();
  return nodes;
}

/**
 * Build InlineNode[] from the inlineToken CST nodes
 * produced by the Chevrotain parser's inline mode.
 *
 * This is the primary entry point for inline content that
 * comes directly from the parser (e.g. paragraph bodies).
 * It flattens and sorts the CST tokens before delegating
 * to the core builder.
 * @param inlineTokenNodes - CST nodes from the parser's
 *   `inlineToken` rule, each wrapping one or more tokens.
 * @param inlineModeNewlineTokens - InlineNewline tokens
 *   captured separately by the parser, merged in to
 *   preserve line break positions.
 * @returns The built array of InlineNode AST nodes.
 */
export function buildInlineNodes(
  inlineTokenNodes: CstNode[],
  inlineModeNewlineTokens: IToken[],
): InlineNode[] {
  const tokens = flattenInlineTokens(inlineTokenNodes, inlineModeNewlineTokens);
  return buildFromTokens(tokens);
}

/**
 * Build InlineNode[] from `inlineLine` CST subrule nodes.
 *
 * Each inlineLine CstNode wraps InlineModeStart +
 * inlineToken children into a single node. This unwraps
 * them before delegating to buildInlineNodes. Used by
 * block-level constructs (section titles, list items)
 * where the parser groups inline content per source line.
 * @param inlineLineNodes - CST nodes from the parser's
 *   `inlineLine` subrule, one per source line.
 * @param inlineModeNewlineTokens - InlineNewline tokens
 *   captured separately, merged in to preserve line
 *   break positions.
 * @returns The built array of InlineNode AST nodes.
 */
export function buildInlineNodesFromLines(
  inlineLineNodes: CstNode[],
  inlineModeNewlineTokens: IToken[],
): InlineNode[] {
  return buildInlineNodes(
    unwrapInlineLines(inlineLineNodes),
    inlineModeNewlineTokens,
  );
}
