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
  BlockNode,
  DelimitedBlockNode,
  Location,
  ParagraphNode,
  VerbatimVariant,
} from "../../ast.js";
import { FIRST_COLUMN, FIRST_LINE } from "../../constants.js";
import { annotation } from "./delimited.js";
import { buildFromTokens } from "../inline/inline-node-builder.js";
import { isSingleWordLine, rstrip } from "../line-shapes.js";
import type { InlineToken } from "../inline/tokens.js";
import {
  makeLocation,
  type Fragment,
  type LocationIndex,
} from "../positions.js";

/**
 * What the block-attribute line held above a paragraph made of it: the
 * variant its style named, and the line's own bracket interior as the
 * reader recorded it.
 *
 * TWO facts with two producers, travelling as ONE parameter because
 * the linter caps a builder at four and both builders that take this
 * were already at four; the device is the `rename` parameter of
 * buildDelimitedAdmonition (build/delimited.ts), for the same reason.
 * Each field names its own producer, because the two rules differ:
 * `annotatedBy` is set only when the attribute line is the LAST node
 * of the held run, which is stricter than the style's transparency.
 *
 * NOT exported (knip's types bucket gates dead exported types at 0):
 * the reader passes an object literal, and the name exists for the two
 * signatures alone.
 */
interface HeldStyle {
  /**
   * The variant the style named - `paragraphFormVariant` or
   * `verbatimStyledVariant` over `HeldMetadata.actionableStyle`
   * (lines/open-style.ts, lines/held-metadata.ts).
   */
  readonly variant: VerbatimVariant;
  /**
   * The attribute line's bracket interior (`HeldMetadata.annotation`),
   * or undefined when no attribute line ended the held run.
   */
  readonly annotatedBy: string | undefined;
}

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
 * Whether the source line a block OPENS ON ends after its first word -
 * `ParagraphNode.firstWordEndsItsLine` (src/ast.ts carries the whole
 * argument and the printer that reads it).
 *
 * Measured off the SOURCE from the block's own start offset, so the
 * indentation and any prefix in front of the block (a description
 * list's term column) are outside the question, and rstripped before
 * the test the way every registry rule is matched.
 * @param source - the whole document
 * @param start - the block's start offset
 * @returns true when one word stands between that offset and the end
 *   of its line
 */
function firstWordEndsItsLine(source: string, start: number): boolean {
  const newline = source.indexOf("\n", start);
  return isSingleWordLine(
    rstrip(source.slice(start, newline === -1 ? source.length : newline)),
  );
}

/**
 * A plain paragraph: its inline body, positioned over the CONTENT
 * tokens — newlines are separators, not content, so a paragraph does
 * not end on the line break that ended it.
 * @param tokens - the body's tokens, in source order
 * @param source - the whole document, for the block's own first line
 * @param at - the document's location index
 * @returns the paragraph node
 */
export function buildParagraph(
  tokens: readonly InlineToken[],
  source: string,
  at: LocationIndex,
): ParagraphNode {
  const position = bodyExtent(tokens, at);
  return {
    type: "paragraph",
    children: buildFromTokens(tokens, at),
    firstWordEndsItsLine: firstWordEndsItsLine(source, position.start.offset),
    position,
  };
}

// Where an admonition's NAME ends inside the label span. Everything
// after it is separator: the colon, then the blanks
// `AdmonitionParagraphRx` requires (`[ \t]+`, one or more) and whose
// width the span therefore does not fix.
const LABEL_COLON = ":";

/**
 * Builds an AdmonitionNode from a paragraph-form admonition. The body
 * keeps the SAME inline children a paragraph has — the
 * tokens are in hand at the reader's call site; no per-line
 * flattening remains. Position: start at the label, end at the last
 * content token (label end when the body is empty) — unchanged.
 *
 * The variant is the name in FRONT of the colon, cut at the colon
 * rather than by taking a fixed two characters off the label's end.
 * The label span is the whole prefix the registry matched, and the
 * blanks after the colon are `[ \t]+` — one or more — so a fixed cut
 * kept every surplus blank in the variant ("NOTE:    text" gave
 * "note:  ") and a tab gave "not". The printer spells the variant
 * back with a colon after it, so either residue put a SECOND colon
 * run on the line, which re-reads as a description-list term.
 * @param label - The admonition label span (e.g. "NOTE: "). Its image
 *   always contains the colon: the reader passes the registry's
 *   matched prefix group (src/parse/lines/reader.ts), whose pattern
 *   requires it. A hand-built Fragment without one would cut the
 *   variant a character short rather than throw.
 * @param tokens - The body's tokens, in source order. May be empty.
 * @param at - The document's location index.
 * @returns An AdmonitionNode in paragraph form.
 */
export function buildAdmonitionParagraph(
  label: Fragment,
  tokens: readonly InlineToken[],
  at: LocationIndex,
): AdmonitionNode {
  return admonitionOver(
    {
      label: label.image.slice(0, label.image.indexOf(LABEL_COLON)),
      span: { start: at.start(label), end: at.end(label) },
    },
    tokens,
    at,
  );
}

/**
 * What the held metadata run makes of the paragraph about to open -
 * the whole answer as ONE value, so a paragraph cannot be both an
 * admonition and a styled block, and the reader has one question to
 * ask (`HeldMetadata.paragraphOpening`, lines/held-metadata.ts).
 */
export type ParagraphOpening =
  | {
      /** A bare admonition style line stands over it. */
      readonly kind: "admonition";
      /** The variant that line spells, and the line's own span. */
      readonly style: AdmonitionOpening;
    }
  | {
      /** A paragraph-form style line converts it to a verbatim block. */
      readonly kind: "styled";
      /** The style's target, and the annotation the reader recorded. */
      readonly held: HeldStyle;
    }
  | {
      /** Nothing the held run carried changes what it is. */
      readonly kind: "plain";
    };

/**
 * The block a paragraph's tokens become, once the held run has
 * spoken - the three shapes {@link ParagraphOpening} distinguishes,
 * resolved in one place so the reader pushes one node and names no
 * builder of its own.
 * @param opening - what the held run made of this paragraph
 * @param tokens - the body's tokens, in source order
 * @param source - the whole document, for the block's own first line
 * @param at - the document's location index
 * @returns the admonition, the verbatim block, or the paragraph
 */
export function buildParagraphNode(
  opening: ParagraphOpening,
  tokens: readonly InlineToken[],
  source: string,
  at: LocationIndex,
): BlockNode {
  switch (opening.kind) {
    case "admonition": {
      return admonitionOver(opening.style, tokens, at);
    }
    case "styled": {
      return buildParagraphFormBlock(opening.held, tokens, source, at);
    }
    case "plain": {
      return buildParagraph(tokens, source, at);
    }
  }
}

/**
 * What a paragraph-form admonition's opening line contributes.
 *
 * ONE node for both spellings, which is the point: `[NOTE]` over a
 * paragraph and `NOTE: ` in front of it are the same admonition to
 * Asciidoctor (parser.rb:730, content_model :simple), so the reader
 * records the admonition and the printer writes the label form for
 * both. The style line's own node is not built at all - it is the
 * admonition's opening bytes, which is why the span starts there.
 */
interface AdmonitionOpening {
  /** The variant, as that line spells it (`NOTE`). */
  readonly label: string;
  /** The line's own span; the node starts here. */
  readonly span: AdmonitionNode["position"];
}

/**
 * The paragraph-form admonition both spellings build: the variant
 * lowercased, the body as a paragraph's own inline children, and a
 * span from the opening line to the last content token.
 * @param opening - what the opening line contributes
 * @param tokens - the body's tokens, in source order; may be empty
 * @param at - the document's location index
 * @returns the admonition node
 */
function admonitionOver(
  opening: AdmonitionOpening,
  tokens: readonly InlineToken[],
  at: LocationIndex,
): AdmonitionNode {
  const content = tokens.filter((t) => t.type !== "InlineNewline");
  const last = content.at(-1);
  return {
    type: "admonition",
    variant: opening.label.toLowerCase(),
    form: "paragraph",
    text: buildFromTokens(tokens, at),
    children: [],
    position: {
      start: opening.span.start,
      end: last === undefined ? opening.span.end : at.end(last),
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
 * @param annotatedBy - the annotation the reader recorded, if any
 * @returns a literal delimited block in indented form
 */
export function buildLiteralParagraph(
  first: Fragment,
  rest: readonly Fragment[],
  at: LocationIndex,
  annotatedBy: string | undefined,
): DelimitedBlockNode {
  const last = rest.at(-1) ?? first;
  return {
    type: "delimitedBlock",
    variant: "literal",
    form: "indented",
    content: [first, ...rest].map((line) => line.image).join("\n"),
    position: { start: at.start(first), end: at.end(last) },
    ...annotation(annotatedBy),
  };
}

/**
 * A verbatim-styled paragraph, built at OPEN from the lines the
 * `verbatimStyled` extent consumed: content is the source
 * slice from the first content line's start to the last line's raw
 * end (no trailing newline), so the bytes are the author's. The
 * extent's non-emptiness lives in the SIGNATURE — the first line is
 * its own parameter — so no `lines.at(-1) ?? first` interior-
 * validation site appears here (the registry may not grow);
 * `rest.at(-1) ?? first` below is a TOTAL answer, since `rest`
 * really is empty for a one-line block.
 * @param held - what the held attribute line made of the block
 * @param held.variant - the style's target (verbatimStyledVariant)
 * @param held.annotatedBy - the annotation the reader recorded, if any
 * @param first - the extent's first line
 * @param rest - the extent's remaining lines, in order; empty for a
 *   one-line block
 * @param at - the document's location index
 * @returns a verbatim block in paragraph form
 */
export function buildStyledParagraph(
  held: HeldStyle,
  first: Fragment,
  rest: readonly Fragment[],
  at: LocationIndex,
): DelimitedBlockNode {
  const last = rest.at(-1) ?? first;
  return {
    type: "delimitedBlock",
    variant: held.variant,
    form: "paragraph",
    content: [first, ...rest].map((line) => line.image).join("\n"),
    position: { start: at.start(first), end: at.end(last) },
    ...annotation(held.annotatedBy),
  };
}

/**
 * A paragraph-form block built where the reader was ABOUT to build a
 * paragraph and a held non-verbatim paragraph-form style spoke: same
 * extent the paragraph would have had (the tokens were
 * read with the paragraph's own context), content by source slice —
 * byte-identical to the deleted post-pass conversion, minus the
 * serializer (#40).
 * @param held - what the held attribute line made of the block
 * @param held.variant - the style's target (paragraphFormVariant)
 * @param held.annotatedBy - the annotation the reader recorded, if any
 * @param tokens - the paragraph body's tokens, as read
 * @param source - the whole document
 * @param at - the document's location index
 * @returns a delimited block in paragraph form
 */
function buildParagraphFormBlock(
  held: HeldStyle,
  tokens: readonly InlineToken[],
  source: string,
  at: LocationIndex,
): DelimitedBlockNode {
  const position = bodyExtent(tokens, at);
  return {
    type: "delimitedBlock",
    variant: held.variant,
    form: "paragraph",
    content: source.slice(position.start.offset, position.end.offset),
    position,
    ...annotation(held.annotatedBy),
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
    // The fragment IS the whole line, so its image is the source slice
    // the question is about; offset 0 is that slice's own start.
    firstWordEndsItsLine: firstWordEndsItsLine(line.image, 0),
    position,
  };
}
