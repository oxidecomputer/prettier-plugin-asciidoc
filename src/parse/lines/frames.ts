/**
 * The shared vocabulary reader.ts and list-reader.ts both need, with
 * NOTHING imported back from either of them — the module that lets
 * the readers form a DAG instead of a cycle (`import graph` in
 * tests/parser/architecture.test.ts gates cycles at zero).
 *
 * No frame lives here any more, and no seam either. Every composite
 * construct is read extent-first — delimited blocks at their opening
 * line, list items through itemExtent — and headings are leaves, so
 * nothing closes on a later line and the reader keeps no stack; and
 * the scans that read those extents are pure functions over lines,
 * so there is no reader interface left to declare. What remains is
 * the pure units: {@link fragmentOfLine} and the leaf/held-metadata
 * builder tables. The file keeps its historical name because a
 * rename would churn every import for a word.
 */
import type { BlockNode } from "../../ast.js";
import {
  buildBlockAnchor,
  buildBlockAttributeList,
  buildBlockTitle,
  buildPageBreak,
  buildRawBlockLine,
  buildThematicBreak,
} from "../build/metadata.js";
import type { Fragment, LocationIndex } from "../positions.js";
import type { LineKind } from "./classify.js";
import type { SourceLine } from "./split.js";

/**
 * One line's span, for the builders. A block node is built from the
 * RAW spelling of its line — trailing whitespace and all — and that is
 * what its position measures; classification used the rstripped
 * `text`.
 * @param line - the source line
 * @param from - raw start column index, 0-based
 * @param to - raw end column index, exclusive
 * @returns the span
 */
export function fragmentOfLine(
  line: SourceLine,
  from = 0,
  to = line.raw.length,
): Fragment {
  return { image: line.raw.slice(from, to), offset: line.offset + from };
}

/**
 * A line kind that IS a block, whole and entire: no extent to read
 * and nothing to open. The union {@link leafBuilder} is total over.
 */
type LeafKind = "thematicBreak" | "pageBreak";

// The builder each field-free leaf kind goes to. The field-CARRYING
// leaves (attribute entries, block macros) take the classifier's
// parse and dispatch in the reader's own switch
// (BlockReader.parsedLeaf), where the kind's narrowing is free.
const LEAF_BUILDERS: Record<
  LeafKind,
  (line: Fragment, at: LocationIndex) => BlockNode
> = {
  thematicBreak: buildThematicBreak,
  pageBreak: buildPageBreak,
};

/**
 * Whether a classified line is a block, whole and entire — a narrowing
 * so {@link leafBuilder} needs no absent case.
 * @param kind - what the classifier made of a line
 * @returns true when {@link leafBuilder} has a builder for it
 */
export function isLeafKind(kind: LineKind["kind"]): kind is LeafKind {
  return Object.hasOwn(LEAF_BUILDERS, kind);
}

/**
 * The builder one leaf kind's node comes from.
 * @param kind - a leaf line kind, narrowed by {@link isLeafKind} or by
 *   the caller's own `case` labels
 * @returns the builder for it
 */
export function leafBuilder(
  kind: LeafKind,
): (line: Fragment, at: LocationIndex) => BlockNode {
  return LEAF_BUILDERS[kind];
}

// Line kinds `parse_block_metadata_line` claims, and the node each
// becomes: an anchor, an attribute list, a block title, and the
// comment/preprocessor lines the same scan consumes. An attribute
// ENTRY is deliberately absent: Ruby processes it as a document
// attribute where it stands, so it stays a leaf where it was
// written. This table is the one source of truth for which line
// kinds are held-back metadata.
const HELD_BUILDERS = new Map<
  LineKind["kind"],
  (line: Fragment, at: LocationIndex) => BlockNode
>([
  ["anchor", buildBlockAnchor],
  ["attributeLine", buildBlockAttributeList],
  ["blockTitle", buildBlockTitle],
  ["raw", buildRawBlockLine],
]);

/**
 * The node a held-back metadata line becomes once it is known what it
 * annotates — what `BlockReader.holdMetadata` in reader.ts holds and
 * releases.
 * @param kind - what the classifier made of the line
 * @param line - the line itself
 * @param at - the document's location index
 * @returns the node, or undefined when the line is not held-back
 *   metadata
 */
export function heldMetadataNode(
  kind: LineKind,
  line: SourceLine,
  at: LocationIndex,
): BlockNode | undefined {
  return HELD_BUILDERS.get(kind.kind)?.(fragmentOfLine(line), at);
}
