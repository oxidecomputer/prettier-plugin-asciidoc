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
import type {
  BlockNode,
  DescriptionListItemNode,
  ListItemNode,
} from "../ast.js";
import {
  isLineComment,
  isReaderConsumedLine,
  printsSourceAttributeLine,
  stacksAsMetadata,
} from "../block-metadata.js";
import { LINE_COMMENT_HEAD } from "../parse/line-shapes.js";

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

// Why headings split on level here, and why the ONE suppression
// below exists (no section container is modeled, and that
// containment fact is one such a container would otherwise enforce
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
// - A pseudo-anchor line above a level >= 1 heading needs no rule
//   here. The pair only ever reaches the printer as two siblings
//   when the author wrote a blank between them - a section title
//   does not interrupt a paragraph, so the adjacent spelling is one
//   paragraph and no pair exists - and the blank the author wrote is
//   a recorded fact the metadata arm replays
//   (`ParagraphNode.blankBelowAnchorLine`, src/ast.ts). A second,
//   level-keyed suppression stood here until the fact was recorded;
//   it was deleted once measured inert (byte-identical output over
//   every anchor-above-heading shape its own comment named, and over
//   the whole deep battery).
// - Aligning level >= 1 to the header's author-adjacency rule is a
//   deliberate byte-change candidate for later work, not drift.
//
// Pinned by tests/format/heading-adjacency.test.ts (the containment
// characterization fixtures) and the shape-diff heading-adjacency
// rows.

/**
 * Tests whether a block is a heading below the document title —
 * level 1 (`==`) or deeper. One suppression in {@link shouldStack}
 * keys on it: the reader-eaten arm, on the PREVIOUS element being one
 * (ONE-SIDED: `// c` directly above `== B` stacks today and must
 * keep stacking).
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
 *   pairing rule, its anchor exceptions and the recorded
 *   separation that overrides them
 *   ({@link stacksAsMetadata}, block-metadata.ts)
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
      !isSectionHeading(previous) &&
      !sourceLineWouldJoinTheItem(previous, current)) ||
    stacksOntoAttributeEntry(previous, current) ||
    stacksUnderDocumentHeader(previous, current) ||
    stacksUnderFrontMatter(previous, current) ||
    stacksAsMetadata(previous, current)
  );
}

/**
 * Whether stacking would hand the LIST above `current` the
 * `[source]` line the printer writes for it
 * ({@link printsSourceAttributeLine}, src/block-metadata.ts).
 *
 * A fence respelled with `----` puts its attribute line FIRST, so the
 * line that lands against the item is the annotation, not the
 * delimiter, and the two are read differently there. A delimiter ENDS
 * the item's read outright (`read_lines_for_list_item`, parser.rb
 * l.1453-1456: a delimited block breaks the list unless a
 * continuation is active), which is why every other block may stack
 * under the reader-eaten line. An attribute line does not end it:
 * Ruby takes the line into the item, the delimited block below opens
 * outside the item carrying no style at all, and the source
 * highlighting and the language hint are gone from the render. One
 * blank line is what puts the annotation back on its own block
 * (the after-blank break, parser.rb l.1549).
 *
 * ONLY under a `list`. A description list has an escape the marker
 * kinds do not (parser.rb l.1462-1481): a block attribute line whose
 * next line is not a list item is unshifted straight back out of the
 * item, so the annotation reaches its block there without a blank.
 * The kind that answers is the OUTERMOST one, which is exactly what
 * `previous.type` is - Ruby's `dlist` flag is the type of the list
 * whose item read is running, and a nested list's lines are buffered
 * by that read rather than read by one of their own (measured both
 * ways: a description list holding a nested marker list keeps the
 * escape, a marker list holding a nested description list does not).
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether a blank line must separate the two.
 */
function sourceLineWouldJoinTheItem(
  previous: BlockNode,
  current: BlockNode,
): boolean {
  return previous.type === "list" && printsSourceAttributeLine(current);
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
 * Named rather than inlined because the ceiling counts
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
 * The last ITEM of a list-like block, or undefined for a block that
 * is not one.
 *
 * TWO kinds, one accessor. A `list` and a `descriptionList` are the
 * only blocks whose last printed line is their last CHILD's line
 * rather than a delimiter of their own, and the three fields the two
 * questions below ask of that child (`blocks`, `text`, `activeTail`)
 * are the item BODY both item kinds extend (src/ast.ts). Naming the
 * kinds once here is what keeps a description list from being
 * invisible to both tests: while only `list` was named, a `t:: a` /
 * `+` / `[role]` item's armed tail reached neither, the pair below it
 * got one blank line where it needs two, and the next block attached
 * to the item on re-read.
 * @param block - any block node
 * @returns its last item, or undefined when it holds none
 */
function lastItemOf(
  block: BlockNode,
): ListItemNode | DescriptionListItemNode | undefined {
  return block.type === "list" || block.type === "descriptionList"
    ? block.children.at(-1)
    : undefined;
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
  const item = lastItemOf(block);
  if (item === undefined) {
    return isReaderConsumedLine(block);
  }
  const last = item.blocks.at(-1)?.block;
  if (last !== undefined) {
    // A trailing nested list recurses through the same test.
    return endsWithReaderEatenLine(last);
  }
  // THE TOKEN TYPE IS NOT THE PROOF. An inline `rawLine` is a comment
  // or a preprocessor directive where the paragraph scan made one
  // (`isRawParagraphLine` admits nothing else), and a `///` NEAR MISS
  // where an item's head drain replayed one instead (list-read.ts's
  // `detached` arm) - a line no reader eats. What holds over both is
  // the pair's OTHER condition rather than this one: the detached arm
  // fires only on a `+` or a blank standing behind the run, and this
  // test is reached only where the item has no attached block, so the
  // item's last printed line is the run and at least that separator
  // line stands under it. Nothing can then begin on the next line,
  // and `stacksWithReaderEatenLine` asks for that adjacency too, so a
  // near miss cannot reach the answer this returns.
  return item.text.at(-1)?.type === "rawLine";
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
 * Whether the head drain would take the whole of what this item writes
 * under its term line, so the `+` the author wrote under that body has
 * to come back.
 *
 * `parse_list_item` peeks past a run of `//`-headed lines before it
 * reads an item's first block, and unshifts the run only when a line
 * FOLLOWS it (`comment_lines = list_item_reader.skip_line_comments`,
 * parser.rb l.1362-71, over `Reader#skip_line_comments`, reader.rb
 * l.329-346, which takes any line whose head is `//` and stops at a
 * blank). A run reaching the buffer's end is dropped outright, and the
 * description goes with it.
 *
 * WHETHER THE RUN RENDERS DOES NOT ENTER. The byte is the AUTHOR'S,
 * and a line the re-read loses is a line lost whatever it renders: a
 * `///` run takes its `<dd>` down with it and a `// c` run takes only
 * the source line, and both are the same deletion. The narrower rule
 * that asked for a rendering body was measured against the wider one
 * over the drainable-description grid and moved no row in either
 * direction, so what it bought was two fewer bytes and one more
 * concept; the blanks under the byte are the armed-tail rule's either
 * way ({@link listTailContinuationActive}), which is what makes the
 * wider rule safe.
 *
 * IT LIVES HERE, in the separator rules, rather than beside the arm in
 * src/print/description-list.ts that writes the byte. What a `+` on an
 * item's last line MEANS is decided UNDER it - one blank arms it and
 * attaches the next block, two detach it - and that blank count is
 * this file's ({@link listTailContinuationActive},
 * {@link separatorAfter}). One predicate, read by the writer and by
 * the rule that finishes the line, is what keeps the two from
 * disagreeing about one item.
 *
 * The spelling of "comment" is the DRAIN's ({@link LINE_COMMENT_HEAD},
 * the reader's bare `//` prefix), which is wider than the classifier's
 * `CommentLineRx`: `///`, `///c` and `////x` are paragraphs to the
 * parser and lines the drain deletes just the same, and it is the
 * drain's reading that decides this question.
 *
 * NOT AN INVENTED BYTE, though the printer decides where it goes. This
 * shape can only be read from a source that already carried the `+`.
 * For the drain to have left these lines in the description at parse
 * time, a line had to follow the run in the item's own buffer: a
 * non-comment line would stand in the recorded lines and a blank with
 * content under it would leave a BLOCK, and both tests below say no to
 * those. What is left is a buffer ending in a blank, and a trailing
 * blank survives Ruby's own strip (`buffer.pop` under the
 * `last_line.empty?` arm, parser.rb l.1584-85) only where the pop
 * broke the walk on a marker directly under it
 * (`ListContinuationMarker === buffer[-1]`, l.1580-82).
 *
 * The two other tail bytes `tailParts` (src/print/list.ts) writes are
 * excluded here rather than merely unlikely. `detachedTail` needs a
 * last block, so the empty-blocks test rules it out; a live
 * `trailingContinuation` prints its own `+` DIRECTLY under the run,
 * which stops the drain on its own and makes a second byte
 * unnecessary.
 *
 * The reflow arm writes no body lines at all - the description is
 * joined onto the term line, and the item's buffer re-reads empty - so
 * the drain has nothing to reach there.
 * @param node - the description item being printed
 * @returns true when the item writes a detached `+` under its body
 */
export function drainTakesWholeBody(node: DescriptionListItemNode): boolean {
  switch (node.printing) {
    case "reflow": {
      return false;
    }
    case "replay": {
      return (
        node.blocks.length === 0 &&
        node.trailingContinuation === false &&
        node.textLines.length > 0 &&
        node.textLines.every((line) => line.startsWith(LINE_COMMENT_HEAD))
      );
    }
  }
}

/**
 * Whether an item ends on a `+` the PRINTER writes rather than one the
 * reader recorded as armed: a description whose whole body the head
 * drain would take is closed with a detached `+`
 * ({@link drainTakesWholeBody}, written by
 * src/print/description-list.ts).
 * The printed lines end on a live `+` either way, so the separator
 * question is the same one, and asking the writer's own predicate is
 * what keeps the two from disagreeing about one item.
 *
 * A MARKER item never writes that byte - the arm is the description
 * printer's - which is what the type test says.
 * @param item - the last item of a list-like block
 * @returns whether the item's own printed tail is a live `+`
 */
function printsDrainShield(
  item: ListItemNode | DescriptionListItemNode,
): boolean {
  return item.type === "descriptionListItem" && drainTakesWholeBody(item);
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
 * on, so the innermost item's flag is the one that answers, and
 * {@link lastItemOf} is what makes both reach a description list.
 *
 * TWO SOURCES for one question, because a live `+` at an item's end
 * has two origins: one the reader recorded and one the printer writes
 * ({@link printsDrainShield}). The `||` is no widening - both arms
 * name the same printed shape, a `+` on the item's last line - and
 * leaving the second out is what let a `term::` / `///` / blank / `+`
 * item take one blank line where it needs two, pulling the block under
 * it into the `<dd>`.
 * @param block - The preceding block node.
 * @returns Whether its tail continuation is still armed.
 */
function listTailContinuationActive(block: BlockNode): boolean {
  const item = lastItemOf(block);
  if (item === undefined) {
    return false;
  }
  const last = item.blocks.at(-1)?.block;
  // A trailing nested list of EITHER kind is what the printed lines
  // end on, so the innermost item's flag is the one that answers.
  if (last !== undefined && lastItemOf(last) !== undefined) {
    return listTailContinuationActive(last);
  }
  return item.activeTail || printsDrainShield(item);
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
