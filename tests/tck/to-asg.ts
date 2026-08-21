/**
 * Converts our AST to the AsciiDoc Abstract Semantic Graph (ASG)
 * format used by the official TCK (Technology Compatibility Kit)
 * tests.
 *
 * Test-only module — not shipped with the plugin. Validates our
 * parser produces semantically correct output by comparing
 * against the canonical expected outputs from asciidoc-tck.
 *
 * Current limitations:
 * - Inline nodes are merged into a single ASG "text" span per
 *   block, because AsgInline only has a text variant. Formatting
 *   marks (bold, italic, etc.) are serialized back to their source
 *   form so the merged text value matches the raw source.
 * - Block metadata (block attribute lists, titles) is not yet
 *   propagated onto the following block in ASG output.
 */

import type {
  AdmonitionNode,
  BlockNode,
  DelimitedBlockNode,
  DiscreteHeadingNode,
  DocumentNode,
  DocumentTitleNode,
  InlineNode,
  ListItemNode,
  ListNode,
  Location,
  PageBreakNode,
  ParagraphNode,
  ParentBlockNode,
  SectionNode,
  ThematicBreakNode,
} from "../../src/ast.js";
import type {
  AsgBlock,
  AsgBreak,
  AsgDiscreteHeading,
  AsgDocument,
  AsgInline,
  AsgLeafBlock,
  AsgList,
  AsgListItem,
  AsgLocation,
  AsgParagraph,
  AsgParentBlock,
  AsgSection,
} from "./asg-types.js";
import {
  convertInlines,
  toAsgLocation,
  locationFromPair,
} from "./to-asg-inlines.js";

// -- Delimiters -------------------------------------------------

const LEAF_DELIMITERS: Record<string, string> = {
  listing: "----",
  literal: "....",
  pass: "++++",
};

const PARENT_DELIMITERS: Record<string, string> = {
  example: "====",
  sidebar: "****",
  open: "--",
  quote: "____",
};

/**
 * Returns the ASG marker string for a list variant at a
 * given depth (e.g. "*" for unordered depth 1).
 * @param variant - list variant (unordered/ordered/callout)
 * @param depth - nesting depth (1-based)
 * @returns the marker string used in ASG output
 */
function listMarker(variant: ListNode["variant"], depth: number): string {
  switch (variant) {
    case "unordered": {
      return "*".repeat(depth);
    }
    case "ordered": {
      return ".".repeat(depth);
    }
    case "callout": {
      return "<.>";
    }
  }
}

// -- Block filtering --------------------------------------------

/**
 * Determines whether a block node is visible in the ASG.
 * The ASG omits comments, attribute entries, block attribute
 * lists, block titles, and preprocessor directives — the last
 * because a directive is a preprocessor line that Asciidoctor
 * resolves before the parser runs, so it has no ASG node at all.
 * @param node - block node to test for ASG visibility
 * @returns true if the node appears in ASG output
 */
function isAsgVisible(node: BlockNode): boolean {
  return (
    node.type !== "comment" &&
    node.type !== "attributeEntry" &&
    node.type !== "blockAttributeList" &&
    node.type !== "blockTitle" &&
    node.type !== "preprocessorDirective"
  );
}

/**
 * Filters a block array to only ASG-visible nodes,
 * removing comments, attribute entries, and metadata.
 * @param nodes - block nodes to filter
 * @returns only the nodes that appear in ASG output
 */
function filterVisible(nodes: BlockNode[]): BlockNode[] {
  return nodes.filter((n) => isAsgVisible(n));
}

// -- Block conversion -------------------------------------------

/**
 * Converts a ParagraphNode to ASG paragraph format with
 * inline content and location.
 * @param node - paragraph AST node
 * @returns ASG paragraph block
 */
function convertParagraph(node: ParagraphNode): AsgParagraph {
  return {
    name: "paragraph",
    type: "block",
    inlines: convertInlines(node.children),
    location: toAsgLocation(node),
  };
}

/**
 * Returns the effective end position of a block. Recurses
 * into sections whose position covers only the heading
 * line, finding the true end of their last visible child.
 * @param node - block node to find the end of
 * @returns the effective end Location
 */
function blockEffectiveEnd(node: BlockNode): Location {
  if (node.type === "section") {
    const last = filterVisible(node.children).at(-1);
    if (last !== undefined) {
      return blockEffectiveEnd(last);
    }
  }
  return node.position.end;
}

/**
 * Computes the ASG location for a section, spanning from
 * the heading through the end of its last visible child.
 * @param node - section AST node
 * @returns ASG location array [start, end]
 */
function sectionLocation(node: SectionNode): AsgLocation {
  const last = filterVisible(node.children).at(-1);
  if (last !== undefined) {
    return locationFromPair(node.position.start, blockEffectiveEnd(last));
  }
  return toAsgLocation(node);
}

/**
 * Builds ASG inline text nodes for a heading title.
 * Title text starts after the equals-sign prefix and
 * space. The prefix is `level+1` equals signs followed
 * by a space, totalling `level+2` characters (e.g. level
 * 0 → "= ", level 1 → "== ", level 2 → "=== ").
 * @param start - start location of the heading line
 * @param level - section nesting level (0-based)
 * @param heading - the heading text content
 * @returns ASG inlines array with a single text node
 */
function headingTitleInlines(
  start: Location,
  level: number,
  heading: string,
): AsgInline[] {
  const markerWidth = level + 2;
  const titleStart: Location = {
    offset: start.offset + markerWidth,
    line: start.line,
    column: start.column + markerWidth,
  };
  const titleEnd: Location = {
    offset: titleStart.offset + heading.length,
    line: start.line,
    column: titleStart.column + heading.length,
  };
  return [
    {
      name: "text",
      type: "string",
      value: heading,
      location: locationFromPair(titleStart, titleEnd),
    },
  ];
}

/**
 * Converts a SectionNode to ASG section format with
 * title inlines, level, child blocks, and location.
 * @param node - section AST node
 * @returns ASG section block
 */
function convertSection(node: SectionNode): AsgSection {
  const visible = filterVisible(node.children);
  return {
    name: "section",
    type: "block",
    title: headingTitleInlines(node.position.start, node.level, node.heading),
    level: node.level,
    blocks: visible.map((c) => convertBlock(c)),
    location: sectionLocation(node),
  };
}

/**
 * Converts a ListNode to ASG list format with variant,
 * marker, items, and location.
 * @param node - list AST node
 * @returns ASG list block
 */
function convertList(node: ListNode): AsgList {
  const { children } = node;
  const [firstItem] = children;
  const { depth } = firstItem;
  const marker = listMarker(node.variant, depth);
  return {
    name: "list",
    type: "block",
    variant: node.variant,
    marker,
    items: children.map((item) => convertListItem(item, marker)),
    location: toAsgLocation(node),
  };
}

/**
 * Converts a ListItemNode to ASG list item format with
 * the marker and principal (inline content).
 * Nested ListNodes are filtered out so only InlineNode
 * children are passed to convertInlines.
 * @param node - list item AST node
 * @param marker - the list marker string (e.g. "*")
 * @returns ASG list item block
 */
function convertListItem(node: ListItemNode, marker: string): AsgListItem {
  const inlines = node.children.filter(
    (child): child is InlineNode => child.type !== "list",
  );
  return {
    name: "listItem",
    type: "block",
    marker,
    principal: convertInlines(inlines),
    location: toAsgLocation(node),
  };
}

/**
 * Converts a DelimitedBlockNode (listing, literal, pass)
 * to ASG leaf block format with verbatim content.
 * @param node - delimited block AST node
 * @returns ASG leaf block
 */
function convertDelimitedBlock(node: DelimitedBlockNode): AsgLeafBlock {
  const delimiter = LEAF_DELIMITERS[node.variant] ?? "----";
  const inlines: AsgInline[] = [];
  if (node.content.length > 0) {
    const contentStartLine = node.position.start.line + 1;
    const contentLines = node.content.split("\n");
    const lastContentLine = contentStartLine + contentLines.length - 1;
    const lastLine = contentLines.at(-1) ?? "";
    // Delimited block content always starts at column 1;
    // the opening delimiter line is on start.line, so
    // content begins on start.line + 1. End col is the
    // length of the last content line (1-based inclusive).
    inlines.push({
      name: "text",
      type: "string",
      value: node.content,
      location: [
        { line: contentStartLine, col: 1 },
        { line: lastContentLine, col: lastLine.length },
      ],
    });
  }
  return {
    name: node.variant,
    type: "block",
    form: node.form,
    delimiter,
    inlines,
    location: toAsgLocation(node),
  };
}

/**
 * Converts a ParentBlockNode (example, sidebar, open,
 * quote) to ASG parent block format with child blocks.
 * @param node - parent block AST node
 * @returns ASG parent block
 */
function convertParentBlock(node: ParentBlockNode): AsgParentBlock {
  const delimiter = PARENT_DELIMITERS[node.variant] ?? "====";
  const visible = filterVisible(node.children);
  return {
    name: node.variant,
    type: "block",
    form: "delimited",
    delimiter,
    blocks: visible.map((c) => convertBlock(c)),
    location: toAsgLocation(node),
  };
}

/**
 * Converts an AdmonitionNode to ASG admonition format
 * with variant, form, delimiter, and child blocks.
 * @param node - admonition AST node
 * @returns ASG parent block with admonition metadata
 */
function convertAdmonition(node: AdmonitionNode): AsgParentBlock {
  const delimiter =
    node.delimiter === undefined
      ? "===="
      : (PARENT_DELIMITERS[node.delimiter] ?? "====");
  const visible = filterVisible(node.children);
  return {
    name: "admonition",
    type: "block",
    form: node.form,
    delimiter,
    variant: node.variant.toLowerCase(),
    blocks: visible.map((c) => convertBlock(c)),
    location: toAsgLocation(node),
  };
}

/**
 * Converts a DiscreteHeadingNode to ASG heading block
 * format with title inlines and level.
 * @param node - discrete heading AST node
 * @returns ASG discrete heading block
 */
function convertDiscreteHeading(node: DiscreteHeadingNode): AsgDiscreteHeading {
  return {
    name: "heading",
    type: "block",
    title: headingTitleInlines(node.position.start, node.level, node.heading),
    level: node.level,
    location: toAsgLocation(node),
  };
}

/**
 * Converts a thematic or page break node to ASG break
 * block format.
 * @param node - thematic break or page break AST node
 * @returns ASG break block with variant
 */
function convertBreak(node: ThematicBreakNode | PageBreakNode): AsgBreak {
  return {
    name: "break",
    type: "block",
    variant: node.type === "thematicBreak" ? "thematic" : "page",
    location: toAsgLocation(node),
  };
}

/**
 * Dispatches a BlockNode to the appropriate ASG converter
 * based on its type. Handles all block types including
 * metadata-only nodes that are filtered upstream.
 * @param node - any block AST node
 * @returns the corresponding ASG block
 */
function convertBlock(node: BlockNode): AsgBlock {
  switch (node.type) {
    case "paragraph": {
      return convertParagraph(node);
    }
    case "section": {
      return convertSection(node);
    }
    case "list": {
      return convertList(node);
    }
    case "delimitedBlock": {
      return convertDelimitedBlock(node);
    }
    case "parentBlock": {
      return convertParentBlock(node);
    }
    case "admonition": {
      return convertAdmonition(node);
    }
    case "discreteHeading": {
      return convertDiscreteHeading(node);
    }
    case "thematicBreak":
    case "pageBreak": {
      return convertBreak(node);
    }
    // What is left has no ASG block of its own. isAsgVisible()
    // strips comments, attribute entries, block attribute lists,
    // block titles and preprocessor directives before convertBlock()
    // sees them, and extractHeader() consumes a documentTitle that
    // is the document's FIRST child. Two cases still arrive here: a
    // blockMacro, which we do not project yet, and a documentTitle
    // that is not first (`para` then `= Title`), which is not a
    // header. The empty-paragraph sentinel satisfies TypeScript's
    // exhaustive switch without a throw that would require a
    // non-null assertion at every call site, and keeps such a
    // document comparable rather than crashing the TCK run.
    case "preprocessorDirective":
    case "blockMacro":
    case "comment":
    case "attributeEntry":
    case "blockAttributeList":
    case "blockTitle":
    case "documentTitle": {
      return {
        name: "paragraph",
        type: "block",
        inlines: [],
        location: toAsgLocation(node),
      };
    }
  }
}

// -- Document header extraction ---------------------------------

// Collected header data returned by extractHeader(). Kept
// private to this module; only toASG() consumes it.
interface HeaderInfo {
  title: DocumentTitleNode;
  attributes: Record<string, string>;
  headerEndLocation: Location;
  consumed: number;
}

/**
 * Extracts document header info (title + attribute entries)
 * from the leading children. Returns undefined if no
 * document title is present.
 * @param children - top-level block nodes of the document
 * @returns header info or undefined if no title found
 */
function extractHeader(children: BlockNode[]): HeaderInfo | undefined {
  if (children.length === 0) {
    return undefined;
  }
  const [first] = children;
  if (first.type !== "documentTitle") {
    return undefined;
  }
  const attributes: Record<string, string> = {};
  let lastHeaderNode: BlockNode = first;
  let consumed = 1;
  // Attribute entries immediately following the title are part
  // of the header.
  for (const child of children.slice(1)) {
    if (child.type === "attributeEntry") {
      attributes[child.name] = child.value ?? "";
      lastHeaderNode = child;
      consumed += 1;
    } else {
      break;
    }
  }
  return {
    title: first,
    attributes,
    headerEndLocation: lastHeaderNode.position.end,
    consumed,
  };
}

// -- Document location ------------------------------------------

/**
 * Computes the ASG location for the entire document,
 * spanning from the document start through the last body
 * block or header end.
 * @param document - the parsed document node
 * @param header - extracted header info, if any
 * @param bodyChildren - visible body block nodes
 * @returns ASG location array [start, end]
 */
function computeDocumentLocation(
  document: DocumentNode,
  header: HeaderInfo | undefined,
  bodyChildren: BlockNode[],
): AsgLocation {
  const { position } = document;
  const lastBody = bodyChildren.at(-1);
  if (lastBody !== undefined) {
    return locationFromPair(position.start, blockEffectiveEnd(lastBody));
  }
  if (header !== undefined) {
    return locationFromPair(position.start, header.headerEndLocation);
  }
  return toAsgLocation(document);
}

// -- Public API -------------------------------------------------

/**
 * Converts our parser's AST into the ASG format used by
 * the official AsciiDoc TCK conformance tests.
 * Test-only utility — not shipped with the plugin.
 * @param document - parsed DocumentNode from our parser
 * @returns ASG document object for comparison with TCK
 */
export function toASG(document: DocumentNode): AsgDocument {
  const header = extractHeader(document.children);
  const bodyStart = header?.consumed ?? 0;
  const bodyChildren = document.children
    .slice(bodyStart)
    .filter((n) => isAsgVisible(n));
  const documentLocation = computeDocumentLocation(
    document,
    header,
    bodyChildren,
  );

  const blocks = bodyChildren.map((c) => convertBlock(c));
  // TCK expected outputs omit blocks when empty.
  const result: AsgDocument = {
    name: "document",
    type: "block",
    ...(blocks.length > 0 ? { blocks } : {}),
    location: documentLocation,
  };
  if (header !== undefined) {
    const { title: titleNode, attributes, headerEndLocation } = header;
    const { position: titlePosition } = titleNode;
    // The document title is level 0, so we can reuse the
    // section-heading helper directly.
    const titleInlines = headingTitleInlines(
      titlePosition.start,
      0,
      titleNode.title,
    );
    result.attributes = attributes;
    result.header = {
      title: titleInlines,
      location: locationFromPair(titlePosition.start, headerEndLocation),
    };
  }
  return result;
}

/**
 * Converts our inline nodes to ASG inline format, for
 * use with inline-only TCK fixtures that expect just an
 * inlines array rather than a full document.
 * @param nodes - inline AST nodes from a paragraph
 * @returns ASG inlines array for TCK comparison
 */
export function toASGInlines(nodes: InlineNode[]): AsgInline[] {
  return convertInlines(nodes);
}
