/**
 * Post-parse transformations: paragraph-form blocks and
 * block masquerading (style-driven content model).
 *
 * **Paragraph-form blocks:** When a `BlockAttributeListNode` with a
 * recognized block style (source, listing, literal, pass, verse,
 * quote, example, sidebar) immediately precedes a `ParagraphNode`,
 * the paragraph is converted to a `DelimitedBlockNode` with
 * `form: "paragraph"`.
 *
 * **Block masquerading:** When a style attribute on a delimited
 * block changes its effective content model, the block is
 * transformed accordingly. For example, `[verse]` before a
 * `____` block converts it from compound (parsed children) to
 * verbatim (raw string content), because verse line breaks are
 * semantically significant and must not be reflowed.
 *
 * Both transformations keep the attribute list node as a separate
 * sibling — the printer's stacking behavior handles placing it on
 * the line before the block content.
 *
 * This runs on the flat block array after CST visiting but before
 * section nesting, so blocks inside sections are handled correctly.
 */
import type {
  AdmonitionNode,
  BlockNode,
  BlockAttributeListNode,
  DelimitedBlockNode,
  InlineNode,
  ParentBlockNode,
  ParagraphNode,
} from "../ast.js";
import {
  inlineMacroToSource,
  linkToSource,
  xrefToSource,
  anchorToSource,
} from "../serialize-inline.js";
import { FIRST, NEWLINE_LENGTH, NEXT, PAIR_LENGTH } from "../constants.js";

// Matches any single word composed entirely of uppercase ASCII letters.
// Used by getAdmonitionVariant to recognise NOTE, TIP, IMPORTANT, etc.
// Module-level so the regex is compiled once, not on every call.
const UPPERCASE_WORD = /^[A-Z]+$/v;

// Maps recognized first positional attribute values to the
// `DelimitedBlockNode.variant` they produce. AsciiDoc `source`
// and `listing` both map to the "listing" variant.
const PARAGRAPH_FORM_STYLES: ReadonlyMap<
  string,
  DelimitedBlockNode["variant"]
> = new Map([
  ["source", "listing"],
  ["listing", "listing"],
  ["literal", "literal"],
  ["pass", "pass"],
  ["verse", "verse"],
  ["quote", "quote"],
  ["example", "example"],
  ["sidebar", "sidebar"],
]);

// Maps style attributes that masquerade a parent block's
// content model to verbatim. The key is the style name
// (first positional attribute), the value is the target
// `DelimitedBlockNode.variant`. Only styles that CHANGE the
// content model from compound (parsed children) to verbatim
// (raw string) are included. Styles that keep the block
// compound (e.g. `[quote]` on `--`) need no transformation.
//
// The two-level structure (parent variant → style → target)
// is necessary because valid masquerade styles differ per
// parent block type (e.g. `[verse]` is valid on `____`
// quote blocks but not `====` example blocks).
//
// Outer map: parent block variant → inner map of masquerade
// style → delimited block variant.
//
// Pass-block masquerades ([stem]/[latexmath]/[asciimath] on
// `++++`) are deliberately absent: they don't change the
// content model (raw → raw, still verbatim).
const VERBATIM_MASQUERADES: ReadonlyMap<
  ParentBlockNode["variant"],
  ReadonlyMap<string, DelimitedBlockNode["variant"]>
> = new Map([
  [
    "quote",
    new Map<string, DelimitedBlockNode["variant"]>([
      ["verse", "verse"],
      ["stem", "pass"],
      ["latexmath", "pass"],
      ["asciimath", "pass"],
    ]),
  ],
  [
    "open",
    new Map<string, DelimitedBlockNode["variant"]>([
      ["source", "listing"],
      ["listing", "listing"],
      ["literal", "literal"],
      ["pass", "pass"],
      ["comment", "pass"],
      ["verse", "verse"],
    ]),
  ],
]);

/**
 * Extracts the first positional attribute (the style) from
 * a block attribute list value. The value is the text
 * between brackets, e.g. "source,ruby" -> "source".
 * @param value - The `.value` field of a
 *   `BlockAttributeListNode`: the raw text inside the
 *   brackets, not including the brackets themselves
 *   (e.g. `"source,ruby"`).
 * @returns The trimmed style name (everything before the
 *   first comma).
 */
function extractStyle(value: string): string {
  // Split on the first comma to isolate the style name from
  // any additional positional attributes (e.g. language in
  // `[source,ruby]`). Shorthand values like `#myid` and `.role`
  // (no comma) are returned as-is; they won't match any entry
  // in the caller's lookup tables, so callers don't need to
  // special-case them.
  const [first] = value.split(",");
  return first.trim();
}

/**
 * Checks whether a block attribute list declares a
 * recognized paragraph-form style (source, listing,
 * literal, pass, verse, quote, example, sidebar).
 * @param node - The attribute list node whose first
 *   positional attribute is tested against the
 *   `PARAGRAPH_FORM_STYLES` lookup table.
 * @returns The target delimited-block variant, or
 *   `undefined` if the style is not a paragraph-form
 *   style.
 */
function getParagraphFormVariant(
  node: BlockAttributeListNode,
): DelimitedBlockNode["variant"] | undefined {
  const style = extractStyle(node.value);
  return PARAGRAPH_FORM_STYLES.get(style);
}

/**
 * Checks whether a block attribute list declares an
 * admonition type (NOTE, TIP, IMPORTANT, CAUTION,
 * WARNING, or custom types like EXERCISE).
 * @param node - The attribute list node whose first
 *   positional attribute is tested. Only single
 *   uppercase words match; styles with commas, dots,
 *   or hashes (e.g. `[source,ruby]`) are excluded.
 * @returns The lowercase admonition variant name, or
 *   `undefined` if the style is not an admonition.
 */
function getAdmonitionVariant(
  node: BlockAttributeListNode,
): string | undefined {
  const style = extractStyle(node.value).toUpperCase();
  // Any single uppercase word is treated as an admonition type.
  // AsciiDoc defines five (NOTE, TIP, IMPORTANT, CAUTION, WARNING)
  // but the spec allows custom variants. Using uppercase as the
  // discriminator means [source,ruby], [#myid], and [.role] are
  // naturally excluded — extractStyle already trims the first token,
  // and the comma/hash/dot residues prevent an all-uppercase match.
  if (UPPERCASE_WORD.test(style)) {
    return style.toLowerCase();
  }
  return undefined;
}

/**
 * Checks whether a block attribute list declares a verbatim
 * masquerade style for the given parent block variant.
 * A masquerade changes the block's content model from
 * compound (parsed children) to verbatim (raw string).
 * @param attribute - The attribute list node whose style
 *   is looked up in the `VERBATIM_MASQUERADES` table.
 * @param parentVariant - The variant of the parent block
 *   that carries the attribute list (e.g. "quote",
 *   "open").
 * @returns The target delimited-block variant, or
 *   `undefined` if this combination does not trigger a
 *   masquerade.
 */
function getVerbatimMasquerade(
  attribute: BlockAttributeListNode,
  parentVariant: ParentBlockNode["variant"],
): DelimitedBlockNode["variant"] | undefined {
  const styleMap = VERBATIM_MASQUERADES.get(parentVariant);
  if (styleMap === undefined) {
    return undefined;
  }
  const style = extractStyle(attribute.value);
  return styleMap.get(style);
}

/**
 * Extracts the raw verbatim content from a parent block
 * by slicing the source text between its open and close
 * delimiters. Needed for masquerading: the parent block's
 * children were parsed as compound content, but the
 * masquerade converts the block to verbatim, so we must
 * recover the original source text instead.
 *
 * Invariant: `node.position.start` is the first character
 * of the open delimiter line; `node.position.end` is one
 * past the last character of the close delimiter line
 * (standard Prettier end-exclusive convention).
 * @param node - The parent block whose delimiter-enclosed
 *   content is extracted.
 * @param sourceText - The full original source text,
 *   used for offset-based slicing.
 * @returns The raw text between delimiters, or an empty
 *   string if the block has no content.
 */
function extractParentBlockContent(
  node: ParentBlockNode,
  sourceText: string,
): string {
  // Find the end of the open delimiter line (first newline
  // after the block's start offset).
  const openEnd = sourceText.indexOf("\n", node.position.start.offset);
  // Defensive: unreachable for valid parser output (a parent
  // block always has a close delimiter after the open line),
  // but guards against malformed input.
  if (openEnd < FIRST) {
    return "";
  }
  const contentStart = openEnd + NEWLINE_LENGTH;

  // Find the newline before the close delimiter line. The
  // end offset is one past the close delimiter's last char,
  // so search backward from that point (within the close
  // delimiter) to find the newline that precedes it.
  const closeNewline = sourceText.lastIndexOf(
    "\n",
    node.position.end.offset - NEWLINE_LENGTH,
  );
  if (closeNewline < contentStart) {
    // No content between delimiters (empty block).
    return "";
  }

  // The content is everything from contentStart up to (but
  // not including) the newline before the close delimiter.
  return sourceText.slice(contentStart, closeNewline);
}

/**
 * Converts a paragraph's inline children into a verbatim
 * string for the delimited block's `content` field.
 * Delegates each child to `inlineToText`, which handles
 * every inline node type (text, spans, macros, anchors,
 * hard breaks, etc.), so the paragraph-form block's
 * content faithfully reproduces the original source.
 * @param paragraph - The paragraph node whose children
 *   are serialized back to AsciiDoc source text.
 * @returns The concatenated source text of all inline
 *   children.
 */
function paragraphToContent(paragraph: ParagraphNode): string {
  return paragraph.children.map((child) => inlineToText(child)).join("");
}

/**
 * Serializes an inline AST node back to its AsciiDoc
 * source representation. Handles all inline node types:
 * plain text, attribute references, formatting spans
 * (bold, italic, monospace, highlight), macros (links,
 * xrefs, images, kbd, btn, menu, footnote, passthrough),
 * and hard line breaks.
 * @param node - The inline node to serialize.
 * @returns The AsciiDoc source text for the node,
 *   including any constrained/unconstrained formatting
 *   marks.
 */
function inlineToText(node: InlineNode): string {
  switch (node.type) {
    case "text": {
      return node.value;
    }
    case "attributeReference": {
      return `{${node.name}}`;
    }
    case "bold": {
      const mark = node.constrained ? "*" : "**";
      const inner = node.children.map((child) => inlineToText(child)).join("");
      return `${mark}${inner}${mark}`;
    }
    case "italic": {
      const mark = node.constrained ? "_" : "__";
      const inner = node.children.map((child) => inlineToText(child)).join("");
      return `${mark}${inner}${mark}`;
    }
    case "monospace": {
      const mark = node.constrained ? "`" : "``";
      const inner = node.children.map((child) => inlineToText(child)).join("");
      return `${mark}${inner}${mark}`;
    }
    case "highlight": {
      const mark = node.constrained ? "#" : "##";
      const rolePrefix = node.role === undefined ? "" : `[${node.role}]`;
      const inner = node.children.map((child) => inlineToText(child)).join("");
      return `${rolePrefix}${mark}${inner}${mark}`;
    }
    case "inlineMacro": {
      return inlineMacroToSource(node);
    }
    case "link": {
      return linkToSource(node);
    }
    case "xref": {
      return xrefToSource(node);
    }
    case "inlineAnchor": {
      return anchorToSource(node);
    }
    case "hardLineBreak": {
      return " +\n";
    }
  }
}

/**
 * Scans the flat block array for style-driven transformations:
 *
 * 1. **Paragraph-form blocks:** `BlockAttributeListNode` +
 *    `ParagraphNode` pairs where the attribute list declares a
 *    paragraph-form style → convert to `DelimitedBlockNode`.
 *
 * 2. **Block masquerading:** `BlockAttributeListNode` +
 *    `ParentBlockNode` where the style changes the content
 *    model from compound to verbatim → convert to
 *    `DelimitedBlockNode` with raw content.
 *
 * 3. **Admonitions:** `BlockAttributeListNode` +
 *    `ParentBlockNode` where the style is an admonition type
 *    → convert to `AdmonitionNode`.
 *
 * Masquerade checks run BEFORE admonition checks because
 * styles like `verse` and `source` are not admonitions, even
 * though they match the uppercase-word pattern.
 * @param blocks - Flat array of block-level AST nodes
 *   produced by the CST visitor, before section nesting.
 * @param sourceText - The full original source text,
 *   needed for extracting raw content when masquerading
 *   parent blocks to verbatim.
 * @returns A new array with paragraph-form conversions,
 *   masquerades, and admonition transforms applied. The
 *   input array is not mutated.
 */
export function convertParagraphFormBlocks(
  blocks: BlockNode[],
  sourceText: string,
): BlockNode[] {
  const result: BlockNode[] = [];
  let index = FIRST;

  while (index < blocks.length) {
    const { [index]: current } = blocks;

    // When a block attribute list with a recognized style
    // (source, listing, etc.) is followed by a paragraph,
    // convert the paragraph to a paragraph-form block.
    if (current.type === "blockAttributeList" && index + NEXT < blocks.length) {
      const { [index + NEXT]: next } = blocks;
      if (next.type === "paragraph") {
        const variant = getParagraphFormVariant(current);
        if (variant !== undefined) {
          // Keep the attribute list node as metadata.
          result.push(current);

          // Convert the paragraph to a paragraph-form block.
          const content = paragraphToContent(next);
          const delimitedBlock: DelimitedBlockNode = {
            type: "delimitedBlock",
            variant,
            form: "paragraph",
            content,
            position: next.position,
          };
          result.push(delimitedBlock);

          // Skip past both the attribute list and paragraph.
          index += PAIR_LENGTH;
          continue;
        }
      }

      // Block masquerading: a style attribute on a parent
      // block changes its content model from compound
      // (parsed children) to verbatim (raw string). Check
      // masquerades BEFORE admonitions because styles like
      // `verse` and `source` are valid masquerade styles,
      // not admonitions.
      if (next.type === "parentBlock") {
        const masqueradeVariant = getVerbatimMasquerade(current, next.variant);
        if (masqueradeVariant !== undefined) {
          result.push(current);

          const content = extractParentBlockContent(next, sourceText);
          const masqueradedBlock: DelimitedBlockNode = {
            type: "delimitedBlock",
            variant: masqueradeVariant,
            form: "delimited",
            content,
            sourceDelimiter: next.variant,
            position: next.position,
          };
          result.push(masqueradedBlock);

          index += PAIR_LENGTH;
          continue;
        }
      }

      // Block-form admonitions: an attribute list with an
      // admonition type (NOTE, TIP, etc.) followed by a parent
      // block (example `====` or open `--`) becomes an
      // AdmonitionNode with form "delimited".
      if (next.type === "parentBlock") {
        const admonitionVariant = getAdmonitionVariant(current);
        if (admonitionVariant !== undefined) {
          // Keep the attribute list node as metadata for
          // the printer to output `[NOTE]` etc.
          result.push(current);

          const admonition: AdmonitionNode = {
            type: "admonition",
            variant: admonitionVariant,
            form: "delimited",
            delimiter: next.variant,
            // `content` is undefined for admonitions — their
            // text is in `children` (inline nodes), not raw
            // string content.
            content: undefined,
            children: next.children,
            position: next.position,
          };
          result.push(admonition);

          // Skip past both the attribute list and parent block.
          index += PAIR_LENGTH;
          continue;
        }
      }
    }

    result.push(current);
    index += NEXT;
  }

  return result;
}
