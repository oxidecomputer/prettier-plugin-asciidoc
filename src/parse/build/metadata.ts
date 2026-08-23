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
import { unreachable } from "../../unreachable.js";
import { makeInlineAnchor } from "../inline/inline-link-builder.js";
import { rstrip } from "../line-shapes.js";
import { rawLineForm } from "../lines/classify.js";
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

// Regex to decompose a block macro line into its three
// parts: name, target, and attribute list.
const BLOCK_MACRO_RE =
  /^(?<name>[a-zA-Z]\w*)::(?<target>[^\[]*)\[(?<attrlist>[^\]]*)\]/v;

/**
 * Builds a BlockMacroNode from a block macro line.
 *
 * Block macros follow the `name::target[attrlist]` pattern. The regex
 * splits the line into the three components so the AST
 * preserves them as structured fields rather than a raw string.
 * @param line - A block macro line (e.g. `image::sunset.jpg[Alt]`).
 * @param at - The document's location index.
 * @returns A block macro node with name, target, and attrlist.
 */
export function buildBlockMacro(
  line: Fragment,
  at: LocationIndex,
): BlockMacroNode {
  // The classifier's BLOCK_MACRO and this file's BLOCK_MACRO_RE are
  // two patterns for one shape; the guard is what says they must
  // agree. It is not defence against user input — a line that is not
  // a block macro never reaches here.
  const match = BLOCK_MACRO_RE.exec(line.image);
  const groups =
    match?.groups ?? unreachable(`Invalid block macro: ${line.image}`);
  return {
    type: "blockMacro",
    name: groups.name,
    target: groups.target,
    attrlist: groups.attrlist,
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}

/**
 * Build a block anchor node from a block anchor line (spec D6: its
 * own kind — two sites used to recognise "anchor" by pattern-matching
 * a wrapper paragraph's internals, and a first-class syntactic form
 * was riding as a degenerate paragraph).
 *
 * Reuses `makeInlineAnchor` for the line's interior, so the id and
 * reftext split has one spelling.
 * @param line - A block anchor line (`[[id]]` on its own line).
 * @param at - The document's location index.
 * @returns The block anchor node.
 */
export function buildBlockAnchor(
  line: Fragment,
  at: LocationIndex,
): BlockAnchorNode {
  const anchor = makeInlineAnchor(line, at);
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
 * (`PreprocessorReader#process_line`, reader.rb:819) removes the line
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
  switch (rawLineForm(rstrip(line.image))) {
    case "comment": {
      return buildLineComment(line, at);
    }
    case "conditional":
    case "include": {
      return buildPreprocessorDirective(line, at);
    }
    default: {
      return buildRawLineParagraph(line, at);
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
function parseUnsetForm(
  prefix: string,
  suffix: string,
): false | "prefix" | "suffix" {
  if (prefix === "!") return "prefix";
  if (suffix === "!") return "suffix";
  return false;
}

/**
 * Parses an attribute entry line (`:name: value`) into its components.
 * Handles three forms: set (`:name: value`), prefix-unset (`:!name:`),
 * and suffix-unset (`:name!:`).
 * @param line - An attribute-entry line, the full line.
 * @param at - The document's location index.
 * @returns Attribute entry node with parsed name, optional trimmed
 *   value, and unset form indicator.
 */
export function buildAttributeEntry(
  line: Fragment,
  at: LocationIndex,
): AttributeEntryNode {
  const groups =
    ATTRIBUTE_ENTRY_RE.exec(line.image)?.groups ??
    unreachable(`Invalid attribute entry: ${line.image}`);
  const { prefixBang, name, suffixBang } = groups;
  // TypeScript types regex groups as `string`, but unmatched
  // optional groups are `undefined` at runtime.
  const rawValue = groups.value as string | undefined;
  const trimmed = rawValue?.trim();
  return {
    type: "attributeEntry",
    name,
    value: trimmed === undefined || trimmed.length === 0 ? undefined : trimmed,
    unset: parseUnsetForm(prefixBang, suffixBang),
    position: {
      start: at.start(line),
      end: at.end(line),
    },
  };
}
