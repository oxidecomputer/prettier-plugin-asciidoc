/**
 * Block-metadata classification over AST nodes.
 *
 * "Block metadata" is a block that annotates the block after it
 * rather than standing alone: block attribute lists
 * (`[source,ruby]`), block titles (`.Title`), and anchor-only
 * paragraphs (`[[id]]`). Both sides of the pipeline need the
 * SAME definition — the printer stacks metadata directly above
 * the block it annotates (print-join.ts), and the parser's
 * section-nesting pass moves metadata into the container of the
 * section heading it labels (section-builder.ts). A neutral
 * module keeps the two from diverging without making the parse
 * layer depend on the print layer.
 */
import type { BlockNode } from "./ast.js";
import { FIRST, SINGLE } from "./constants.js";

/**
 * Tests whether a block is a paragraph whose only child
 * is an inline anchor (`[[id]]`).
 *
 * These act as block metadata when they appear on a
 * standalone line, but unlike true metadata tokens they
 * would merge with a following paragraph on re-parse
 * (breaking idempotency), so the printer's stacking needs
 * special treatment.
 * @param block - The block node to test.
 * @returns Whether the block is an anchor-only paragraph.
 */
export function isAnchorParagraph(block: BlockNode): boolean {
  return (
    block.type === "paragraph" &&
    block.children.length === SINGLE &&
    block.children[FIRST].type === "inlineAnchor"
  );
}

/**
 * Tests whether a block is block metadata (attribute
 * list, block title, or anchor paragraph).
 *
 * Block metadata stacks with the following block — no
 * blank line between them. This matches idiomatic
 * AsciiDoc where `[source,ruby]` sits directly above
 * `----` with no intervening blank line.
 * @param block - The block node to test.
 * @returns Whether the block is block metadata.
 */
export function isBlockMetadata(block: BlockNode): boolean {
  return (
    block.type === "blockAttributeList" ||
    block.type === "blockTitle" ||
    isAnchorParagraph(block)
  );
}

/**
 * Tests whether a block's content would merge with a preceding
 * anchor paragraph if no blank line separated them.
 *
 * Plain paragraphs and paragraph-form admonitions both start
 * with ordinary text that the parser would absorb into the
 * anchor's paragraph on re-parse, breaking idempotency. Both
 * sides of the pipeline consult this: the printer preserves a
 * blank line before such blocks (print-join.ts), and the
 * continuation absorber refuses to build an attached
 * metadata+block group that stacking would corrupt
 * (continuation-absorber.ts).
 * @param block - The block node to test.
 * @returns Whether this block would merge with a preceding
 *   anchor paragraph.
 */
export function wouldMergeWithAnchor(block: BlockNode): boolean {
  return (
    (block.type === "paragraph" && !isAnchorParagraph(block)) ||
    (block.type === "admonition" && block.form === "paragraph")
  );
}
