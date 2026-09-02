/**
 * The LEAF-BUILDER table and nothing else: which line kinds are a
 * block whole and entire, and the constructor each one takes. Its
 * only importer is reader.ts, which dispatches through it, and it
 * imports nothing back from any reader, so no cycle can form here
 * (`import graph` in tests/parser/architecture.test.ts gates cycles
 * at zero).
 *
 * No frame lives here any more, and no seam either. Every composite
 * construct is read extent-first (delimited blocks at their opening
 * line, list items through itemExtent) and headings are leaves, so
 * nothing closes on a later line and the reader keeps no stack; the
 * scans that read those extents are pure functions over lines, so
 * there is no reader interface left to declare. What used to sit
 * beside the table went to the modules that answer for it:
 * `fragmentOfLine` to split.ts, beside the `SourceLine` it measures,
 * and the held-metadata table to held-metadata.ts, beside its one
 * caller. The file keeps its historical name because a rename would
 * churn every import for a word.
 */
import type { BlockNode } from "../../ast.js";
import { buildPageBreak, buildThematicBreak } from "../build/metadata.js";
import type { Fragment, LocationIndex } from "../positions.js";
import type { LineKind } from "./classify.js";

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
