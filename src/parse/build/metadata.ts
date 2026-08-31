/**
 * One-line blocks: the block metadata that annotates what follows
 * (anchors, attribute lists, block titles), and the standalone lines
 * that are a whole block by themselves (attribute entries, macros,
 * breaks, comments, preprocessor directives).
 *
 * Every function here is `(span, index) → node` and nothing else: no
 * traversal, no context. What a line MEANS was decided by
 * lines/classify.ts against the registry in line-shapes.ts, and which
 * block it belongs to by the extent lines/reader.ts collected for it.
 * These only take it apart.
 */
import type {
  AttributeEntryNode,
  BlockAnchorNode,
  BlockAttributeListNode,
  BlockMacroNode,
  BlockNode,
  BlockTitleNode,
  CommentNode,
  PageBreakNode,
  PreprocessorDirectiveNode,
  ThematicBreakNode,
} from "../../ast.js";
import { makeInlineAnchor } from "../inline/inline-link-builder.js";
import { rawLineForm, rstrip } from "../line-shapes.js";
import type { Fragment, LocationIndex } from "../positions.js";
import { buildRawLineParagraph } from "./paragraph.js";

// A "// text" line arrives as one raw line. We strip the leading
// "// " (or just "//") to get the comment text. The space after // is
// syntactic, not content. Prefix "//" is 2 characters; the space
// separator is 1 more.
const LINE_COMMENT_PREFIX_LEN = 2;
const LINE_COMMENT_SPACE_LEN = 1;

/**
 * Builds a CommentNode from a line comment.
 *
 * Strips the syntactic `//` prefix and the optional space separator
 * to extract just the comment text. An empty comment (`//` with
 * nothing after) yields an empty string value.
 * @param line - A raw line whose image starts with `//`.
 * @param at - The document's location index.
 * @returns A comment node with commentType "line" and the extracted
 *   text content.
 */
function buildLineComment(line: Fragment, at: LocationIndex): CommentNode {
  // Strip the leading "//" to get " text" or "".
  const raw = line.image.slice(LINE_COMMENT_PREFIX_LEN);
  // If the comment has content, it starts with a space —
  // strip it.
  const value = raw.startsWith(" ") ? raw.slice(LINE_COMMENT_SPACE_LEN) : raw;

  return {
    type: "comment",
    commentType: "line",
    value,
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

// Block attribute list line is `[content]`. We strip the outer
// brackets to get the raw attribute content.
const BLOCK_ATTR_LIST_PREFIX_LEN = 1;
const BLOCK_ATTR_LIST_SUFFIX_LEN = 1;

/**
 * Builds a BlockAttributeListNode from a block attribute line.
 *
 * The line is `[content]`. We strip the outer brackets so the
 * AST stores only the raw attribute text -- the printer re-wraps it in
 * brackets when emitting output.
 * @param line - A block attribute line, bracket-delimited.
 * @param at - The document's location index.
 * @returns A block attribute list node with the inner content as its
 *   value.
 */
export function buildBlockAttributeList(
  line: Fragment,
  at: LocationIndex,
): BlockAttributeListNode {
  const value = line.image.slice(
    BLOCK_ATTR_LIST_PREFIX_LEN,
    // Negated to slice from the end: -1 drops the trailing `]`.
    -BLOCK_ATTR_LIST_SUFFIX_LEN,
  );
  return {
    type: "blockAttributeList",
    value,
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

// Block title line is `.Title text`. The leading dot is syntactic —
// we strip it to get the title text. The registry's BLOCK_TITLE
// pattern guarantees the character immediately after the dot is
// non-whitespace, so no trim() is needed here (unlike the heading
// builder, where the spec allows arbitrary whitespace between the
// marker and the title text).
const BLOCK_TITLE_PREFIX_LEN = 1;

/**
 * Builds a BlockTitleNode from a block-title line.
 *
 * The line is `.Title text`. The leading dot is syntactic, so
 * we strip it -- the printer re-adds the dot prefix during output.
 * @param line - A block-title line, starting with `.`.
 * @param at - The document's location index.
 * @returns A block title node with the extracted title text.
 */
export function buildBlockTitle(
  line: Fragment,
  at: LocationIndex,
): BlockTitleNode {
  return {
    type: "blockTitle",
    title: line.image.slice(BLOCK_TITLE_PREFIX_LEN),
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

/**
 * Builds a ThematicBreakNode from a thematic-break line.
 *
 * Thematic breaks (`'''`) carry no content -- only source position is
 * preserved so the printer can place the delimiter correctly.
 * @param line - A thematic-break line (`'''` or longer).
 * @param at - The document's location index.
 * @returns A thematic break node with source position.
 */
export function buildThematicBreak(
  line: Fragment,
  at: LocationIndex,
): ThematicBreakNode {
  return {
    type: "thematicBreak",
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

/**
 * Builds a PageBreakNode from a page-break line.
 *
 * Page breaks (`<<<`) carry no content -- only source position is
 * preserved so the printer can place the delimiter correctly.
 * @param line - A page-break line (`<<<` or longer).
 * @param at - The document's location index.
 * @returns A page break node with source position.
 */
export function buildPageBreak(
  line: Fragment,
  at: LocationIndex,
): PageBreakNode {
  return {
    type: "pageBreak",
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

/**
 * Builds a BlockMacroNode from the classifier's parsed fields — group
 * captures taken over the rstripped `text` transfer to the raw
 * `image` unchanged, because rstrip trims only the end of the line
 * and every captured span ends at or before the closing bracket.
 * @param kind - the classifier's parse of the line
 * @param kind.name - macro name
 * @param kind.target - target between `::` and `[`
 * @param kind.attrlist - raw attrlist content
 * @param line - the block macro line's span
 * @param at - The document's location index.
 * @returns A block macro node with name, target, and attrlist.
 */
export function buildBlockMacro(
  kind: { name: string; target: string; attrlist: string },
  line: Fragment,
  at: LocationIndex,
): BlockMacroNode {
  return {
    type: "blockMacro",
    name: kind.name,
    target: kind.target,
    attrlist: kind.attrlist,
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

/**
 * Build a block anchor node from a block anchor line — its OWN node
 * kind: two sites used to recognise "anchor" by pattern-matching a
 * wrapper paragraph's internals, and a first-class syntactic form was
 * riding as a degenerate paragraph.
 *
 * Reuses `makeInlineAnchor` for the line's interior, so the id and
 * reftext split has one spelling. `makeInlineAnchor`
 * (parse/inline/inline-link-builder.ts's `splitAnchor`) assumes its
 * fragment IS the `[[...]]` token, delimiters included and nothing
 * past the closing pair - true of an inline anchor, whose tokenizer
 * span ends at the second `]`, but not of `line`: the classifier
 * that routed this line here matched a RSTRIPPED copy (`^...$` over
 * one rstripped line, line-shapes.ts's `wholeLine`), while `line`
 * itself is the raw span, trailing ASCII whitespace and all
 * (issue #69, Face 1). `slice(width, -width)` then cuts its last two
 * bytes off the WRONG end - the trailing blanks, not the closing
 * `]]` - leaving `]` characters from the real delimiter stuck to the
 * id. rstripping here, once, before the split, is what makes this
 * builder see the same bytes the classifier already judged.
 * @param line - A block anchor line (`[[id]]` on its own line).
 * @param at - The document's location index.
 * @returns The block anchor node.
 */
export function buildBlockAnchor(
  line: Fragment,
  at: LocationIndex,
): BlockAnchorNode {
  const anchor = makeInlineAnchor(
    { image: rstrip(line.image), offset: line.offset },
    at,
  );
  return {
    type: "blockAnchor",
    id: anchor.id,
    reftext: anchor.reftext,
    position: anchor.position,
  };
}

/**
 * Builds a PreprocessorDirectiveNode from a directive line.
 *
 * The node carries the line verbatim rather than a decomposition into
 * keyword/target/attrlist: the formatter never resolves a directive,
 * and Asciidoctor's own reader
 * (`PreprocessorReader#process_line`, reader.rb:824) removes the line
 * from the stream before block parsing, so there is no block for the
 * parts to describe.
 *
 * "Verbatim" means the RSTRIPPED line: `Helpers.prepare_source_string`
 * strips every line before any rule runs, so trailing whitespace is
 * not part of what Asciidoctor read, and Prettier trims it before a
 * break in any case.
 * @param line - A raw line of conditional or include form
 *   (e.g. `ifdef::backend[]`, `include::chapter.adoc[]`).
 * @param at - The document's location index.
 * @returns The verbatim directive node.
 */
function buildPreprocessorDirective(
  line: Fragment,
  at: LocationIndex,
): PreprocessorDirectiveNode {
  return {
    type: "preprocessorDirective",
    value: rstrip(line.image),
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

/**
 * Builds the block for a raw line the reader read between blocks —
 * a comment or a preprocessor directive kept verbatim, or a line that
 * is raw for another reason (see `buildRawLineParagraph`).
 *
 * Classifies the RSTRIPPED image: a span carries the author's bytes
 * (`SourceLine.raw`) while every shape in the registry is written
 * against the rstripped spelling (`SourceLine.text`), so
 * `ifdef::backend[]␠␠` would otherwise miss the `$`-anchored
 * directive pattern and lose its transparency.
 * @param line - The raw line.
 * @param at - The document's location index.
 * @returns The block node for the line.
 */
export function buildRawBlockLine(
  line: Fragment,
  at: LocationIndex,
): BlockNode {
  return buildReaderConsumedLine(line, at) ?? buildRawLineParagraph(line, at);
}

/**
 * Builds the node for a line Asciidoctor's READER consumes wherever it
 * stands - a line comment or a preprocessor directive - and nothing
 * else.
 *
 * Split out of {@link buildRawBlockLine} because the document-header
 * scan needs exactly this half and must not have the other: a header
 * line that is neither of these is the AUTHOR line, not a paragraph
 * (`process_attribute_entries` -> `Reader#skip_comment_lines`,
 * parser.rb), so a paragraph fallback reaching the header would put a
 * node kind in it that {@link HeaderLineNode} does not admit. One
 * derivation, two consumers, so the two cannot come to disagree about
 * which lines the reader eats.
 *
 * Classifies the RSTRIPPED image, for the reason
 * {@link buildRawBlockLine} states.
 * @param line - The raw line.
 * @param at - The document's location index.
 * @returns The comment or directive node, or undefined when the line
 *   is neither.
 */
export function buildReaderConsumedLine(
  line: Fragment,
  at: LocationIndex,
): CommentNode | PreprocessorDirectiveNode | undefined {
  switch (rawLineForm(rstrip(line.image))) {
    case "comment": {
      return buildLineComment(line, at);
    }
    case "conditional":
    case "include": {
      return buildPreprocessorDirective(line, at);
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Builds an AttributeEntryNode from the classifier's parsed fields —
 * the value arrives trimmed and empty-narrowed; nothing is
 * re-derived.
 * @param kind - the classifier's parse of the line
 * @param kind.name - the attribute name
 * @param kind.value - the trimmed value, or undefined
 * @param kind.unset - whether the entry unsets the attribute
 * @param line - the attribute-entry line's span
 * @param at - The document's location index.
 * @returns the attribute entry node
 */
export function buildAttributeEntry(
  kind: { name: string; value: string | undefined; unset: boolean },
  line: Fragment,
  at: LocationIndex,
): AttributeEntryNode {
  return {
    type: "attributeEntry",
    name: kind.name,
    value: kind.value,
    unset: kind.unset,
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}
