/**
 * Paragraph-shaped blocks: the plain paragraph, the paragraph-form
 * admonition, the indented literal paragraph, and the one-line
 * paragraph that holds a verbatim source line.
 *
 * Every function here is `(span, index) → node` and nothing else: no
 * traversal, no context. What a line MEANS was decided by
 * lines/classify.ts against the registry in line-shapes.ts, and which
 * block it belongs to by the extent lines/reader.ts collected for it.
 * These only take it apart.
 */
import type {
  AdmonitionNode,
  DelimitedBlockNode,
  Location,
  ParagraphNode,
  VerbatimVariant,
} from "../../ast.js";
import { FIRST_COLUMN, FIRST_LINE } from "../../constants.js";
import { buildFromTokens } from "../inline/inline-node-builder.js";
import type { InlineToken } from "../inline/tokens.js";
import {
  makeLocation,
  type Fragment,
  type LocationIndex,
} from "../positions.js";

/**
 * The start and end of a paragraph body, from its first to its last
 * CONTENT token — newlines are structural separators, not content; a
 * raw line IS content for this purpose, since it occupies a source
 * line of the paragraph.
 * @param tokens - the body's offset-sorted token stream
 * @param at - the document's location index
 * @returns the content span, or a zero-offset span for an empty body
 *   (the reader never builds an empty paragraph)
 */
export function bodyExtent(
  tokens: readonly InlineToken[],
  at: LocationIndex,
): { start: Location; end: Location } {
  const content = tokens.filter((t) => t.type !== "InlineNewline");
  const start =
    content.length > 0
      ? at.start(content[0])
      : makeLocation(0, FIRST_LINE, FIRST_COLUMN);
  const last = content.at(-1);
  return { start, end: last === undefined ? start : at.end(last) };
}

/**
 * A plain paragraph: its inline body, positioned over the CONTENT
 * tokens — newlines are separators, not content, so a paragraph does
 * not end on the line break that ended it.
 * @param tokens - the body's tokens, in source order
 * @param at - the document's location index
 * @returns the paragraph node
 */
export function buildParagraph(
  tokens: readonly InlineToken[],
  at: LocationIndex,
): ParagraphNode {
  return {
    type: "paragraph",
    children: buildFromTokens(tokens, at),
    position: bodyExtent(tokens, at),
  };
}

// Colon-space suffix length in admonition markers ("NOTE: ").
const COLON_SPACE_LEN = 2;

/**
 * Builds an AdmonitionNode from a paragraph-form admonition. The body
 * keeps the SAME inline children a paragraph has — the
 * tokens are in hand at the reader's call site; no per-line
 * flattening remains. Position: start at the label, end at the last
 * content token (label end when the body is empty) — unchanged.
 * @param label - The admonition label span (e.g. "NOTE: ").
 * @param tokens - The body's tokens, in source order. May be empty.
 * @param at - The document's location index.
 * @returns An AdmonitionNode in paragraph form.
 */
export function buildAdmonitionParagraph(
  label: Fragment,
  tokens: readonly InlineToken[],
  at: LocationIndex,
): AdmonitionNode {
  const content = tokens.filter((t) => t.type !== "InlineNewline");
  const last = content.at(-1);
  return {
    type: "admonition",
    variant: label.image.slice(0, -COLON_SPACE_LEN).toLowerCase(),
    form: "paragraph",
    text: buildFromTokens(tokens, at),
    children: [],
    position: {
      start: at.start(label),
      end: last === undefined ? at.end(label) : at.end(last),
    },
  };
}

/**
 * An indented literal paragraph: the reader's run of indented lines,
 * joined with newlines. Each line keeps its leading spaces, which is
 * what makes the content verbatim.
 *
 * The run's first line is its own parameter, the same way
 * {@link buildStyledParagraph} takes one: the run cannot be empty —
 * literalParagraphExtent opens it ON the indented line — and saying so
 * in the signature makes `rest.at(-1) ?? first` a total answer instead
 * of a guard the run's non-emptiness had to be trusted for.
 * @param first - the run's first (indented) line
 * @param rest - the run's remaining lines, in order; empty for a
 *   one-line paragraph
 * @param at - the document's location index
 * @returns a literal delimited block in indented form
 */
export function buildLiteralParagraph(
  first: Fragment,
  rest: readonly Fragment[],
  at: LocationIndex,
): DelimitedBlockNode {
  const last = rest.at(-1) ?? first;
  return {
    type: "delimitedBlock",
    variant: "literal",
    form: "indented",
    content: [first, ...rest].map((line) => line.image).join("\n"),
    position: { start: at.start(first), end: at.end(last) },
  };
}

/**
 * A verbatim-styled paragraph, built at OPEN from the lines the
 * `verbatimStyled` extent consumed: content is the source
 * slice from the first content line's start to the last line's raw
 * end (no trailing newline), so the bytes are the author's. The
 * extent's non-emptiness lives in the SIGNATURE — the first line is
 * its own parameter — so no `lines.at(-1) ?? first` interior-
 * validation site appears here (the registry may not grow, review
 * M1); `rest.at(-1) ?? first` below is a TOTAL answer, since `rest`
 * really is empty for a one-line block.
 * @param variant - the style's target variant (verbatimStyledVariant)
 * @param first - the extent's first line
 * @param rest - the extent's remaining lines, in order; empty for a
 *   one-line block
 * @param at - the document's location index
 * @returns a verbatim block in paragraph form
 */
export function buildStyledParagraph(
  variant: VerbatimVariant,
  first: Fragment,
  rest: readonly Fragment[],
  at: LocationIndex,
): DelimitedBlockNode {
  const last = rest.at(-1) ?? first;
  return {
    type: "delimitedBlock",
    variant,
    form: "paragraph",
    content: [first, ...rest].map((line) => line.image).join("\n"),
    position: { start: at.start(first), end: at.end(last) },
  };
}

/**
 * A paragraph-form block built where the reader was ABOUT to build a
 * paragraph and a held non-verbatim paragraph-form style spoke: same
 * extent the paragraph would have had (the tokens were
 * read with the paragraph's own context), content by source slice —
 * byte-identical to the deleted post-pass conversion, minus the
 * serializer (#40).
 * @param variant - the style's target (paragraphFormVariant)
 * @param tokens - the paragraph body's tokens, as read
 * @param source - the whole document
 * @param at - the document's location index
 * @returns a delimited block in paragraph form
 */
export function buildParagraphFormBlock(
  variant: VerbatimVariant,
  tokens: readonly InlineToken[],
  source: string,
  at: LocationIndex,
): DelimitedBlockNode {
  const position = bodyExtent(tokens, at);
  return {
    type: "delimitedBlock",
    variant,
    form: "paragraph",
    content: source.slice(position.start.offset, position.end.offset),
    position,
  };
}

/**
 * Builds a paragraph holding one verbatim line: the block-level form
 * of a raw line that is not a comment or a preprocessor directive. The
 * one shape that reaches it is the second of two adjacent `+` lines
 * inside a list item, which Asciidoctor keeps as CONTENT of the
 * attached block (`read_lines_for_list_item`'s `:frozen` state) and
 * the reader therefore builds as a raw-line leaf. The printer keeps a
 * `rawLine` on an output line of its own, so the byte survives where
 * it was written.
 * @param line - The raw line.
 * @param at - The document's location index.
 * @returns A paragraph whose only child is the raw line.
 */
export function buildRawLineParagraph(
  line: Fragment,
  at: LocationIndex,
): ParagraphNode {
  const position = { start: at.start(line), end: at.end(line) };
  return {
    type: "paragraph",
    children: [{ type: "rawLine", value: line.image, position }],
    position,
  };
}
