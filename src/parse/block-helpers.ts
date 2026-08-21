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
  BlockNode,
  CommentNode,
  DelimitedBlockNode,
  InlineNode,
  Location,
  ParentBlockNode,
} from "../ast.js";
import {
  EMPTY,
  FIRST,
  FIRST_COLUMN,
  FIRST_LINE,
  LAST_ELEMENT,
  NEWLINE_LENGTH,
} from "../constants.js";
import type { BlockCstChildren } from "./cst-types.js";
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
 * Trim a checkbox prefix (e.g. `[x] `) from the beginning
 * of an InlineNode[] array.
 *
 * The grammar captures the checkbox marker as part of the
 * inline text. This function strips it after parsing so the
 * AST stores the checkbox state separately from the item's
 * visible text. Mutates the first TextNode in-place — safe
 * because the node was freshly built and is not shared.
 * @param children - Inline children to trim. Mutated in
 *   place; does nothing if the first child is not a
 *   TextNode.
 * @param prefixLength - Number of characters to strip
 *   from the first TextNode's value (e.g. 4 for `[x] `).
 */
export function trimCheckboxPrefix(
  children: InlineNode[],
  prefixLength: number,
): void {
  if (children.length === EMPTY) return;
  const [first] = children;
  if (first.type === "text") {
    first.value = first.value.slice(prefixLength);
  }
}

/**
 * Where a delimited block closes. A block that met its own terminator
 * closes on it; one the reader forced shut (an outer terminator took
 * the line, or EOF came first) closes at the `UnclosedEnd` boundary
 * token — at the start of the terminator line that ended it, or at
 * the end of the document. Recovery alone leaves both undefined.
 */
export interface BlockClose {
  /** The block's own closing delimiter token, when it had one. */
  readonly close: IToken | undefined;
  /** The zero-length `UnclosedEnd` boundary, when it was forced shut. */
  readonly unclosed: IToken | undefined;
}

/**
 * The content end offset and node end position a block close implies.
 * @param at - the block's close, own or forced
 * @param sourceText - the full source text
 * @returns the exclusive offset where content stops (the newline before
 *   a terminator line is not content) and the node's end location
 */
function closeExtent(
  at: BlockClose,
  sourceText: string,
): { contentEnd: number; end: Location } {
  if (at.close !== undefined) {
    return {
      contentEnd: at.close.startOffset - NEWLINE_LENGTH,
      end: tokenEndLocation(at.close),
    };
  }
  // A forced close on a LINE: the outer terminator begins there, so
  // the content stops before the newline that precedes it. At EOF the
  // boundary sits one past the last character and everything after the
  // opener is content — up to the document's final newline, which is a
  // line terminator, not content (a synthesised closer goes directly
  // under the last content line).
  if (
    at.unclosed !== undefined &&
    at.unclosed.startOffset < sourceText.length
  ) {
    return {
      contentEnd: at.unclosed.startOffset - NEWLINE_LENGTH,
      end: tokenStartLocation(at.unclosed),
    };
  }
  return {
    contentEnd: sourceText.endsWith("\n")
      ? sourceText.length - NEWLINE_LENGTH
      : sourceText.length,
    end: computeEnd(sourceText),
  };
}

/**
 * Builds a DelimitedBlockNode from its opener and close by extracting
 * content verbatim from the source text. Token-based reconstruction
 * would lose blank lines because the CST groups tokens by type, not
 * position.
 * @param open - The opening delimiter token.
 * @param at - The block's close, own or forced (see {@link BlockClose}).
 * @param variant - The block variant (listing, literal, pass,
 *   etc.) that determines how the printer formats content.
 * @param sourceText - The full source text, used for verbatim
 *   substring extraction between delimiters.
 * @returns A complete DelimitedBlockNode with content sliced
 *   directly from the source text.
 */
export function buildDelimitedBlock(
  open: IToken,
  at: BlockClose,
  variant: DelimitedBlockNode["variant"],
  sourceText: string,
): DelimitedBlockNode {
  // Content starts after the open delimiter + newline.
  const contentStart = open.startOffset + open.image.length + NEWLINE_LENGTH;
  const { contentEnd, end } = closeExtent(at, sourceText);
  const content =
    contentStart <= contentEnd
      ? sourceText.slice(contentStart, contentEnd)
      : "";
  return {
    type: "delimitedBlock",
    variant,
    form: "delimited",
    content,
    position: { start: tokenStartLocation(open), end },
  };
}

/**
 * Builds a ParentBlockNode from its opener and close and the
 * recursively visited child block nodes.
 * @param open - The opening delimiter token.
 * @param at - The block's close, own or forced (see {@link BlockClose}).
 * @param variant - The parent block variant (example,
 *   sidebar, open, quote) that controls nesting semantics.
 * @param children - Recursively visited child BlockNodes
 *   contained within the delimiters.
 * @returns A ParentBlockNode whose position spans from the
 *   open delimiter to where the block closed.
 */
export function buildParentBlock(
  open: IToken,
  at: BlockClose,
  variant: ParentBlockNode["variant"],
  children: BlockNode[],
): ParentBlockNode {
  // Where the block closed; the source text plays no part for a
  // compound block, whose content is its children, so an empty
  // string stands in for it and only an EOF close reaches that arm.
  const { end } = closeExtent(at, "");
  return {
    type: "parentBlock",
    variant,
    children,
    position: { start: tokenStartLocation(open), end },
  };
}

// Every subrule the grammar's `block` rule can take. The rule is an OR
// over alternatives that each start on a distinct token, so at most one
// of these is ever set and the order carries no priority.
const BLOCK_SUBRULES = [
  "section",
  "list",
  "verbatimBlock",
  "compoundBlock",
  "paragraph",
  "admonitionParagraph",
  "literalParagraph",
] as const;

/**
 * Finds the CST subrule node present in the block context.
 * @param context - The block-level CST children. Each property
 *   corresponds to an alternative in the block grammar rule.
 * @returns The matched subrule node, or undefined when error recovery
 *   produced an empty block.
 */
export function findSubrule(context: BlockCstChildren): CstNode | undefined {
  for (const name of BLOCK_SUBRULES) {
    const node = context[name]?.[FIRST];
    if (node !== undefined) return node;
  }
  return undefined;
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
 * Builds a CommentNode from a block comment's opener and close.
 * Content is sliced from the source text rather than rebuilt from
 * tokens (the CST groups tokens by type, which would lose blank
 * lines); a forced close ends it where the reader ended the block.
 * @param open - The opening `////` delimiter token.
 * @param at - The block's close, own or forced (see {@link BlockClose}).
 * @param sourceText - The full source text, used for verbatim
 *   content extraction between delimiters.
 * @returns A CommentNode with block type whose value contains
 *   the raw content between (or after) the delimiters.
 */
export function buildBlockComment(
  open: IToken,
  at: BlockClose,
  sourceText: string,
): CommentNode {
  const contentStart = open.startOffset + open.image.length + NEWLINE_LENGTH;
  const { contentEnd, end } = closeExtent(at, sourceText);
  const value =
    contentStart <= contentEnd
      ? sourceText.slice(contentStart, contentEnd)
      : "";
  return {
    type: "comment",
    commentType: "block",
    value,
    position: { start: tokenStartLocation(open), end },
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
 * @param textTokens - The body's lines in source order, one synthetic
 *   token per line (see `textLines` in inline-tokens.ts); raw
 *   comment/preprocessor lines are lines of their own. May be empty.
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
