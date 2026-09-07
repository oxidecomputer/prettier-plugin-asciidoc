/**
 * Where a `// prettier-ignore` line reaches: the mark that tells the
 * printer to write a block's own source bytes back instead of
 * formatting it (`BlockNodeBase.ignoredByPragma`, src/ast.ts).
 *
 * Split from reader.ts by responsibility, the way held-metadata.ts is:
 * the reader owns the read position and the block sequence, and this
 * owns only which block the pragma names. It is the one writer of the
 * mark.
 */
import type { BlockNode } from "../../ast.js";
import {
  isBlockMetadata,
  isIgnorePragma,
  isReaderConsumedLine,
} from "../../block-metadata.js";

/**
 * Mark the block joining a sequence when a pragma above it is still
 * looking for the block it names.
 *
 * The run is read off the marks already recorded rather than out of a
 * flag the reader carries: a pragma marks the block under it, and a
 * marked block that {@link isBlockMetadata} or
 * {@link isReaderConsumedLine} answers for passes the mark on to the
 * block under IT. Keeping the state in the marks is what makes it
 * impossible for a run to be open with nothing recording it.
 *
 * WHAT THE RUN CROSSES, exactly as built and not as Asciidoctor's own
 * metadata loop would: a block attribute list, a block title, a block
 * anchor, a `//` line comment, a preprocessor directive, and a blank
 * line (a blank is no node, so the previous SIBLING is still the
 * pragma). Anything else ends it and is itself the block the pragma
 * names. The two differences from `parse_block_metadata_line`
 * (parser.rb l.2043-2089) are measured and deliberate rather than
 * claimed to be absent, and they point opposite ways:
 *
 * - The run stops SHORT of that loop at an attribute entry
 *   (`:name: value`) and at a `////` comment BLOCK. The loop reads
 *   through both; neither predicate above answers for either kind, so
 *   the run ends there and freezes a smaller unit than the pragma
 *   names. Pinned by the two "stops at" rows in
 *   tests/format/ignore-pragma.test.ts.
 * - The run reaches PAST that loop across a blank line, which ends the
 *   loop. Pinned by the "crosses a blank line" row in the same file.
 *
 * Neither costs a reading: the block the run lands on is written back
 * as the author spelled it either way. Which boundary is wanted is one
 * question for both directions, and it is open.
 *
 * Only the previous sibling is read, so this is a fold over the
 * sequence and not a search back through it.
 * @param blocks - the sequence so far, in source order
 * @param node - the block about to join it
 */
export function carryIgnorePragma(
  blocks: readonly BlockNode[],
  node: BlockNode,
): void {
  const previous = blocks.at(-1);
  if (previous === undefined) {
    return;
  }
  const passesItOn =
    previous.ignoredByPragma === true &&
    (isBlockMetadata(previous) || isReaderConsumedLine(previous));
  if (isIgnorePragma(previous) || passesItOn) {
    node.ignoredByPragma = true;
  }
}
