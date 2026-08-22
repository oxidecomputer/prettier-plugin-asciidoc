/**
 * Paragraph-shaped blocks: the plain paragraph, the paragraph-form
 * admonition, the indented literal paragraph, and the one-line
 * paragraph that holds a verbatim source line.
 *
 * Every function here is `(span, index) → node` and nothing else: no
 * traversal, no context. What a line MEANS was decided by
 * lines/classify.ts against the registry in line-shapes.ts, and which
 * block it belongs to by the reader's frame stack. These only take it
 * apart.
 */
import type {
  AdmonitionNode,
  DelimitedBlockNode,
  Location,
  ParagraphNode,
} from "../../ast.js";
import {
  EMPTY,
  FIRST,
  FIRST_COLUMN,
  FIRST_LINE,
  LAST_ELEMENT,
} from "../../constants.js";
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
    content.length > EMPTY
      ? at.start(content[FIRST])
      : makeLocation(FIRST, FIRST_LINE, FIRST_COLUMN);
  const last = content.at(LAST_ELEMENT);
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
 * Builds an AdmonitionNode from a paragraph-form admonition.
 * @param label - The admonition label span (e.g. "NOTE: ",
 *   "WARNING: ").
 * @param tokens - The body's lines in source order, one synthetic
 *   token per line (see `textLines` in inline/text-lines.ts); raw
 *   comment/preprocessor lines are lines of their own. May be empty.
 * @param at - The document's location index.
 * @returns An AdmonitionNode in paragraph form with variant
 *   derived from the label (lowercased, colon-space suffix
 *   stripped).
 */
export function buildAdmonitionParagraph(
  label: Fragment,
  tokens: readonly InlineToken[],
  at: LocationIndex,
): AdmonitionNode {
  const content =
    tokens.length > EMPTY ? tokens.map((t) => t.image).join("\n") : undefined;
  const lastTextToken = tokens.at(LAST_ELEMENT);
  const variant = label.image.slice(EMPTY, -COLON_SPACE_LEN).toLowerCase();
  return {
    type: "admonition",
    variant,
    form: "paragraph",
    delimiter: undefined,
    content,
    children: [],
    position: {
      start: at.start(label),
      end: lastTextToken === undefined ? at.end(label) : at.end(lastTextToken),
    },
  };
}

/**
 * An indented literal paragraph: the reader's run of indented lines,
 * joined with newlines. Each line keeps its leading spaces, which is
 * what makes the content verbatim.
 * @param lines - the run's lines, in order, each the whole raw line
 * @param at - the document's location index
 * @returns a literal delimited block in indented form
 */
export function buildLiteralParagraph(
  lines: readonly Fragment[],
  at: LocationIndex,
): DelimitedBlockNode {
  const [first] = lines;
  const last = lines.at(LAST_ELEMENT) ?? first;
  return {
    type: "delimitedBlock",
    variant: "literal",
    form: "indented",
    content: lines.map((line) => line.image).join("\n"),
    position: { start: at.start(first), end: at.end(last) },
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
