/**
 * NODE BUILDERS for tests that hand-build a piece of the tree.
 *
 * A test that writes a node as an object literal restates the node's
 * whole shape, so every field `src/ast.ts` gains has to be written
 * again in every literal or the file stops compiling. A builder with
 * a default for every field is where that cost is paid once.
 *
 * WHY DEFAULTS AND NOT A REQUIRED ARGUMENT. The literals this
 * replaces are fixtures for something else entirely - `gapsOf` reads
 * only positions, the parity normaliser reads only the key order -
 * and spelling out the fields they do not read is what made them
 * fan-out. A caller states the fields its assertion is ABOUT and
 * nothing else, so the diff of a landing field is this file.
 *
 * WHAT A DEFAULT COSTS, stated so a reader can weigh it: a builder
 * used on the EXPECTED side of `toEqual` asserts its defaults too, so
 * a test whose subject is a field must override that field rather
 * than lean on the default agreeing with the code under test. The
 * rows that do that say so where they call.
 *
 * A KIND GETS A BUILDER WHEN A TEST BUILDS IT. This is not a mirror
 * of `src/ast.ts` - a second full copy of the tree's shape is the
 * thing the module exists to remove, and an unused builder would be
 * exactly that.
 */
import {
  blockWhitespace,
  PLAIN_WHITESPACE_CONTEXT,
} from "../../src/whitespace-fact.js";
import type { ListNode, Location, ParagraphNode } from "../../src/ast.js";
import { NO_PACKED_TEXT } from "../../src/line-verdict.js";

/**
 * The fields a builder's caller may set: every field of the node
 * except its discriminant, which the builder owns. Spelled once so
 * that a new builder cannot forget to exclude `type`, which is what
 * would let a caller build a node of the wrong kind.
 */
type Fields<NodeType> = Readonly<Partial<Omit<NodeType, "type">>>;

/**
 * A node's position, from two offsets on line 1.
 *
 * Column is derived as `offset + 1`, which is true for a single-line
 * document and is what every caller here wants; a test that needs a
 * real multi-line position writes the position itself.
 * @param from - the inclusive start offset
 * @param to - the exclusive end offset
 * @returns the position
 */
export function span(
  from: number,
  to: number,
): { start: Location; end: Location } {
  return { start: at(from), end: at(to) };
}

/**
 * One location on line 1 at a character offset.
 * @param offset - the character offset
 * @returns the location
 */
function at(offset: number): Location {
  return { offset, line: 1, column: offset + 1 };
}

/**
 * The position a builder gives a node whose caller did not place one.
 *
 * An empty span at the start of the document: it is a position no
 * assertion about layout would pass with by accident, which is what a
 * default has to be when `position` is the one field almost every
 * caller does set.
 * @returns the empty span
 */
function nowhere(): { start: Location; end: Location } {
  return span(0, 0);
}

/**
 * A paragraph node with every field defaulted.
 *
 * The defaults are the values a paragraph of ordinary prose carries:
 * no children, the recorded anchor-blank fact false,
 * and the reading of a block holding no line the packer composes,
 * which is what a childless paragraph is. A test about one of those
 * facts overrides it.
 * @param fields - the fields this caller's assertion is about
 * @returns the node
 */
export function paragraphNode(
  fields: Fields<ParagraphNode> = {},
): ParagraphNode {
  return {
    type: "paragraph",
    children: [],
    blankBelowAnchorLine: false,
    reading: NO_PACKED_TEXT,
    whitespace: blockWhitespace(
      fields.children ?? [],
      PLAIN_WHITESPACE_CONTEXT,
    ),
    position: nowhere(),
    ...fields,
  };
}

/**
 * A list node with every field defaulted.
 *
 * The defaults spell the plainest list there is, `*` unordered with
 * no items, because that is the list every caller here wanted and
 * none of them said so.
 * @param fields - the fields this caller's assertion is about
 * @returns the node
 */
export function listNode(fields: Fields<ListNode> = {}): ListNode {
  return {
    type: "list",
    variant: "unordered",
    marker: "*",
    children: [],
    position: nowhere(),
    ...fields,
  };
}
