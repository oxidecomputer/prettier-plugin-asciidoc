/**
 * Inline-to-text conversion and location helpers for the
 * ASG converter. Extracted from to-asg.ts to stay within
 * the max-lines lint limit.
 *
 * The ASG does not model inline markup — every inline span
 * is represented as a flat "text" node. This module handles
 * the flattening: it serialises our rich inline AST back to
 * source text, then wraps the result in a single AsgInlineLiteral
 * node covering the full span. This is test-only code used
 * solely for TCK conformance checks.
 */

import type { InlineNode, Location, Node } from "../../src/ast.js";
import {
  inlineMacroToSource,
  linkToSource,
  xrefToSource,
  anchorToSource,
} from "../../src/serialize-inline.js";
import type { AsgInline, AsgLocation } from "./asg-types.js";

// -- Location conversion ----------------------------------------

/**
 * Converts a parser AST node position to ASG location
 * format. Our end column is exclusive (one past last
 * char); ASG end column is inclusive.
 * @param node - AST node whose absolute source position
 *   is used; both start and end are document-level offsets,
 *   not relative to any parent node
 * @returns two-element ASG location array [start, end]
 */
export function toAsgLocation(node: Node): AsgLocation {
  return [
    { line: node.position.start.line, col: node.position.start.column },
    { line: node.position.end.line, col: node.position.end.column - 1 },
  ];
}

/**
 * Builds an ASG location from separate start and end
 * Location values. Useful when the span does not
 * correspond to a single node's position.
 * @param start - start location for the synthetic span;
 *   typically the position of the first sibling node in a
 *   group that has no single containing node
 * @param end - end location (exclusive column; one past
 *   the last character, matching our AST convention)
 * @returns two-element ASG location array [start, end]
 */
export function locationFromPair(start: Location, end: Location): AsgLocation {
  return [
    { line: start.line, col: start.column },
    { line: end.line, col: end.column - 1 },
  ];
}

// -- Inlines ----------------------------------------------------

/**
 * Serialises a single inline AST node back to its source
 * text. The ASG has no inline markup model — all inline
 * content is represented as a single flat "text" node.
 * To produce that text we must reconstruct the original
 * source, including all markup delimiters, macro syntax,
 * and attribute references.
 * @param node - inline AST node to serialise; may be a
 *   plain text run, a formatting span (bold, italic, etc.),
 *   or a macro (link, xref, kbd, etc.)
 * @returns the source-form text of the node, suitable for
 *   concatenation into the ASG "text" value; this is NOT
 *   rendered/display text
 */
function inlineNodeToText(node: InlineNode): string {
  // This closure is recreated on every call to inlineNodeToText.
  // Acceptable for the shallow trees we see in practice; a
  // top-level binding would work too but keeps the helper local.
  const childrenToText = (children: InlineNode[]): string =>
    children.map((child) => inlineNodeToText(child)).join("");
  switch (node.type) {
    case "text": {
      return node.value;
    }
    case "attributeReference": {
      return `{${node.name}}`;
    }
    case "bold": {
      const mark = node.constrained ? "*" : "**";
      return `${mark}${childrenToText(node.children)}${mark}`;
    }
    case "italic": {
      const mark = node.constrained ? "_" : "__";
      return `${mark}${childrenToText(node.children)}${mark}`;
    }
    case "monospace": {
      const mark = node.constrained ? "`" : "``";
      return `${mark}${childrenToText(node.children)}${mark}`;
    }
    case "highlight": {
      const mark = node.constrained ? "#" : "##";
      // The role attribute bracket appears before the opening mark,
      // e.g. [.line-through]#text# — not after it.
      const rolePrefix = node.role === undefined ? "" : `[${node.role}]`;
      return `${rolePrefix}${mark}${childrenToText(node.children)}${mark}`;
    }
    // Macro node types delegate to their dedicated source
    // serialisers in serialize-inline.ts. Those functions
    // reconstruct the full macro syntax (target, attrlist,
    // etc.) and are shared with the printer round-trip.
    case "inlineMacro": {
      return inlineMacroToSource(node);
    }
    case "link": {
      return linkToSource(node);
    }
    case "xref": {
      return xrefToSource(node);
    }
    case "inlineAnchor": {
      return anchorToSource(node);
    }
    case "rawLine": {
      // Comments and preprocessor directives are dropped while
      // READING in Asciidoctor, so the ASG has no node for them and
      // they contribute no text.
      return "";
    }
    case "hardLineBreak": {
      // AsciiDoc hard line break: a space followed by a literal
      // plus sign at end of line, then a newline character.
      return " +\n";
    }
  }
}

// Maps our AST inline mark types to ASG span variants.
const SPAN_VARIANT: Record<string, "strong" | "emphasis" | "code" | "mark"> = {
  bold: "strong",
  italic: "emphasis",
  monospace: "code",
  highlight: "mark",
};

/**
 * Converts a single inline AST node to one or more ASG
 * inline nodes. Spans (bold, italic, etc.) become
 * `AsgInlineSpan` with recursive children; links/xrefs
 * become `AsgInlineRef`; everything else is serialised
 * back to source text as `AsgInlineLiteral`.
 * @param node - inline AST node to convert
 * @returns array of ASG inline nodes (usually one)
 */
function inlineNodeToAsg(node: InlineNode): AsgInline[] {
  switch (node.type) {
    case "bold":
    case "italic":
    case "monospace":
    case "highlight": {
      const { children, constrained } = node;
      return [
        {
          name: "span" as const,
          type: "inline" as const,
          variant: SPAN_VARIANT[node.type],
          form: constrained ? "constrained" : "unconstrained",
          inlines: convertInlines(children),
          location: toAsgLocation(node),
        },
      ];
    }
    default: {
      // Fallback: serialise to source text as a literal.
      // The ASG node is built by picking individual fields
      // rather than spreading `node`; if Node gains new
      // fields, they will not propagate here automatically.
      return [
        {
          name: "text" as const,
          type: "string" as const,
          value: inlineNodeToText(node),
          location: toAsgLocation(node),
        },
      ];
    }
  }
}

/**
 * Converts an array of inline AST nodes to the ASG inline
 * format. Each node is converted individually: spans become
 * structured `AsgInlineSpan` nodes; other nodes are
 * serialised to source text as `AsgInlineLiteral`.
 *
 * Adjacent text literals are NOT merged — each AST node
 * produces its own ASG entry. The TCK fixtures expect
 * this 1:1 correspondence.
 * @param nodes - inline AST nodes from a paragraph or
 *   other block that carries inline content
 * @returns ASG inlines array, or empty if nodes is empty
 */
export function convertInlines(nodes: InlineNode[]): AsgInline[] {
  return nodes.flatMap((node) => inlineNodeToAsg(node));
}
