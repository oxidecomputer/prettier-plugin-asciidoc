// Single-token to AST node builders.
//
// These functions convert individual line tokens — the ones the
// BlockReader emits for a source line that is a block by itself —
// into typed AST nodes. Every builder here takes exactly one IToken
// and returns one BlockNode — no CST recursion is needed. They are
// separated from ast-builder.ts both to keep that file within the
// max-lines lint limit and to make the single-token / subrule
// distinction explicit at the module boundary.
import type { IToken } from "chevrotain";
import type {
  SectionNode,
  DocumentTitleNode,
  DiscreteHeadingNode,
  CommentNode,
  BlockAttributeListNode,
  BlockTitleNode,
  ThematicBreakNode,
  PageBreakNode,
  BlockMacroNode,
  PreprocessorDirectiveNode,
  AttributeEntryNode,
  ParagraphNode,
  BlockNode,
} from "../ast.js";
import { EMPTY, FIRST, MARKER_OFFSET } from "../constants.js";
import { unreachable } from "../unreachable.js";
import type { BlockCstChildren } from "./cst-types.js";
import { makeInlineAnchor } from "./inline-link-builder.js";
import { rawLineForm } from "./lines/classify.js";
import { rstrip } from "./line-shapes.js";
import { tokenStartLocation, tokenEndLocation } from "./positions.js";
import { parseUnsetForm } from "./block-helpers.js";

const SECTION_MARKER_RE = /^(?<markers>={2,6})\s+(?<title>.*)/v;

/**
 * Splits a heading line into its level and title text.
 * @param token - A SectionTitleLine or DiscreteHeadingLine token
 *   containing the full heading line (e.g. "== My Title").
 * @returns The level (1 for `==`) and the trimmed title.
 */
function parseHeading(token: IToken): { level: number; heading: string } {
  // The reader's SECTION_TITLE pattern guarantees this regex
  // matches — if it doesn't, the classifier is wrong.
  const match = SECTION_MARKER_RE.exec(token.image);
  const groups =
    match?.groups ?? unreachable(`Invalid section marker: ${token.image}`);
  return {
    level: groups.markers.length - MARKER_OFFSET,
    heading: groups.title.trim(),
  };
}

/**
 * Builds a SectionNode from a heading-line token.
 *
 * The reader emits the entire heading line as one token
 * (e.g. "== My Title"). We split it here because the AST
 * stores level and title separately -- the printer needs them
 * independently to reconstruct the heading with normalized
 * whitespace.
 * @param token - A SectionTitleLine token containing the full
 *   heading line.
 * @returns A section node with level, heading text, and an
 *   empty children array for the visitor to populate.
 */
export function buildSection(token: IToken): SectionNode {
  return {
    type: "section",
    ...parseHeading(token),
    children: [],
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

/**
 * Builds a DiscreteHeadingNode from a heading line the reader
 * classified under a pending `[discrete]`: a standalone heading that
 * opens no section and nests nothing.
 * @param token - A DiscreteHeadingLine token.
 * @returns A discrete heading with the same level and text a section
 *   would have had.
 */
function buildDiscreteHeading(token: IToken): DiscreteHeadingNode {
  return {
    type: "discreteHeading",
    ...parseHeading(token),
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
 * Like buildSection, the reader emits the full line as one token. We
 * extract the title text here so the printer can normalize whitespace
 * independently of the `= ` prefix.
 * @param token - A DocumentTitleLine token whose image starts with `= `.
 * @returns A document title node with the extracted title text.
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

// A "// text" line arrives as one RawLine token. We strip the leading
// "// " (or just "//") to get the comment text. The space after // is
// syntactic, not content. Prefix "//" is 2 characters; the space
// separator is 1 more.
const LINE_COMMENT_PREFIX_LEN = 2;
const LINE_COMMENT_SPACE_LEN = 1;

/**
 * Builds a CommentNode from a line-comment token.
 *
 * Strips the syntactic `//` prefix and the optional space separator
 * to extract just the comment text. An empty comment (`//` with
 * nothing after) yields an empty string value.
 * @param token - A RawLine token whose image starts with `//`.
 * @returns A comment node with commentType "line" and the extracted
 *   text content.
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
 * Builds a BlockAttributeListNode from a block attribute line.
 *
 * The token image is `[content]`. We strip the outer brackets so the
 * AST stores only the raw attribute text -- the printer re-wraps it in
 * brackets when emitting output.
 * @param token - A BlockAttributeLine token whose image is
 *   bracket-delimited.
 * @returns A block attribute list node with the inner content as its
 *   value.
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

// Block title token is `.Title text`. The leading dot is syntactic —
// we strip it to get the title text. The registry's BLOCK_TITLE
// pattern guarantees the character immediately after the dot is
// non-whitespace, so no trim() is needed here (unlike buildSection /
// buildDocumentTitle, where the spec allows arbitrary whitespace
// between the marker and the title text).
const BLOCK_TITLE_PREFIX_LEN = 1;

/**
 * Builds a BlockTitleNode from a block-title line.
 *
 * The token image is `.Title text`. The leading dot is syntactic, so
 * we strip it -- the printer re-adds the dot prefix during output.
 * @param token - A BlockTitleLine token whose image starts with `.`.
 * @returns A block title node with the extracted title text.
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
 * Builds a ThematicBreakNode from a thematic-break line.
 *
 * Thematic breaks (`'''`) carry no content -- only source position is
 * preserved so the printer can place the delimiter correctly.
 * @param token - A ThematicBreakLine token (`'''` or longer).
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
 * Builds a PageBreakNode from a page-break line.
 *
 * Page breaks (`<<<`) carry no content -- only source position is
 * preserved so the printer can place the delimiter correctly.
 * @param token - A PageBreakLine token (`<<<` or longer).
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
 * Builds a BlockMacroNode from a block macro line.
 *
 * Block macros follow the `name::target[attrlist]` pattern. The regex
 * splits the token image into the three components so the AST
 * preserves them as structured fields rather than a raw string.
 * @param token - A BlockMacroLine token (e.g. `image::sunset.jpg[Alt]`).
 * @returns A block macro node with name, target, and attrlist.
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
 * Build a single-anchor paragraph from an `AnchorLine` token.
 *
 * Reuses `makeInlineAnchor` for parsing the token content and the
 * printer's `isAnchorParagraph` / `shouldStack` logic for correct
 * block-level anchor formatting.
 * @param token - An `AnchorLine` token (`[[id]]` on its own line).
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

/**
 * Builds a PreprocessorDirectiveNode from a directive line.
 *
 * The node carries the line verbatim rather than a decomposition into
 * keyword/target/attrlist: the formatter never resolves a directive,
 * and Asciidoctor's own reader
 * (`PreprocessorReader#process_line`, reader.rb:819) removes the line
 * from the stream before block parsing, so there is no block for the
 * parts to describe.
 *
 * "Verbatim" means the RSTRIPPED line: `Helpers.prepare_source_string`
 * strips every line before any rule runs, so trailing whitespace is
 * not part of what Asciidoctor read, and Prettier trims it before a
 * break in any case.
 * @param token - A RawLine token of conditional or include form
 *   (e.g. `ifdef::backend[]`, `include::chapter.adoc[]`).
 * @returns The verbatim directive node.
 */
function buildPreprocessorDirective(token: IToken): PreprocessorDirectiveNode {
  return {
    type: "preprocessorDirective",
    value: rstrip(token.image),
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

/**
 * Builds a paragraph holding one verbatim line: the block-level form
 * of a raw line that is not a comment or a preprocessor directive. The
 * one shape that reaches it is the second of two adjacent `+` lines
 * inside a list item, which Asciidoctor keeps as CONTENT of the
 * attached block (`read_lines_for_list_item`'s `:frozen` state) and
 * the reader therefore emits as a RawLine leaf. The printer keeps a
 * `rawLine` on an output line of its own, so the byte survives where
 * it was written.
 * @param token - The RawLine token.
 * @returns A paragraph whose only child is the raw line.
 */
function buildRawLineParagraph(token: IToken): ParagraphNode {
  const position = {
    start: tokenStartLocation(token),
    end: tokenEndLocation(token),
  };
  return {
    type: "paragraph",
    children: [{ type: "rawLine", value: token.image, position }],
    position,
  };
}

/**
 * Builds the block for a RawLine the reader emitted between blocks —
 * a comment or a preprocessor directive kept verbatim, or a line that
 * is raw for another reason (see {@link buildRawLineParagraph}).
 *
 * Classifies the RSTRIPPED image: a token carries the author's bytes
 * (`SourceLine.raw`) while every shape in the registry is written
 * against the rstripped spelling (`SourceLine.text`), so
 * `ifdef::backend[]␠␠` would otherwise miss the `$`-anchored
 * directive pattern and lose its transparency.
 * @param token - The RawLine token.
 * @returns The block node for the line.
 */
function buildRawBlockLine(token: IToken): BlockNode {
  switch (rawLineForm(rstrip(token.image))) {
    case "comment": {
      return buildLineComment(token);
    }
    case "conditional":
    case "include": {
      return buildPreprocessorDirective(token);
    }
    default: {
      return buildRawLineParagraph(token);
    }
  }
}

// Attribute entry: `:name: value`, `:name:`, `:!name:`, or `:name!:`.
// The SAME shape as the registry's ATTRIBUTE_ENTRY (`AttributeEntryRx`:
// `^:(!?\w[^:]*):(?:[ \t]+(.*))?$`) with the unset bang and the value
// captured: `!` is a `[^:]` character, so every line the classifier
// accepted matches here too (the lazy name simply stops before a
// trailing bang), and a miss is unreachable.
const ATTRIBUTE_ENTRY_RE =
  /^:(?<prefixBang>!?)(?<name>\w[^:]*?)(?<suffixBang>!?):(?:[ \t]+(?<value>[^\n]*))?$/v;

/**
 * Parses an attribute entry line (`:name: value`) into its components.
 * Handles three forms: set (`:name: value`), prefix-unset (`:!name:`),
 * and suffix-unset (`:name!:`).
 * @param token - An AttributeEntryLine token whose image holds the
 *   full line.
 * @returns Attribute entry node with parsed name, optional trimmed
 *   value, and unset form indicator.
 */
function buildAttributeEntry(token: IToken): AttributeEntryNode {
  const groups =
    ATTRIBUTE_ENTRY_RE.exec(token.image)?.groups ??
    unreachable(`Invalid attribute entry: ${token.image}`);
  const { prefixBang, name, suffixBang } = groups;
  // TypeScript types regex groups as `string`, but unmatched
  // optional groups are `undefined` at runtime.
  const rawValue = groups.value as string | undefined;
  const trimmed = rawValue?.trim();
  return {
    type: "attributeEntry",
    name,
    value:
      trimmed === undefined || trimmed.length === EMPTY ? undefined : trimmed,
    unset: parseUnsetForm(prefixBang, suffixBang),
    position: {
      start: tokenStartLocation(token),
      end: tokenEndLocation(token),
    },
  };
}

/**
 * Extracts the first token from a CST token array and converts it to
 * an AST node using the given builder.
 *
 * CST children are optional arrays -- a rule's token slot is undefined
 * when the alternative wasn't matched. This helper centralizes the
 * presence check so each call site in buildTokenBlock stays concise.
 * @param tokens - The CST token array, which may be undefined or empty
 *   if the alternative wasn't matched.
 * @param build - Builder function that converts a single token into
 *   the corresponding block-level AST node. All callers are the
 *   single-token block builders defined in this module.
 * @returns The built AST node, or undefined if no token was present.
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
 * Dispatches a block CST node to the appropriate single-token AST
 * builder.
 *
 * Some block types (titles, headings, metadata lines, breaks, raw
 * lines) are fully represented by a single line token and need no
 * visitor traversal. This function checks each token slot and builds
 * the AST node directly. Returns undefined for subrule-based blocks
 * (sections, paragraphs, lists, delimited blocks) that require the
 * visitor to recurse.
 * @param context - The CST children of a block rule, containing
 *   optional token arrays for each alternative.
 * @returns The AST node for a single-token block, or undefined if the
 *   block requires visitor traversal.
 */
export function buildTokenBlock(
  context: BlockCstChildren,
): BlockNode | undefined {
  return (
    tryBuild(context.DocumentTitleLine, buildDocumentTitle) ??
    tryBuild(context.DiscreteHeadingLine, buildDiscreteHeading) ??
    tryBuild(context.BlockAttributeLine, buildBlockAttributeList) ??
    tryBuild(context.AnchorLine, buildBlockAnchor) ??
    tryBuild(context.BlockTitleLine, buildBlockTitle) ??
    tryBuild(context.AttributeEntryLine, buildAttributeEntry) ??
    tryBuild(context.RawLine, buildRawBlockLine) ??
    tryBuild(context.BlockMacroLine, buildBlockMacro) ??
    tryBuild(context.ThematicBreakLine, buildThematicBreak) ??
    tryBuild(context.PageBreakLine, buildPageBreak)
  );
}
