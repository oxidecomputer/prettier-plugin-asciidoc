/**
 * Description-list printing: a list of items, each of them its term
 * lines, the source between them, its description and the blocks
 * attached to it.
 *
 * THE WIDTH REACHES ONE ARM AND ONLY ONE. A description item answers
 * `"replay"` or `"reflow"` (src/ast.ts, `DescriptionPrinting`), the
 * answer is the SCAN's and travels on the node, and this file reads it
 * rather than asking again. The replay arm writes the item's recorded
 * lines back exactly as they stand, so a width is an input to no
 * computation it performs; the reflow arm is the packer's, and the
 * width is the one thing it needs that the node does not carry.
 *
 * The replay is the partition read back: for each term, its own
 * source line and then that term's gap lines, one per line; then the
 * description's recorded lines; then each block behind the separator
 * lines the source wrote before it, through the same gap spelling a
 * marker item's blocks print behind.
 */
import { doc, type Doc } from "prettier";
import type {
  DescriptionListItemNode,
  DescriptionTermNode,
  InlineNode,
  TermEntry,
  TermGapLine,
} from "../ast.js";
import { inlineAtoms } from "./inline.js";
import { gapParts, tailParts } from "./list.js";
import { atomOf, blockBody } from "./reflow.js";
import type { PrintFunction, PrintPath } from "./blocks.js";

const {
  builders: { hardline, join },
} = doc;

/**
 * Print a description list: its items, one under the other with no
 * blank line between them.
 *
 * ADJACENT, and not by default: `parse_description_list` has no
 * `skip_blank_lines` between siblings (parser.rb:1228, against
 * :1119-1128 for a marker list), because the item's own read
 * consumed the blanks and its buffer popped them (:1584). So a blank
 * a source wrote between two items is not part of either item and is
 * not replayed - which is also why writing none cannot break the
 * list: the sibling pattern is asked of the very next line either
 * way (`is_sibling_list_item?`, :1430).
 *
 * A DETACHED `+` between two items goes with those blanks, and the
 * rule is stated here rather than left to be inferred, because the
 * gap alphabet says the opposite about a `+` that stands INSIDE an
 * item ({@link TermGapLine}: there it is an author's byte and it is
 * replayed). The two are different bytes. A `+` behind a blank
 * attaches to nothing - it is not the first item's trailing
 * continuation, which needs no blank, and it heads no paragraph, so
 * `detachedTail` is false by construction - and Ruby erases it where
 * it stands (`buffer[detached_continuation] = ListContinuationPlaceholder`,
 * :1576). It reaches no node, renders nothing, and writing none is a
 * fixed point. Measured: `a:: d` / blank / `+` / `b:: y` prints
 * `a:: d` / `b:: y`, render-equal; `a:: d` / `+` / `b:: y` with no
 * blank keeps its `+`, because there it IS the first item's trailing
 * continuation and a fact on that item's node.
 * @param path - Prettier's AST path, for recursing into the items
 * @param print - Prettier's recursive print callback
 * @returns Doc IR for the formatted list
 */
export function printDescriptionList(
  path: PrintPath,
  print: PrintFunction,
): Doc {
  return join(hardline, path.map(print, "children"));
}

/**
 * The image one term-gap line goes back to the source as.
 * @param line - the gap line
 * @returns the line it stands for, without its newline
 */
function termGapImage(line: TermGapLine): string {
  return typeof line === "string" ? line : line.comment;
}

/**
 * One term's gap, written back one line per line.
 * @param gap - the term's recorded gap lines
 * @returns the parts that follow the term's own line
 */
function gapImages(gap: readonly TermGapLine[]): Doc[] {
  return gap.flatMap((line) => [hardline, termGapImage(line)]);
}

/**
 * The item's OPENING: the term line up to where its own inline
 * description begins, which is the indent `DescriptionListRx`
 * swallowed, the term and its delimiter.
 *
 * Taken from the description's first inline node rather than from the
 * delimiter's own length, so the one fact read is a POSITION the
 * builder already recorded and nothing here re-matches the term line.
 * Where the term line carried no description of its own - the item has
 * none at all, or the whole of it is on the lines under the term - the
 * line IS the opening and goes back whole.
 *
 * The `[ \t]+` the pattern reaches the description through is trimmed
 * rather than kept, which is the ONE spelling the reflow arm decides
 * for itself: the packer writes one space between two words, so
 * `t::   d` comes back as `t:: d`. Render-neutral, because that run is
 * exactly what `DescriptionListRx` consumes before the description
 * starts, and it is the same collapse the packer applies to every
 * other run of spaces inside the description. The REPLAY arm respells
 * nothing, which is why the two spellings only ever part company on an
 * item the conditions cleared.
 * @param term - the item's last term, whose line the description
 *   shares
 * @param text - the item's principal text, as inline nodes
 * @returns the opening, without its newline
 */
function openingImage(
  term: DescriptionTermNode,
  text: readonly InlineNode[],
): string {
  const start = text.at(0)?.position.start;
  if (start?.line !== term.position.start.line) {
    return term.line;
  }
  return term.line.slice(0, start.column - 1).trimEnd();
}

/**
 * The item's last term line and the description that hangs off it,
 * written the way the answer the SCAN recorded says to write them.
 *
 * A total switch with no `default`, so the compiler refuses a third
 * answer until somebody says what the printer does with it. The two
 * arms part company at the PACKER and nowhere else: `"replay"` writes
 * the recorded line, the gap under it and the recorded description
 * lines, each at the column its author wrote it in; `"reflow"` hands
 * the opening and the description's inline nodes to the block-body
 * engine as ONE run, which is what the formatter does with a
 * paragraph.
 *
 * The reflow arm writes no gap, and that is not an omission: the scan
 * answers `"reflow"` only for an item whose last term's gap is EMPTY
 * (src/parse/lines/description-list-node.ts), because a join writes
 * the description onto the term line and would delete every line
 * standing between the two. There is nothing here to write.
 *
 * The OPENING is an atom of the packed run rather than a prefix in
 * front of it, for the reason the paragraph-form admonition's label is
 * one (src/print/blocks.ts): it occupies its columns of the first
 * output line and the packer must measure them, while every line the
 * packer opens after it stands at column 0, exactly where the four
 * conditions probed the description's words. The join after it may
 * never become a break - `t::` alone on a line is a TERM with no
 * inline text, whose item reads greedily past a blank
 * (parser.rb:1551-1556) and swallows the next block.
 * @param node - the item being printed
 * @param entry - its last term entry
 * @param term - that term's own printed doc, which the replay arm
 *   writes and the reflow arm respells
 * @param printWidth - the column budget for a whole output line
 * @returns the parts that close the item's own lines
 */
function closingLines(
  node: DescriptionListItemNode,
  entry: TermEntry,
  term: Doc,
  printWidth: number,
): Doc[] {
  switch (node.printing) {
    case "replay": {
      return [
        term,
        ...gapImages(entry.gap),
        ...node.textLines.flatMap((line): Doc[] => [hardline, line]),
      ];
    }
    case "reflow": {
      const opening = openingImage(entry.term, node.text);
      const body = inlineAtoms(node.text, entry.term.position.start.line, {
        atColumnZero: false,
        markInFront: undefined,
      });
      // Text nodes that are all whitespace produce no atoms, so a text
      // array with children can still yield none - and then the
      // opening is the whole item. ONE test for both, as the
      // admonition's label arm makes it.
      if (body.length === 0) {
        return [opening];
      }
      return blockBody(
        [
          atomOf(opening),
          { ...body[0], glueLeft: false, noBreakBefore: true },
          ...body.slice(1),
        ],
        printWidth,
        0,
      );
    }
  }
}

/**
 * Print one description item.
 * @param node - the item
 * @param path - Prettier's AST path, for recursing into the blocks
 * @param print - Prettier's recursive print callback
 * @param printWidth - the column budget for a whole output line, read
 *   by the reflow arm and by nothing else
 * @returns Doc IR for the formatted item
 */
export function printDescriptionListItem(
  node: DescriptionListItemNode,
  path: PrintPath,
  print: PrintFunction,
  printWidth: number,
): Doc {
  const terms = path.map((termPath) => termPath.call(print, "term"), "terms");
  const parts: Doc[] = [];
  // `path.map` walked `terms`, so the printed docs are that array's
  // parallel and the index is the entry's own. Every term ABOVE the
  // item's last is a line of its own behind its gap; the LAST one is
  // the line the description shares, so the two are written together
  // and the hardline between them is the closing arm's to decide.
  for (const [index, term] of terms.entries()) {
    const entry = node.terms[index];
    if (index + 1 === terms.length) {
      parts.push(...closingLines(node, entry, term, printWidth));
    } else {
      parts.push(term, ...gapImages(entry.gap), hardline);
    }
  }
  return [...parts, ...printedBlocks(node, path, print)];
}

/**
 * The item's blocks, each behind the separator lines the source wrote
 * in front of it - the recorded gap, replayed through the spelling a
 * marker item's blocks already print behind ({@link gapParts}).
 *
 * The RECORDED gap, not `printedGap`'s adjusted one: that adjustment
 * exists for a nested list that shares its parent ITEM's marker, and
 * a description item has no marker for one to share. A nested list
 * whose delimiter this list's sibling pattern matches is not a
 * nested list at all - it is the next item.
 * @param node - the item
 * @param path - Prettier's AST path, for recursing into the blocks
 * @param print - Prettier's recursive print callback
 * @returns the Doc parts that follow the item's own lines
 */
function printedBlocks(
  node: DescriptionListItemNode,
  path: PrintPath,
  print: PrintFunction,
): Doc[] {
  const blocks = path.map(
    (blockPath) => blockPath.call(print, "block"),
    "blocks",
  );
  const parts: Doc[] = [];
  for (const [index, block] of blocks.entries()) {
    parts.push(...gapParts(node.blocks[index].gap), block);
  }
  parts.push(...tailParts(node));
  return parts;
}
