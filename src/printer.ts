/**
 * Prettier printer for AsciiDoc AST → Doc IR.
 *
 * The printer walks our AST and produces Prettier's Doc IR (intermediate
 * representation). Prettier then converts the Doc IR to formatted text.
 *
 * Formatting opinions applied here:
 * - Paragraph text is reflowed to printWidth by the atom engine
 *   (src/reflow.ts): whitespace — including newlines — is normalized
 *   to single spaces between words, and the greedy packer decides
 *   where to break.
 * - Blocks separated by exactly one blank line
 *   (join with [hardline, hardline]).
 * - Documents end with exactly one trailing newline
 *   (hardline after last child).
 * - Empty documents produce empty output (no trailing newline).
 *
 * TODO: Reflow treats all paragraph text as prose. Constructs
 * the parser doesn't yet recognise (block macros, tables,
 * etc.) are parsed as paragraphs and will be incorrectly
 * reflowed. This resolves as those constructs get their own
 * AST nodes.
 */
import { doc, type Printer, type Doc } from "prettier";
import { MARKER_OFFSET } from "./constants.js";
import { inlineAtoms } from "./print-inline.js";
import { blockBody } from "./reflow.js";
import { joinBlocks } from "./print-join.js";
import {
  type AnyNode,
  hasPrecedingLanguageAttribute,
  printAdmonition,
  printAttributeEntry,
  printComment,
  printDelimitedBlock,
  printParentBlock,
} from "./print-blocks.js";
import { printList, printListItem } from "./print-list.js";
import { anchorToSource } from "./serialize-inline.js";

const {
  builders: { hardline },
} = doc;

const printer: Printer<AnyNode> = {
  print(path, options, print): Doc {
    const { node } = path;

    switch (node.type) {
      case "document": {
        const children = path.map(print, "children");
        if (node.children.length > 0) {
          return [joinBlocks(node.children, children), hardline];
        }
        return "";
      }
      case "heading":
      case "discreteHeading": {
        // ONE arm for both heading leaves and every level (`=`, level
        // 0, through `======`): the two kinds print identically and
        // the level is CARRIED, never re-derived — a single
        // construction site leaves no second spelling to drift.
        // Pinned by the level-jump row and the discrete-heading row
        // in tests/format/heading-adjacency.test.ts.
        return ["=".repeat(node.level + MARKER_OFFSET), " ", node.title];
      }
      case "comment": {
        return printComment(node);
      }
      case "attributeEntry": {
        return printAttributeEntry(node);
      }
      case "blockAttributeList": {
        return ["[", node.value, "]"];
      }
      case "blockTitle": {
        return [".", node.title];
      }
      case "delimitedBlock": {
        return printDelimitedBlock(node, hasPrecedingLanguageAttribute(node));
      }
      case "parentBlock": {
        return printParentBlock(node, path, print);
      }
      case "admonition": {
        return printAdmonition(node, path, print, options.printWidth);
      }
      // Normalize breaks to the canonical three-character form
      // regardless of how many characters the source used
      // (`''''` → `'''`, `<<<<<` → `<<<`).
      case "thematicBreak": {
        return "'''";
      }
      case "pageBreak": {
        return "<<<";
      }
      case "blockMacro": {
        const { name, target, attrlist } = node;
        return [name, "::", target, "[", attrlist, "]"];
      }
      // A line Asciidoctor's reader eats before block parsing
      // (`PreprocessorReader#process_line`): kept exactly as written,
      // because the formatter cannot resolve it.
      case "preprocessorDirective": {
        return node.value;
      }
      // A block anchor prints through the same spelling the inline
      // anchor uses — one serializer, byte-identical to the wrapper
      // paragraph it replaced (spec D6; parity enforces the bytes).
      case "blockAnchor": {
        return anchorToSource(node);
      }
      case "paragraph": {
        // Reflow paragraph text to printWidth: THE block-body engine
        // (reflow.ts blockBody), shared with the paragraph-form
        // admonition body and the list item's text (spec D7).
        return blockBody(
          inlineAtoms(node.children, node.position.start.line),
          options.printWidth,
          0,
        );
      }
      case "list": {
        return printList(node, path, print);
      }
      case "listItem": {
        return printListItem(node, path, print, options.printWidth);
      }
      // An inline node standing alone is a one-node block: the same
      // engine, at the full width. Prettier's AstPath is invariant, so
      // the printer's node union must admit the inline nodes a
      // paragraph's `children` array is typed with, and this arm is
      // what admitting them means — every block that owns inline
      // content builds its atoms itself.
      default: {
        return blockBody(
          inlineAtoms([node], node.position.start.line),
          options.printWidth,
          0,
        );
      }
    }
  },
};

export default printer;
