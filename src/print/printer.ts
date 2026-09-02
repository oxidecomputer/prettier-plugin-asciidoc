/**
 * Prettier printer for AsciiDoc AST → Doc IR.
 *
 * The printer walks our AST and produces Prettier's Doc IR (intermediate
 * representation). Prettier then converts the Doc IR to formatted text.
 *
 * Formatting opinions applied here:
 * - Paragraph text is reflowed to printWidth by the atom engine
 *   (src/print/reflow.ts): whitespace — including newlines — is normalized
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
import { canonicalAttrlist } from "../parse/attrlist.js";
import { MARKER_OFFSET } from "../constants.js";
import { inlineAtoms } from "./inline.js";
import { blockBody } from "./reflow.js";
import { joinBlocks } from "./join.js";
import {
  type AnyNode,
  hasPrecedingLanguageAttribute,
  printAdmonition,
  printAttributeEntry,
  printComment,
  printDelimitedBlock,
  printDocumentHeader,
  printParentBlock,
} from "./blocks.js";
import { printList, printListItem } from "./list.js";
import { anchorToSource } from "./serialize-inline.js";
import { getVisitorKeys } from "./visitor-keys.js";

const {
  builders: { hardline },
} = doc;

const printer: Printer<AnyNode> = {
  // Printing asks for the children it wants by name; the walk Prettier
  // makes over our AST on its own is generic and reads this table
  // instead. Cursor tracking is the live reader today, and without the
  // table it descends into `position` and calls locStart on an object
  // that has none. Range formatting never reaches the table at all,
  // for reasons that are Prettier's rather than ours.
  // See src/print/visitor-keys.ts.
  getVisitorKeys,

  print(path, options, print): Doc {
    const { node } = path;

    switch (node.type) {
      case "document": {
        const children = path.map(print, "children");
        // The byte-order mark the reader took off the head goes back
        // on first, in both arms. Stripping it is how the first line
        // is READ (src/parse/lines/split.ts); deleting it from the
        // output would shorten the file and hand any second mark
        // behind it to the next read, which strips that one in turn.
        const mark = node.byteOrderMark ?? "";
        if (node.children.length > 0) {
          return [mark, joinBlocks(node.children, children), hardline];
        }
        return mark;
      }
      // The document header owns its own lines, so it is one Doc
      // with no separator decision above it - see printDocumentHeader.
      case "documentHeader": {
        return printDocumentHeader(node);
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
        return ["[", canonicalAttrlist(node.value), "]"];
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
        // A block macro's brackets are ALWAYS an attribute list
        // (`parse_attributes`, parser.rb:611, :665), so the one spacing
        // rule applies with no per-name question — unlike an inline
        // macro, where most names take TEXT between the brackets
        // (src/print/serialize-inline.ts).
        return [name, "::", target, "[", canonicalAttrlist(attrlist), "]"];
      }
      // A line Asciidoctor's reader eats before block parsing
      // (`PreprocessorReader#process_line`): kept exactly as written,
      // because the formatter cannot resolve it.
      case "preprocessorDirective": {
        return node.value;
      }
      // A block anchor prints through the same spelling the inline
      // anchor uses — one serializer, byte-identical to the wrapper
      // paragraph it replaced (parity enforces the bytes).
      case "blockAnchor": {
        return anchorToSource(node);
      }
      case "paragraph": {
        // Reflow paragraph text to printWidth: THE block-body engine
        // (reflow.ts blockBody), shared with the paragraph-form
        // admonition body and the list item's text.
        return blockBody(
          inlineAtoms(node.children, node.position.start.line, true),
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
          inlineAtoms([node], node.position.start.line, true),
          options.printWidth,
          0,
        );
      }
    }
  },
};

export default printer;
