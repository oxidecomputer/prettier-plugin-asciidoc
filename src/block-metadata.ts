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
 * THE pairing rule lives here too ({@link stacksAsMetadata}, spec
 * D5b): whether a metadata block stacks directly above the block
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
 * held metadata lines (print-list-hazard.ts) and that suppress
 * stacking above a heading (print-join.ts) both have to say so.
 */
import type { BlockNode } from "./ast.js";
import { BLOCK_ANCHOR } from "./parse/line-shapes.js";
import { anchorToSource } from "./serialize-inline.js";

/**
 * Tests whether a block is a `//` line comment — the ONE node-level
 * home for the question. `Reader#skip_line_comments` consumes such
 * lines before anything counts them, which makes them transparent
 * wherever adjacency or attachment is decided: the printer stacks
 * consecutive comments without a blank (print-join.ts, where closing
 * the gap can change nothing — a line comment renders nothing, unlike
 * a preprocessor directive, whose blank-line gap the reader can still
 * make visible), and the list hazard reads through them on both sides
 * of its run (print-list-hazard.ts). A `////`-delimited comment BLOCK
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
 * (`PreprocessorReader#process_line`, reader.rb:819).
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
 * their neighbours (print-join.ts).
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
 * list hazard's run-membership test (print-list-hazard.ts) — the
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
 * What this block's printed line re-reads as, when it prints as a
 * `[[…]]` line — THE printed-anchor record, derived at ask time and
 * stored nowhere: the fact depends on the PRINTER's spelling of the
 * node, which the reader cannot know without predicting the printer,
 * and a stored field would go stale the moment the serializer
 * changed.
 *
 * "anchor": the printed spelling satisfies the block-anchor grammar —
 * a blockAnchor node, or a sole-inlineAnchor paragraph whose printed
 * line passes (`[[id,]]` prints `[[id]]`, which IS an anchor on
 * re-read). "lookalike": the printed spelling fails the grammar and
 * IS the author's own line — for a comma-free spelling by the
 * sole-child extent argument below, and for a reftext-bearing one by
 * the serializer's verbatim arm (anchorToSource emits the captured
 * post-comma bytes when the id fails the grammar) — a TEXT line to
 * the re-reader. undefined: everything else.
 *
 * Grammar: BLOCK_ANCHOR (parse/line-shapes.ts, over
 * BLOCK_ANCHOR_SOURCE); behavior is Ruby's BlockAnchorRx (rx.rb:163),
 * pinned by the corpus rows `blocks_test.rb#should not recognize
 * block anchor that starts with digit#0` / `…illegal id characters#0`
 * and the pseudo-anchor suites. Spelling: anchorToSource — the
 * printer's own serializer, so the record judges the line the printer
 * will actually emit.
 *
 * The single child IS the whole line, and the check does not have to
 * say so: a paragraph is positioned over its content tokens
 * (`bodyExtent`, parse/build/paragraph.ts) and `buildFromTokens`
 * (parse/inline/inline-node-builder.ts) builds one node per token
 * span, so a one-child paragraph was built from one content token and
 * the two extents are the same span by construction. Anything else on
 * the line — trailing text, a trailing space, a hard break — is
 * another content token and therefore another child, which the count
 * rejects.
 * @param block - The block node to test.
 * @returns What the block's printed line re-reads as, or undefined
 *   when it does not print as a `[[…]]` line.
 */
export function anchorLineShape(
  block: BlockNode,
): "anchor" | "lookalike" | undefined {
  if (block.type === "blockAnchor") {
    // A blockAnchor node's id passed BLOCK_ANCHOR at classification,
    // and the serializer's valid-id arm keeps a valid spelling valid.
    return "anchor";
  }
  if (block.type !== "paragraph" || block.children.length !== 1) {
    return undefined;
  }
  const [child] = block.children;
  if (child.type !== "inlineAnchor") {
    return undefined;
  }
  return BLOCK_ANCHOR.test(anchorToSource(child)) ? "anchor" : "lookalike";
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
 * `current` — THE pairing rule; every consumer shares it (spec D5b).
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
