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
import type { BlockNode } from "../ast.js";
import {
  anchorLineShape,
  isLineComment,
  isReaderConsumedLine,
  stacksAsMetadata,
} from "../block-metadata.js";

const {
  builders: { hardline },
} = doc;

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
 * (level 0 is SEMANTIC — it opens the document header run).
 *
 * A live arm of {@link stacksOntoAttributeEntry}, not a restatement
 * of its attribute-entry half: a level-0 heading DEEPER in the file
 * is a plain `heading` node (the document's own title is a
 * `documentHeader` that owns its entries), and the entries under it
 * stack on this test alone (measured on two corpus documents).
 * @param block - The block node to test.
 * @returns Whether the block is the level-0 heading.
 */
function isDocumentTitle(block: BlockNode): boolean {
  return block.type === "heading" && block.level === 0;
}

// Why headings split on level here, and why these two suppressions
// exist (no section container is modeled, and these are the two
// containment facts such a container would otherwise enforce
// invisibly):
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
//   and the incumbent forced blank is preserved because the
//   covenant here is byte identity.
// - A pseudo-anchor line never stacks under a level >= 1 heading:
//   the stacked pair re-parses as one joined line and the heading
//   is destroyed.
// - Aligning level >= 1 to the header's author-adjacency rule is a
//   deliberate byte-change candidate for later work, not drift.
//
// Pinned by tests/format/heading-adjacency.test.ts (the containment
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
 * - An attribute entry under another one, or under a
 *   level-0 section title ({@link stacksOntoAttributeEntry})
 * - A document header and the block written on the very
 *   next line ({@link stacksUnderDocumentHeader})
 * - Block metadata and the block it annotates, per the one
 *   pairing rule and its anchor exceptions
 *   ({@link stacksAsMetadata}, block-metadata.ts) —
 *   suppressed for a pseudo-anchor line directly above a
 *   level >= 1 heading: the stacked pair re-parses joined
 *   and the heading is destroyed (the A1 row in
 *   tests/format/heading-adjacency.test.ts)
 *
 * The comment-pair arm is the one that does NOT ask about source
 * adjacency, and that is the whole of what it adds: two line comments
 * with a blank line between them come out stacked (`// a` / blank /
 * `// b` prints as the two lines), which the reader-eaten arm below
 * refuses because {@link startsOnTheNextLine} is false there.
 *
 * Only the attribute-entry arm keys on what `current` IS,
 * so no block kind is exempt - a LIST included. A list
 * stacks under a reader-eaten line (`// c` / `* item`),
 * under the block metadata that annotates it (`[foo]` /
 * `* item`) and under a document header the source wrote
 * it directly beneath (`= T` / `A` / `: rem` / `* item`),
 * and takes the blank-line separator everywhere else. The
 * comment this replaces claimed lists always take the
 * blank line; it was already false on the first two counts
 * before the header arm added the third.
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
    stacksOntoAttributeEntry(previous, current) ||
    stacksUnderDocumentHeader(previous, current) ||
    stacksUnderFrontMatter(previous, current) ||
    (stacksAsMetadata(previous, current) &&
      !destroysHeadingWhenStacked(previous, current))
  );
}

/**
 * Whether the pair stacks because `current` is an attribute entry
 * that belongs under what stands above it: another attribute entry,
 * or a level-0 heading that is NOT a document header (a header owns
 * its own attribute entries - {@link DocumentHeaderNode} - so the
 * only `= Title` left here is a level-0 SECTION deeper in the file).
 *
 * The reverse (attribute entry before title) is intentionally absent:
 * in AsciiDoc, attributes follow the title - they never precede it.
 *
 * Named rather than inlined for the reason
 * {@link destroysHeadingWhenStacked} states: the ceiling counts
 * {@link shouldStack}'s operators.
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether the two should stack.
 */
function stacksOntoAttributeEntry(
  previous: BlockNode,
  current: BlockNode,
): boolean {
  return (
    isAttributeEntry(current) &&
    (isAttributeEntry(previous) || isDocumentTitle(previous))
  );
}

/**
 * Whether the pair stacks because YAML front matter stands directly
 * above `current` in the SOURCE.
 *
 * A blank line here is not cosmetic either. WITHOUT
 * `skip-front-matter` - Asciidoctor's default - the closing `---` is
 * not a delimiter at all: it is the last line of a paragraph that
 * runs on into whatever the author wrote under it, so a blank line
 * inserted between them SPLITS that paragraph and the document
 * renders differently. Adjacency is the author's own spelling and the
 * only one that re-reads the same under both readings of the block.
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether the two should stack.
 */
function stacksUnderFrontMatter(
  previous: BlockNode,
  current: BlockNode,
): boolean {
  return (
    previous.type === "frontMatter" && startsOnTheNextLine(previous, current)
  );
}

/**
 * Whether the pair stacks because a document header stands directly
 * above `current` in the SOURCE.
 *
 * The header ends at the first blank line, so a block written on the
 * very next line instead is one Asciidoctor's own header read stopped
 * short of - and its first line may still be part of one paragraph
 * WITH the header's last line: a revision line
 * `RevisionInfoLineRx` rejects is unshifted straight back into the
 * body (`parse_header_metadata`, parser.rb). Adjacency is the only
 * spelling that provably re-reads the same there, and it is the
 * author's own.
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether the two should stack.
 */
function stacksUnderDocumentHeader(
  previous: BlockNode,
  current: BlockNode,
): boolean {
  return (
    previous.type === "documentHeader" && startsOnTheNextLine(previous, current)
  );
}

/**
 * Whether stacking the pair would DESTROY a heading: a PARAGRAPH that
 * prints as a `[[…]]` line, directly above a level >= 1 heading,
 * re-parses as one joined line (a section title does not interrupt a
 * paragraph). The first-class `blockAnchor` node is excluded because
 * its line is metadata on re-read and the heading below it survives —
 * which is why the test is `anchorLineShape` answered on a paragraph,
 * not the anchor/lookalike split: a paragraph printing `[[id]]` for
 * the author's `[[id,]]` keeps its blank line here, exactly as it
 * always has. Named rather than inlined into {@link shouldStack}
 * because the ceiling counts that function's operators (see the level
 * comment above); the rule is one clause of the metadata arm's
 * suppression.
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether the stacked spelling would re-parse joined.
 */
function destroysHeadingWhenStacked(
  previous: BlockNode,
  current: BlockNode,
): boolean {
  return (
    isSectionHeading(current) &&
    previous.type === "paragraph" &&
    anchorLineShape(previous) !== undefined
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
 * Whether a list's last printed line stands under a still-ARMED `+` —
 * the tail {@link ListItemNode.activeTail} records: a continuation
 * whose activation ran through block metadata only and never met its
 * block. One blank line under such a tail ATTACHES the next block to
 * the item on re-read (`read_lines_for_list_item`'s `:active` arm,
 * parser.rb l.1483); two detach it (the after-blank break, l.1549).
 * The recursion mirrors {@link endsWithReaderEatenLine}: a trailing
 * nested list's own last item is what the printed lines actually end
 * on, so the innermost item's flag is the one that answers.
 * @param block - The preceding block node.
 * @returns Whether its tail continuation is still armed.
 */
function listTailContinuationActive(block: BlockNode): boolean {
  if (block.type !== "list") {
    return false;
  }
  const item = block.children.at(-1);
  const last = item?.blocks.at(-1)?.block;
  if (last?.type === "list") {
    return listTailContinuationActive(last);
  }
  return item?.activeTail ?? false;
}

/**
 * The blank-line separator a non-stacking pair gets: one blank line,
 * or two when the previous block's tail keeps a `+` armed.
 * @param previous - The preceding block node.
 * @returns The separator Doc.
 */
function separatorAfter(previous: BlockNode): Doc {
  return listTailContinuationActive(previous)
    ? [hardline, hardline, hardline]
    : [hardline, hardline];
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
    // use a single newline. All other pairs get a blank line — TWO
    // blank lines when the previous block is a list whose tail
    // continuation is still armed, because one blank under a live `+`
    // re-attaches the block the source left detached
    // ({@link listTailContinuationActive}).
    const separator: Doc = shouldStack(blocks, index)
      ? hardline
      : separatorAfter(blocks[index - 1]);
    result.push(separator, printed[index]);
  }
  return result;
}
