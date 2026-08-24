/**
 * Flat token stream → InlineNode[] builder.
 *
 * Takes the merged, sorted inline token stream of one paragraph
 * body and pairs formatting marks into nested spans. Dispatches
 * atomic tokens (links, macros) through a map-based dispatch
 * table.
 *
 * A token carries only its bytes and its document offset, so line
 * and column come from the document's one location index, handed in
 * as `at`.
 */
import type {
  InlineNode,
  InlineMacroNode,
  RawLineNode,
  TextNode,
  BoldNode,
  ItalicNode,
  MonospaceNode,
  HighlightNode,
  AttributeReferenceNode,
} from "../../ast.js";
import type { Fragment, LocationIndex } from "../positions.js";
import { DELIM_WIDTH } from "../../constants.js";
import { unreachable } from "../../unreachable.js";
import type { InlineToken, InlineTokenType } from "./tokens.js";
import {
  makeLinkFromUrl,
  makeXrefFromShorthand,
  makeInlineAnchor,
  makeHardLineBreak,
} from "./inline-link-builder.js";

// Map from mark token kind to AST node type.
const MARK_TO_TYPE = new Map<
  InlineTokenType,
  "bold" | "italic" | "monospace" | "highlight"
>([
  ["BoldMark", "bold"],
  ["ItalicMark", "italic"],
  ["MonoMark", "monospace"],
  ["HighlightMark", "highlight"],
]);

// Set of mark token kinds for fast membership testing.
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
 * @returns Index of the matching close mark, or -1 if none
 *   is found.
 */
function findCloseMark(
  tokens: readonly InlineToken[],
  openIndex: number,
): number {
  const openToken = tokens[openIndex];
  const {
    type: openType,
    image: { length: markLength },
  } = openToken;

  for (
    let scanIndex = openIndex + 1;
    scanIndex < tokens.length;
    scanIndex += 1
  ) {
    const candidate = tokens[scanIndex];
    // Same kind and same image length (single vs double mark).
    if (candidate.type === openType && candidate.image.length === markLength) {
      return scanIndex;
    }
  }
  return -1;
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
 * @param at - The document's location index.
 * @returns A TextNode with the coalesced value and spanning
 *   position.
 */
function makeTextNode(
  value: string,
  first: Fragment,
  last: Fragment,
  at: LocationIndex,
): TextNode {
  return {
    type: "text",
    value,
    position: { start: at.start(first), end: at.end(last) },
  };
}

// Parameters for makeFormattingNode.
interface FormattingNodeOptions {
  markType: InlineTokenType;
  constrained: boolean;
  children: InlineNode[];
  openMark: Fragment;
  closeMark: Fragment;
  at: LocationIndex;
}

/**
 * Create a formatting AST node (bold, italic, monospace, or
 * highlight without a role).
 *
 * A single factory for all four formatting types avoids
 * duplicating the shared position/constrained/children
 * logic. The switch on the resolved type name ensures each
 * variant gets the correct discriminant for the AST union: the
 * four arms look identical because a spread with a UNION-typed
 * `type` does not narrow to a union member, so each member needs
 * its own literal — a TypeScript price, not a drifting spelling.
 * @param options - Mark type, constraint level, children,
 *   and the open/close mark tokens for position tracking.
 * @returns The typed formatting node for the AST.
 */
function makeFormattingNode(
  options: FormattingNodeOptions,
): BoldNode | ItalicNode | MonospaceNode | HighlightNode {
  const { markType, constrained, children, openMark, closeMark, at } = options;
  const type = MARK_TO_TYPE.get(markType);
  const position = { start: at.start(openMark), end: at.end(closeMark) };
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
      // MARK_TO_TYPE above and the tokenizer's mark rules in
      // `inline/rules.ts` are two lists of the same four kinds. Only
      // this guard says they have to agree.
      return unreachable(`Unknown mark token: ${markType}`);
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
 * @param fragment - The `{name}` token's span.
 * @param at - The document's location index.
 * @returns An AttributeReferenceNode with the extracted
 *   attribute name and source position.
 */
function makeAttributeReference(
  fragment: Fragment,
  at: LocationIndex,
): AttributeReferenceNode {
  return {
    type: "attributeReference",
    name: fragment.image.slice(DELIM_WIDTH, -DELIM_WIDTH),
    position: { start: at.start(fragment), end: at.end(fragment) },
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
  tokens: readonly InlineToken[];
  /** Current position in the token stream. */
  index: number;
  /** The RoleAttribute token at the current position. */
  token: InlineToken;
  /** Flush any accumulated plain text as a TextNode. */
  flushText: () => void;
  /** Append text to the pending plain-text accumulator. */
  accumulate: (token: InlineToken, text: string) => void;
  /** Output list of inline nodes built so far. */
  nodes: InlineNode[];
  /** The document's location index. */
  at: LocationIndex;
}

/**
 * Handle a RoleAttribute token (`[.role]`).
 *
 * A role attribute immediately before a highlight mark
 * (`#...#`) creates a custom-styled span. If no pairing is
 * found, the role token falls through as plain text — it may be
 * an unresolved or misplaced attribute.
 *
 * The HighlightNode is built HERE rather than through
 * {@link makeFormattingNode} even though the pair-and-recurse
 * shape matches: this literal spells the keys `type, constrained,
 * role, children, position`, the factory's highlight arm spells
 * `type, role, constrained, children, position`, and serialization
 * order is a contract — unifying them would move keys on every
 * `[.role]#x#` document.
 * @param context - The current token stream state and
 *   accumulator callbacks.
 * @returns The next token index to resume processing from.
 */
function handleRoleAttribute(context: RoleAttributeContext): number {
  const { tokens, index, token, flushText, accumulate, nodes, at } = context;
  const { image: roleImage } = token;
  const roleText = roleImage.slice(DELIM_WIDTH, -DELIM_WIDTH);
  const nextIndex = index + 1;

  if (nextIndex < tokens.length && tokens[nextIndex].type === "HighlightMark") {
    const closeIndex = findCloseMark(tokens, nextIndex);
    if (closeIndex !== -1) {
      flushText();
      const openMark = tokens[nextIndex];
      const closeMark = tokens[closeIndex];
      const innerTokens = tokens.slice(nextIndex + 1, closeIndex);
      const children = buildFromTokens(innerTokens, at);
      const constrained = openMark.image.length === DELIM_WIDTH;
      const highlightNode: HighlightNode = {
        type: "highlight",
        constrained,
        role: roleText,
        children,
        position: { start: at.start(token), end: at.end(closeMark) },
      };
      nodes.push(highlightNode);
      return closeIndex + 1;
    }
  }

  // No matching highlight — treat as text.
  accumulate(token, token.image);
  return index + 1;
}

/**
 * Try to pair a formatting mark with its close.
 *
 * MARK_TOKEN_TYPES is the gate and it lives HERE, with the pairing
 * it guards: extracts the tokens between the open and close marks,
 * recursively builds their InlineNode children, and wraps them in
 * the appropriate formatting node. Returns undefined for a token
 * that is not a formatting mark at all and for one with no matching
 * close, both of which send the caller on to plain-text
 * accumulation.
 * @param tokens - The flat token stream being processed.
 * @param index - Position of the open formatting mark.
 * @param token - The token at the current position; its own `type`
 *   is the gate.
 * @param at - The document's location index.
 * @returns The built node and next index, or undefined if the token
 *   is not a formatting mark or has no close.
 */
function handleFormattingMark(
  tokens: readonly InlineToken[],
  index: number,
  token: InlineToken,
  at: LocationIndex,
): { node: InlineNode; nextIndex: number } | undefined {
  if (!MARK_TOKEN_TYPES.has(token.type)) return undefined;
  // Find a close mark that is not immediately adjacent to the
  // open mark. An adjacent close would create an empty
  // formatting span (e.g. `____` tokenized as `__` + `__`)
  // which has no content and crashes the printer. Skipping
  // adjacent matches lets the tokens between them become
  // content, matching Asciidoctor's behavior where `_____`
  // is italic wrapping a literal `_`.
  //
  // This is the ZERO-INNER-TOKENS shape only. A span whose children
  // are all WHITESPACE has tokens, so it is built and reaches the
  // printer's own empty-span bail (appendSpan, src/print-inline.ts),
  // which the whitespace-only `_# #_` fires and this loop never
  // sees. Neither guard subsumes the other; both are live.
  let closeIndex = findCloseMark(tokens, index);
  while (closeIndex !== -1) {
    const innerTokens = tokens.slice(index + 1, closeIndex);
    if (innerTokens.length > 0) break;
    closeIndex = findCloseMark(tokens, closeIndex);
  }
  if (closeIndex === -1) return undefined;

  const innerTokens = tokens.slice(index + 1, closeIndex);
  const children = buildFromTokens(innerTokens, at);
  const constrained = token.image.length === DELIM_WIDTH;
  const closeMark = tokens[closeIndex];
  return {
    node: makeFormattingNode({
      markType: token.type,
      constrained,
      children,
      openMark: token,
      closeMark,
      at,
    }),
    nextIndex: closeIndex + 1,
  };
}

/**
 * Build an InlineMacroNode from a unified `InlineMacro` token.
 *
 * Splits the token image at the first `:` (name) and first `[`
 * (target vs attrlist boundary). All `name:target[attrlist]`
 * inline macros share this same structure, so one builder
 * replaces the previous ten per-macro factories.
 * @param fragment - The InlineMacro token's span.
 * @param at - The document's location index.
 * @returns An InlineMacroNode with name, target, and attrlist.
 */
function makeInlineMacro(
  fragment: Fragment,
  at: LocationIndex,
): InlineMacroNode {
  const colonIndex = fragment.image.indexOf(":");
  const bracketIndex = fragment.image.indexOf("[");
  return {
    type: "inlineMacro",
    name: fragment.image.slice(0, colonIndex),
    target: fragment.image.slice(colonIndex + 1, bracketIndex),
    attrlist: fragment.image.slice(bracketIndex + 1, -1),
    position: { start: at.start(fragment), end: at.end(fragment) },
  };
}

// Map from token kind to factory function for atomic
// (single-token) inline nodes, avoiding a long if/else chain.
type AtomicFactory = (fragment: Fragment, at: LocationIndex) => InlineNode;
const ATOMIC_DISPATCH = new Map<InlineTokenType, AtomicFactory>([
  ["AttributeReference", makeAttributeReference],
  ["InlineMacro", makeInlineMacro],
  ["InlineUrl", makeLinkFromUrl],
  ["XrefShorthand", makeXrefFromShorthand],
  ["InlineAnchor", makeInlineAnchor],
  ["HardLineBreak", makeHardLineBreak],
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
 * @param at - The document's location index.
 * @returns The built InlineNode, or undefined if the
 *   token type has no registered factory.
 */
function handleAtomicToken(
  token: InlineToken,
  at: LocationIndex,
): InlineNode | undefined {
  const factory = ATOMIC_DISPATCH.get(token.type);
  return factory === undefined ? undefined : factory(token, at);
}

/**
 * Build a RawLineNode from a whole-line RawLine token.
 *
 * The node exists so the printer can re-emit the line verbatim on a
 * line of its own; it is deliberately NOT a TextNode, which would be
 * reflowed into the surrounding words and turn a comment into visible
 * prose.
 * @param fragment - The RawLine token's span (the whole line).
 * @param at - The document's location index.
 * @returns A RawLineNode spanning exactly that line.
 */
function makeRawLineNode(fragment: Fragment, at: LocationIndex): RawLineNode {
  return {
    type: "rawLine",
    value: fragment.image,
    position: { start: at.start(fragment), end: at.end(fragment) },
  };
}

/**
 * Drop a trailing newline from a pending text run.
 * @param pending - Text accumulated so far.
 * @returns The text without its final `\n`, unchanged when there
 *   is none.
 */
function withoutTrailingNewline(pending: string): string {
  return pending.endsWith("\n") ? pending.slice(0, -1) : pending;
}

/**
 * Skip a newline token sitting at `index` — the one that terminates
 * a raw line, which the RawLineNode's own output break replaces.
 * @param tokens - The token stream being processed.
 * @param index - Position just after the raw line.
 * @returns The index to resume from.
 */
function skipStructuralNewline(
  tokens: readonly InlineToken[],
  index: number,
): number {
  return index < tokens.length && tokens[index].type === "InlineNewline"
    ? index + 1
    : index;
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
  tokens: readonly InlineToken[],
  index: number,
): number {
  const isHardBreakFollowedByNewline =
    node.type === "hardLineBreak" &&
    index < tokens.length &&
    tokens[index].type === "InlineNewline";
  return isHardBreakFollowedByNewline ? index + 1 : index;
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
 *   from the inline tokenizer.
 * @param at - The document's location index.
 * @returns The built array of InlineNode AST nodes.
 */
export function buildFromTokens(
  allTokens: readonly InlineToken[],
  at: LocationIndex,
): InlineNode[] {
  // Strip trailing InlineNewline — it's a structural
  // separator (paragraph boundary), not inline content.
  // Only between-line newlines should become \n text.
  const { length: tokenCount } = allTokens;
  let end = tokenCount;
  while (end > 0 && allTokens[end - 1].type === "InlineNewline") {
    end -= 1;
  }
  const tokens = end < tokenCount ? allTokens.slice(0, end) : allTokens;

  const nodes: InlineNode[] = [];
  let pendingText = "";
  let pendingStart: InlineToken | undefined = undefined;
  let pendingEnd: InlineToken | undefined = undefined;
  let index = 0;

  /** Flush accumulated plain text into a TextNode. */
  function flushText(): void {
    if (
      pendingText.length > 0 &&
      pendingStart !== undefined &&
      pendingEnd !== undefined
    ) {
      nodes.push(makeTextNode(pendingText, pendingStart, pendingEnd, at));
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
  function accumulate(token: InlineToken, text: string): void {
    pendingStart ??= token;
    pendingEnd = token;
    pendingText += text;
  }

  while (index < tokens.length) {
    const token = tokens[index];
    const { type } = token;

    // A raw line owns its output line, so the newlines that bound
    // it are structural: the one that ended the previous line was
    // accumulated into the pending text and is trimmed off here,
    // and the one that ends the raw line is skipped below. Leaving
    // them in would put stray "\n" into text runs; the printer's
    // atoms are newline-free by contract (src/reflow.ts, Atom).
    if (type === "RawLine") {
      pendingText = withoutTrailingNewline(pendingText);
      flushText();
      nodes.push(makeRawLineNode(token, at));
      index = skipStructuralNewline(tokens, index + 1);
      continue;
    }

    // Dispatch to category-specific handlers.
    if (type === "RoleAttribute") {
      index = handleRoleAttribute({
        tokens,
        index,
        token,
        flushText,
        accumulate,
        nodes,
        at,
      });
      continue;
    }

    // Paired formatting marks (*...*  _..._ `...` #...#): pair with
    // the matching close, or fall through as plain text when none
    // exists.
    const pairedResult = handleFormattingMark(tokens, index, token, at);
    if (pairedResult !== undefined) {
      flushText();
      const { node, nextIndex } = pairedResult;
      nodes.push(node);
      index = nextIndex;
      continue;
    }

    // Atomic single-token nodes: attribute references,
    // links, xrefs, inline anchors, macros.
    const atomicNode = handleAtomicToken(token, at);
    if (atomicNode !== undefined) {
      flushText();
      nodes.push(atomicNode);
      index += 1;
      // After a hard line break, skip the structural
      // InlineNewline that follows — the HardLineBreakNode
      // already represents the line break.
      index = skipNewlineAfterHardBreak(atomicNode, tokens, index);
      continue;
    }

    // InlineNewline → \n, everything else → literal image.
    accumulate(token, type === "InlineNewline" ? "\n" : token.image);
    index += 1;
  }

  flushText();
  return nodes;
}
