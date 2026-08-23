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
 * it rather than restating its exceptions. The classifications it is
 * built from ({@link isBlockMetadata}, {@link isAnchorLine},
 * {@link wouldMergeWithAnchor}) are private to it — the rule is their
 * only consumer, so nothing can pair metadata by half of it.
 *
 * One printer-STYLE qualifier is exported beside them: a `[[…]]` line
 * whose id fails the block-anchor grammar is not metadata at all, but
 * it prints as though it were, and the rule that GROUPS an item's
 * held metadata lines (print-list-hazard.ts) has to say so as well
 * ({@link isPseudoAnchorLine}).
 */
import type { BlockNode } from "./ast.js";

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
  return (
    (block.type === "comment" && block.commentType === "line") ||
    block.type === "preprocessorDirective"
  );
}

/**
 * Tests whether a block is block metadata (attribute
 * list, block title, or block anchor).
 *
 * Block metadata stacks with the following block — no
 * blank line between them. This matches idiomatic
 * AsciiDoc where `[source,ruby]` sits directly above
 * `----` with no intervening blank line. Consulted through
 * {@link stacksAsMetadata}, which owns the exceptions.
 * @param block - The block node to test.
 * @returns Whether the block is block metadata.
 */
function isBlockMetadata(block: BlockNode): boolean {
  return (
    block.type === "blockAttributeList" ||
    block.type === "blockTitle" ||
    block.type === "blockAnchor"
  );
}

/**
 * Tests whether a block PRINTS as a bracket-anchor line without being
 * a `blockAnchor` node: a paragraph whose one and only inline child is
 * an inline anchor.
 *
 * The pseudo-anchor case. A `[[…]]` line is a block ANCHOR only when
 * it matches the block-anchor grammar (`BLOCK_ANCHOR_SOURCE`,
 * parse/line-shapes.ts; behavior is Ruby's `BlockAnchorRx`, rx.rb —
 * pinned by the corpus rows named below). When the id fails it
 * (`[[3-blind-mice]]` starts with a digit, `[[illegal$id]]` has an
 * illegal character) or the reftext alternative does not
 * (`[[id,]]` — the alternative needs a character after the comma),
 * Asciidoctor reads the line as an ordinary PARAGRAPH and so does the
 * reader; nothing about it is metadata. It still prints as `[[…]]`
 * alone on a line, so the printer keeps it with the block below: that
 * is the author's byte, and re-parsing our output must not gain a
 * blank line or an invented `+` (`[[id,]]` prints as `[[id]]`, which
 * IS a block anchor on re-parse, so pass 1 would not otherwise be a
 * fixed point). A printer-STYLE fact, not a parse fact — which is why
 * it qualifies the rules instead of being a node kind.
 *
 * The single child IS the whole line, and the check does not have to
 * say so: a paragraph is positioned over its content tokens
 * (`bodyExtent`, parse/build/paragraph.ts) and `buildFromTokens`
 * (parse/inline/inline-node-builder.ts) builds one node per token
 * span, so a one-child paragraph was built from one content token and
 * the two extents are the same span by construction. Anything else on
 * the line — trailing text, a trailing space, a hard break — is
 * another content token and therefore another child, which this
 * predicate rejects on the count.
 *
 * Pinned by tests/format/block-attributes.test.ts ("pseudo-anchor
 * lines"), tests/format/list-item-blocks.test.ts (the item-level run
 * rows) and the corpus rows `blocks_test.rb#should not recognize
 * block anchor that starts with digit#0` and `blocks_test.rb#should
 * not recognize block anchor with illegal id characters#0`, which
 * parity holds byte-identical.
 * @param block - The block node to test.
 * @returns Whether the block prints as a bracket-anchor line without
 *   being one.
 */
export function isPseudoAnchorLine(block: BlockNode): boolean {
  if (block.type !== "paragraph" || block.children.length !== 1) return false;
  const [child] = block.children;
  return child.type === "inlineAnchor";
}

/**
 * Tests whether a block prints as an anchor line: the first-class
 * `blockAnchor`, or a pseudo-anchor paragraph
 * ({@link isPseudoAnchorLine}). The stacking exceptions key on this,
 * not on the node kind — what breaks idempotency is the printed LINE.
 *
 * The ONE spelling of the pseudo-anchor arm inside
 * {@link stacksAsMetadata}: every clause of the rule that asks about
 * an anchor asks it here, so the first-class node and the
 * look-alike line can never take different exceptions. Private for
 * the same reason — the rule is the only place that composes them.
 * @param block - The block node to test.
 * @returns Whether the block prints as an anchor line.
 */
function isAnchorLine(block: BlockNode): boolean {
  return block.type === "blockAnchor" || isPseudoAnchorLine(block);
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
