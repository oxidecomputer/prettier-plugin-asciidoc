/**
 * A one-line spelling of an inline tree, shared by the suites that
 * compare whole inline shapes rather than probing node by node:
 * tests/parser/inline-resolution-order.test.ts (which span wins where
 * two overlap) and tests/parser/doubled-marks.test.ts (where an
 * unconstrained delimiter stands). Both ask the same question of a
 * parsed paragraph, so they ask it through one function.
 */
import { asParagraph } from "../helpers.js";
import { parse } from "../../src/parser.js";
import type { InlineNode } from "../../src/ast.js";

/**
 * A one-line spelling of an inline tree: `bold[...]` for a span,
 * `"..."` for a text run, `u`/`c` for unconstrained/constrained. Tests
 * compare whole shapes rather than probing node by node, because what
 * a resolution change moves is which span exists at all, not one field
 * of one node.
 * @param node - an inline node
 * @returns its shape, with children nested inside the brackets
 */
export function shapeOf(node: InlineNode): string {
  if (node.type === "text") return JSON.stringify(node.value);
  if (node.type === "curvedQuote") {
    const spelling = node.quote === "double" ? "d" : "s";
    return `curved${spelling}[${node.children.map(shapeOf).join(",")}]`;
  }
  if (!("children" in node)) return node.type;
  const spelling = "constrained" in node && node.constrained ? "c" : "u";
  return `${node.type}${spelling}[${node.children.map(shapeOf).join(",")}]`;
}

/**
 * The shape of a one-paragraph document's inline content.
 * @param input - the document source
 * @returns one shape string per top-level inline node
 */
export function shapes(input: string): string[] {
  const document = parse(input);
  const [block] = document.children;
  return asParagraph(block).children.map(shapeOf);
}
