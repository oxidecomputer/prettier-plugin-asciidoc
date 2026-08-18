/**
 * Helper functions for the AST builder's block-level processing.
 *
 * Extracted from ast-builder.ts to keep that file within the
 * max-lines lint limit. These are pure functions that build
 * AST nodes from CST tokens or find subrule nodes in the CST.
 */
import type { CstNode, IToken } from "chevrotain";
import type {
  AdmonitionNode,
  AttributeEntryNode,
  BlockNode,
  CommentNode,
  DelimitedBlockNode,
  ParentBlockNode,
  TextNode,
} from "../ast.js";
import {
  EMPTY,
  FIRST,
  FIRST_COLUMN,
  FIRST_LINE,
  LAST_ELEMENT,
  NEWLINE_LENGTH,
} from "../constants.js";
import { unreachable } from "../unreachable.js";
import type { BlockCstChildren } from "./cst-types.js";
import type { FlatListItem } from "./list-builder.js";
import {
  makeLocation,
  tokenStartLocation,
  tokenEndLocation,
  computeEnd,
} from "./positions.js";

// Checklist marker: `[x] `, `[*] `, or `[ ] ` at the start
// of an unordered list item's text. Group 1 captures the
// inner character so we can distinguish checked from unchecked.
const CHECKBOX_RE = /^\[(?<mark>[x* ])\] /v;
// Length of the checkbox prefix: `[x] ` = 4 characters.
export const CHECKBOX_PREFIX_LEN = 4;

/**
 * Detects a checklist prefix (`[x] `, `[*] `, `[ ] `) at the
 * start of item text. Returns the checkbox state and the text
 * with the prefix stripped, or undefined/original text if no
 * checkbox is present.
 * @param rawValue - The raw text content of a list item,
 *   possibly starting with a checkbox marker.
 * @returns The checkbox state ("checked", "unchecked", or
 *   undefined if absent) and the byte length of the prefix
 *   to strip from the value before building inline children.
 */
export function parseCheckbox(rawValue: string): {
  checkbox: "checked" | "unchecked" | undefined;
  prefixLength: number;
} {
  const match = CHECKBOX_RE.exec(rawValue);
  if (match?.groups === undefined) {
    return {
      checkbox: undefined,
      prefixLength: EMPTY,
    };
  }
  const {
    groups: { mark },
  } = match;
  return {
    checkbox: mark === " " ? "unchecked" : "checked",
    prefixLength: CHECKBOX_PREFIX_LEN,
  };
}

/**
 * Builds a DelimitedBlockNode from open/close tokens by
 * extracting content verbatim from the source text. Same
 * substring extraction strategy as blockComment -- token-based
 * reconstruction would lose blank lines because the CST
 * groups tokens by type, not position.
 * @param openTokens - The opening delimiter tokens from the
 *   CST.
 * @param closeTokens - The closing delimiter tokens, or
 *   undefined when the block is unclosed (EOF before match).
 * @param variant - The block variant (listing, literal, pass,
 *   etc.) that determines how the printer formats content.
 * @param sourceText - The full source text, used for verbatim
 *   substring extraction between delimiters.
 * @returns A complete DelimitedBlockNode with content sliced
 *   directly from the source text.
 */
export function buildDelimitedBlock(
  openTokens: IToken[] | undefined,
  closeTokens: IToken[] | undefined,
  variant: DelimitedBlockNode["variant"],
  sourceText: string,
): DelimitedBlockNode {
  // Always present: the grammar can't enter a leaf block rule
  // without first matching the open delimiter.
  const openToken =
    openTokens?.[FIRST] ??
    unreachable("Delimited block must have an opening delimiter");

  const closeToken = closeTokens?.[FIRST];

  // Content starts after the open delimiter + newline.
  const contentStart =
    openToken.startOffset + openToken.image.length + NEWLINE_LENGTH;

  // When the close delimiter is missing (unclosed block — EOF
  // arrived before the matching close), treat everything from
  // the open delimiter to the end of the source as content.
  // This preserves the input verbatim instead of crashing.
  if (closeToken === undefined) {
    const content =
      contentStart <= sourceText.length ? sourceText.slice(contentStart) : "";
    return {
      type: "delimitedBlock",
      variant,
      form: "delimited",
      content,
      position: {
        start: tokenStartLocation(openToken),
        end: computeEnd(sourceText),
      },
    };
  }

  // Normal case: content ends before the newline that precedes
  // the close delimiter. closeToken.startOffset - 1 lands on the
  // newline character itself; slicing up to (not including) that
  // position gives us the content without a trailing newline.
  const contentEnd = closeToken.startOffset - NEWLINE_LENGTH;
  const content =
    contentStart <= contentEnd
      ? sourceText.slice(contentStart, contentEnd)
      : "";

  return {
    type: "delimitedBlock",
    variant,
    form: "delimited",
    content,
    position: {
      start: tokenStartLocation(openToken),
      end: tokenEndLocation(closeToken),
    },
  };
}

/**
 * Builds a ParentBlockNode from open/close delimiter tokens
 * and recursively visited child block nodes.
 * @param openTokens - The opening delimiter tokens from the
 *   CST.
 * @param closeTokens - The closing delimiter tokens, or
 *   undefined when the block is unclosed (EOF before match).
 * @param variant - The parent block variant (example,
 *   sidebar, open, quote) that controls nesting semantics.
 * @param children - Recursively visited child BlockNodes
 *   contained within the delimiters.
 * @returns A ParentBlockNode whose position spans from the
 *   open delimiter to the close delimiter (or open token end
 *   as fallback for unclosed blocks).
 */
export function buildParentBlock(
  openTokens: IToken[] | undefined,
  closeTokens: IToken[] | undefined,
  variant: ParentBlockNode["variant"],
  children: BlockNode[],
): ParentBlockNode {
  // Always present: the grammar can't enter a parent block
  // rule without first matching the open delimiter.
  const openToken =
    openTokens?.[FIRST] ??
    unreachable("Parent block must have an opening delimiter");

  const closeToken = closeTokens?.[FIRST];

  return {
    type: "parentBlock",
    variant,
    children,
    position: {
      start: tokenStartLocation(openToken),
      // When the close delimiter is missing (unclosed block),
      // use the open token's end as a fallback. The block's
      // end will be inaccurate, but this preserves whatever
      // partial content was parsed instead of crashing.
      end:
        closeToken === undefined
          ? tokenEndLocation(openToken)
          : tokenEndLocation(closeToken),
    },
  };
}

/**
 * Extracts verbatim content between comment delimiters from
 * the source text. Substring extraction is used instead of
 * joining token images because the CST groups tokens by type
 * (e.g. all Newline tokens together), which would lose blank
 * lines that appear inside the comment block.
 * @param delimiterToken - The opening `////` delimiter token.
 * @param endToken - The closing `////` delimiter token.
 * @param sourceText - The full source text from which content
 *   is sliced (between the delimiter boundaries).
 * @returns The raw string between the delimiters, or an empty
 *   string when the delimiters are adjacent (no content).
 */
export function extractBlockCommentContent(
  delimiterToken: IToken,
  endToken: IToken,
  sourceText: string,
): string {
  const contentStart =
    delimiterToken.startOffset + delimiterToken.image.length + NEWLINE_LENGTH;
  const contentEnd = endToken.startOffset - NEWLINE_LENGTH;
  return contentStart <= contentEnd
    ? sourceText.slice(contentStart, contentEnd)
    : "";
}

/**
 * Merges inline text and IndentedLine tokens into a single
 * array sorted by source position. This preserves the original
 * line order when both token types appear in a list item.
 * @param textTokens - Inline text tokens (plain paragraph
 *   lines) from the list item CST.
 * @param indentedTokens - IndentedLine tokens (continuation
 *   lines with leading whitespace) from the list item CST.
 * @returns A single token array in source order. Returns
 *   `textTokens` directly when there are no indented tokens,
 *   avoiding an unnecessary copy.
 */
export function mergeTextTokens(
  textTokens: IToken[],
  indentedTokens: IToken[],
): IToken[] {
  if (indentedTokens.length === EMPTY) {
    return textTokens;
  }
  return [...textTokens, ...indentedTokens].toSorted(
    (a, b) => a.startOffset - b.startOffset,
  );
}

/**
 * Finds the first list-type CST subrule in the block context.
 * Separated from findSubrule to keep cyclomatic complexity
 * under the limit -- each nullish-coalescing branch counts.
 * @param context - The block CST children to search through.
 * @returns The first list subrule node (unordered, ordered, or
 *   callout), or undefined if no list rule matched.
 */
function findListSubrule(context: BlockCstChildren): CstNode | undefined {
  return (
    context.unorderedList?.[FIRST] ??
    context.orderedList?.[FIRST] ??
    context.calloutList?.[FIRST]
  );
}

/**
 * Checks for any delimited leaf block subrule type (listing,
 * literal, passthrough, fenced code) in the block CST.
 * @param context - The block CST children to search through.
 * @returns The first leaf block subrule node, or undefined if
 *   no leaf block delimiter was matched.
 */
function findLeafBlockSubrule(context: BlockCstChildren): CstNode | undefined {
  return (
    context.listingBlock?.[FIRST] ??
    context.fencedCodeBlock?.[FIRST] ??
    context.literalBlock?.[FIRST] ??
    context.passBlock?.[FIRST]
  );
}

/**
 * Checks for any parent block subrule type (example, sidebar,
 * open, quote) in the block CST.
 * @param context - The block CST children to search through.
 * @returns The first parent block subrule node, or undefined
 *   if no parent block delimiter was matched.
 */
function findParentBlockSubrule(
  context: BlockCstChildren,
): CstNode | undefined {
  return (
    context.exampleBlock?.[FIRST] ??
    context.sidebarBlock?.[FIRST] ??
    context.openBlock?.[FIRST] ??
    context.quoteBlock?.[FIRST]
  );
}

/**
 * Checks for any delimited block subrule -- either leaf blocks
 * (verbatim content) or parent blocks (recursive content).
 * Combines both helpers to keep findSubrule within the
 * cyclomatic complexity limit.
 * @param context - The block CST children to search through.
 * @returns The first delimited block subrule node (leaf or
 *   parent), or undefined if none was matched.
 */
function findDelimitedBlockSubrule(
  context: BlockCstChildren,
): CstNode | undefined {
  return findLeafBlockSubrule(context) ?? findParentBlockSubrule(context);
}

/**
 * Groups the paragraph-like rules: literal paragraphs,
 * admonition paragraphs, and regular paragraphs. Order
 * matters -- literal and admonition paragraphs take priority
 * because they have stricter token requirements (IndentedLine
 * or AdmonitionMarker) that distinguish them from plain
 * paragraphs. Extracted to keep the block() visitor under
 * the cyclomatic complexity limit.
 * @param context - The block CST children to search through.
 * @returns The first paragraph-like subrule node, or undefined
 *   if no paragraph rule was matched.
 */
function findParagraphSubrule(context: BlockCstChildren): CstNode | undefined {
  return (
    context.literalParagraph?.[FIRST] ??
    context.admonitionParagraph?.[FIRST] ??
    context.paragraph?.[FIRST]
  );
}

/**
 * Finds the first CST subrule node present in the block
 * context. Returns `undefined` if recovery produced an empty
 * block CST node.
 * @param context - The block-level CST children. Each
 *   property corresponds to an alternative in the block
 *   grammar rule.
 * @returns The first matched subrule node, checked in
 *   priority order: comments and attribute entries first
 *   (syntactically unambiguous), then lists and delimited
 *   blocks, then paragraphs last (paragraphs would shadow
 *   other constructs). Within paragraphs, literal and
 *   admonition forms take priority over plain paragraphs.
 *   Returns undefined when error recovery produced an
 *   empty block.
 */
export function findSubrule(context: BlockCstChildren): CstNode | undefined {
  return (
    context.blockComment?.[FIRST] ??
    context.attributeEntry?.[FIRST] ??
    findListSubrule(context) ??
    findDelimitedBlockSubrule(context) ??
    findParagraphSubrule(context)
  );
}

/** Nesting depth assigned to recovered list items (always 1). */
const RECOVERY_DEPTH = 1;
/**
 * Fallback for list item visitor methods when recovery enters
 * the rule without a marker token. Builds a depth-1 stub from
 * whatever text tokens are available.
 * @param textTokens - Whatever inline text tokens Chevrotain's
 *   error recovery collected. May be empty if recovery
 *   captured nothing.
 * @returns A FlatListItem stub at depth 1 with position
 *   information derived from the available tokens, or a
 *   zero-offset fallback when no tokens are present.
 */
export function buildRecoveredListItem(textTokens: IToken[]): FlatListItem {
  const fallback = makeLocation(FIRST, FIRST_LINE, FIRST_COLUMN);
  if (textTokens.length === EMPTY) {
    return {
      depth: RECOVERY_DEPTH,
      inlineChildren: [],
      attachedBlocks: [],
      danglingContinuation: false,
      checkbox: undefined,
      calloutNumber: undefined,
      start: fallback,
      end: fallback,
    };
  }
  const start = tokenStartLocation(textTokens[FIRST]);
  const end = tokenEndLocation(
    textTokens.at(LAST_ELEMENT) ?? textTokens[FIRST],
  );
  // Combine all recovered tokens into a single TextNode rather than
  // re-running the inline parser. Recovery tokens may be partial or
  // out of order, and attempting inline parsing on them could crash
  // or produce nonsense nodes. A single verbatim TextNode is the
  // safest fallback.
  const value = textTokens.map((t) => t.image).join("\n");
  const textNode: TextNode = {
    type: "text",
    value,
    position: { start, end },
  };
  return {
    depth: RECOVERY_DEPTH,
    inlineChildren: [textNode],
    attachedBlocks: [],
    danglingContinuation: false,
    checkbox: undefined,
    calloutNumber: undefined,
    start,
    end,
  };
}

/**
 * Determines whether an attribute entry uses `!` prefix or
 * suffix unset syntax, or is a normal set. AsciiDoc supports
 * both `:!name:` (prefix) and `:name!:` (suffix) forms to
 * undefine an attribute.
 * @param prefix - The character before the attribute name
 *   (empty string or "!").
 * @param suffix - The character after the attribute name
 *   (empty string or "!").
 * @returns `"prefix"` or `"suffix"` indicating the unset
 *   form, or `false` if the attribute is being set normally.
 */
export function parseUnsetForm(
  prefix: string,
  suffix: string,
): false | "prefix" | "suffix" {
  if (prefix === "!") return "prefix";
  if (suffix === "!") return "suffix";
  return false;
}

/**
 * Builds a CommentNode from a block comment's CST tokens.
 * Handles unclosed block comments gracefully -- when the end
 * delimiter is missing, content extends to EOF.
 * @param delimiterToken - The opening `////` delimiter token.
 * @param endToken - The closing `////` delimiter token, or
 *   undefined when the comment block is unclosed (EOF before
 *   the matching close delimiter).
 * @param sourceText - The full source text, used for verbatim
 *   content extraction between delimiters.
 * @returns A CommentNode with block type whose value contains
 *   the raw content between (or after) the delimiters.
 */
export function buildBlockComment(
  delimiterToken: IToken,
  endToken: IToken | undefined,
  sourceText: string,
): CommentNode {
  if (endToken === undefined) {
    // Unclosed block comment — EOF arrived before ////.
    const contentStart =
      delimiterToken.startOffset + delimiterToken.image.length + NEWLINE_LENGTH;
    const value =
      contentStart <= sourceText.length ? sourceText.slice(contentStart) : "";
    return {
      type: "comment",
      commentType: "block",
      value,
      position: {
        start: tokenStartLocation(delimiterToken),
        end: computeEnd(sourceText),
      },
    };
  }

  // Extract verbatim content directly from the source text.
  // Token-based reconstruction would lose blank lines inside
  // the comment because the CST groups tokens by type.
  const value = extractBlockCommentContent(
    delimiterToken,
    endToken,
    sourceText,
  );
  return {
    type: "comment",
    commentType: "block",
    value,
    position: {
      start: tokenStartLocation(delimiterToken),
      end: tokenEndLocation(endToken),
    },
  };
}

// Colon-space suffix length in admonition markers ("NOTE: ").
const COLON_SPACE_LEN = 2;

/**
 * Builds an AdmonitionNode from a paragraph-form admonition.
 * Handles recovery gracefully when the marker token is missing.
 * @param markerToken - The admonition label token (e.g.
 *   "NOTE: ", "WARNING: "), or undefined when Chevrotain's
 *   error recovery entered the rule without matching a marker.
 * @param textTokens - Inline text tokens forming the
 *   admonition body content. May be empty.
 * @returns An AdmonitionNode in paragraph form with variant
 *   derived from the marker label (lowercased, colon-space
 *   suffix stripped). Falls back to "note" when the marker
 *   is missing.
 */
export function buildAdmonitionParagraph(
  markerToken: IToken | undefined,
  textTokens: IToken[],
): AdmonitionNode {
  const content =
    textTokens.length > EMPTY
      ? textTokens.map((t) => t.image).join("\n")
      : undefined;
  const lastTextToken = textTokens.at(LAST_ELEMENT);

  // Recovery entered the rule without a marker token.
  if (markerToken === undefined) {
    const fallback = makeLocation(FIRST, FIRST_LINE, FIRST_COLUMN);
    return {
      type: "admonition",
      variant: "note",
      form: "paragraph",
      delimiter: undefined,
      content,
      children: [],
      position: {
        start: fallback,
        end:
          lastTextToken === undefined
            ? fallback
            : tokenEndLocation(lastTextToken),
      },
    };
  }

  const variant = markerToken.image
    .slice(EMPTY, -COLON_SPACE_LEN)
    .toLowerCase();
  const endToken = lastTextToken ?? markerToken;
  return {
    type: "admonition",
    variant,
    form: "paragraph",
    delimiter: undefined,
    content,
    children: [],
    position: {
      start: tokenStartLocation(markerToken),
      end: tokenEndLocation(endToken),
    },
  };
}

/**
 * Builds a stub AttributeEntryNode when recovery enters the
 * rule without the expected tokens.
 * @param token - The single token Chevrotain's error recovery
 *   managed to capture (typically the attribute name), or
 *   undefined if recovery captured nothing at all.
 * @returns A minimal AttributeEntryNode with the token's image
 *   as the name (or empty string), no value, and position
 *   derived from the token or a zero-offset fallback.
 */
export function buildRecoveredAttributeEntry(
  token: IToken | undefined,
): AttributeEntryNode {
  const fallback = makeLocation(FIRST, FIRST_LINE, FIRST_COLUMN);
  return {
    type: "attributeEntry",
    name: token?.image ?? "",
    value: undefined,
    unset: false,
    position:
      token === undefined
        ? { start: fallback, end: fallback }
        : {
            start: tokenStartLocation(token),
            end: tokenEndLocation(token),
          },
  };
}
