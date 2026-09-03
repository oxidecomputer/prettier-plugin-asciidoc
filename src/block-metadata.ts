/**
 * Block-metadata classification over AST nodes.
 *
 * "Block metadata" is a block that annotates the block after it
 * rather than standing alone: block attribute lists
 * (`[source,ruby]`), block titles (`.Title`), and block anchors
 * (`blockAnchor` nodes). Both sides of the pipeline need the
 * SAME definition — the printer stacks metadata directly above
 * the block it annotates. A neutral module keeps the two from
 * diverging without making the parse layer depend on the print
 * layer.
 *
 * THE pairing rule lives here too ({@link stacksAsMetadata}):
 * whether a metadata block stacks directly above the block
 * below it is one decision with one home, and every consumer imports
 * it rather than restating its exceptions. Two of the classifications
 * it is built from ({@link isAnchorLine},
 * {@link wouldMergeWithAnchor}) are private to it — the rule is their
 * only consumer, so nothing can pair metadata by half of it.
 *
 * One printer-STYLE qualifier is exported beside them: what a block's
 * PRINTED `[[…]]` line re-reads as ({@link anchorLineShape}). A line
 * whose id fails the block-anchor grammar is not metadata at all, but
 * it prints as though it were, and the rules that GROUP an item's
 * held metadata lines (src/print/list-hazard.ts) and that suppress
 * stacking above a heading (src/print/join.ts) both have to say so.
 *
 * That qualifier is why the module reads three addresses outside
 * itself, and TWO of them are print-side: the grammar
 * (`BLOCK_ANCHOR`, parse/line-shapes.ts) says what a line means on
 * re-read, while the printer's own serializer (`anchorToSource`,
 * print/serialize-inline.ts) and its own word split (`splitWords`,
 * print/reflow.ts) say which line the printer will emit. A question
 * about the PRINTED line cannot be answered without asking the
 * printer, and asking it here is what keeps one answer where two
 * consumers need it. Read the neutrality claim above with that in
 * mind: no file under src/parse/ imports src/print/, which is the
 * layer rule, but the parse layer's one import from here
 * ({@link isReaderConsumedLine}) does reach print code through this
 * module. What keeps that honest is that none of the printed-line
 * records is on the parse layer's side of the module.
 */
import type { BlockNode, InlineAnchorNode, InlineNode } from "./ast.js";
import { BLOCK_ANCHOR } from "./parse/line-shapes.js";
import { splitWords } from "./print/reflow.js";
import { anchorToSource } from "./print/serialize-inline.js";

/**
 * Tests whether a block is a `//` line comment — the ONE node-level
 * home for the question. `Reader#skip_line_comments` consumes such
 * lines before anything counts them, which makes them transparent
 * wherever adjacency or attachment is decided: the printer stacks
 * consecutive comments without a blank (src/print/join.ts, where closing
 * the gap can change nothing — a line comment renders nothing, unlike
 * a preprocessor directive, whose blank-line gap the reader can still
 * make visible), and the list hazard reads through them on both sides
 * of its run (src/print/list-hazard.ts). A `////`-delimited comment BLOCK
 * is deliberately NOT one: `skip_line_comments` skips `//` lines only,
 * and a comment block is a block like any other.
 * @param block - The block node to test.
 * @returns Whether the block is a line comment.
 */
export function isLineComment(block: BlockNode): boolean {
  return block.type === "comment" && block.commentType === "line";
}

/**
 * Tests whether a block is a line Asciidoctor's READER consumes
 * before block structure exists: a line comment
 * (`Reader#skip_line_comments`) or a preprocessor directive
 * (`PreprocessorReader#process_line`, reader.rb:824).
 *
 * Such a line is TRANSPARENT: the parser never sees it, so metadata
 * on one side still annotates the block on the other, and a blank
 * line inserted next to one is not cosmetic — it lands inside the run
 * of lines the parser is still reading, and can end a list item that
 * the source kept going (`+` / blank / `// c` / `para` attaches,
 * `+` / `// c` / blank / `para` does not). Both sides of the pipeline
 * consult this: the parse layer looks past such lines when deciding
 * whether a held style is actionable (the reader's held-run
 * transparency guard, lines/reader.ts), the printer stacks them with
 * their neighbours (src/print/join.ts).
 * @param block - The block node to test.
 * @returns Whether the reader eats this block's line.
 */
export function isReaderConsumedLine(block: BlockNode): boolean {
  return isLineComment(block) || block.type === "preprocessorDirective";
}

/**
 * Tests whether a block is block metadata (attribute
 * list, block title, or block anchor).
 *
 * Block metadata stacks with the following block — no
 * blank line between them. This matches idiomatic
 * AsciiDoc where `[source,ruby]` sits directly above
 * `----` with no intervening blank line. Consulted through
 * {@link stacksAsMetadata}, which owns the exceptions, and by the
 * list hazard's run-membership test (src/print/list-hazard.ts) — the
 * metadata-KIND classification has this one home.
 * @param block - The block node to test.
 * @returns Whether the block is block metadata.
 */
export function isBlockMetadata(block: BlockNode): boolean {
  return (
    block.type === "blockAttributeList" ||
    block.type === "blockTitle" ||
    block.type === "blockAnchor"
  );
}

/**
 * Whether the printer emits nothing at all for this inline child, so
 * it is not on the printed line however much source it covers.
 *
 * Only text can vanish, and the test is the PACKER's own word split
 * (`splitWords`, print/reflow.ts): every atom a text node becomes is
 * one of those words, so a value they find no word in reaches no
 * output line. Asking the packer rather than restating a whitespace
 * class is what keeps the two from drifting - and since issue #75,
 * splitWords' set IS the reader's rstrip set (both are Ruby's ASCII-only
 * `\s`), so a no-break space is content to both or neither; the printed
 * line is what this module's records are about.
 *
 * "Only text" is a CLOSURE over the InlineNode union, checked kind by
 * kind on 2026-08-26 and true of all of them: an attributeReference
 * prints its own source (`{empty}` included), a rawLine owns an output
 * line, a hardLineBreak prints ` +`, and every span kind carries its
 * marks. A kind that later prints nothing and is not text would make
 * this under-answer, which returns the caller to the behavior it had
 * before the filter existed rather than to a wrong answer.
 * @param node - one inline child of a paragraph
 * @returns Whether the printer emits nothing for it.
 */
function printsNothing(node: InlineNode): boolean {
  return node.type === "text" && splitWords(node.value).length === 0;
}

/**
 * The anchor a block's PRINTED line spells, or undefined when the
 * block prints no `[[...]]` line at all: the `blockAnchor` node
 * itself, or a paragraph whose sole PRINTING child is an inline
 * anchor.
 *
 * The children that print NOTHING are counted out first
 * ({@link printsNothing}), and that is the whole of issue #46's second
 * shape: a `[[...]]` line with trailing whitespace keeps those blanks in
 * the paragraph's inline body, because the body is a source slice that
 * ends at the raw line's end (parse/lines/paragraph-reader.ts) while
 * the reader's rstrip took them off the line it classified. Left in
 * the count they made the line stop being an anchor line, and the
 * blank the printer then wrote in front of the block below was one its
 * own second pass removed.
 *
 * The sole printing child is the whole PRINTED line, which is the only
 * identity this needs: the printer emits one line here, that line is
 * the serialization of the surviving children, and the ones counted
 * out contribute no characters to it. The stronger claim, that the
 * paragraph's own extent is the child's span (by `bodyExtent`,
 * parse/build/paragraph.ts, over one content token), held while the
 * gate was a raw child count and does NOT hold now: `[[3-bad]]` with
 * two trailing spaces is two content tokens over a strictly wider
 * extent. Extents are not what the record is about.
 * @param block - The block node to test.
 * @returns The id/reftext pair its printed line spells, or undefined.
 */
function anchorOfLine(
  block: BlockNode,
): Pick<InlineAnchorNode, "id" | "reftext"> | undefined {
  if (block.type === "blockAnchor") {
    return block;
  }
  if (block.type !== "paragraph") {
    return undefined;
  }
  const printed = block.children.filter((node) => !printsNothing(node));
  if (printed.length !== 1) {
    return undefined;
  }
  const [child] = printed;
  // A BIBLIOGRAPHY-form anchor is excluded on purpose: its printed
  // line is `[[[id]]]`, three brackets, which the two-bracket
  // `BLOCK_ANCHOR` grammar this record answers against can never
  // match - testing it here would mean calling `anchorToSource` (the
  // two-bracket serializer) on a node it was not built for. A
  // paragraph whose sole content is a bibliography anchor is
  // therefore ordinary text as far as this record is concerned,
  // exactly like any other paragraph that opens with plain prose.
  return child.type === "inlineAnchor" && child.form === "inline"
    ? child
    : undefined;
}

/**
 * What this block's printed line re-reads as, when it prints as a
 * `[[…]]` line — THE printed-anchor record, derived at ask time and
 * stored nowhere: the fact depends on the PRINTER's spelling of the
 * node, which the reader cannot know without predicting the printer,
 * and a stored field would go stale the moment the serializer
 * changed.
 *
 * "anchor": the printed spelling satisfies the block-anchor grammar
 * (`[[id, ]]` prints `[[id, ]]`, which IS an anchor on re-read).
 * "lookalike": the printed spelling fails it and IS the author's own
 * line, because the serializer emits the captured post-comma bytes
 * whenever the author's spelling fails the grammar (a rejected id, or
 * the empty reftext of `[[id,]]`) - a TEXT line to the re-reader.
 * undefined: {@link anchorOfLine} found no printed `[[...]]` line.
 *
 * ONE test for BOTH node kinds. A `blockAnchor` node used to answer
 * `"anchor"` unconditionally, on the argument that its id passed the
 * grammar at classification and the serializer keeps a valid spelling
 * valid; that argument used to be false for the trailing-whitespace
 * family (issue #69/#79: the anchor builder sliced the RAW line, not
 * the rstripped one the classifier had already matched, so `[[ok]]`
 * with two trailing spaces built the id `ok]]` and the printed
 * `[[ok]]]]` was text on re-read). `heldMetadataNode`
 * (parse/lines/held-metadata.ts) hands every held builder the
 * rstripped span now, so this shape no longer reaches "lookalike" -
 * but a record that judges the printed line still does not take a
 * node kind's word for it, asking the grammar in one place rather
 * than trusting a second invariant it does not itself enforce.
 *
 * The class that moves with the whitespace used to have TWO arms,
 * before issue #75, because the packer's split set was wider than the
 * reader's rstrip set (JavaScript's `\s` against Ruby's ASCII-only
 * one). A tail in the reader's rstrip set (the six ASCII whitespace
 * characters) leaves a line the grammar already rejects, since the
 * blanks never reach the id: `[[3-bad]]` with two trailing spaces is a
 * lookalike, as `[[3-bad]]` is. A tail the packer used to erase but the
 * reader kept (a no-break space, a thin space, an ideographic space, a
 * byte-order mark) used to leave a line the reader refused to classify
 * as an anchor while the printer nonetheless emitted one - the one
 * shape where a paragraph answered `"anchor"`. splitWords is ASCII-only
 * now, so that second arm is gone: every such tail is content to BOTH
 * the reader and the packer, and the block-attributes suites'
 * "a trailing %s answers undefined" (tests/parser/block-attributes.test.ts)
 * and "a trailing %s is content, and keeps the blank"
 * (tests/format/block-attributes.test.ts) rows pin the unified answer
 * over the already-rejected `[[3-bad]]` id; the VALID-id shape
 * (`[[anc]]` plus the same tail) is pinned separately, in
 * tests/format/whitespace-nbsp.test.ts and
 * tests/parser/block-attributes.test.ts's own `[[anc]]` rows.
 *
 * Grammar: BLOCK_ANCHOR (parse/line-shapes.ts, over
 * BLOCK_ANCHOR_SOURCE); behavior is Ruby's BlockAnchorRx (rx.rb:164),
 * pinned by the corpus rows `blocks_test.rb#should not recognize
 * block anchor that starts with digit#0` / `…illegal id characters#0`
 * and the pseudo-anchor suites. Spelling: anchorToSource — the
 * printer's own serializer, so the record judges the line the printer
 * will actually emit.
 * @param block - The block node to test.
 * @returns What the block's printed line re-reads as, or undefined
 *   when it does not print as a `[[…]]` line.
 */
export function anchorLineShape(
  block: BlockNode,
): "anchor" | "lookalike" | undefined {
  const anchor = anchorOfLine(block);
  if (anchor === undefined) {
    return undefined;
  }
  return BLOCK_ANCHOR.test(anchorToSource(anchor)) ? "anchor" : "lookalike";
}

/**
 * Tests whether a block prints as an anchor line: {@link
 * anchorLineShape} answered at all. The stacking exceptions key on
 * this, not on the node kind — what breaks idempotency is the printed
 * LINE.
 *
 * The ONE spelling of the pseudo-anchor arm inside
 * {@link stacksAsMetadata}: every clause of the rule that asks about
 * an anchor asks it here, so the first-class node and the
 * look-alike line can never take different exceptions.
 * @param block - The block node to test.
 * @returns Whether the block prints as an anchor line.
 */
function isAnchorLine(block: BlockNode): boolean {
  return anchorLineShape(block) !== undefined;
}

/**
 * Tests whether a block's content would merge with a preceding
 * block anchor if no blank line separated them.
 *
 * Plain paragraphs and paragraph-form admonitions both start
 * with ordinary text that the parser would absorb into ONE
 * paragraph with the anchor inline on re-parse, breaking
 * idempotency. {@link stacksAsMetadata} is the one consumer: it
 * keeps the blank line before such a block, so re-parsing the
 * printer's output reads the anchor the author wrote.
 * @param block - The block node to test.
 * @returns Whether this block would merge with a preceding
 *   block anchor.
 */
function wouldMergeWithAnchor(block: BlockNode): boolean {
  return (
    block.type === "paragraph" ||
    (block.type === "admonition" && block.form === "paragraph")
  );
}

/**
 * Whether `previous` is block metadata that stacks directly above
 * `current` — THE pairing rule; every consumer shares it, so no
 * consumer re-derives stacking from node shapes of its own.
 *
 * Block metadata (attribute lists, anchors, titles) stacks with each
 * other and with the block that follows them, as does a pseudo-anchor
 * line — a paragraph that prints as `[[…]]` because its id failed the
 * block-anchor grammar. Two exceptions, both about re-parse fidelity:
 * a block anchor must not stack with a block whose text would merge
 * into it, and two anchors must not stack with each other (stacking
 * removes the blank line and re-parse folds them into one paragraph
 * of inline anchors, which is not what the author wrote). Both key on
 * the printed LINE ({@link isAnchorLine}), so a look-alike takes them
 * exactly as the first-class node does.
 * @param previous - The preceding block node.
 * @param current - The current block node.
 * @returns Whether the two stack as metadata.
 */
export function stacksAsMetadata(
  previous: BlockNode,
  current: BlockNode,
): boolean {
  return (
    (isBlockMetadata(previous) || isAnchorLine(previous)) &&
    !(isAnchorLine(previous) && isAnchorLine(current)) &&
    (!isAnchorLine(previous) || !wouldMergeWithAnchor(current))
  );
}
