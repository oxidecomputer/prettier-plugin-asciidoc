/**
 * Prettier printer for AsciiDoc AST → Doc IR.
 *
 * The printer walks our AST and produces Prettier's Doc IR (intermediate
 * representation). Prettier then converts the Doc IR to formatted text.
 *
 * Formatting opinions applied here:
 * - Paragraph text is reflowed to printWidth using fill.
 *   (Whitespace — including newlines — is normalized to single
 *   spaces between words; fill decides where to break.)
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
import { EMPTY, MARKER_OFFSET } from "./constants.js";
import { printInlineNode } from "./print-inline.js";
import { flattenForFill, stripLeadingHazardBreak } from "./reflow.js";
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

const {
  builders: { fill, hardline },
} = doc;

const printer: Printer<AnyNode> = {
  print(path, _options, print): Doc {
    const { node } = path;

    switch (node.type) {
      case "document": {
        const children = path.map(print, "children");
        if (node.children.length > EMPTY) {
          return [joinBlocks(node.children, children), hardline];
        }
        return "";
      }
      case "documentTitle": {
        return ["= ", node.title];
      }
      case "section": {
        const marker = "=".repeat(node.level + MARKER_OFFSET);
        const headingContent: Doc = [marker, " ", node.heading];
        if (node.children.length > EMPTY) {
          const sectionChildren = path.map(print, "children");
          return [
            headingContent,
            hardline,
            hardline,
            joinBlocks(node.children, sectionChildren),
          ];
        }
        return headingContent;
      }
      case "discreteHeading": {
        const marker = "=".repeat(node.level + MARKER_OFFSET);
        return [marker, " ", node.heading];
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
        return printDelimitedBlock(
          node,
          hasPrecedingLanguageAttribute(node, path),
        );
      }
      case "parentBlock": {
        return printParentBlock(node, path, print);
      }
      case "admonition": {
        return printAdmonition(node, path, print);
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
      case "paragraph": {
        // Reflow paragraph text to printWidth using fill. The text
        // children produce word/line pairs; fill packs as many words
        // as possible onto each line before wrapping.
        // flattenForFill (not .flat()) ensures proper fill()
        // alignment when inline formatting is mixed with text.
        return fill(
          stripLeadingHazardBreak(flattenForFill(path.map(print, "children"))),
        );
      }
      case "list": {
        return printList(node, path, print);
      }
      case "listItem": {
        return printListItem(node, path, print);
      }
      case "text":
      case "bold":
      case "italic":
      case "monospace":
      case "highlight":
      case "attributeReference":
      case "inlineMacro":
      case "link":
      case "xref":
      case "inlineAnchor":
      case "rawLine":
      case "hardLineBreak": {
        return printInlineNode(node, path, print);
      }
    }
  },
};

export default printer;
