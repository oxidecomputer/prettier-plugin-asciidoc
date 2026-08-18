/**
 * Section nesting logic for the AST builder.
 *
 * The grammar parses sections flat — each section heading is just
 * another block. This module converts that flat sequence into a
 * nested tree where deeper sections become children of shallower
 * ones. The algorithm mirrors nestListItems in list-builder.ts:
 * a stack tracks open nesting levels.
 */
import type { BlockNode, SectionNode } from "../ast.js";
import { EMPTY, LAST_ELEMENT, NEXT } from "../constants.js";
import { isBlockMetadata } from "../block-metadata.js";

/**
 * Close the innermost open section and attach it to its
 * parent. If a section is still on the stack the finished
 * section becomes that parent's child; otherwise it falls
 * through to the document root. Factored out so that the
 * main loop body and the end-of-input drain phase share
 * identical placement logic — duplicating it would risk
 * the two diverging silently.
 * @param stack - The open-section stack being maintained
 *   by nestSections. Each entry is a section whose
 *   children are still being accumulated. Mutated in
 *   place: the top entry is removed.
 * @param children - Top-level block accumulator for the
 *   document. Finished sections land here when the stack
 *   is empty (i.e. they have no enclosing section).
 */
function popSection(stack: SectionNode[], children: BlockNode[]): void {
  const finished = stack.pop();
  if (finished === undefined) {
    return;
  }
  if (stack.length > EMPTY) {
    stack[stack.length + LAST_ELEMENT].children.push(finished);
  } else {
    children.push(finished);
  }
}

/**
 * Check whether the block at `index` is section metadata: a
 * block-metadata node (anchor paragraph, block attribute
 * list, or block title) whose following flat blocks —
 * possibly more metadata — lead to a section heading. Such
 * blocks label the section (issue #3: `[[id]]` above
 * `== Heading` gives the section its xref id), so nesting
 * must place them next to the section node rather than
 * appending them to whatever container is currently open —
 * otherwise the anchor lands as the last child of the
 * PREVIOUS section and the printer's blank-line separator
 * detaches it from its heading. Blank lines are irrelevant
 * here: Asciidoctor attaches block metadata to the next
 * block even across blank lines, so a detached anchor is
 * re-attached (healing documents damaged by the bug).
 *
 * Known limitation: comments are NOT treated as transparent.
 * In `[[id]]` / `// note` / `== H`, the scan stops at the
 * comment, so the anchor stays in the previous container and
 * prints visually detached from the heading. This is cosmetic
 * only — Asciidoctor skips comment lines when attaching
 * metadata, so the id still resolves to the section in both
 * layouts (verified against `@asciidoctor/core`).
 * @param flatBlocks - The flat block sequence.
 * @param index - Index of the candidate metadata block.
 * @returns True when the block labels an upcoming section.
 */
function isSectionMetadata(flatBlocks: BlockNode[], index: number): boolean {
  if (!isBlockMetadata(flatBlocks[index])) {
    return false;
  }
  for (let scan = index + NEXT; scan < flatBlocks.length; scan += NEXT) {
    const { [scan]: block } = flatBlocks;
    if (block.type === "section") {
      return true;
    }
    if (!isBlockMetadata(block)) {
      return false;
    }
  }
  return false;
}

/**
 * Convert a flat block array into a nested section tree.
 * Sections at deeper levels become children of the
 * preceding shallower section (e.g. `== A` then `=== B`
 * produces A containing B). Non-section blocks attach to
 * the deepest open section or the document root.
 * @param flatBlocks - The unstructured block sequence
 *   produced by the CST visitor. The grammar emits all
 *   section headings at the same depth regardless of
 *   their `=` count, so nesting must be reconstructed
 *   here from the level numbers alone.
 * @returns A block array where every section's children
 *   list contains exactly the blocks and sub-sections
 *   that appeared between its heading and the next
 *   heading of equal or lesser level (or end of input).
 */
export function nestSections(flatBlocks: BlockNode[]): BlockNode[] {
  const children: BlockNode[] = [];
  const stack: SectionNode[] = [];
  // Metadata blocks held back because they label an upcoming
  // section heading (see isSectionMetadata). Flushed into the
  // section's own container when the heading arrives, so the
  // metadata always ends up the section node's immediate
  // preceding sibling.
  let pendingMetadata: BlockNode[] = [];

  for (const [index, block] of flatBlocks.entries()) {
    if (block.type === "section") {
      // Pop sections at the same level or deeper. A heading at
      // level N closes any open section also at level N because
      // two sections at the same level are siblings, not nested.
      // Deeper sections (level > N) are obviously closed too.
      while (
        stack.length > EMPTY &&
        stack[stack.length + LAST_ELEMENT].level >= block.level
      ) {
        popSection(stack, children);
      }
      // Emit the section's metadata into the container the
      // section itself will pop into. Nothing else can be
      // appended to that container while this section is on
      // the stack, so the metadata is guaranteed to sit
      // directly before the section node.
      const container =
        stack.length > EMPTY
          ? stack[stack.length + LAST_ELEMENT].children
          : children;
      container.push(...pendingMetadata);
      pendingMetadata = [];
      stack.push(block);
    } else if (isSectionMetadata(flatBlocks, index)) {
      pendingMetadata.push(block);
    } else if (stack.length > EMPTY) {
      stack[stack.length + LAST_ELEMENT].children.push(block);
    } else {
      children.push(block);
    }
  }

  // Drain remaining sections from the stack.
  while (stack.length > EMPTY) {
    popSection(stack, children);
  }

  return children;
}
