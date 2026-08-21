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
  isAnchorParagraph,
  isBlockMetadata,
  isReaderConsumedLine,
  wouldMergeWithAnchor,
} from "./block-metadata.js";
import { EMPTY, LAST_ELEMENT } from "./constants.js";

const {
  builders: { hardline },
} = doc;
// Index of the second child in a block array (offset 1 from
// zero). Also serves as the loop increment in joinBlocks
// (advance by one). Both uses share the numeric value 1.
const SECOND_CHILD = 1;
// Offset from one line to the next when comparing block positions.
const NEXT_LINE = 1;

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
 * Tests whether a block is a document title.
 *
 * Used in stacking logic: a document title followed
 * by attribute entries forms a contiguous header
 * (`= Title` then `:attr: value` with no blank line).
 * @param block - The block node to test.
 * @returns Whether the block is a document title.
 */
function isDocumentTitle(block: BlockNode): boolean {
  return block.type === "documentTitle";
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
 *   the run of lines the parser is still reading
 * - Consecutive attribute entries (idiomatic stacking)
 * - Document title followed by attribute entry (the
 *   contiguous header pattern: `= Title` then
 *   `:attr: value` with no blank line)
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
  // Hoisted out of the computed key: StrykerJS cannot place a mutant
  // inside a destructuring PATTERN and wraps the whole declaration in an
  // if/else, which would scope both bindings out of the return below.
  const previousIndex = index - SECOND_CHILD;
  const { [previousIndex]: previous, [index]: current } = blocks;
  return (
    (isLineComment(previous) && isLineComment(current)) ||
    stacksWithReaderEatenLine(previous, current) ||
    (isAttributeEntry(previous) && isAttributeEntry(current)) ||
    (isDocumentTitle(previous) && isAttributeEntry(current)) ||
    shouldStackMetadata(previous, current)
  );
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
 * line — every other container closes with a delimiter of its own, and
 * a section owns whatever follows it. So a directive or comment that
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
  const item = block.children.at(LAST_ELEMENT);
  const attached = item?.attachedBlocks.at(LAST_ELEMENT);
  if (attached !== undefined) {
    return endsWithReaderEatenLine(attached.block);
  }
  // An inline rawLine is a comment or a preprocessor directive by
  // construction (`isRawParagraphLine` admits nothing else).
  return item?.children.at(LAST_ELEMENT)?.type === "rawLine";
}

/**
 * Whether `current` began on the line directly after `previous`
 * ended, i.e. the source had no blank line between them.
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether the two were adjacent in the source.
 */
function startsOnTheNextLine(previous: BlockNode, current: BlockNode): boolean {
  return current.position.start.line === previous.position.end.line + NEXT_LINE;
}

/**
 * Block metadata stacks with the following block, with exceptions
 * for anchor paragraphs that would merge on re-parse.
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether the two blocks should stack as metadata.
 */
function shouldStackMetadata(previous: BlockNode, current: BlockNode): boolean {
  // Block metadata (attribute lists, anchors, titles) stacks
  // with each other and with the block that follows them.
  // Exceptions:
  // 1. Anchor paragraphs must NOT stack with plain paragraphs —
  //    on re-parse the anchor would merge into the paragraph
  //    text, breaking idempotency.
  // 2. Consecutive anchor paragraphs must NOT stack — stacking
  //    removes the blank line, causing re-parse to merge them
  //    into a single paragraph with inline anchors (different
  //    semantics from block anchors).
  return (
    isBlockMetadata(previous) &&
    !(isAnchorParagraph(previous) && isAnchorParagraph(current)) &&
    (!isAnchorParagraph(previous) || !wouldMergeWithAnchor(current))
  );
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
  const result: Doc[] = [printed[EMPTY]];
  for (
    let index = SECOND_CHILD;
    index < printed.length;
    index += SECOND_CHILD
  ) {
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
