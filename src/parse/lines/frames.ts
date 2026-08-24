/**
 * The shared vocabulary reader.ts and list-reader.ts both need, with
 * NOTHING imported back from either of them — the module that lets
 * the readers form a DAG instead of a cycle (`import graph` in
 * tests/parser/architecture.test.ts gates cycles at zero, Ruling 31).
 *
 * No frame lives here any more. Every composite construct is read
 * extent-first — delimited blocks at their opening line, list items
 * through itemExtent — and headings are leaves (spec D10), so nothing
 * closes on a later line and the reader keeps no stack. What remains
 * is the seam and the leaf tables: {@link ListHost} (what
 * extent-first list reading needs from a reader),
 * {@link VerbatimRole} (what a resolved verbatim open builds),
 * {@link fragmentOfLine}, and the leaf/held-metadata builder tables.
 * The file keeps its historical name because a rename would churn
 * every import and the metrics SEAMS registry for a word: "hosts"
 * would describe half of it no better than "frames" does.
 */
import type {
  BlockNode,
  DelimitedBlockNode,
  ParentBlockNode,
} from "../../ast.js";
import {
  buildBlockAnchor,
  buildBlockAttributeList,
  buildBlockTitle,
  buildPageBreak,
  buildRawBlockLine,
  buildThematicBreak,
} from "../build/metadata.js";
import type { InlineToken } from "../inline/tokens.js";
import type { Fragment, LocationIndex } from "../positions.js";
import type { LineKind } from "./classify.js";
import type { SourceLine } from "./split.js";

/**
 * The node the reader builds at OPEN for a verbatim delimited block —
 * decided by resolveDelimitedOpen (lines/open-style.ts) and handed
 * straight to buildVerbatimBlock with the extent, so nothing is ever
 * re-derived from the opener (spec D4a).
 */
export type VerbatimRole =
  | {
      /** Role discriminant: a verbatim delimited block. */
      readonly builds: "delimitedBlock";
      /** Which delimited block it builds. */
      readonly variant: DelimitedBlockNode["variant"];
      /** The masqueraded parent's delimiter, when a style re-modeled it. */
      readonly sourceDelimiter?: ParentBlockNode["variant"];
      /** Set for a Markdown fence, which implies the `source` style. */
      readonly fenced?: true;
      /** The fence's language hint, when its opening line carried one. */
      readonly language?: string;
    }
  | {
      /** Role discriminant: a comment block, which is a CommentNode. */
      readonly builds: "comment";
    }
  | {
      /** Role discriminant: a table, an opaque verbatim extent (D1). */
      readonly builds: "table";
    };

/**
 * The seam the list reader (list-reader.ts) consumes — everything
 * extent-first reading needs from a BlockReader, and nothing else.
 * A confined reader implements it too, which is what lets readList
 * recurse: an inner list is read from an outer item's buffer with the
 * SAME functions. Nothing here writes back into the host: a list
 * lands where its reader's CALLER puts it — the value returns, and
 * there is no callback to mis-wire.
 */
export interface ListHost {
  /** The lines this host reads — the document's, or an item's buffer. */
  readonly lines: readonly SourceLine[];
  /**
   * EVERY line of the document, unerased — gap spellings are read from
   * here by 1-based line number, because a buffer omits lines the
   * extent scan consumed (skipped blanks) and blanks the ones Ruby
   * erased.
   */
  readonly documentLines: readonly SourceLine[];
  /** The document's offset→Location index, for the builders. */
  readonly at: LocationIndex;
  /** The whole document — verbatim content is sliced from it. */
  readonly source: string;
  /**
   * Whether a `+` printed at the very end of this host's lines
   * re-reads inert — true for the document reader (EOF), the
   * enclosing item's own tail-safety for an item-confined one, and
   * `closed || enclosing` for a compound interior, decided at the
   * compound open (spec D2/D3). The extent scan inherits it as its
   * stream-end boundary fact (see `ExtentBounds.tailSafe` in
   * list-reader.ts).
   */
  readonly tailSafe: boolean;
  /**
   * Read one item's interior: the principal text (the `listItem`-set
   * paragraph from the marker line, text starting at the marker's
   * `markerEnd`) and then every block, via a fresh confined
   * BlockReader over `[markerLine, ...buffer]`, which collects the
   * item's blocks into its own flat sequence and answers the
   * classifier with its own context.
   *
   * DEVIATION from the spec's §3 seam sketch, called out on purpose:
   * the sketch lists `readItemText` and `confine` as two members;
   * here the text is read INSIDE confine, because the text's
   * continuation lines must be consumed from the confined reader's
   * own stream (`readParagraph` advances its host), and one entry
   * point means one stream authority — no index handshake between
   * two readers.
   */
  readonly confine: (
    markerLine: SourceLine,
    marker: {
      /** The marker style, for the confined reader's ancestry. */
      readonly style: string;
      /** Raw column where the item's text starts. */
      readonly markerEnd: number;
    },
    buffer: readonly SourceLine[],
    tailSafe: boolean,
  ) => {
    /** The principal text's tokens. */
    text: InlineToken[];
    /** The item's blocks, in source order. */
    blocks: BlockNode[];
  };
}

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
export type LeafKind = "thematicBreak" | "pageBreak";

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
