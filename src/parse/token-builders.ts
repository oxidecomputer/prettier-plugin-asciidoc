// Single-token to AST node builders.
//
// These functions convert individual lexer tokens into typed AST
// nodes. Every builder here takes exactly one IToken and returns
// one BlockNode — no CST recursion is needed. They are separated
// from ast-builder.ts both to keep that file within the max-lines
// lint limit and to make the single-token / subrule distinction
// explicit at the module boundary.
import type { IToken } from "chevrotain";
import type {
  SectionNode,
  DocumentTitleNode,
  CommentNode,
  BlockAttributeListNode,
  BlockTitleNode,
  ThematicBreakNode,
  PageBreakNode,
  BlockMacroNode,
  IncludeDirectiveNode,
  ConditionalDirectiveNode,
  ParagraphNode,
  BlockNode,
} from "../ast.js";
import { FIRST, MARKER_OFFSET } from "../constants.js";
import { unreachable } from "../unreachable.js";
import type { BlockCstChildren } from "./cst-types.js";
import { makeInlineAnchor } from "./inline-link-builder.js";
import { tokenStartLocation, tokenEndLocation } from "./positions.js";

const SECTION_MARKER_RE = /^(?<markers>={2,6})\s+(?<title>.*)/v;

/**
 * Builds a SectionNode from a heading-line token.
 *
 * The lexer captures the entire heading line as one
 * token (e.g. "== My Title"). We split it here because
 * the AST stores level and title separately -- the
 * printer needs them independently to reconstruct the
 * heading with normalized whitespace.
 * @param token - A SectionMarker token containing
 *   the full heading line.
 * @returns A section node with level, heading text,
 *   and an empty children array for the visitor to
 *   populate as it recurses into the section body.
 */
function buildSection(token: IToken): SectionNode {
  // The lexer's SectionMarker pattern guarantees this regex
  // matches — if it doesn't, the token definition is wrong.
  const match = SECTION_MARKER_RE.exec(token.image);
  const groups =
    match?.groups ?? unreachable(`Invalid section marker: ${token.image}`);
  return {
    type: "section",
    level: groups.markers.length - MARKER_OFFSET,
    heading: groups.title.trim(),
    children: [],
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

// The document title token is `= Title Text`. The prefix `= `
// is always exactly 2 characters (the `=` sign and a space).
const DOCUMENT_TITLE_PREFIX_LEN = 2;

/**
 * Builds a DocumentTitleNode from a document-title token.
 *
 * Like buildSection, the lexer captures the full line
 * as one token. We extract the title text here so the
 * printer can normalize whitespace independently of
 * the `= ` prefix.
 * @param token - A DocumentTitle token whose image
 *   starts with `= `.
 * @returns A document title node with the extracted
 *   title text.
 */
function buildDocumentTitle(token: IToken): DocumentTitleNode {
  const title = token.image.slice(DOCUMENT_TITLE_PREFIX_LEN).trim();
  return {
    type: "documentTitle",
    title,
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

// The lexer captures "// text" as a single LineComment token.
// We strip the leading "// " (or just "//") to get the comment
// text. The space after // is syntactic, not content.
// Prefix "//" is 2 characters; the space separator is 1 more.
const LINE_COMMENT_PREFIX_LEN = 2;
const LINE_COMMENT_SPACE_LEN = 1;

/**
 * Builds a CommentNode from a line-comment token.
 *
 * Strips the syntactic `//` prefix and the optional
 * space separator to extract just the comment text.
 * An empty comment (`//` with nothing after) yields
 * an empty string value.
 * @param token - A LineComment token whose image
 *   starts with `//`.
 * @returns A comment node with commentType "line" and
 *   the extracted text content.
 */
function buildLineComment(token: IToken): CommentNode {
  // Strip the leading "//" to get " text" or "".
  const raw = token.image.slice(LINE_COMMENT_PREFIX_LEN);
  // If the comment has content, it starts with a space —
  // strip it.
  const value = raw.startsWith(" ") ? raw.slice(LINE_COMMENT_SPACE_LEN) : raw;

  return {
    type: "comment",
    commentType: "line",
    value,
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

// Block attribute list token is `[content]`. We strip the outer
// brackets to get the raw attribute content.
const BLOCK_ATTR_LIST_PREFIX_LEN = 1;
const BLOCK_ATTR_LIST_SUFFIX_LEN = 1;

/**
 * Builds a BlockAttributeListNode from a block
 * attribute list token.
 *
 * The token image is `[content]`. We strip the outer
 * brackets so the AST stores only the raw attribute
 * text -- the printer re-wraps it in brackets when
 * emitting output.
 * @param token - A BlockAttributeList token whose
 *   image is bracket-delimited.
 * @returns A block attribute list node with the
 *   inner content as its value.
 */
function buildBlockAttributeList(token: IToken): BlockAttributeListNode {
  const value = token.image.slice(
    BLOCK_ATTR_LIST_PREFIX_LEN,
    // Negated to slice from the end: -1 drops the trailing `]`.
    -BLOCK_ATTR_LIST_SUFFIX_LEN,
  );
  return {
    type: "blockAttributeList",
    value,
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

// Block title token is `.Title text`. The leading dot is
// syntactic — we strip it to get the title text. The lexer
// pattern (/\.(?![. ])\S[^\n]*/) guarantees the character
// immediately after the dot is non-whitespace, so no trim() is
// needed here (unlike buildSection / buildDocumentTitle, where
// the spec allows arbitrary whitespace between the marker and
// the title text).
const BLOCK_TITLE_PREFIX_LEN = 1;

/**
 * Builds a BlockTitleNode from a block-title token.
 *
 * The token image is `.Title text`. The leading dot is
 * syntactic, so we strip it -- the printer re-adds the
 * dot prefix during output.
 * @param token - A BlockTitle token whose image starts
 *   with a `.` prefix.
 * @returns A block title node with the extracted title
 *   text.
 */
function buildBlockTitle(token: IToken): BlockTitleNode {
  const title = token.image.slice(BLOCK_TITLE_PREFIX_LEN);
  return {
    type: "blockTitle",
    title,
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

/**
 * Builds a ThematicBreakNode from a thematic-break token.
 *
 * Thematic breaks (`'''`) carry no content -- only
 * source position is preserved so the printer can
 * place the delimiter correctly.
 * @param token - A ThematicBreak token (`'''` or longer).
 * @returns A thematic break node with source position.
 */
function buildThematicBreak(token: IToken): ThematicBreakNode {
  return {
    type: "thematicBreak",
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

/**
 * Builds a PageBreakNode from a page-break token.
 *
 * Page breaks (`<<<`) carry no content -- only source
 * position is preserved so the printer can place the
 * delimiter correctly.
 * @param token - A PageBreak token (`<<<` or longer).
 * @returns A page break node with source position.
 */
function buildPageBreak(token: IToken): PageBreakNode {
  return {
    type: "pageBreak",
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

// Regex to decompose a block macro token into its three
// parts: name, target, and attribute list.
const BLOCK_MACRO_RE =
  /^(?<name>[a-zA-Z]\w*)::(?<target>[^\[]*)\[(?<attrlist>[^\]]*)\]/v;

/**
 * Builds a BlockMacroNode from a block macro token.
 *
 * Block macros follow the `name::target[attrlist]` pattern.
 * The regex splits the token image into the three components
 * so the AST preserves them as structured fields rather than
 * a raw string.
 * @param token - A BlockMacro token
 *   (e.g. `image::sunset.jpg[Alt]`).
 * @returns A block macro node with name, target, and
 *   attrlist.
 */
function buildBlockMacro(token: IToken): BlockMacroNode {
  const match = BLOCK_MACRO_RE.exec(token.image);
  const groups =
    match?.groups ?? unreachable(`Invalid block macro: ${token.image}`);
  return {
    type: "blockMacro",
    name: groups.name,
    target: groups.target,
    attrlist: groups.attrlist,
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

/**
 * Build a single-anchor paragraph from a `BlockAnchor` token.
 *
 * Reuses `makeInlineAnchor` for parsing the token content and
 * the printer's `isAnchorParagraph` / `shouldStack` logic for
 * correct block-level anchor formatting.
 * @param token - A `BlockAnchor` token (`[[id]]` on its own
 *   line).
 * @returns A paragraph containing a single `InlineAnchorNode`.
 */
function buildBlockAnchor(token: IToken): ParagraphNode {
  const anchor = makeInlineAnchor(token);
  return {
    type: "paragraph",
    children: [anchor],
    position: anchor.position,
  };
}

// Narrows a regex capture group to the ConditionalDirective
// keyword union. The regex guarantees only valid keywords
// match, but TypeScript needs an explicit check to narrow
// from `string`. A switch provides narrowing without `as`.
/**
 * Validates and narrows a regex-captured directive keyword.
 *
 * The lexer regex only matches the four valid keywords, so
 * the default branch is unreachable at runtime. The switch
 * lets TypeScript narrow the type without an unsafe cast.
 * @param value - The raw string from the regex capture.
 * @returns The validated conditional keyword.
 */
function validateDirective(
  value: string,
): ConditionalDirectiveNode["directive"] {
  switch (value) {
    case "ifdef":
    case "ifndef":
    case "ifeval":
    case "endif": {
      return value;
    }
    default: {
      return unreachable(`Unknown conditional: ${value}`);
    }
  }
}

// Regex to decompose a conditional directive token into its
// three parts: directive keyword, target, and attribute list.
const CONDITIONAL_DIRECTIVE_RE =
  /^(?<directive>ifdef|ifndef|ifeval|endif)::(?<target>[^\[]*)\[(?<attrlist>[^\]]*)\]/v;

/**
 * Builds a ConditionalDirectiveNode from a conditional
 * directive token.
 *
 * Conditional directives (`ifdef`, `ifndef`, `ifeval`,
 * `endif`) are preprocessor instructions preserved verbatim
 * by the formatter. The regex splits the token image into
 * directive keyword, target, and attrlist.
 * @param token - A ConditionalDirective token
 *   (e.g. `ifdef::backend[]`).
 * @returns A conditional directive node with directive,
 *   target, and attrlist.
 */
function buildConditionalDirective(token: IToken): ConditionalDirectiveNode {
  const match = CONDITIONAL_DIRECTIVE_RE.exec(token.image);
  const groups =
    match?.groups ??
    unreachable(`Invalid conditional directive: ${token.image}`);
  return {
    type: "conditionalDirective",
    directive: validateDirective(groups.directive),
    target: groups.target,
    attrlist: groups.attrlist,
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

// Regex to decompose an include directive token into its two
// parts: target (file path) and attribute list.
const INCLUDE_DIRECTIVE_RE =
  /^include::(?<target>[^\[]*)\[(?<attrlist>[^\]]*)\]/v;

/**
 * Builds an IncludeDirectiveNode from an include directive
 * token.
 *
 * Include directives follow the `include::path[opts]` pattern.
 * The regex splits the token image into target and attrlist so
 * the AST preserves them as structured fields rather than a
 * raw string.
 * @param token - An IncludeDirective token
 *   (e.g. `include::chapter.adoc[leveloffset=+1]`).
 * @returns An include directive node with target and attrlist.
 */
function buildIncludeDirective(token: IToken): IncludeDirectiveNode {
  const match = INCLUDE_DIRECTIVE_RE.exec(token.image);
  const groups =
    match?.groups ?? unreachable(`Invalid include directive: ${token.image}`);
  return {
    type: "includeDirective",
    target: groups.target,
    attrlist: groups.attrlist,
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

/**
 * Extracts the first token from a CST token array and
 * converts it to an AST node using the given builder.
 *
 * CST children are optional arrays -- a rule's token
 * slot is undefined when the alternative wasn't matched.
 * This helper centralizes the presence check so each
 * call site in buildTokenBlock stays concise.
 * @param tokens - The CST token array, which may be
 *   undefined or empty if the alternative wasn't matched.
 * @param build - Builder function that converts a single
 *   token into the corresponding block-level AST node.
 *   All callers are the single-token block builders
 *   defined in this module.
 * @returns The built AST node, or undefined if no token
 *   was present.
 */
function tryBuild(
  tokens: IToken[] | undefined,
  build: (token: IToken) => BlockNode,
): BlockNode | undefined {
  const token = tokens?.[FIRST];
  if (token !== undefined) {
    return build(token);
  }
  return undefined;
}

/**
 * Dispatches a block CST node to the appropriate
 * single-token AST builder.
 *
 * Some block types (sections, comments, titles, breaks,
 * attribute lists) are fully represented by a single
 * lexer token and need no visitor traversal. This
 * function checks each token slot in priority order and
 * builds the AST node directly. Returns undefined for
 * subrule-based blocks (paragraphs, delimited blocks)
 * that require the visitor to recurse.
 * @param context - The CST children of a block rule,
 *   containing optional token arrays for each
 *   alternative.
 * @returns The AST node for a single-token block, or
 *   undefined if the block requires visitor traversal.
 */
// eslint-disable-next-line complexity -- linear dispatch, not branching logic
export function buildTokenBlock(
  context: BlockCstChildren,
): BlockNode | undefined {
  return (
    tryBuild(context.SectionMarker, buildSection) ??
    tryBuild(context.DocumentTitle, buildDocumentTitle) ??
    tryBuild(context.LineComment, buildLineComment) ??
    tryBuild(context.BlockAttributeList, buildBlockAttributeList) ??
    tryBuild(context.BlockTitle, buildBlockTitle) ??
    tryBuild(context.ThematicBreak, buildThematicBreak) ??
    tryBuild(context.PageBreak, buildPageBreak) ??
    tryBuild(context.ConditionalDirective, buildConditionalDirective) ??
    tryBuild(context.IncludeDirective, buildIncludeDirective) ??
    tryBuild(context.BlockMacro, buildBlockMacro) ??
    tryBuild(context.BlockAnchor, buildBlockAnchor)
  );
}
