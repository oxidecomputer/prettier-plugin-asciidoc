/**
 * Block stacking and joining logic for the AsciiDoc
 * printer.
 *
 * Determines how adjacent block-level nodes are
 * separated: stacked on adjacent lines (single newline)
 * or separated by a blank line (double newline). Used by
 * the main printer and by block-printing helpers that
 * contain child blocks.
 */
import { doc, type Doc } from "prettier";
import type { BlockNode } from "./ast.js";
import {
  isPseudoAnchorLine,
  isReaderConsumedLine,
  stacksAsMetadata,
} from "./block-metadata.js";

const {
  builders: { hardline },
} = doc;

/**
 * Tests whether a block is a line comment.
 *
 * Line comments and attribute entries are special cases
 * for block separation: consecutive elements of either
 * type should appear on adjacent lines, not separated by
 * a blank line like other block elements. This matches
 * idiomatic AsciiDoc style. A line comment renders
 * nothing, so closing the gap between two of them cannot
 * change the output — unlike a preprocessor directive,
 * whose blank-line gap the reader can still make visible
 * (two blank-separated unresolved includes render as two
 * paragraphs, adjacent ones as a single paragraph), so
 * directives stack only when the source had them
 * adjacent.
 * @param block - The block node to test.
 * @returns Whether the block is a line comment.
 */
function isLineComment(block: BlockNode): boolean {
  return block.type === "comment" && block.commentType === "line";
}

/**
 * Tests whether a block is an attribute entry.
 *
 * Used alongside {@link isReaderConsumedLine} to
 * determine stacking: consecutive attribute entries appear
 * on adjacent lines without a blank-line separator.
 * @param block - The block node to test.
 * @returns Whether the block is an attribute entry.
 */
function isAttributeEntry(block: BlockNode): boolean {
  return block.type === "attributeEntry";
}

/**
 * Tests whether a block is the document-title heading (`=`, level 0).
 *
 * Used in stacking logic: the document title followed by attribute
 * entries forms a contiguous header (`= Title` then `:attr: value`
 * with no blank line). A field read now that headings are one kind
 * (spec D10(d): level 0 is SEMANTIC — the header run).
 * @param block - The block node to test.
 * @returns Whether the block is the level-0 heading.
 */
function isDocumentTitle(block: BlockNode): boolean {
  return block.type === "heading" && block.level === 0;
}

// Why headings split on level here, and why these two suppressions
// exist (spec D10(d) — the section container left the AST, and these
// are the two containment facts it used to enforce invisibly):
//
// - Level 0 is SEMANTIC. `= Title` opens the document HEADER, a
//   contiguous run that comment and directive lines may sit inside
//   and that the first blank line terminates. Preserving the
//   author's adjacency there is meaning-preserving, not style:
//   breaking it demotes author/revision/attribute lines to body
//   content (measured: the author line, `:toc:` and `:doctype:`
//   renders all change with header adjacency).
// - Level >= 1 is FROZEN SPELLING. No header exists below a section
//   heading; blank-vs-adjacent is render-neutral there (measured),
//   and the incumbent forced blank is preserved because this plan's
//   covenant is byte identity.
// - A pseudo-anchor line never stacks under a level >= 1 heading:
//   the stacked pair re-parses as one joined line and the heading
//   is destroyed.
// - Aligning level >= 1 to the header's author-adjacency rule is a
//   deliberate byte-change candidate for a later plan (γ or later),
//   not drift.
//
// Pinned by tests/format/heading-adjacency.test.ts (the D10(d)
// characterization fixtures) and the shape-diff heading-adjacency
// rows.

/**
 * Tests whether a block is a heading below the document title —
 * level 1 (`==`) or deeper. The two suppressions in
 * {@link shouldStack} key on it: the reader-eaten arm on the
 * PREVIOUS element being one (ONE-SIDED — `// c` directly above
 * `== B` stacks today and must keep stacking), the metadata arm on
 * `current` being one with a pseudo-anchor line above.
 * @param block - The block node to test.
 * @returns Whether the block is a level >= 1 heading.
 */
function isSectionHeading(block: BlockNode): boolean {
  return block.type === "heading" && block.level >= 1;
}

/**
 * Checks whether the block at `index` and the one before
 * it should be stacked on adjacent lines (single newline,
 * no blank line).
 *
 * Stacking applies to:
 * - Consecutive line comments (idiomatic stacking)
 * - A reader-eaten line (line comment, preprocessor
 *   directive) and the block on either side of it, when
 *   the source had no blank line between them: the reader
 *   removes the line before block parsing, so a blank line
 *   the formatter inserted next to it would land inside
 *   the run of lines the parser is still reading —
 *   suppressed when the PREVIOUS element is a level >= 1
 *   heading: the old section printer forced the
 *   post-heading blank, and that byte is frozen (see the
 *   level comment below)
 * - Consecutive attribute entries (idiomatic stacking)
 * - Document title followed by attribute entry (the
 *   contiguous header pattern: `= Title` then
 *   `:attr: value` with no blank line)
 * - Block metadata and the block it annotates, per the one
 *   pairing rule and its anchor exceptions
 *   ({@link stacksAsMetadata}, block-metadata.ts) —
 *   suppressed for a pseudo-anchor line directly above a
 *   level >= 1 heading: the stacked pair re-parses joined
 *   and the heading is destroyed (spec D10(d), the A1 row)
 *
 * The reverse (attribute entry before title) is
 * intentionally absent: in AsciiDoc, attributes follow
 * the title — they never precede it.
 *
 * Lists always get a blank-line separator — no stacking
 * conditions needed for list nodes. If future block types
 * (delimited blocks, tables) introduce more stacking
 * patterns, consider switching to a node property (e.g.
 * `stackable`) instead of pairwise checks.
 * @param blocks - The full array of sibling block nodes.
 * @param index - Index of the current block (must be
 *   at least 1 so the previous block exists).
 * @returns Whether the two blocks should stack without
 *   a blank-line separator.
 */
function shouldStack(blocks: BlockNode[], index: number): boolean {
  const previous = blocks[index - 1];
  const current = blocks[index];
  return (
    (isLineComment(previous) && isLineComment(current)) ||
    (stacksWithReaderEatenLine(previous, current) &&
      !isSectionHeading(previous)) ||
    (isAttributeEntry(previous) && isAttributeEntry(current)) ||
    (isDocumentTitle(previous) && isAttributeEntry(current)) ||
    (stacksAsMetadata(previous, current) &&
      !destroysHeadingWhenStacked(previous, current))
  );
}

/**
 * Whether stacking the pair would DESTROY a heading: a pseudo-anchor
 * line directly above a level >= 1 heading re-parses as one joined
 * line. Named rather than inlined into {@link shouldStack} because
 * the ceiling counts that function's operators (see the level comment
 * above); the rule is one clause of the metadata arm's suppression.
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether the stacked spelling would re-parse joined.
 */
function destroysHeadingWhenStacked(
  previous: BlockNode,
  current: BlockNode,
): boolean {
  return isSectionHeading(current) && isPseudoAnchorLine(previous);
}

/**
 * Whether the pair stacks because one of the two is a line the
 * reader eats.
 *
 * A line comment or a preprocessor directive is removed before block
 * parsing, so a blank line the formatter inserts beside it is not
 * cosmetic — it lands inside the run of lines the parser is still
 * reading (`+` / blank / `// c` / `para` attaches, `+` / `// c` /
 * blank / `para` does not) and can be visible in the output (two
 * blank-separated unresolved includes render as two paragraphs,
 * adjacent ones as one). Adjacency in the SOURCE is therefore the
 * condition on both sides.
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether the pair must stay on adjacent lines.
 */
function stacksWithReaderEatenLine(
  previous: BlockNode,
  current: BlockNode,
): boolean {
  return (
    (endsWithReaderEatenLine(previous) || isReaderConsumedLine(current)) &&
    startsOnTheNextLine(previous, current)
  );
}

/**
 * Whether the LAST line a block occupies is one the reader eats.
 *
 * A list is the one container whose last line is its last CHILD's
 * line — every other container closes with a delimiter of its own.
 * So a directive or comment that
 * ends a list item is the line directly above the next top-level
 * block, and the stacking must reach it (`* a` / `+` /
 * `ifdef::backend[]` / `----` puts the listing INSIDE the item for
 * Asciidoctor, because the reader never sees the directive). The item
 * can end with the line either as an attached block or as a
 * `rawLine` in its own text, so both are checked.
 * @param block - The preceding block node.
 * @returns Whether its last printed line is reader-eaten.
 */
function endsWithReaderEatenLine(block: BlockNode): boolean {
  if (block.type !== "list") {
    return isReaderConsumedLine(block);
  }
  const item = block.children.at(-1);
  const last = item?.blocks.at(-1)?.block;
  if (last !== undefined) {
    // A trailing nested list recurses through the same test.
    return endsWithReaderEatenLine(last);
  }
  // An inline rawLine is a comment or a preprocessor directive by
  // construction (`isRawParagraphLine` admits nothing else).
  return item?.text.at(-1)?.type === "rawLine";
}

/**
 * Whether `current` began on the line directly after `previous`
 * ended, i.e. the source had no blank line between them.
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether the two were adjacent in the source.
 */
function startsOnTheNextLine(previous: BlockNode, current: BlockNode): boolean {
  return current.position.start.line === previous.position.end.line + 1;
}

/**
 * Joins printed block children with appropriate
 * separators.
 *
 * Consecutive line comments and other stacked pairs get a
 * single newline; all other adjacent pairs get a blank
 * line (double hardline). This is the central block
 * separation logic — every block-level container routes
 * through here.
 * @param blocks - The original AST block nodes, used to
 *   determine stacking relationships between adjacent
 *   siblings.
 * @param printed - The corresponding Doc IR produced by
 *   printing each block.
 * @returns A single Doc with blocks separated by the
 *   correct number of newlines.
 */
export function joinBlocks(blocks: BlockNode[], printed: Doc[]): Doc {
  const result: Doc[] = [printed[0]];
  for (let index = 1; index < printed.length; index += 1) {
    // Stacked blocks (consecutive comments, consecutive attribute
    // entries, or document title + attribute entry in a header)
    // use a single newline. All other pairs get a blank line.
    const separator: Doc = shouldStack(blocks, index)
      ? hardline
      : [hardline, hardline];
    result.push(separator, printed[index]);
  }
  return result;
}
