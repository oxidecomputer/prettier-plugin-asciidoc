/**
 * Parser pipeline: source text → BlockReader → AST.
 *
 * There is no lexer and no parser generator. The BlockReader
 * (src/parse/lines/reader.ts) walks the source lines once with an
 * explicit frame stack; a frame IS the node under construction, and
 * closing one attaches its node to its parent. Paragraph text is
 * tokenized by src/parse/inline/tokenize.ts and paired into spans by
 * src/parse/inline/inline-node-builder.ts.
 *
 * The reader is total over any input: nothing here can fail, so there
 * is no recovery concept and no partial tree — malformed constructs
 * are paragraphs and text, exactly as they were.
 */
import type { Parser } from "prettier";
import type { BlockNode, DocumentNode } from "./ast.js";
import { readDocument } from "./parse/lines/reader.js";

/**
 * Return a node's start offset for Prettier's cursor
 * tracking and range formatting.
 * @param node - Any AST node with a position
 * @returns Zero-based start offset in source text
 */
function locStart(node: BlockNode | DocumentNode): number {
  return node.position.start.offset;
}

/**
 * Return a node's end offset for Prettier's cursor
 * tracking and range formatting.
 * @param node - Any AST node with a position
 * @returns Zero-based exclusive end offset in source
 */
function locEnd(node: BlockNode | DocumentNode): number {
  return node.position.end.offset;
}

/**
 * Run the parse pipeline.
 *
 * Both the Prettier `Parser.parse` entry point and a named export, so
 * tests can exercise the parser without going through formatting.
 * @param text - full AsciiDoc source document
 * @returns root DocumentNode of the AST
 */
export function parse(text: string): DocumentNode {
  return readDocument(text);
}

const parser: Parser<DocumentNode> = {
  parse,
  astFormat: "asciidoc-ast",
  locStart,
  locEnd,
};

export default parser;
export { locStart, locEnd };
